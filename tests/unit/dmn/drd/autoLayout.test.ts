import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    autoLayoutDmnDrd,
    DmnDrdEditor,
    defaultSizeForKind,
    SVG_NS,
} from '../../../../src/dmn/drd/index.js';
import type {
    DmnDrdElement,
    DmnDrdModel,
    DmnInformationRequirement,
} from '../../../../src/dmn/drd/index.js';

/**
 * M4.j auto-layout tests — columnar topological layering following the
 * information-requirement direction (from → to), the all-or-nothing
 * bail, cycle-aware back-edge skipping, converging-dependency
 * alignment, dangling/self-reference tolerance, and the DmnDrdEditor
 * wiring (auto-apply on load + the explicit re-arrange affordance).
 * Mirrors the state-machine autoLayout coverage.
 */
describe('autoLayoutDmnDrd', () => {
    /** A node at the origin (the deserialize default). */
    function origin(id: string, kind: 'decision' | 'inputData' = 'decision'): DmnDrdElement {
        return { id, kind, name: id, position: { x: 0, y: 0 }, size: defaultSizeForKind(kind) };
    }

    function r(id: string, from: string, to: string): DmnInformationRequirement {
        return { id, from, to };
    }

    function byId(elements: DmnDrdElement[]): Map<string, DmnDrdElement> {
        return new Map(elements.map((e) => [e.id, e]));
    }

    it('lays an at-origin input → decision chain into ascending columns on one row', () => {
        const out = byId(
            autoLayoutDmnDrd(
                [origin('age', 'inputData'), origin('eligible'), origin('offer')],
                [r('ir1', 'age', 'eligible'), r('ir2', 'eligible', 'offer')],
            ),
        );
        expect(out.get('age')!.position.x).toBeLessThan(out.get('eligible')!.position.x);
        expect(out.get('eligible')!.position.x).toBeLessThan(out.get('offer')!.position.x);
        // Linear chain — each node is alone in its column, so they share a row.
        expect(out.get('age')!.position.y).toBe(out.get('eligible')!.position.y);
        expect(out.get('eligible')!.position.y).toBe(out.get('offer')!.position.y);
    });

    it('respects an already-positioned model (all-or-nothing bail)', () => {
        const positioned: DmnDrdElement = {
            id: 'age',
            kind: 'inputData',
            name: 'age',
            position: { x: 40, y: 40 },
            size: defaultSizeForKind('inputData'),
        };
        const out = autoLayoutDmnDrd(
            [positioned, origin('eligible')],
            [r('ir1', 'age', 'eligible')],
        );
        expect(out.find((e) => e.id === 'age')!.position).toEqual({ x: 40, y: 40 });
        expect(out.find((e) => e.id === 'eligible')!.position).toEqual({ x: 0, y: 0 });
    });

    it('skips a back-edge so the forward chain is not inflated', () => {
        // a → b → c, plus c → a (a cycle the DRD shouldn't have, but be safe).
        const out = byId(
            autoLayoutDmnDrd(
                [origin('a'), origin('b'), origin('c')],
                [r('ir1', 'a', 'b'), r('ir2', 'b', 'c'), r('ir3', 'c', 'a')],
            ),
        );
        expect(out.get('a')!.position.x).toBeLessThan(out.get('b')!.position.x);
        expect(out.get('b')!.position.x).toBeLessThan(out.get('c')!.position.x);
    });

    it('aligns converging dependencies at the longest-path column', () => {
        // two inputs feed two sub-decisions which both feed the final decision.
        const out = byId(
            autoLayoutDmnDrd(
                [origin('in1', 'inputData'), origin('in2', 'inputData'), origin('subA'), origin('subB'), origin('final')],
                [
                    r('r1', 'in1', 'subA'),
                    r('r2', 'in2', 'subB'),
                    r('r3', 'subA', 'final'),
                    r('r4', 'subB', 'final'),
                ],
            ),
        );
        // subA + subB share a column (same x), stack on different rows.
        expect(out.get('subA')!.position.x).toBe(out.get('subB')!.position.x);
        expect(out.get('subA')!.position.y).not.toBe(out.get('subB')!.position.y);
        // final sits past both branches.
        expect(out.get('final')!.position.x).toBeGreaterThan(out.get('subA')!.position.x);
    });

    it('tolerates a self-reference + a dangling endpoint without crashing', () => {
        const out = byId(
            autoLayoutDmnDrd(
                [origin('age', 'inputData'), origin('decide')],
                [
                    r('self', 'decide', 'decide'), // self-reference
                    r('go', 'age', 'decide'),
                    r('dangle', 'decide', 'ghost'), // ghost is not a node
                ],
            ),
        );
        expect(out.get('age')!.position.x).toBeLessThan(out.get('decide')!.position.x);
    });

    it('returns an empty array for an empty model', () => {
        expect(autoLayoutDmnDrd([], [])).toEqual([]);
    });
});

describe('DmnDrdEditor auto-layout wiring', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    function atOriginModel(): DmnDrdModel {
        return {
            name: 'pricing',
            elements: [
                { id: 'age', kind: 'inputData', name: 'age', position: { x: 0, y: 0 }, size: defaultSizeForKind('inputData') },
                { id: 'offer', kind: 'decision', name: 'offer', position: { x: 0, y: 0 }, size: defaultSizeForKind('decision') },
            ],
            requirements: [{ id: 'ir1', from: 'age', to: 'offer' }],
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
        const editor = new DmnDrdEditor({ host, svgGroup, initialModel: atOriginModel() });
        // offer moved off the origin to its column (it depends on age).
        expect(editor.findElement('offer')!.position.x).toBeGreaterThan(0);
        editor.dispose();
    });

    it('auto-lays-out an at-origin model passed to load()', () => {
        const editor = new DmnDrdEditor({ host, svgGroup });
        editor.load(atOriginModel());
        expect(editor.findElement('offer')!.position.x).toBeGreaterThan(0);
        editor.dispose();
    });

    it('autoLayout() re-arranges positioned nodes + emits change', () => {
        const positioned: DmnDrdModel = {
            name: 'pricing',
            elements: [
                { id: 'a', kind: 'inputData', name: 'a', position: { x: 500, y: 500 }, size: defaultSizeForKind('inputData') },
                { id: 'b', kind: 'decision', name: 'b', position: { x: 10, y: 10 }, size: defaultSizeForKind('decision') },
            ],
            requirements: [{ id: 'go', from: 'a', to: 'b' }],
        };
        const editor = new DmnDrdEditor({ host, svgGroup, initialModel: positioned });
        expect(editor.findElement('a')!.position).toEqual({ x: 500, y: 500 });

        let emitted = 0;
        editor.onChange(() => emitted++);
        editor.autoLayout();

        expect(emitted).toBe(1);
        // a is the forward root → its column is left of b's.
        expect(editor.findElement('a')!.position.x).toBeLessThan(editor.findElement('b')!.position.x);
        editor.dispose();
    });
});
