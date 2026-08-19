import type { DmnDrdElement, DmnDrdPosition } from '../types.js';

/**
 * Geometry helpers for the DRD requirement-edge renderer.
 *
 * A DRD renders as a directed graph of node boxes joined by
 * information-requirement arrows. Mirroring the state-machine
 * geometry, requirements draw as **straight segments trimmed to
 * the node borders** — simple, decoupled from the bpmn-lite orthogonal
 * router, and the right baseline for a requirements diagram. Orthogonal
 * routing can layer on later without changing the renderer contract.
 *
 * The border trim treats every node as its bounding rectangle. For an
 * InputData stadium that's a hair off near the rounded ends, but the
 * difference is sub-pixel at these sizes + invisible behind the
 * arrowhead — a true stadium intersection isn't worth the math.
 */

/** The world-space center of a node's bounding box. */
export function elementCenter(el: DmnDrdElement): DmnDrdPosition {
    return {
        x: el.position.x + el.size.width / 2,
        y: el.position.y + el.size.height / 2,
    };
}

/**
 * The point on `el`'s rectangle border that lies on the ray from the
 * node center toward `toward`. Used to start/end a requirement arrow
 * exactly at the node edge (not buried inside it). Degenerate (toward
 * === center) returns the center.
 */
export function borderPointToward(el: DmnDrdElement, toward: DmnDrdPosition): DmnDrdPosition {
    const c = elementCenter(el);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const hw = el.size.width / 2;
    const hh = el.size.height / 2;
    const sx = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
}

/** The trimmed straight segment (start on the source border, end on the target border) + its midpoint. */
export interface RequirementSegment {
    readonly start: DmnDrdPosition;
    readonly end: DmnDrdPosition;
    readonly mid: DmnDrdPosition;
}

/**
 * Compute the rendered geometry for a requirement between two nodes:
 * the segment between centers, trimmed to each border, plus its
 * midpoint. Information requirements never self-reference (a decision
 * can't require itself), so there's no self-loop case to handle — the
 * editor skips any `from === to` edge before reaching here.
 */
export function requirementSegment(
    source: DmnDrdElement,
    target: DmnDrdElement,
): RequirementSegment {
    const start = borderPointToward(source, elementCenter(target));
    const end = borderPointToward(target, elementCenter(source));
    return {
        start,
        end,
        mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    };
}
