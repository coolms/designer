import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { renderDiagram, type DiagramView } from '../../../src/index.js';
import type { BpmnLiteModel } from '../../../src/bpmn-lite/types.js';
import type { StateMachineModel } from '../../../src/state-machine/types.js';
import type { DmnDrdModel } from '../../../src/dmn/drd/types.js';

/**
 * `renderDiagram` is the package's answer to a seam that was published at one
 * end only: `createEditor` paints chrome for surfaces it cannot draw, and the
 * parts needed to draw were all marked internal or shipped in no published
 * entry point.
 *
 * ⚠️ **All three drawing surfaces are exercised here on purpose.** The function
 * claims bpmn-lite, state-machine and dmn-drd. Only one of them can be checked
 * in a browser today, and a claim of three verified once is the same defect
 * this function exists to fix -- something declared supported that nobody
 * proved. So each surface mounts, draws and serializes in this suite.
 */

/** jsdom implements no SVG layout, so getBBox is absent. */
const FAKE_BBOX = { x: 10, y: 20, width: 300, height: 150 } as DOMRect;

beforeAll(() => {
    const proto = SVGElement.prototype as unknown as { getBBox?: () => DOMRect };
    proto.getBBox = () => FAKE_BBOX;
});

let view: DiagramView | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
    view?.destroy();
    view = null;
    host?.remove();
    host = null;
});

function mountHost(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    host = el;
    return el;
}

function bpmnModel(): BpmnLiteModel {
    return {
        processId: 'order.approve',
        elements: [
            { id: 'start', type: 'startEvent', position: { x: 0, y: 0 }, size: { width: 36, height: 36 } },
            { id: 'review', type: 'task', position: { x: 0, y: 0 }, size: { width: 120, height: 80 }, label: 'Review' },
            { id: 'end', type: 'endEvent', position: { x: 0, y: 0 }, size: { width: 36, height: 36 } },
        ],
        flows: [
            { id: 'f1', source: 'start', target: 'review' },
            { id: 'f2', source: 'review', target: 'end' },
        ],
    };
}

function stateMachineModel(): StateMachineModel {
    return {
        workflowName: 'article',
        supports: ['App\\Entity\\Article'],
        markingProperty: 'status',
        places: [
            { id: 'draft', position: { x: 0, y: 0 }, size: { width: 120, height: 60 }, initial: true },
            { id: 'published', position: { x: 0, y: 0 }, size: { width: 120, height: 60 } },
        ],
        transitions: [{ id: 't1', name: 'publish', from: 'draft', to: 'published' }],
    };
}

function drdModel(): DmnDrdModel {
    return {
        name: 'discount',
        elements: [
            { id: 'tier', kind: 'inputData', name: 'Tier', position: { x: 0, y: 0 }, size: { width: 120, height: 50 } },
            { id: 'rate', kind: 'decision', name: 'Rate', position: { x: 0, y: 0 }, size: { width: 160, height: 60 } },
        ],
        requirements: [{ id: 'r1', from: 'tier', to: 'rate' }],
    };
}

describe('renderDiagram', () => {
    // Nodes AND edges are counted on every surface. An earlier version of this
    // suite asserted only `childElementCount > 0`, which stayed green while the
    // edges were silently dropped -- the model used the wrong field names and
    // nothing said so. A count that cannot tell a whole diagram from half of
    // one is not evidence that the surface draws.

    it('draws a BPMN-Lite model into the canvas', () => {
        view = renderDiagram(mountHost(), { surface: 'bpmn-lite', model: bpmnModel() });

        const group = host!.querySelector('.coolms-designer__viewport');
        expect(group).not.toBeNull();
        expect(group!.querySelectorAll('[data-element-id]').length).toBe(3);
        expect(group!.querySelectorAll('[data-flow-id]').length).toBe(2);
    });

    it('draws a state machine', () => {
        view = renderDiagram(mountHost(), { surface: 'state-machine', model: stateMachineModel() });

        const group = host!.querySelector('.coolms-designer__viewport');
        expect(group).not.toBeNull();
        expect(group!.querySelectorAll('[data-place-id]').length).toBe(2);
        expect(group!.querySelectorAll('[data-transition-id]').length).toBe(1);
    });

    it('draws a DMN DRD', () => {
        view = renderDiagram(mountHost(), { surface: 'dmn-drd', model: drdModel() });

        const group = host!.querySelector('.coolms-designer__viewport');
        expect(group).not.toBeNull();
        expect(group!.querySelectorAll('[data-element-id]').length).toBe(2);
        expect(group!.querySelectorAll('[data-requirement-id]').length).toBe(1);
    });

    it('auto-lays out a model whose elements carry no coordinates', () => {
        // Every element above sits at the origin, which is what an
        // engine-authored body looks like. Without layout they would stack.
        view = renderDiagram(mountHost(), { surface: 'bpmn-lite', model: bpmnModel() });

        const positions = Array.from(
            host!.querySelectorAll('[data-element-id]'),
            (el) => el.getAttribute('transform') ?? '',
        );
        expect(new Set(positions).size).toBe(positions.length);
    });

    it('serializes without the editor chrome and with a tight viewBox', () => {
        view = renderDiagram(mountHost(), { surface: 'bpmn-lite', model: bpmnModel() });

        const svg = view.toSvg();
        expect(svg).not.toBeNull();
        // The background rect is a pointer target, not part of the drawing.
        expect(svg).not.toContain('coolms-designer__canvas-bg');
        // pad 12 around the stubbed content box.
        expect(svg).toContain('viewBox="-2 8 324 174"');
        expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    });

    it('serializes without the pan/zoom transform', () => {
        const el = mountHost();
        view = renderDiagram(el, { surface: 'bpmn-lite', model: bpmnModel() });

        // Whatever the viewport is scrolled to must not reach the bytes:
        // otherwise the capture records where somebody left the scrollbar.
        el.querySelector('.coolms-designer__viewport')!.setAttribute('transform', 'translate(999,999) scale(3)');

        expect(view.toSvg()).not.toContain('translate(999,999)');
    });

    it('honours a custom pad', () => {
        view = renderDiagram(mountHost(), { surface: 'bpmn-lite', model: bpmnModel() });

        expect(view.toSvg({ pad: 0 })).toContain('viewBox="10 20 300 150"');
    });

    it('returns null rather than an empty picture when nothing was drawn', () => {
        const proto = SVGElement.prototype as unknown as { getBBox: () => DOMRect };
        const restore = proto.getBBox;
        proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;

        view = renderDiagram(mountHost(), { surface: 'bpmn-lite', model: bpmnModel() });
        expect(view.toSvg()).toBeNull();

        proto.getBBox = restore;
    });

    it('refuses a surface that is not a drawing, and leaves no shell behind', () => {
        const el = mountHost();

        expect(() =>
            // dmn-table renders HTML, has no bbox and nothing to serialize.
            renderDiagram(el, { surface: 'dmn-table', model: bpmnModel() } as never),
        ).toThrow(/not a diagram surface/);

        // A throw that left the shell mounted would leak DOM on every attempt.
        expect(el.querySelector('.coolms-designer')).toBeNull();
    });

    it('unwinds the DOM on destroy, and tolerates a second call', () => {
        const el = mountHost();
        const local = renderDiagram(el, { surface: 'bpmn-lite', model: bpmnModel() });

        expect(el.querySelector('.coolms-designer__canvas')).not.toBeNull();

        local.destroy();
        expect(el.querySelector('.coolms-designer__canvas')).toBeNull();

        expect(() => local.destroy()).not.toThrow();
    });
});
