import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    StateMachineEditor,
    emptyStateMachineModel,
    DEFAULT_PLACE_SIZE,
    SVG_NS,
} from '../../../src/state-machine/index.js';
import type {
    SmPlace,
    SmTransition,
    StateMachineModel,
} from '../../../src/state-machine/index.js';

/**
 * StateMachineEditor tests — the render half: paint-on-construct,
 * place + transition SVG, the initial marker, guard glyph, dangling-
 * endpoint skip, self-loop, load() replace, and the empty-model banner.
 * Mirrors the BpmnLiteEditor paint tests.
 */
describe('StateMachineEditor', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    function place(id: string, x: number, initial = false): SmPlace {
        return {
            id,
            position: { x, y: 40 },
            size: DEFAULT_PLACE_SIZE,
            ...(initial ? { initial: true } : {}),
        };
    }

    function transition(
        id: string,
        name: string,
        from: string,
        to: string,
        guard?: string,
    ): SmTransition {
        return { id, name, from, to, ...(guard !== undefined ? { guard } : {}) };
    }

    function model(over: Partial<StateMachineModel> = {}): StateMachineModel {
        return {
            workflowName: 'order_lifecycle',
            supports: [],
            markingProperty: 'status',
            places: [place('draft', 40, true), place('submitted', 280)],
            transitions: [transition('t_submit', 'submit', 'draft', 'submitted')],
            ...over,
        };
    }

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svgGroup = makeSvgGroup();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('paints a <g> per place with its name + the initial marker', () => {
        const editor = new StateMachineEditor({ host, svgGroup, initialModel: model() });

        const places = editor.paintedPlacesElement!;
        const placeGs = places.querySelectorAll('g[data-place-id]');
        expect(placeGs.length).toBe(2);

        const draft = places.querySelector('g[data-place-id="draft"]')!;
        expect(draft.classList.contains('coolms-designer__sm-place--initial')).toBe(true);
        expect(
            draft.querySelector('.coolms-designer__sm-place-label')!.textContent,
        ).toBe('draft');
        // The initial place carries the entry-dot marker.
        expect(draft.querySelector('.coolms-designer__sm-initial-dot')).not.toBeNull();

        const submitted = places.querySelector('g[data-place-id="submitted"]')!;
        expect(submitted.classList.contains('coolms-designer__sm-place--initial')).toBe(false);
        expect(submitted.querySelector('.coolms-designer__sm-initial-dot')).toBeNull();

        editor.dispose();
    });

    it('paints a transition path with the editor-scoped arrowhead + the transition name', () => {
        const editor = new StateMachineEditor({ host, svgGroup, initialModel: model() });

        const transitions = editor.paintedTransitionsElement!;
        // The <defs> arrowhead marker is present + scoped to this instance.
        expect(transitions.querySelector(`#${editor.arrowheadMarkerId}`)).not.toBeNull();

        const edges = transitions.querySelectorAll('g[data-transition-id]');
        expect(edges.length).toBe(1);
        const edge = edges[0]!;
        expect(edge.getAttribute('data-transition-from')).toBe('draft');
        expect(edge.getAttribute('data-transition-to')).toBe('submitted');

        const path = edge.querySelector('.coolms-designer__sm-transition-path')!;
        expect(path.getAttribute('marker-end')).toBe(`url(#${editor.arrowheadMarkerId})`);
        // Straight segment between distinct places => a single "L" line.
        expect(path.getAttribute('d')).toMatch(/^M .* L /);

        expect(
            edge.querySelector('.coolms-designer__sm-transition-label')!.textContent,
        ).toBe('submit');

        editor.dispose();
    });

    it('flags a guarded transition + appends the guard glyph to its label', () => {
        const editor = new StateMachineEditor({
            host,
            svgGroup,
            initialModel: model({
                transitions: [
                    transition('t_submit', 'submit', 'draft', 'submitted', 'subject.total > 0'),
                ],
            }),
        });

        const label = editor.paintedTransitionsElement!.querySelector(
            '.coolms-designer__sm-transition-label',
        )!;
        expect(label.classList.contains('coolms-designer__sm-transition-label--guarded')).toBe(true);
        expect(label.textContent).toContain('submit');
        expect(label.textContent).toContain('guard');

        editor.dispose();
    });

    it('skips a transition whose endpoint does not resolve to a place', () => {
        const editor = new StateMachineEditor({
            host,
            svgGroup,
            initialModel: model({
                transitions: [transition('t_dangling', 'go', 'draft', 'nowhere')],
            }),
        });
        expect(
            editor.paintedTransitionsElement!.querySelectorAll('g[data-transition-id]').length,
        ).toBe(0);
        editor.dispose();
    });

    it('draws a self-transition as a loop (cubic path)', () => {
        const editor = new StateMachineEditor({
            host,
            svgGroup,
            initialModel: model({
                places: [place('draft', 40, true)],
                transitions: [transition('t_touch', 'touch', 'draft', 'draft')],
            }),
        });
        const path = editor.paintedTransitionsElement!.querySelector(
            '.coolms-designer__sm-transition-path',
        )!;
        expect(path.getAttribute('d')).toContain('C');
        editor.dispose();
    });

    it('load() replaces the model, repaints, and emits change', () => {
        const editor = new StateMachineEditor({ host, svgGroup });
        const seen: StateMachineModel[] = [];
        editor.onChange((m) => seen.push(m));

        editor.load(model());
        expect(seen.length).toBe(1);
        expect(editor.state.places.length).toBe(2);
        expect(
            editor.paintedPlacesElement!.querySelectorAll('g[data-place-id]').length,
        ).toBe(2);

        editor.dispose();
    });

    it('shows the scaffold banner only while the model is empty', () => {
        const editor = new StateMachineEditor({
            host,
            svgGroup,
            initialModel: emptyStateMachineModel(),
        });
        const banner = host.querySelector<HTMLElement>(
            '[data-coolms-designer-scaffold="state-machine"]',
        )!;
        expect(banner.style.display).toBe('');

        editor.load(model());
        expect(banner.style.display).toBe('none');

        editor.dispose();
    });
});
