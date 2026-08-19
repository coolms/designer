import { DEFAULT_PLACE_SIZE } from './types.js';
import type { SmPlace, SmTransition } from './types.js';

/**
 * topological auto-layout for state machines that arrive
 * without diagram geometry.
 *
 * **The problem (mirrors M3.3.l for BPMN-Lite).** A Symfony Workflow
 * `state_machine` config carries only semantics — `places: [...]` +
 * `transitions: {name: {from, to}}`. There is no diagram sidecar, so a
 * model deserialized from a hand-authored / module-shipped workflow YAML
 * (the path) has every place at the origin `{x: 0, y: 0}` — one
 * fuzzy pile in the top-left. This lays them out into readable columns.
 *
 * **The algorithm.** Identical cycle-aware longest-path layering to the
 * BPMN-Lite `autoLayoutBpmnLite` (F-7.5): classify back-edges via DFS
 * coloring, strip them, then BFS the forward-only DAG assigning each
 * place `column = max(current, source.column + 1)` so converging
 * branches align. Places cascade left-to-right by depth; siblings stack
 * vertically. This matters more for state machines than for BPMN — a
 * lifecycle like `draft → submitted → approved` with a `rejected →
 * draft` re-open edge is a cycle, and without the back-edge skip the
 * re-open edge would shove `draft` to the far right.
 *
 * **Self-transitions** (`from === to`, e.g. a `touch` that re-enters the
 * same state) are back-edges by definition and contribute nothing to
 * column assignment.
 *
 * **Dangling transitions** (a `from`/`to` naming no existing place — the
 * model may be mid-edit) are ignored when building the graph; they
 * neither create phantom columns nor crash the walk.
 *
 * **All-or-nothing, like BPMN.** If ANY place already sits off the
 * origin, the model is treated as already-positioned + returned
 * untouched — we never clobber an author's manual placement.
 *
 * @returns the same array identity (spread copy) when no layout is
 *          applied; a new array of repositioned places when it fires.
 */
export function autoLayoutStateMachine(
    places: ReadonlyArray<SmPlace>,
    transitions: ReadonlyArray<SmTransition>,
): SmPlace[] {
    if (places.length === 0) {
        return [...places];
    }
    // Bail out if ANY place is already positioned — respect an existing
    // diagram. The deserialized default is exactly `{x: 0, y: 0}`.
    const anyPositioned = places.some(
        (p) => p.position.x !== 0 || p.position.y !== 0,
    );
    if (anyPositioned) {
        return [...places];
    }

    const columns = computeColumns(places, transitions);
    const rowsByColumn = new Map<number, number>();
    const repositioned: SmPlace[] = [];

    for (const place of places) {
        const col = columns.get(place.id) ?? 0;
        const row = rowsByColumn.get(col) ?? 0;
        rowsByColumn.set(col, row + 1);
        repositioned.push({
            ...place,
            position: positionFor(col, row),
        });
    }
    return repositioned;
}

/**
 * Layout constants tuned for the {@link DEFAULT_PLACE_SIZE} place box
 * (132 × 48). COL_WIDTH leaves room for the transition arrow + its name
 * label between columns; ROW_HEIGHT keeps stacked siblings clear of each
 * other's labels. MARGIN_X is generous so the initial-state entry marker
 * (which paints ~18px LEFT of the first column's place box) stays on-canvas.
 */
const COL_WIDTH = 260;
const ROW_HEIGHT = 110;
const MARGIN_X = 56;
const MARGIN_Y = 48;

function positionFor(col: number, row: number): { x: number; y: number } {
    // Uniform place size, so a plain top-left grid placement aligns every
    // box on a shared baseline without per-kind centering.
    void DEFAULT_PLACE_SIZE;
    return {
        x: MARGIN_X + col * COL_WIDTH,
        y: MARGIN_Y + row * ROW_HEIGHT,
    };
}

/**
 * Cycle-aware column assignment — the same shape as the BPMN-Lite
 * `computeColumns`, narrowed to the place/transition model.
 *
 * Root = a place with no incoming forward transition. Each successor's
 * column is `max(current, source.column + 1)` (longest-path-from-root).
 * Back-edges (a transition whose target is an ancestor of its source in
 * the DFS tree) are stripped before the BFS so re-open / retry loops
 * don't inflate the forward chain. The `maxColumn` cap is a safety net
 * for pathological inputs the DFS classifier missed.
 */
function computeColumns(
    places: ReadonlyArray<SmPlace>,
    transitions: ReadonlyArray<SmTransition>,
): Map<string, number> {
    const fullOut = buildAdjacency(places, transitions);
    const backEdges = computeBackEdges(places, fullOut);
    const out = stripBackEdges(places, fullOut, backEdges);
    const inDegree = computeInDegree(places, out);

    const columns = new Map<string, number>();
    const queue: string[] = [];

    for (const p of places) {
        if ((inDegree.get(p.id) ?? 0) === 0) {
            columns.set(p.id, 0);
            queue.push(p.id);
        }
    }

    const maxColumn = Math.max(0, places.length - 1);
    const maxIterations = places.length * places.length + 1;
    let iterations = 0;
    while (queue.length > 0 && iterations < maxIterations) {
        iterations++;
        const id = queue.shift()!;
        const sourceCol = columns.get(id) ?? 0;
        if (sourceCol >= maxColumn) continue;
        for (const childId of out.get(id) ?? []) {
            const nextCol = Math.min(sourceCol + 1, maxColumn);
            const currentCol = columns.get(childId);
            if (currentCol === undefined || nextCol > currentCol) {
                columns.set(childId, nextCol);
                queue.push(childId);
            }
        }
    }

    // Disconnected components / pure cycles with no in-degree-0 entry:
    // seed them at column 0 + cascade their forward children.
    for (const p of places) {
        if (columns.has(p.id)) continue;
        columns.set(p.id, 0);
        const stack: string[] = [p.id];
        while (stack.length > 0) {
            const id = stack.pop()!;
            const baseCol = columns.get(id) ?? 0;
            for (const childId of out.get(id) ?? []) {
                if (columns.has(childId)) continue;
                columns.set(childId, baseCol + 1);
                stack.push(childId);
            }
        }
    }

    return columns;
}

/**
 * DFS-coloring back-edge classifier (WHITE / GRAY / BLACK). An edge
 * (s, t) is a back-edge iff `t` is GRAY when reached from `s` — i.e. `t`
 * is an ancestor of `s` on the recursion stack, so the edge closes a
 * cycle. Seeds from in-degree-0 places first (so lifecycle entry states
 * become DFS roots + re-open edges become back-edges), then sweeps any
 * remaining unvisited places. Iterative to survive deep graphs.
 */
function computeBackEdges(
    places: ReadonlyArray<SmPlace>,
    out: Map<string, string[]>,
): Set<string> {
    const backEdges = new Set<string>();
    const color = new Map<string, 'white' | 'gray' | 'black'>();
    for (const p of places) {
        color.set(p.id, 'white');
    }

    function dfs(start: string): void {
        const stack: Array<{ id: string; childIdx: number }> = [
            { id: start, childIdx: 0 },
        ];
        color.set(start, 'gray');
        while (stack.length > 0) {
            const frame = stack[stack.length - 1]!;
            const children = out.get(frame.id) ?? [];
            if (frame.childIdx >= children.length) {
                color.set(frame.id, 'black');
                stack.pop();
                continue;
            }
            const childId = children[frame.childIdx]!;
            frame.childIdx++;
            const childColor = color.get(childId);
            if (childColor === 'gray') {
                backEdges.add(edgeKey(frame.id, childId));
            } else if (childColor === 'white') {
                color.set(childId, 'gray');
                stack.push({ id: childId, childIdx: 0 });
            }
        }
    }

    const fullInDegree = computeInDegree(places, out);
    for (const p of places) {
        if ((fullInDegree.get(p.id) ?? 0) === 0 && color.get(p.id) === 'white') {
            dfs(p.id);
        }
    }
    for (const p of places) {
        if (color.get(p.id) === 'white') {
            dfs(p.id);
        }
    }
    return backEdges;
}

function edgeKey(source: string, target: string): string {
    return `${source} ${target}`;
}

function stripBackEdges(
    places: ReadonlyArray<SmPlace>,
    fullOut: Map<string, string[]>,
    backEdges: Set<string>,
): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const p of places) {
        const children = fullOut.get(p.id) ?? [];
        out.set(
            p.id,
            children.filter((c) => !backEdges.has(edgeKey(p.id, c))),
        );
    }
    return out;
}

function computeInDegree(
    places: ReadonlyArray<SmPlace>,
    out: Map<string, string[]>,
): Map<string, number> {
    const inDegree = new Map<string, number>();
    for (const p of places) {
        inDegree.set(p.id, 0);
    }
    for (const [, children] of out) {
        for (const childId of children) {
            inDegree.set(childId, (inDegree.get(childId) ?? 0) + 1);
        }
    }
    return inDegree;
}

/**
 * Build the forward adjacency from transitions. Only edges between two
 * KNOWN places are kept — dangling endpoints (mid-edit) and self-loops
 * are dropped here (a self-loop would otherwise register as its own
 * back-edge, which is harmless, but skipping it keeps the graph clean).
 */
function buildAdjacency(
    places: ReadonlyArray<SmPlace>,
    transitions: ReadonlyArray<SmTransition>,
): Map<string, string[]> {
    const known = new Set(places.map((p) => p.id));
    const out = new Map<string, string[]>();
    for (const p of places) {
        out.set(p.id, []);
    }
    for (const t of transitions) {
        if (t.from === t.to) continue; // self-loop — no layout signal
        if (!known.has(t.from) || !known.has(t.to)) continue; // dangling
        out.get(t.from)!.push(t.to);
    }
    return out;
}
