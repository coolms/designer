import { describe, it, expect } from 'vitest';

import {
    autoLayoutBpmnLite,
    bpmnLiteJsonToModel,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnSequenceFlow,
} from '../../../src/bpmn-lite/index.js';

/**
 * auto-layout fallback pins.
 */
describe('autoLayoutBpmnLite', () => {
    function el(
        id: string,
        type: BpmnElement['type'] = 'task',
        position = { x: 0, y: 0 },
    ): BpmnElement {
        return {
            id,
            type,
            position,
            size: type === 'task' ? { width: 100, height: 80 } : { width: 36, height: 36 },
        };
    }

    function flow(id: string, source: string, target: string): BpmnSequenceFlow {
        return { id, source, target };
    }

    it('empty input -> empty output', () => {
        expect(autoLayoutBpmnLite([], [])).toEqual([]);
    });

    it('linear A -> B -> C cascades left to right by column', () => {
        const elements = [el('A', 'startEvent'), el('B', 'task'), el('C', 'endEvent')];
        const flows = [flow('f1', 'A', 'B'), flow('f2', 'B', 'C')];
        const out = autoLayoutBpmnLite(elements, flows);

        // Columns are A:0, B:1, C:2. Strictly increasing x.
        expect(out[0]!.position.x).toBeLessThan(out[1]!.position.x);
        expect(out[1]!.position.x).toBeLessThan(out[2]!.position.x);
        // All on the same row -- but `position.y` is the box's TOP-LEFT,
        // not its center. Events (36 high) + tasks (80 high) get
        // centered within the same row slot, so the centre-y aligns
        // even though the top-y differs.
        const centerY = (e: BpmnElement): number =>
            e.position.y + e.size.height / 2;
        expect(centerY(out[0]!)).toBeCloseTo(centerY(out[1]!), 0);
        expect(centerY(out[1]!)).toBeCloseTo(centerY(out[2]!), 0);
    });

    it('XOR fork stacks branch elements vertically in the same column', () => {
        // start -> gw -> {b1, b2} -> end
        // gw at col 1, b1+b2 at col 2 (siblings stack vertically), end at col 3
        const elements = [
            el('start', 'startEvent'),
            el('gw', 'exclusiveGateway'),
            el('b1', 'task'),
            el('b2', 'task'),
            el('end', 'endEvent'),
        ];
        const flows = [
            flow('f1', 'start', 'gw'),
            flow('f2', 'gw', 'b1'),
            flow('f3', 'gw', 'b2'),
            flow('f4', 'b1', 'end'),
            flow('f5', 'b2', 'end'),
        ];
        const out = autoLayoutBpmnLite(elements, flows);
        const byId = new Map(out.map((e) => [e.id, e]));

        // b1, b2 same column (same x), different rows (different y).
        expect(byId.get('b1')!.position.x).toBe(byId.get('b2')!.position.x);
        expect(byId.get('b1')!.position.y).not.toBe(byId.get('b2')!.position.y);
        // gw before branches; end after.
        expect(byId.get('gw')!.position.x).toBeLessThan(byId.get('b1')!.position.x);
        expect(byId.get('b1')!.position.x).toBeLessThan(byId.get('end')!.position.x);
    });

    it('respects existing positions (no-op when ANY element has bounds)', () => {
        // Even a single non-default position bails out. The model
        // came in with author-laid geometry; we don't second-guess.
        const elements = [
            el('A', 'task', { x: 100, y: 100 }),
            el('B', 'task'), // {0,0} but bailout still fires because A has bounds
            el('C', 'task'),
        ];
        const flows: BpmnSequenceFlow[] = [];
        const out = autoLayoutBpmnLite(elements, flows);
        expect(out[0]!.position).toEqual({ x: 100, y: 100 });
        expect(out[1]!.position).toEqual({ x: 0, y: 0 });
        expect(out[2]!.position).toEqual({ x: 0, y: 0 });
    });

    it('disconnected components each get their own column-0 root', () => {
        // Two islands: A->B and X->Y.
        const elements = [
            el('A', 'startEvent'),
            el('B', 'endEvent'),
            el('X', 'startEvent'),
            el('Y', 'endEvent'),
        ];
        const flows = [flow('f1', 'A', 'B'), flow('f2', 'X', 'Y')];
        const out = autoLayoutBpmnLite(elements, flows);
        const byId = new Map(out.map((e) => [e.id, e]));

        // A + X both column 0 (same x).
        expect(byId.get('A')!.position.x).toBe(byId.get('X')!.position.x);
        // But on different rows (A row 0, X row 1).
        expect(byId.get('A')!.position.y).not.toBe(byId.get('X')!.position.y);
    });

    it('cyclic graph terminates (no infinite loop)', () => {
        // A -> B -> A. No proper roots; everything has in-degree 1.
        const elements = [el('A'), el('B')];
        const flows = [flow('f1', 'A', 'B'), flow('f2', 'B', 'A')];
        const out = autoLayoutBpmnLite(elements, flows);
        // Both elements get column positions assigned without hanging.
        expect(out).toHaveLength(2);
        for (const e of out) {
            expect(Number.isFinite(e.position.x)).toBe(true);
            expect(Number.isFinite(e.position.y)).toBe(true);
        }
    });

    it('retry-loop in M2.n verify-spine shape keeps the forward chain monotonic (F-7.5)', () => {
        // Mirror of the spine: start -> sendCode -> enter_otp ->
        // verify -> gw, with gw -> end (success) AND gw -> enter_otp
        // (retry, the back-edge).
        //
        // **Pre-F-7.5 bug**: the back-edge gw -> enter_otp pushed
        // enter_otp's column from 2 (its true forward position) up to
        // 5 (one past the gateway). The forward edge sendCode ->
        // enter_otp then had to traverse the whole row, passing
        // visually THROUGH the intermediate `verify` task. The user
        // surfaced this as "Send OTP email and Verify OTP connected
        // with just line without arrow" — the arrowhead was at
        // enter_otp (far right), but the line passed through verify
        // so it LOOKED like sendCode had a no-arrow connection to
        // verify.
        //
        // **Post-F-7.5**: back-edges are stripped before column
        // assignment. enter_otp stays at col 2 (its true forward
        // depth), verify at col 3, gw at col 4, end at col 5.
        // sendCode -> enter_otp becomes a clean forward edge with no
        // intermediate elements in its path. The retry edge gw ->
        // enter_otp is now a backward edge that F-7.3's U-router
        // routes below the row.
        const elements = [
            el('start', 'startEvent'),
            el('sendCode', 'task'),
            el('enter_otp', 'task'),
            el('verify', 'task'),
            el('gw', 'exclusiveGateway'),
            el('end', 'endEvent'),
        ];
        const flows = [
            flow('f1', 'start', 'sendCode'),
            flow('f2', 'sendCode', 'enter_otp'),
            flow('f3', 'enter_otp', 'verify'),
            flow('f4', 'verify', 'gw'),
            flow('f5', 'gw', 'end'),
            flow('f6', 'gw', 'enter_otp'), // The retry back-edge.
        ];
        const out = autoLayoutBpmnLite(elements, flows);
        const byId = new Map(out.map((e) => [e.id, e]));

        // Centre-x by id, so we can compare columns regardless of the
        // per-kind box-size centering.
        const cx = (id: string): number => {
            const e = byId.get(id)!;
            return e.position.x + e.size.width / 2;
        };

        // The forward chain start -> sendCode -> enter_otp -> verify
        // -> gw -> end must be strictly increasing on x. Pre-F-7.5
        // this assertion failed at enter_otp (cx 5) > verify (cx 3).
        expect(cx('start')).toBeLessThan(cx('sendCode'));
        expect(cx('sendCode')).toBeLessThan(cx('enter_otp'));
        expect(cx('enter_otp')).toBeLessThan(cx('verify'));
        expect(cx('verify')).toBeLessThan(cx('gw'));
        expect(cx('gw')).toBeLessThan(cx('end'));

        // Belt-and-braces bound check (defended by maxColumn cap).
        for (const e of out) {
            expect(e.position.x).toBeLessThan(1400);
            expect(e.position.x).toBeGreaterThanOrEqual(0);
        }
    });

    it('self-loop (single-node cycle) does not push the node off-canvas (F-7.5)', () => {
        // Pathological edge case: an element with a self-loop should
        // sit at column 0 (it's its own root) not column N (the cap).
        // The back-edge classifier catches s -> s as a back-edge
        // because s is GRAY on the recursion stack when we visit
        // itself.
        const elements = [el('a', 'task'), el('b', 'task')];
        const flows = [
            flow('f1', 'a', 'b'),
            flow('f2', 'b', 'b'), // self-loop on b
        ];
        const out = autoLayoutBpmnLite(elements, flows);
        const byId = new Map(out.map((e) => [e.id, e]));
        // a stays in-degree 0 (col 0); b gets col 1 from the a -> b
        // forward edge. The self-loop on b is a back-edge + ignored.
        expect(byId.get('a')!.position.x).toBeLessThan(
            byId.get('b')!.position.x,
        );
        // Without the back-edge skip, b would attempt to push itself
        // to col 2, then 3, then 4... -- the maxColumn cap would
        // catch it at 1 (= elements.length - 1) but we still don't
        // want the BFS churning.
        expect(byId.get('b')!.position.x).toBeLessThan(500);
    });

    it('fromJson auto-lays out a body with no diagram sidecar', () => {
        // Mirror of the M2.n identity.verify_new_user_spine shape:
        // 5 elements + 4 flows, NO diagram, all elements at {0,0}.
        const body = JSON.stringify({
            process: { id: 'test' },
            elements: [
                { id: 'start', type: 'startEvent' },
                { id: 'send', type: 'task' },
                { id: 'verify', type: 'task' },
                { id: 'gw', type: 'exclusiveGateway' },
                { id: 'end', type: 'endEvent' },
                { id: 'f1', type: 'sequenceFlow', source: 'start', target: 'send' },
                { id: 'f2', type: 'sequenceFlow', source: 'send', target: 'verify' },
                { id: 'f3', type: 'sequenceFlow', source: 'verify', target: 'gw' },
                { id: 'f4', type: 'sequenceFlow', source: 'gw', target: 'end' },
            ],
        });
        const model = bpmnLiteJsonToModel(body);
        const positions = new Set(
            model.elements.map((e) => `${e.position.x},${e.position.y}`),
        );
        // All 5 elements get UNIQUE positions instead of stacking at (0,0).
        expect(positions.size).toBe(5);
    });

    it('fromJson preserves diagram positions when sidecar IS present', () => {
        const body = JSON.stringify({
            process: { id: 'test' },
            elements: [
                { id: 'A', type: 'task' },
                { id: 'B', type: 'task' },
            ],
            diagram: {
                elements: {
                    A: { bounds: { x: 100, y: 200, width: 100, height: 80 } },
                    B: { bounds: { x: 400, y: 200, width: 100, height: 80 } },
                },
                flows: {},
            },
        });
        const model = bpmnLiteJsonToModel(body);
        const byId = new Map(model.elements.map((e) => [e.id, e]));
        // Diagram bounds win; auto-layout doesn't reposition.
        expect(byId.get('A')!.position).toEqual({ x: 100, y: 200 });
        expect(byId.get('B')!.position).toEqual({ x: 400, y: 200 });
    });
});
