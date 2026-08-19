import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    DmnDrdEditor,
    emptyDmnDrdModel,
    defaultSizeForKind,
    SVG_NS,
} from '../../../../src/dmn/drd/index.js';
import type {
    DmnDrdElement,
    DmnDrdModel,
    DmnInformationRequirement,
} from '../../../../src/dmn/drd/index.js';

/**
 * DmnDrdEditor tests — the render half: paint-on-construct, the
 * Decision/InputData node SVG, the requirement path + arrowhead,
 * dangling-endpoint skip, self-reference skip, selection on click,
 * load() replace, and the empty-model banner. Mirrors the
 * StateMachineEditor paint tests.
 */
describe('DmnDrdEditor', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    function node(id: string, kind: 'decision' | 'inputData', x: number, name = id): DmnDrdElement {
        return { id, kind, name, position: { x, y: 40 }, size: defaultSizeForKind(kind) };
    }

    function req(id: string, from: string, to: string): DmnInformationRequirement {
        return { id, from, to };
    }

    function model(over: Partial<DmnDrdModel> = {}): DmnDrdModel {
        return {
            name: 'pricing',
            elements: [
                node('age', 'inputData', 40),
                node('discount', 'decision', 320),
            ],
            requirements: [req('ir_1', 'age', 'discount')],
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

    it('paints a <g> per node with its kind class + name', () => {
        const editor = new DmnDrdEditor({ host, svgGroup, initialModel: model() });

        const els = editor.paintedElementsElement!;
        const elGs = els.querySelectorAll('g[data-element-id]');
        expect(elGs.length).toBe(2);

        const input = els.querySelector('g[data-element-id="age"]')!;
        expect(input.getAttribute('data-element-kind')).toBe('inputData');
        expect(input.classList.contains('coolms-designer__drd-element--inputData')).toBe(true);
        expect(input.querySelector('.coolms-designer__drd-input-box')).not.toBeNull();
        expect(input.querySelector('.coolms-designer__drd-element-label')!.textContent).toBe('age');

        const decision = els.querySelector('g[data-element-id="discount"]')!;
        expect(decision.getAttribute('data-element-kind')).toBe('decision');
        expect(decision.querySelector('.coolms-designer__drd-decision-box')).not.toBeNull();

        editor.dispose();
    });

    it('paints a requirement path with the editor-scoped arrowhead', () => {
        const editor = new DmnDrdEditor({ host, svgGroup, initialModel: model() });

        const reqs = editor.paintedRequirementsElement!;
        // The <defs> arrowhead marker is present + scoped to this instance.
        expect(reqs.querySelector(`#${editor.arrowheadMarkerId}`)).not.toBeNull();

        const edges = reqs.querySelectorAll('g[data-requirement-id]');
        expect(edges.length).toBe(1);
        const edge = edges[0]!;
        expect(edge.getAttribute('data-requirement-from')).toBe('age');
        expect(edge.getAttribute('data-requirement-to')).toBe('discount');

        const path = edge.querySelector('.coolms-designer__drd-requirement-path')!;
        expect(path.getAttribute('marker-end')).toBe(`url(#${editor.arrowheadMarkerId})`);
        // Straight segment between distinct nodes => a single "L" line.
        expect(path.getAttribute('d')).toMatch(/^M .* L /);

        editor.dispose();
    });

    it('skips a requirement whose endpoint does not resolve to a node', () => {
        const editor = new DmnDrdEditor({
            host,
            svgGroup,
            initialModel: model({ requirements: [req('ir_dangle', 'age', 'nowhere')] }),
        });
        expect(
            editor.paintedRequirementsElement!.querySelectorAll('g[data-requirement-id]').length,
        ).toBe(0);
        editor.dispose();
    });

    it('skips a self-referencing requirement (from === to)', () => {
        const editor = new DmnDrdEditor({
            host,
            svgGroup,
            initialModel: model({ requirements: [req('ir_self', 'discount', 'discount')] }),
        });
        expect(
            editor.paintedRequirementsElement!.querySelectorAll('g[data-requirement-id]').length,
        ).toBe(0);
        editor.dispose();
    });

    it('selects a node when its painted box is clicked', () => {
        const editor = new DmnDrdEditor({ host, svgGroup, initialModel: model() });
        const box = editor.paintedElementsElement!.querySelector(
            'g[data-element-id="discount"] .coolms-designer__drd-decision-box',
        )!;
        box.dispatchEvent(new Event('click', { bubbles: true }));
        expect(editor.selection.elementId).toBe('discount');
        editor.dispose();
    });

    it('clears the selection on an empty-canvas click', () => {
        const editor = new DmnDrdEditor({ host, svgGroup, initialModel: model() });
        editor.selection.select({ kind: 'element', id: 'discount' });
        svgGroup.dispatchEvent(new Event('click', { bubbles: true }));
        expect(editor.selection.target).toBeNull();
        editor.dispose();
    });

    it('load() replaces the model, repaints, and emits change', () => {
        const editor = new DmnDrdEditor({ host, svgGroup });
        const seen: DmnDrdModel[] = [];
        editor.onChange((m) => seen.push(m));

        editor.load(model());
        expect(seen.length).toBe(1);
        expect(editor.state.elements.length).toBe(2);
        expect(
            editor.paintedElementsElement!.querySelectorAll('g[data-element-id]').length,
        ).toBe(2);

        editor.dispose();
    });

    it('contentBbox spans every node (null when empty)', () => {
        const empty = new DmnDrdEditor({ host, svgGroup });
        expect(empty.contentBbox()).toBeNull();
        empty.load(model());
        const bbox = empty.contentBbox()!;
        expect(bbox.left).toBeLessThan(bbox.right);
        expect(bbox.top).toBeLessThan(bbox.bottom);
        empty.dispose();
    });

    it('shows the scaffold banner only while the model is empty', () => {
        const editor = new DmnDrdEditor({
            host,
            svgGroup,
            initialModel: emptyDmnDrdModel(),
        });
        const banner = host.querySelector<HTMLElement>(
            '[data-coolms-designer-scaffold="dmn-drd"]',
        )!;
        expect(banner.style.display).toBe('');

        editor.load(model());
        expect(banner.style.display).toBe('none');

        editor.dispose();
    });
});
