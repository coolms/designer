import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    autoLayoutStateMachine,
    StateMachineEditor,
    DEFAULT_PLACE_SIZE,
    SVG_NS,
} from '../../../src/state-machine/index.js';
import type {
    SmPlace,
    SmTransition,
    StateMachineModel,
} from '../../../src/state-machine/index.js';

/**
 * auto-layout tests — columnar topological layering, the
 * all-or-nothing bail, cycle-aware back-edge skipping, converging-branch
 * alignment, dangling/self-loop tolerance, and the StateMachineEditor
 * wiring (auto-apply on load + the explicit re-arrange affordance).
 * Mirrors the BPMN-Lite autoLayout coverage.
 */
describe('autoLayoutStateMachine', () => {
    /** A place at the origin (the deserialize default). */
    function origin(id: string, initial = false): SmPlace {
        return {
            id,
            position: { x: 0, y: 0 },
            size: DEFAULT_PLACE_SIZE,
            ...(initial ? { initial: true } : {}),
        };
    }

    function t(id: string, from: string, to: string): SmTransition {
        return { id, name: id, from, to };
    }

    function byId(places: SmPlace[]): Map<string, SmPlace> {
        return new Map(places.map((p) => [p.id, p]));
    }

    it('lays an at-origin linear lifecycle into ascending columns on one row', () => {
        const out = byId(
            autoLayoutStateMachine(
                [origin('draft', true), origin('submitted'), origin('approved')],
                [t('submit', 'draft', 'submitted'), t('approve', 'submitted', 'approved')],
            ),
        );
        expect(out.get('draft')!.position.x).toBeLessThan(out.get('submitted')!.position.x);
        expect(out.get('submitted')!.position.x).toBeLessThan(out.get('approved')!.position.x);
        // Linear chain — each place is alone in its column, so they share a row.
        expect(out.get('draft')!.position.y).toBe(out.get('submitted')!.position.y);
        expect(out.get('submitted')!.position.y).toBe(out.get('approved')!.position.y);
    });

    it('respects an already-positioned model (all-or-nothing bail)', () => {
        const positioned: SmPlace = {
            id: 'draft',
            position: { x: 40, y: 40 },
            size: DEFAULT_PLACE_SIZE,
            initial: true,
        };
        const out = autoLayoutStateMachine(
            [positioned, origin('submitted')],
            [t('submit', 'draft', 'submitted')],
        );
        // Bail keeps EVERY position verbatim — even submitted's origin.
        expect(out.find((p) => p.id === 'draft')!.position).toEqual({ x: 40, y: 40 });
        expect(out.find((p) => p.id === 'submitted')!.position).toEqual({ x: 0, y: 0 });
    });

    it('skips a re-open back-edge so the forward chain is not inflated', () => {
        // draft → submitted → approved, plus approved → draft (re-open loop).
        const out = byId(
            autoLayoutStateMachine(
                [origin('draft', true), origin('submitted'), origin('approved')],
                [
                    t('submit', 'draft', 'submitted'),
                    t('approve', 'submitted', 'approved'),
                    t('reopen', 'approved', 'draft'),
                ],
            ),
        );
        // Without back-edge stripping, the reopen edge would push draft to the
        // far right. The forward order must hold: draft < submitted < approved.
        expect(out.get('draft')!.position.x).toBeLessThan(out.get('submitted')!.position.x);
        expect(out.get('submitted')!.position.x).toBeLessThan(out.get('approved')!.position.x);
    });

    it('aligns converging branches at the longest-path column', () => {
        // draft → a, draft → b, a → done, b → done.
        const out = byId(
            autoLayoutStateMachine(
                [origin('draft', true), origin('a'), origin('b'), origin('done')],
                [
                    t('ta', 'draft', 'a'),
                    t('tb', 'draft', 'b'),
                    t('ad', 'a', 'done'),
                    t('bd', 'b', 'done'),
                ],
            ),
        );
        // a + b share a column (same x), stack on different rows (different y).
        expect(out.get('a')!.position.x).toBe(out.get('b')!.position.x);
        expect(out.get('a')!.position.y).not.toBe(out.get('b')!.position.y);
        // done sits past both branches.
        expect(out.get('done')!.position.x).toBeGreaterThan(out.get('a')!.position.x);
    });

    it('tolerates a self-transition + a dangling endpoint without crashing', () => {
        const out = byId(
            autoLayoutStateMachine(
                [origin('draft', true), origin('active')],
                [
                    t('touch', 'active', 'active'), // self-loop
                    t('go', 'draft', 'active'),
                    t('dangle', 'active', 'ghost'), // ghost is not a place
                ],
            ),
        );
        expect(out.get('draft')!.position.x).toBeLessThan(out.get('active')!.position.x);
    });

    it('returns an empty array for an empty model', () => {
        expect(autoLayoutStateMachine([], [])).toEqual([]);
    });
});

describe('StateMachineEditor auto-layout wiring', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    function atOriginModel(): StateMachineModel {
        return {
            workflowName: 'order_lifecycle',
            supports: [],
            markingProperty: 'status',
            places: [
                { id: 'draft', position: { x: 0, y: 0 }, size: DEFAULT_PLACE_SIZE, initial: true },
                { id: 'submitted', position: { x: 0, y: 0 }, size: DEFAULT_PLACE_SIZE },
            ],
            transitions: [{ id: 'submit', name: 'submit', from: 'draft', to: 'submitted' }],
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

    it('auto-lays-out an at-origin initialModel on construct', () => {
        const editor = new StateMachineEditor({ host, svgGroup, initialModel: atOriginModel() });
        const submitted = editor.findPlace('submitted')!;
        // submitted moved off the origin to its column.
        expect(submitted.position.x).toBeGreaterThan(0);
        editor.dispose();
    });

    it('auto-lays-out an at-origin model passed to load()', () => {
        const editor = new StateMachineEditor({ host, svgGroup });
        editor.load(atOriginModel());
        expect(editor.findPlace('submitted')!.position.x).toBeGreaterThan(0);
        editor.dispose();
    });

    it('autoLayout() re-arranges positioned places + emits change', () => {
        // A positioned model — load() respects it (bail), positions stay put.
        const positioned: StateMachineModel = {
            workflowName: 'wf',
            supports: [],
            markingProperty: 'status',
            places: [
                { id: 'a', position: { x: 500, y: 500 }, size: DEFAULT_PLACE_SIZE, initial: true },
                { id: 'b', position: { x: 10, y: 10 }, size: DEFAULT_PLACE_SIZE },
            ],
            transitions: [{ id: 'go', name: 'go', from: 'a', to: 'b' }],
        };
        const editor = new StateMachineEditor({ host, svgGroup, initialModel: positioned });
        expect(editor.findPlace('a')!.position).toEqual({ x: 500, y: 500 });

        let emitted = 0;
        editor.onChange(() => emitted++);
        editor.autoLayout();

        expect(emitted).toBe(1);
        // a is the forward root → its column is left of b's.
        expect(editor.findPlace('a')!.position.x).toBeLessThan(editor.findPlace('b')!.position.x);
        editor.dispose();
    });
});
