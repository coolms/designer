import type { DmnDrdElement, DmnInformationRequirement } from './types.js';

/**
 * M4.j — topological auto-layout for DRDs that arrive without diagram
 * geometry.
 *
 * **The problem (mirrors M3.5.b for state machines).** A DMN model
 * deserialized from hand-authored / module-shipped XML may carry no
 * DMNDI diagram sidecar, so every node sits at the origin `{x: 0,
 * y: 0}` — one fuzzy pile in the top-left. This lays them out into
 * readable columns following the information-requirement edges.
 *
 * **The algorithm.** Identical cycle-aware longest-path layering to the
 * state-machine + BPMN-Lite layouts: classify back-edges via DFS
 * coloring, strip them, then BFS the forward-only DAG assigning each
 * node `column = max(current, source.column + 1)` so converging
 * dependencies align. Following requirement direction (`from` → `to` =
 * required → requiring), InputData + leaf decisions land in the left
 * columns and the top-level decision lands on the right.
 *
 * **DRDs are acyclic by spec** (a decision can't transitively require
 * itself), so the cycle-aware machinery rarely fires — but it's kept so
 * a mid-edit model that momentarily forms a loop still lays out instead
 * of running away to the right.
 *
 * **Dangling requirements** (a `from`/`to` naming no existing node) and
 * self-references (`from === to`) are ignored when building the graph;
 * they neither create phantom columns nor crash the walk.
 *
 * **All-or-nothing.** If ANY node already sits off the origin, the
 * model is treated as already-positioned + returned untouched — we
 * never clobber an author's manual placement.
 *
 * @returns the same array identity (spread copy) when no layout is
 *          applied; a new array of repositioned nodes when it fires.
 */
export function autoLayoutDmnDrd(
    elements: ReadonlyArray<DmnDrdElement>,
    requirements: ReadonlyArray<DmnInformationRequirement>,
): DmnDrdElement[] {
    if (elements.length === 0) {
        return [...elements];
    }
    const anyPositioned = elements.some(
        (e) => e.position.x !== 0 || e.position.y !== 0,
    );
    if (anyPositioned) {
        return [...elements];
    }

    const columns = computeColumns(elements, requirements);
    const rowsByColumn = new Map<number, number>();
    const repositioned: DmnDrdElement[] = [];

    for (const el of elements) {
        const col = columns.get(el.id) ?? 0;
        const row = rowsByColumn.get(col) ?? 0;
        rowsByColumn.set(col, row + 1);
        repositioned.push({ ...el, position: positionFor(col, row) });
    }
    return repositioned;
}

/**
 * Layout constants tuned for the default node boxes (Decision 168×72,
 * InputData 144×52). COL_WIDTH leaves room for the requirement arrow
 * between columns; ROW_HEIGHT keeps stacked siblings clear of each
 * other.
 */
const COL_WIDTH = 248;
const ROW_HEIGHT = 116;
const MARGIN_X = 48;
const MARGIN_Y = 48;

function positionFor(col: number, row: number): { x: number; y: number } {
    return {
        x: MARGIN_X + col * COL_WIDTH,
        y: MARGIN_Y + row * ROW_HEIGHT,
    };
}

/**
 * Cycle-aware column assignment — the same shape as the state-machine
 * `computeColumns`, narrowed to the DRD element/requirement model.
 *
 * Root = a node with no incoming forward requirement. Each successor's
 * column is `max(current, source.column + 1)` (longest-path-from-root).
 * Back-edges (a requirement whose target is an ancestor of its source
 * in the DFS tree) are stripped before the BFS. The `maxColumn` cap is a
 * safety net for pathological inputs the DFS classifier missed.
 */
function computeColumns(
    elements: ReadonlyArray<DmnDrdElement>,
    requirements: ReadonlyArray<DmnInformationRequirement>,
): Map<string, number> {
    const fullOut = buildAdjacency(elements, requirements);
    const backEdges = computeBackEdges(elements, fullOut);
    const out = stripBackEdges(elements, fullOut, backEdges);
    const inDegree = computeInDegree(elements, out);

    const columns = new Map<string, number>();
    const queue: string[] = [];

    for (const e of elements) {
        if ((inDegree.get(e.id) ?? 0) === 0) {
            columns.set(e.id, 0);
            queue.push(e.id);
        }
    }

    const maxColumn = Math.max(0, elements.length - 1);
    const maxIterations = elements.length * elements.length + 1;
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
    for (const e of elements) {
        if (columns.has(e.id)) continue;
        columns.set(e.id, 0);
        const stack: string[] = [e.id];
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
 * is an ancestor of `s` on the recursion stack. Seeds from in-degree-0
 * nodes first (so input/leaf nodes become DFS roots), then sweeps any
 * remaining unvisited nodes. Iterative to survive deep graphs.
 */
function computeBackEdges(
    elements: ReadonlyArray<DmnDrdElement>,
    out: Map<string, string[]>,
): Set<string> {
    const backEdges = new Set<string>();
    const color = new Map<string, 'white' | 'gray' | 'black'>();
    for (const e of elements) {
        color.set(e.id, 'white');
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

    const fullInDegree = computeInDegree(elements, out);
    for (const e of elements) {
        if ((fullInDegree.get(e.id) ?? 0) === 0 && color.get(e.id) === 'white') {
            dfs(e.id);
        }
    }
    for (const e of elements) {
        if (color.get(e.id) === 'white') {
            dfs(e.id);
        }
    }
    return backEdges;
}

function edgeKey(source: string, target: string): string {
    return `${source} ${target}`;
}

function stripBackEdges(
    elements: ReadonlyArray<DmnDrdElement>,
    fullOut: Map<string, string[]>,
    backEdges: Set<string>,
): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const e of elements) {
        const children = fullOut.get(e.id) ?? [];
        out.set(
            e.id,
            children.filter((c) => !backEdges.has(edgeKey(e.id, c))),
        );
    }
    return out;
}

function computeInDegree(
    elements: ReadonlyArray<DmnDrdElement>,
    out: Map<string, string[]>,
): Map<string, number> {
    const inDegree = new Map<string, number>();
    for (const e of elements) {
        inDegree.set(e.id, 0);
    }
    for (const [, children] of out) {
        for (const childId of children) {
            inDegree.set(childId, (inDegree.get(childId) ?? 0) + 1);
        }
    }
    return inDegree;
}

/**
 * Build the forward adjacency from requirements. Only edges between two
 * KNOWN nodes are kept — dangling endpoints (mid-edit) and
 * self-references are dropped here so the graph stays clean.
 */
function buildAdjacency(
    elements: ReadonlyArray<DmnDrdElement>,
    requirements: ReadonlyArray<DmnInformationRequirement>,
): Map<string, string[]> {
    const known = new Set(elements.map((e) => e.id));
    const out = new Map<string, string[]>();
    for (const e of elements) {
        out.set(e.id, []);
    }
    for (const r of requirements) {
        if (r.from === r.to) continue; // self-reference — no layout signal
        if (!known.has(r.from) || !known.has(r.to)) continue; // dangling
        out.get(r.from)!.push(r.to);
    }
    return out;
}
