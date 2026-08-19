import type { SmPlace, SmPosition } from '../types.js';

/**
 * Geometry helpers for the state-machine transition renderer.
 *
 * State machines render as a directed graph of place rectangles joined
 * by transition arrows. Unlike the BPMN editor (which uses an
 * orthogonal Z-router), transitions draw as **straight
 * segments trimmed to the place borders** — simple, decoupled from
 * bpmn-lite's router, and the right baseline for a state diagram.
 * Orthogonal / self-loop routing can layer on later without changing
 * the renderer contract.
 */

/** The world-space center of a place's bounding box. */
export function placeCenter(place: SmPlace): SmPosition {
    return {
        x: place.position.x + place.size.width / 2,
        y: place.position.y + place.size.height / 2,
    };
}

/**
 * The point on `place`'s rectangle border that lies on the ray from
 * the place center toward `toward`. Used to start/end a transition
 * arrow exactly at the node edge (not buried inside it). Degenerate
 * (toward === center) returns the center.
 */
export function borderPointToward(place: SmPlace, toward: SmPosition): SmPosition {
    const c = placeCenter(place);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const hw = place.size.width / 2;
    const hh = place.size.height / 2;
    // Scale the ray so it just reaches the nearest of the two edge pairs.
    const sx = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
}

/** The trimmed straight segment (start on the source border, end on the target border) + its midpoint. */
export interface TransitionSegment {
    readonly start: SmPosition;
    readonly end: SmPosition;
    readonly mid: SmPosition;
    /** True when source === target (a self-transition) — the renderer draws a loop instead. */
    readonly selfLoop: boolean;
}

/**
 * Compute the rendered geometry for a transition between two places.
 * For distinct places: the segment between centers, trimmed to each
 * border. For a self-transition (same place): a flag the renderer uses
 * to draw a small loop above the node.
 */
export function transitionSegment(source: SmPlace, target: SmPlace): TransitionSegment {
    if (source.id === target.id) {
        const c = placeCenter(source);
        const top: SmPosition = { x: c.x, y: source.position.y };
        return { start: top, end: top, mid: { x: c.x, y: source.position.y - 28 }, selfLoop: true };
    }
    const start = borderPointToward(source, placeCenter(target));
    const end = borderPointToward(target, placeCenter(source));
    return {
        start,
        end,
        mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        selfLoop: false,
    };
}
