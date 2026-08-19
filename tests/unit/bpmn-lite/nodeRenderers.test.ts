import { describe, it, expect } from 'vitest';

import {
    SVG_NS,
    renderStartEvent,
    renderEndEvent,
    renderTask,
    renderExclusiveGateway,
    renderParallelGateway,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnElementKind,
} from '../../../src/bpmn-lite/index.js';

/**
 * Build a `BpmnElement` of the given kind. Default geometry matches
 * BPMN modeler convention (events 36×36, tasks 100×80, gateways 50×50).
 */
function elementOf(
    kind: BpmnElementKind,
    overrides: Partial<BpmnElement> = {},
): BpmnElement {
    const sizes: Record<BpmnElementKind, { width: number; height: number }> = {
        startEvent: { width: 36, height: 36 },
        endEvent: { width: 36, height: 36 },
        task: { width: 100, height: 80 },
        exclusiveGateway: { width: 50, height: 50 },
        parallelGateway: { width: 50, height: 50 },
        inclusiveGateway: { width: 50, height: 50 },
        eventBasedGateway: { width: 50, height: 50 },
        intermediateCatchEvent: { width: 36, height: 36 },
        boundaryEvent: { width: 36, height: 36 },
        // A container, sized to hold a start/activity/end row.
        subProcess: { width: 340, height: 200 },
        // Task-sized: the callee's body lives in another diagram.
        callActivity: { width: 100, height: 80 },
    };
    return {
        id: 'el_1',
        type: kind,
        position: { x: 100, y: 50 },
        size: sizes[kind],
        ...overrides,
    };
}

describe('node renderers', () => {
    describe('common contract -- every renderer', () => {
        const cases: Array<{
            kind: BpmnElementKind;
            renderer: (e: BpmnElement, d: Document) => SVGGElement;
        }> = [
            { kind: 'startEvent', renderer: renderStartEvent },
            { kind: 'endEvent', renderer: renderEndEvent },
            { kind: 'task', renderer: renderTask },
            { kind: 'exclusiveGateway', renderer: renderExclusiveGateway },
            { kind: 'parallelGateway', renderer: renderParallelGateway },
        ];

        for (const { kind, renderer } of cases) {
            it(`${kind}: returns an SVG <g> in the SVG namespace`, () => {
                const g = renderer(elementOf(kind), document);
                expect(g.namespaceURI).toBe(SVG_NS);
                expect(g.tagName.toLowerCase()).toBe('g');
            });

            it(`${kind}: sets data-element-id to the element id`, () => {
                const g = renderer(
                    elementOf(kind, { id: 'custom-id-xyz' }),
                    document,
                );
                expect(g.getAttribute('data-element-id')).toBe('custom-id-xyz');
            });

            it(`${kind}: sets data-element-kind to the element type`, () => {
                const g = renderer(elementOf(kind), document);
                expect(g.getAttribute('data-element-kind')).toBe(kind);
            });

            it(`${kind}: sets transform to translate(x, y)`, () => {
                const g = renderer(
                    elementOf(kind, { position: { x: 250, y: 175 } }),
                    document,
                );
                expect(g.getAttribute('transform')).toBe(
                    'translate(250, 175)',
                );
            });

            it(`${kind}: adds the .coolms-designer__bpmn-element base class`, () => {
                const g = renderer(elementOf(kind), document);
                expect(
                    g.classList.contains('coolms-designer__bpmn-element'),
                ).toBe(true);
            });

            it(`${kind}: omits the <text> label when element.label is undefined`, () => {
                const g = renderer(elementOf(kind), document);
                expect(g.querySelector('.coolms-designer__bpmn-label')).toBeNull();
            });

            it(`${kind}: omits the <text> label when element.label is empty string`, () => {
                const g = renderer(elementOf(kind, { label: '' }), document);
                expect(g.querySelector('.coolms-designer__bpmn-label')).toBeNull();
            });

            it(`${kind}: renders the <text> label when element.label is provided`, () => {
                const g = renderer(
                    elementOf(kind, { label: 'Hello' }),
                    document,
                );
                const text = g.querySelector('.coolms-designer__bpmn-label');
                expect(text).not.toBeNull();
                expect(text?.textContent).toBe('Hello');
            });

            it(`${kind}: never lets a long label exceed the shape's width`, () => {
                // SVG does not auto-wrap, so a single <text> run spilled
                // out both sides of the box ("Apply triage decision" on a
                // 100-wide task). Every line must now fit the budget.
                const g = renderer(
                    elementOf(kind, {
                        label: 'Apply triage decision for the inbound lead',
                    }),
                    document,
                );
                const text = g.querySelector('.coolms-designer__bpmn-label')!;
                const lines = [...text.querySelectorAll('tspan')];
                expect(lines.length).toBeGreaterThan(1);

                const size = elementOf(kind).size;
                // `inside` wraps to the box; `below` gets a wider floor
                // because a 36px event legitimately carries a wider caption.
                const budget = Math.max(size.width, 96) / 6.5;
                for (const line of lines) {
                    expect(
                        (line.textContent ?? '').length,
                        `line "${line.textContent}" must fit`,
                    ).toBeLessThanOrEqual(Math.floor(budget));
                }
            });

            it(`${kind}: keeps every tspan horizontally centred on the shape`, () => {
                const g = renderer(
                    elementOf(kind, { label: 'One two three four five six' }),
                    document,
                );
                const size = elementOf(kind).size;
                for (const line of g.querySelectorAll('tspan')) {
                    expect(line.getAttribute('x')).toBe(String(size.width / 2));
                }
            });

            it(`${kind}: emits a hover <title> (native tooltip) carrying the label`, () => {
                const g = renderer(
                    elementOf(kind, { label: 'My element' }),
                    document,
                );
                const title = g.querySelector('title');
                expect(title).not.toBeNull();
                expect(title?.textContent).toBe('My element');
                // <title> must be the FIRST child for the native tooltip to work.
                expect(g.firstElementChild?.tagName.toLowerCase()).toBe('title');
                expect(g.getAttribute('aria-label')).toBe('My element');
            });

            it(`${kind}: falls back to a humanised kind for the hover title when unlabeled`, () => {
                const g = renderer(elementOf(kind), document);
                const title = g.querySelector('title');
                expect(title).not.toBeNull();
                // Even with no visible <text> label, hover still shows something.
                expect(title?.textContent).not.toBe('');
                expect(g.getAttribute('aria-label')).toBe(title?.textContent);
            });
        }
    });

    describe('startEvent', () => {
        it('paints a single <circle> centered in the bbox', () => {
            const el = elementOf('startEvent');
            const g = renderStartEvent(el, document);
            const circles = g.querySelectorAll('circle');
            expect(circles).toHaveLength(1);

            const c = circles[0]!;
            expect(c.getAttribute('cx')).toBe('18');
            expect(c.getAttribute('cy')).toBe('18');
            expect(c.getAttribute('r')).toBe('18');
        });

        it('adds the start-event modifier class', () => {
            const g = renderStartEvent(elementOf('startEvent'), document);
            expect(
                g.classList.contains('coolms-designer__bpmn-start-event'),
            ).toBe(true);
        });
    });

    describe('endEvent', () => {
        it('paints a single <circle> centered in the bbox', () => {
            const g = renderEndEvent(elementOf('endEvent'), document);
            const circles = g.querySelectorAll('circle');
            expect(circles).toHaveLength(1);
        });

        it('adds the end-event modifier class', () => {
            const g = renderEndEvent(elementOf('endEvent'), document);
            expect(
                g.classList.contains('coolms-designer__bpmn-end-event'),
            ).toBe(true);
        });
    });

    describe('task', () => {
        it('paints a single rounded <rect> matching the bbox', () => {
            const el = elementOf('task');
            const g = renderTask(el, document);
            const rects = g.querySelectorAll('rect');
            expect(rects).toHaveLength(1);

            const r = rects[0]!;
            expect(r.getAttribute('x')).toBe('0');
            expect(r.getAttribute('y')).toBe('0');
            expect(r.getAttribute('width')).toBe('100');
            expect(r.getAttribute('height')).toBe('80');
            expect(r.getAttribute('rx')).toBe('6');
            expect(r.getAttribute('ry')).toBe('6');
        });

        it('label placement is `inside` -- centered with dominant-baseline middle', () => {
            const g = renderTask(
                elementOf('task', { label: 'Send invoice' }),
                document,
            );
            const text = g.querySelector('.coolms-designer__bpmn-label')!;
            expect(text.getAttribute('x')).toBe('50'); // width / 2
            expect(text.getAttribute('y')).toBe('40'); // height / 2
            expect(text.getAttribute('dominant-baseline')).toBe('middle');
        });
    });

    describe('exclusiveGateway', () => {
        it('paints a diamond <polygon> + an X marker <path>', () => {
            const el = elementOf('exclusiveGateway');
            const g = renderExclusiveGateway(el, document);

            const polygons = g.querySelectorAll('polygon');
            expect(polygons).toHaveLength(1);
            expect(polygons[0]!.getAttribute('points')).toBe(
                '25,0 50,25 25,50 0,25',
            );

            const paths = g.querySelectorAll('path');
            expect(paths).toHaveLength(1);
            // X marker -- two crossing lines via two M-L segments.
            const d = paths[0]!.getAttribute('d')!;
            expect(d).toMatch(/^M .+ L .+ M .+ L .+$/);
        });

        it('marker carries the gateway-marker class for CSS targeting', () => {
            const g = renderExclusiveGateway(
                elementOf('exclusiveGateway'),
                document,
            );
            const marker = g.querySelector(
                '.coolms-designer__bpmn-gateway-marker',
            );
            expect(marker).not.toBeNull();
        });

        it('label placement is `below` -- 14 px under the bbox', () => {
            const g = renderExclusiveGateway(
                elementOf('exclusiveGateway', { label: 'Approved?' }),
                document,
            );
            const text = g.querySelector('.coolms-designer__bpmn-label')!;
            expect(text.getAttribute('x')).toBe('25');
            expect(text.getAttribute('y')).toBe('64'); // height(50) + 14
            expect(text.getAttribute('dominant-baseline')).toBe('hanging');
        });
    });

    describe('parallelGateway', () => {
        it('paints a diamond <polygon> + a + marker <path>', () => {
            const el = elementOf('parallelGateway');
            const g = renderParallelGateway(el, document);

            const polygons = g.querySelectorAll('polygon');
            expect(polygons).toHaveLength(1);
            expect(polygons[0]!.getAttribute('points')).toBe(
                '25,0 50,25 25,50 0,25',
            );

            const paths = g.querySelectorAll('path');
            expect(paths).toHaveLength(1);
        });

        it('marker carries the gateway-marker class', () => {
            const g = renderParallelGateway(
                elementOf('parallelGateway'),
                document,
            );
            const marker = g.querySelector(
                '.coolms-designer__bpmn-gateway-marker',
            );
            expect(marker).not.toBeNull();
        });

        it('+ marker is distinct from the exclusiveGateway X marker', () => {
            const xg = renderExclusiveGateway(
                elementOf('exclusiveGateway'),
                document,
            );
            const pg = renderParallelGateway(
                elementOf('parallelGateway'),
                document,
            );
            const xMarker = xg.querySelector('.coolms-designer__bpmn-gateway-marker')!;
            const pMarker = pg.querySelector('.coolms-designer__bpmn-gateway-marker')!;
            expect(xMarker.getAttribute('d')).not.toBe(
                pMarker.getAttribute('d'),
            );
        });
    });
});
