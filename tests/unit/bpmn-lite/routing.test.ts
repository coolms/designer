import { describe, it, expect } from 'vitest';

import {
    computeOrthogonalRoute,
    waypointsToPathD,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * Build a task at (x, y) with the default 100×80 size.
 * Position is the top-left corner per BPMN convention.
 */
function task(id: string, x: number, y: number): BpmnElement {
    return {
        id,
        type: 'task',
        position: { x, y },
        size: { width: 100, height: 80 },
    };
}

describe('computeOrthogonalRoute', () => {
    describe('horizontal-dominated routes', () => {
        it('target to the right: exits source-right + enters target-left', () => {
            const source = task('a', 100, 100); // center (150, 140)
            const target = task('b', 400, 100); // center (450, 140)

            const route = computeOrthogonalRoute(source, target);

            expect(route).toHaveLength(4);
            expect(route[0]).toEqual({ x: 200, y: 140 }); // source right edge, mid-y
            expect(route[3]).toEqual({ x: 400, y: 140 }); // target left edge, mid-y
        });

        it('target to the left (backward edge): U-routes via the bottom of the row (F-7.3)', () => {
            const source = task('a', 400, 100); // bottom 180; center (450, 140)
            const target = task('b', 100, 100); // bottom 180; center (150, 140)

            const route = computeOrthogonalRoute(source, target);

            // F-7.3: leftward edges are routed via the row's bottom so they
            // don't overlap the forward flow that almost certainly runs
            // between source and target in the same row (a
            // verification spine's `gw → task.enter_otp` retry-loop case). The
            // straight-through Z-route the pre-F-7.3 router emitted made the
            // retry edge visually disappear under the forward `task → gw`
            // edge. The U-route lifts it out of the conflict.
            expect(route).toHaveLength(4);
            // Exit: source bottom-center.
            expect(route[0]).toEqual({ x: 450, y: 180 });
            // Drop below the deeper bottom (max(180, 180) = 180) + 40 padding = 220.
            expect(route[1]).toEqual({ x: 450, y: 220 });
            // Travel left under the row.
            expect(route[2]).toEqual({ x: 150, y: 220 });
            // Enter: target bottom-center; arrowhead points UP into the target.
            expect(route[3]).toEqual({ x: 150, y: 180 });
        });

        it('backward edge with mismatched bottoms picks the lower of the two for the drop corridor (F-7.3)', () => {
            // Source is taller (bottom 200), target is shorter (bottom 160).
            // Drop must clear the LOWER bottom -- otherwise the corridor
            // would pierce the taller element.
            const source: BpmnElement = {
                id: 's',
                type: 'task',
                position: { x: 400, y: 100 },
                size: { width: 100, height: 100 }, // bottom 200
            };
            const target: BpmnElement = {
                id: 't',
                type: 'task',
                position: { x: 100, y: 100 },
                size: { width: 100, height: 60 }, // bottom 160
            };

            const route = computeOrthogonalRoute(source, target);

            // Drop = max(200, 160) + 40 = 240.
            expect(route[1]?.y).toBe(240);
            expect(route[2]?.y).toBe(240);
            // Source exits at its own bottom (200), target enters at its own bottom (160).
            expect(route[0]).toEqual({ x: 450, y: 200 });
            expect(route[3]).toEqual({ x: 150, y: 160 });
        });

        it('inserts a single bend at the horizontal midpoint', () => {
            const source = task('a', 100, 100);
            const target = task('b', 400, 100);

            const route = computeOrthogonalRoute(source, target);

            // The two middle waypoints share the same x (the bend column).
            expect(route[1]?.x).toBe(route[2]?.x);
            // Bend column is the midpoint between source-right (200) and target-left (400) = 300.
            expect(route[1]?.x).toBe(300);
        });

        it('handles target with different y -- L-shape with vertical leg', () => {
            const source = task('a', 100, 100); // y center 140
            const target = task('b', 500, 300); // y center 340; |dx|=350 > |dy|=200

            const route = computeOrthogonalRoute(source, target);

            expect(route).toHaveLength(4);
            expect(route[0]).toEqual({ x: 200, y: 140 });
            expect(route[3]).toEqual({ x: 500, y: 340 });
            // Bend column at midpoint between 200 and 500 = 350.
            expect(route[1]).toEqual({ x: 350, y: 140 });
            expect(route[2]).toEqual({ x: 350, y: 340 });
        });
    });

    describe('vertical-dominated routes', () => {
        it('target below: exits source-bottom + enters target-top', () => {
            const source = task('a', 100, 100); // center (150, 140)
            const target = task('b', 100, 500); // center (150, 540); |dy|=400 > |dx|=0

            const route = computeOrthogonalRoute(source, target);

            expect(route).toHaveLength(4);
            expect(route[0]).toEqual({ x: 150, y: 180 }); // source bottom edge
            expect(route[3]).toEqual({ x: 150, y: 500 }); // target top edge
        });

        it('target above: exits source-top + enters target-bottom', () => {
            const source = task('a', 100, 500); // center (150, 540)
            const target = task('b', 100, 100); // center (150, 140); dy < 0

            const route = computeOrthogonalRoute(source, target);

            expect(route).toHaveLength(4);
            expect(route[0]).toEqual({ x: 150, y: 500 }); // source top edge
            expect(route[3]).toEqual({ x: 150, y: 180 }); // target bottom edge
        });

        it('inserts a single bend at the vertical midpoint', () => {
            const source = task('a', 100, 100);
            const target = task('b', 100, 500);

            const route = computeOrthogonalRoute(source, target);

            // The two middle waypoints share the same y (the bend row).
            expect(route[1]?.y).toBe(route[2]?.y);
            // Bend row at midpoint between source-bottom (180) and target-top (500) = 340.
            expect(route[1]?.y).toBe(340);
        });
    });

    describe('axis-aligned edge cases', () => {
        it('horizontal-aligned (same y) and target right: collapses to straight Z geometry', () => {
            const source = task('a', 100, 100);
            const target = task('b', 400, 100);

            const route = computeOrthogonalRoute(source, target);

            // All four points share y=140 (the centerline).
            for (const p of route) {
                expect(p.y).toBe(140);
            }
        });

        it('vertical-aligned (same x) and target below: collapses to straight Z geometry', () => {
            const source = task('a', 100, 100);
            const target = task('b', 100, 400);

            const route = computeOrthogonalRoute(source, target);

            // All four points share x=150 (the centerline).
            for (const p of route) {
                expect(p.x).toBe(150);
            }
        });

        it('equal absolute dx and dy -- horizontal-dominated branch wins (>=)', () => {
            const source = task('a', 0, 0); // center (50, 40)
            const target = task('b', 100, 80); // center (150, 120); dx=100, dy=80; |dx|>=|dy|

            const route = computeOrthogonalRoute(source, target);

            // Horizontal-dominated: source exits right (at x=100).
            expect(route[0]?.x).toBe(100);
            expect(route[0]?.y).toBe(40);
        });
    });
});

describe('waypointsToPathD', () => {
    it('empty input returns empty string', () => {
        expect(waypointsToPathD([])).toBe('');
    });

    it('single point emits a sole M segment', () => {
        expect(waypointsToPathD([{ x: 10, y: 20 }])).toBe('M 10,20');
    });

    it('two points emit M + L', () => {
        expect(
            waypointsToPathD([
                { x: 0, y: 0 },
                { x: 100, y: 50 },
            ]),
        ).toBe('M 0,0 L 100,50');
    });

    it('four points emit M + three Ls', () => {
        const d = waypointsToPathD([
            { x: 200, y: 140 },
            { x: 300, y: 140 },
            { x: 300, y: 340 },
            { x: 400, y: 340 },
        ]);
        expect(d).toBe('M 200,140 L 300,140 L 300,340 L 400,340');
    });
});
