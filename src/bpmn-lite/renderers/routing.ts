import type { BpmnElement, BpmnPosition } from '../types.js';

/**
 * edge routing -- compute the waypoint chain for a
 * SequenceFlow connecting two elements when no manual waypoints
 * are set.
 *
 * **Algorithm: orthogonal Z-route**. Pick the dominant axis between
 * source + target centers (`abs(dx) >= abs(dy)` → horizontal; else
 * vertical). Exit the source on the edge facing the target + enter
 * the target on the opposite edge. Insert two intermediate waypoints
 * at the half-way point on the dominant axis to produce a single
 * bend. The result is always a 4-waypoint chain even when the
 * elements are aligned (degenerate bends collapse to a straight
 * line geometrically + the SVG `<path>` doesn't notice the
 * collinearity).
 *
 * **What this algorithm does NOT do**:
 *  - Avoid obstacles (other elements that sit between source and
 *    target). The router goes straight through; the connect
 *    mode + a future obstacle-aware routing ship will replace this.
 *  - Hop over crossing edges (the BPMN convention for crossings).
 *  - Snap to a grid (the `Snap` utility lives on the
 *    palette / drag path, not the auto-route).
 *  - Edge labels (the property panel surfaces flow
 *    conditions; the route is unaware of label placement).
 *
 * **Why Z-route over straight diagonal**: matches BPMN modeler
 * convention (Camunda Modeler, bpmn-io's bpmn-js, SAP Signavio all
 * default to orthogonal). Orthogonal routes are also easier to
 * eyeball-decode in a busy diagram + composable with the eventual
 * obstacle-avoidance ship.
 *
 * **Why a single bend, not Z-with-two-bends**: a single midpoint
 * bend handles the common case (left-to-right + top-to-bottom
 * adjacency) without overengineering. Connect mode + the
 * obstacle-aware ship will introduce multi-bend routes when
 * required.
 */

/**
 * The bounding-box rectangle of an element, derived from its top-
 * left position + size. Used internally by the router; not part of
 * the public type surface.
 */
interface Bbox {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly cx: number;
    readonly cy: number;
}

function bbox(element: BpmnElement): Bbox {
    const left = element.position.x;
    const top = element.position.y;
    const right = left + element.size.width;
    const bottom = top + element.size.height;
    return {
        left,
        top,
        right,
        bottom,
        cx: left + element.size.width / 2,
        cy: top + element.size.height / 2,
    };
}

/**
 * Vertical clearance below the lower of source / target bottoms
 * when routing a backward edge via the U-route below the row. Hand-
 * picked to look right for the default 100×80 task + ~80px
 * task-row gutters; lifts the corridor a hair below the row so the
 * backward edge doesn't kiss any forward flow's bottom waypoint.
 */
const BACKWARD_EDGE_DROP_PADDING_PX = 40;

/**
 * Compute a 4-waypoint orthogonal route from `source` to `target`.
 * Returns the chain in document order from source-exit to
 * target-entry (the SVG `<path>` builder strings `M` + `L`s together
 * in this order).
 *
 * **F-7.3 backward-edge handling**: when the dominant axis is
 * horizontal AND the target sits to the LEFT of the source
 * (dx < 0), the algorithm routes the edge via the BOTTOM of the row
 * — exit source-bottom, drop below `max(s.bottom, t.bottom) +
 * {@link BACKWARD_EDGE_DROP_PADDING_PX}`, travel left under the row,
 * climb back up into target-bottom. The waypoint chain becomes a
 * U-shape rather than a straight-through Z. This avoids overlapping
 * the forward flow that almost certainly lives between source and
 * target in the same row (a verification spine's `gw →
 * task.enter_otp` retry loop was the surfacing case: the auto-router's
 * pre-F-7.3 straight-Z route ran the retry edge directly through the
 * forward `task → gw` flow, making the loop visually unreadable). The
 * heuristic is "leftward edge = feedback loop"; legitimate left-arrow
 * flows (rare in BPMN; usually a cancellation or compensation pattern)
 * can opt out by setting manual waypoints via the
 * `WaypointDragController`.
 *
 * **What this fix does NOT do**: detect crossing edges between
 * backward-routes for multiple feedback loops at the same y; route
 * around obstacles below the row; route ABOVE instead of below when
 * there's a different cleaner corridor. Future obstacle-aware ships
 * (M4-ish, post-cockpit) will need to replace the heuristic with
 * actual graph-aware routing.
 */
export function computeOrthogonalRoute(
    source: BpmnElement,
    target: BpmnElement,
): BpmnPosition[] {
    const s = bbox(source);
    const t = bbox(target);

    const dx = t.cx - s.cx;
    const dy = t.cy - s.cy;

    if (Math.abs(dx) >= Math.abs(dy)) {
        // F-7.3: backward edge -- route via the bottom of the row.
        if (dx < 0) {
            const dropY =
                Math.max(s.bottom, t.bottom) +
                BACKWARD_EDGE_DROP_PADDING_PX;
            return [
                { x: s.cx, y: s.bottom },
                { x: s.cx, y: dropY },
                { x: t.cx, y: dropY },
                { x: t.cx, y: t.bottom },
            ];
        }
        // Forward horizontal-dominated edge: classic Z-route.
        const sExit: BpmnPosition = { x: s.right, y: s.cy };
        const tEnter: BpmnPosition = { x: t.left, y: t.cy };
        const midX = (sExit.x + tEnter.x) / 2;
        return [
            sExit,
            { x: midX, y: sExit.y },
            { x: midX, y: tEnter.y },
            tEnter,
        ];
    }

    // Vertical-dominated: exit on the bottom or top, enter on the
    // opposite edge of the target.
    const sExit: BpmnPosition = {
        x: s.cx,
        y: dy >= 0 ? s.bottom : s.top,
    };
    const tEnter: BpmnPosition = {
        x: t.cx,
        y: dy >= 0 ? t.top : t.bottom,
    };
    const midY = (sExit.y + tEnter.y) / 2;
    return [
        sExit,
        { x: sExit.x, y: midY },
        { x: tEnter.x, y: midY },
        tEnter,
    ];
}

/**
 * Convert a waypoint chain into an SVG `<path>` `d` attribute --
 * `M x0,y0 L x1,y1 L x2,y2 ...`. Empty + single-point chains
 * produce an empty string (the renderer should skip rendering when
 * there's no geometry to paint).
 */
export function waypointsToPathD(waypoints: ReadonlyArray<BpmnPosition>): string {
    if (waypoints.length === 0) return '';
    if (waypoints.length === 1) {
        // A single point is geometrically degenerate; we still emit
        // an `M` so the path exists in the DOM + downstream code
        // doesn't have to special-case empty paths.
        const p = waypoints[0]!;
        return `M ${p.x},${p.y}`;
    }
    const head = waypoints[0]!;
    const tail = waypoints.slice(1);
    return (
        `M ${head.x},${head.y} ` +
        tail.map((p) => `L ${p.x},${p.y}`).join(' ')
    );
}
