import { describe, it, expect } from 'vitest';

import {
    SVG_NS,
    arrowheadMarkerId,
    buildArrowheadMarker,
    renderSequenceFlow,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnSequenceFlow,
} from '../../../src/bpmn-lite/index.js';

function task(id: string, x: number, y: number): BpmnElement {
    return {
        id,
        type: 'task',
        position: { x, y },
        size: { width: 100, height: 80 },
    };
}

const markerUrl = 'url(#coolms-designer-arrowhead-1)';

describe('renderSequenceFlow', () => {
    describe('common contract', () => {
        const flow: BpmnSequenceFlow = {
            id: 'f1',
            source: 'a',
            target: 'b',
        };
        const source = task('a', 100, 100);
        const target = task('b', 400, 100);

        it('returns an SVG <g> in the SVG namespace', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            expect(g.namespaceURI).toBe(SVG_NS);
            expect(g.tagName.toLowerCase()).toBe('g');
        });

        it('sets data-flow-id, data-flow-source, data-flow-target', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            expect(g.getAttribute('data-flow-id')).toBe('f1');
            expect(g.getAttribute('data-flow-source')).toBe('a');
            expect(g.getAttribute('data-flow-target')).toBe('b');
        });

        it('adds bpmn-flow + bpmn-sequence-flow CSS classes', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            expect(g.classList.contains('coolms-designer__bpmn-flow')).toBe(
                true,
            );
            expect(
                g.classList.contains('coolms-designer__bpmn-sequence-flow'),
            ).toBe(true);
        });

        it('paints exactly one <path> with the bpmn-flow-path class', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const paths = g.querySelectorAll('path.coolms-designer__bpmn-flow-path');
            expect(paths).toHaveLength(1);
        });

        it('attaches the supplied marker URL via marker-end', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const path = g.querySelector('path.coolms-designer__bpmn-flow-path')!;
            expect(path.getAttribute('marker-end')).toBe(markerUrl);
        });

        it('omits the default-flow marker when isDefault is undefined', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            expect(
                g.querySelector('.coolms-designer__bpmn-flow-default-marker'),
            ).toBeNull();
        });

        it('omits the default-flow marker when isDefault is false', () => {
            const g = renderSequenceFlow(
                { ...flow, isDefault: false },
                source,
                target,
                document,
                markerUrl,
            );
            expect(
                g.querySelector('.coolms-designer__bpmn-flow-default-marker'),
            ).toBeNull();
        });
    });

    describe('auto-routing', () => {
        it('paints the auto-router output when no manual waypoints are set', () => {
            const flow: BpmnSequenceFlow = { id: 'f1', source: 'a', target: 'b' };
            const source = task('a', 100, 100); // exits at x=200, y=140
            const target = task('b', 400, 100); // enters at x=400, y=140

            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const d = g.querySelector('path.coolms-designer__bpmn-flow-path')!
                .getAttribute('d');
            // 4 waypoints -> M + 3 Ls.
            expect(d).toBe('M 200,140 L 300,140 L 300,140 L 400,140');
        });
    });

    describe('manual waypoints', () => {
        it('honours manual waypoints (>= 2) verbatim, bypassing the auto-router', () => {
            const flow: BpmnSequenceFlow = {
                id: 'f1',
                source: 'a',
                target: 'b',
                waypoints: [
                    { x: 10, y: 20 },
                    { x: 30, y: 40 },
                    { x: 50, y: 60 },
                ],
            };
            const source = task('a', 0, 0);
            const target = task('b', 1000, 1000);

            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const d = g.querySelector('path.coolms-designer__bpmn-flow-path')!
                .getAttribute('d');
            expect(d).toBe('M 10,20 L 30,40 L 50,60');
        });

        it('falls back to auto-router when manual waypoints has 0 entries', () => {
            const flow: BpmnSequenceFlow = {
                id: 'f1',
                source: 'a',
                target: 'b',
                waypoints: [],
            };
            const source = task('a', 100, 100);
            const target = task('b', 400, 100);

            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const d = g.querySelector('path.coolms-designer__bpmn-flow-path')!
                .getAttribute('d');
            // 4-point auto-route -- proves the fallback fired.
            expect(d?.match(/L /g)).toHaveLength(3);
        });

        it('falls back to auto-router when manual waypoints has 1 entry', () => {
            const flow: BpmnSequenceFlow = {
                id: 'f1',
                source: 'a',
                target: 'b',
                waypoints: [{ x: 50, y: 60 }],
            };
            const source = task('a', 100, 100);
            const target = task('b', 400, 100);

            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const d = g.querySelector('path.coolms-designer__bpmn-flow-path')!
                .getAttribute('d');
            expect(d?.match(/L /g)).toHaveLength(3);
        });
    });

    describe('default-flow marker', () => {
        const flow: BpmnSequenceFlow = {
            id: 'f1',
            source: 'a',
            target: 'b',
            isDefault: true,
        };
        const source = task('a', 100, 100);
        const target = task('b', 400, 100);

        it('paints the default-flow marker when isDefault is true', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const marker = g.querySelector(
                '.coolms-designer__bpmn-flow-default-marker',
            );
            expect(marker).not.toBeNull();
            expect(marker?.tagName.toLowerCase()).toBe('path');
        });

        it('default marker has a 2-point M + L path', () => {
            const g = renderSequenceFlow(
                flow,
                source,
                target,
                document,
                markerUrl,
            );
            const marker = g.querySelector(
                '.coolms-designer__bpmn-flow-default-marker',
            )!;
            expect(marker.getAttribute('d')).toMatch(/^M [\d.-]+,[\d.-]+ L [\d.-]+,[\d.-]+$/);
        });
    });
});

describe('arrowhead marker', () => {
    it('arrowheadMarkerId is stable + instance-id-suffixed', () => {
        expect(arrowheadMarkerId(1)).toBe('coolms-designer-arrowhead-1');
        expect(arrowheadMarkerId(42)).toBe('coolms-designer-arrowhead-42');
    });

    it('buildArrowheadMarker returns a <marker> element in the SVG namespace', () => {
        const m = buildArrowheadMarker(document, 7);
        expect(m.namespaceURI).toBe(SVG_NS);
        expect(m.tagName.toLowerCase()).toBe('marker');
    });

    it('marker carries the instance-id-suffixed id', () => {
        const m = buildArrowheadMarker(document, 7);
        expect(m.id).toBe('coolms-designer-arrowhead-7');
    });

    it('marker has BPMN arrowhead viewBox + refX + refY + orient', () => {
        const m = buildArrowheadMarker(document, 1);
        expect(m.getAttribute('viewBox')).toBe('0 0 10 10');
        expect(m.getAttribute('refX')).toBe('9');
        expect(m.getAttribute('refY')).toBe('5');
        expect(m.getAttribute('orient')).toBe('auto-start-reverse');
    });

    it('marker holds a single triangle <path>', () => {
        const m = buildArrowheadMarker(document, 1);
        const paths = m.querySelectorAll('path');
        expect(paths).toHaveLength(1);
        expect(paths[0]!.getAttribute('d')).toBe('M 0 0 L 10 5 L 0 10 Z');
    });

    it('marker carries the bpmn-arrowhead class', () => {
        const m = buildArrowheadMarker(document, 1);
        expect(m.classList.contains('coolms-designer__bpmn-arrowhead')).toBe(
            true,
        );
    });
});
