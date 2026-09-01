import { defaultGeometryFor } from '../defaults.js';
import type {
    BpmnElement,
    BpmnElementKind,
    BpmnPosition,
    BpmnSequenceFlow,
    BpmnSize,
} from '../types.js';

/**
 * auto-layout fallback for bodies that arrive without a
 * diagram sidecar.
 *
 * **The problem.** The BPMN-Lite parser doesn't require
 * `diagram.elements[id].bounds` because the engine only cares about
 * semantics. Hand-authored bodies (the
 * `identity.verify_new_user_spine` fixture, the conformance corpus,
 * future migrated bodies from non-coolms engines) tend to omit the
 * diagram sidecar entirely, leaving every element at `{x: 0, y: 0}`
 * after the `fromJson` default. They all stack at the
 * canvas origin -- one fuzzy pile in the top-left.
 *
 * **The fix.** When ALL elements lack diagram bounds, walk the flow
 * graph + assign positions via a topological-ish BFS. Elements
 * cascade left-to-right in columns by depth-from-root; siblings
 * stack vertically. Disconnected components each become their own
 * column-zero root. Cycles are tolerated via a visited set.
 *
 * **NOT a full layout engine.** Edges still auto-route through the
 * orthogonal-router (the model carries no waypoints unless
 * the wire body had them). Output is "good enough to see the shape
 * + start editing" -- the user is expected to drag elements into
 * their final layout once authoring begins. Default sizes are set
 * per kind so events / tasks / gateways look right.
 *
 * **Why this lives in fromJson, not BpmnLiteEditor.** Geometry is
 * a property of the model, not of the editor; if the wire body
 * round-trips through `toJson` immediately after a no-diagram
 * `fromJson`, the new positions get persisted into the model's
 * implicit diagram sidecar (via the BpmnElement.position /
 * BpmnElement.size top-level fields). Saving from the designer
 * page then writes those bounds back via `bpmnLiteModelToJson` so
 * the next load has a real diagram. Lossy on first save in the
 * sense that the auto-layout becomes the "real" layout once the
 * author saves -- which is fine, that's the whole point of opening
 * a draft in an editor.
 *
 * **Partial-layout bail-out.** If ANY element already has bounds
 * in the diagram sidecar, this function returns the elements
 * untouched. Auto-layout is all-or-nothing; mixed bodies are a
 * sign that an author already started positioning + we don't want
 * to overwrite their work.
 *
 * @returns the same `elements` array (same identity) when no
 *          layout is applied; a new array with repositioned
 *          elements when auto-layout fires.
 */
export function autoLayoutBpmnLite(
    elements: ReadonlyArray<BpmnElement>,
    flows: ReadonlyArray<BpmnSequenceFlow>,
): BpmnElement[] {
    if (elements.length === 0) {
        return [...elements];
    }
    // Bail out if ANY element already has a non-default position --
    // we treat that as "the wire body had a diagram, respect it."
    // The default position is exactly `{x: 0, y: 0}` (the fallback
    // applied by `fromJson.readElement` when no diagram bounds match).
    // If even one element is off the origin, the body is partially
    // laid out + we leave it alone.
    const anyPositioned = elements.some(
        (e) => e.position.x !== 0 || e.position.y !== 0,
    );
    if (anyPositioned) {
        return [...elements];
    }

    const columns = computeColumns(elements, flows);
    const rowsByColumn = new Map<number, number>();
    const repositioned: BpmnElement[] = [];

    for (const element of elements) {
        const col = columns.get(element.id) ?? 0;
        const row = rowsByColumn.get(col) ?? 0;
        rowsByColumn.set(col, row + 1);
        repositioned.push({
            ...element,
            position: positionFor(col, row, element.type),
            // Keep whatever size the element already had (default
            // geometry was applied at parse time for missing bounds);
            // don't second-guess.
        });
    }
    return repositioned;
}

/**
 * Layout constants tuned for the default kind sizes.
 *
 *  - Events render at 36×36 (startEvent / endEvent).
 *  - Tasks render at 100×80.
 *  - Gateways render at 50×50.
 *
 * COL_WIDTH = task-width (100) + ~80 gap leaves enough room for
 * the orthogonal router's elbow corners + condition labels
 * between adjacent elements. ROW_HEIGHT keeps siblings far enough
 * apart that auto-routed flows don't intersect even at the maximum
 * branch factor the editor supports (2 outgoing per XOR).
 */
const COL_WIDTH = 200;
const ROW_HEIGHT = 130;
const MARGIN_X = 60;
const MARGIN_Y = 60;

function positionFor(
    col: number,
    row: number,
    kind: BpmnElementKind,
): BpmnPosition {
    const geo = defaultGeometryFor(kind);
    // Centre each kind's box within its (COL_WIDTH × ROW_HEIGHT)
    // slot so events + tasks + gateways align on the same row
    // baseline even though their sizes differ.
    const slotCenterX = MARGIN_X + col * COL_WIDTH + COL_WIDTH / 2;
    const slotCenterY = MARGIN_Y + row * ROW_HEIGHT + ROW_HEIGHT / 2;
    return {
        x: Math.round(slotCenterX - geo.size.width / 2),
        y: Math.round(slotCenterY - geo.size.height / 2),
    };
}

/**
 * Cycle-aware column assignment.
 *
 * **The DAG part** -- root = element with no incoming forward flow
 * (typical: start events; also: orphans). Each successor's column is
 * `max(current, source.column + 1)` -- the "longest-path-from-root"
 * assignment so converging branches sit at the same column.
 *
 * **F-7.5 back-edge skip** -- before the BFS, the algorithm classifies
 * each flow as either a forward edge or a **back-edge** (the target is
 * an ancestor of the source in the DFS tree from roots). Back-edges
 * are EXCLUDED from column assignment. The verify spine fixture's
 * `gw.email_result → task.email.enter_otp` retry edge is exactly this
 * case: without the skip it pushed `enter_otp`'s column from 2 (its
 * true forward position right after `svc.email.sendCode`) up to 5
 * (one past the gateway), which made the forward edge `sendCode →
 * enter_otp` traverse the whole row and pass visually THROUGH the
 * intermediate `svc.email.verify` task. The skip restores the
 * topological forward chain.
 *
 * **Cycle safety (defense-in-depth)** -- even with back-edges removed,
 * the BFS retains the `maxColumn` cap as a safety net for pathological
 * inputs (disconnected SCCs the DFS missed, or self-loops). A
 * legitimate longest acyclic path is at most `elements.length - 1`
 * columns wide; anything beyond is back-edge inflation.
 *
 * Elements not reachable from any root (e.g. a separate disconnected
 * mini-process) still get column 0 + cascade their own children from
 * there.
 */
function computeColumns(
    elements: ReadonlyArray<BpmnElement>,
    flows: ReadonlyArray<BpmnSequenceFlow>,
): Map<string, number> {
    const fullOut = buildAdjacency(elements, flows);
    // F-7.5 -- compute back-edges via DFS coloring + materialize a
    // FORWARD-ONLY adjacency map (out without the cycle-closing
    // back-edges). The BFS below walks the forward DAG only.
    const backEdges = computeBackEdges(elements, fullOut);
    const out = stripBackEdges(elements, fullOut, backEdges);
    // In-degree computed against the forward-only graph so the BFS
    // seed correctly identifies "true forward roots" (nodes that are
    // not the target of any forward edge). Without this, the
    // verify spine fixture would still seed start.registered (correct) but
    // also leak enter_otp as a "root" because its only remaining
    // incoming forward edge from sendCode would be discovered via
    // BFS, not via the seed -- wait, no: the in-degree-zero seed only
    // matters for ROOTS. enter_otp has an incoming forward edge from
    // sendCode so it's NOT in-degree-zero; the BFS reaches it via
    // sendCode's outgoing edges. Forward-only in-degree is what's
    // needed.
    const inDegree = computeInDegreeFromAdjacency(elements, out);

    const columns = new Map<string, number>();
    const queue: string[] = [];

    // Seed with all elements that have in-degree 0 in the forward-only
    // graph (proper forward roots).
    for (const e of elements) {
        if ((inDegree.get(e.id) ?? 0) === 0) {
            columns.set(e.id, 0);
            queue.push(e.id);
        }
    }

    // Cap on any element's column value. A legitimate longest path
    // through `elements.length` nodes is at most `elements.length - 1`
    // columns wide; anything beyond that is cycle-driven inflation
    // (which the back-edge skip should have already prevented; the cap
    // is a safety net for graphs the DFS classifier missed).
    const maxColumn = Math.max(0, elements.length - 1);

    // BFS over the forward-only graph. Each child's column is
    // `max(current, source.column + 1)`. With back-edges removed, the
    // graph is a DAG + the algorithm produces the exact longest-path
    // layout in O(V+E) without re-entering any node.
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

    // Disconnected components: any element still missing a column
    // (it sits in a cycle with no in-degree-0 node anywhere, or
    // it's an isolated island) gets column 0 + we BFS from it via
    // the forward-only graph too. Without back-edge stripping a
    // pure SCC (every node has an incoming edge) would have stayed
    // disconnected because none of them are in-degree-0; with the
    // strip the SCC's "natural entry" (the node whose only incoming
    // edges are all back-edges from inside the SCC) becomes
    // in-degree-0 + the BFS picks it up above. Anything that still
    // lands here is an isolated island (no incoming flows at all)
    // OR a graph pattern the DFS classifier couldn't reach.
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
 * F-7.5 -- classify each edge in the flow graph as forward vs.
 * back-edge via DFS coloring (WHITE = unvisited, GRAY = on the
 * recursion stack, BLACK = fully processed). An edge (s, t) is a
 * back-edge iff `t` is GRAY when we visit it from `s` -- meaning `t`
 * is an ancestor of `s` in the current DFS tree, i.e. the edge closes
 * a cycle.
 *
 * The DFS starts from in-degree-0 nodes first (proper forward roots),
 * then sweeps any unvisited remainders so SCCs without an external
 * entry point still get classified. Self-loops (s → s) are
 * back-edges by definition.
 *
 * **Output** -- a Set of "{source}\u0000{target}" strings; lookup is
 * O(1) per edge. Total cost: O(V + E) one-shot at layout time.
 *
 * **Why not Tarjan SCC** -- a full SCC algorithm would also classify
 * non-tree forward edges + cross-edges, which we don't need. The DFS
 * coloring is the minimal subset that catches the verify spine's retry-loop
 * pattern + every variation of "cycle-closing edge from a deeper node
 * back to an ancestor."
 */
function computeBackEdges(
    elements: ReadonlyArray<BpmnElement>,
    out: Map<string, string[]>,
): Set<string> {
    const backEdges = new Set<string>();
    const color = new Map<string, 'white' | 'gray' | 'black'>();
    for (const e of elements) {
        color.set(e.id, 'white');
    }

    // Iterative DFS so deep graphs don't blow the call stack. Each
    // stack frame carries the node id + the index of the next child
    // to visit (so we can resume after recursing into a child).
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
                // Back-edge: `childId` is on the current DFS stack,
                // i.e. it's an ancestor of `frame.id` in the DFS tree.
                backEdges.add(edgeKey(frame.id, childId));
            } else if (childColor === 'white') {
                color.set(childId, 'gray');
                stack.push({ id: childId, childIdx: 0 });
            }
            // BLACK = already fully processed; treat as a forward
            // cross-edge (still counts as forward for column purposes;
            // not a back-edge).
        }
    }

    // Seed from in-degree-0 nodes first so the DFS tree reflects the
    // natural forward direction (start events become DFS roots, retry
    // edges become back-edges). Note: we compute in-degree against the
    // FULL graph here -- the back-edge classification is what
    // determines which edges are "really" incoming for layout
    // purposes, but the DFS seeding has to start somewhere + the full
    // in-degree gives the most natural reading order.
    const fullInDegree = new Map<string, number>();
    for (const e of elements) fullInDegree.set(e.id, 0);
    for (const [, children] of out) {
        for (const childId of children) {
            fullInDegree.set(childId, (fullInDegree.get(childId) ?? 0) + 1);
        }
    }
    for (const e of elements) {
        if ((fullInDegree.get(e.id) ?? 0) === 0 && color.get(e.id) === 'white') {
            dfs(e.id);
        }
    }
    // Cover any remaining nodes (cycles with no in-degree-0 entry, or
    // disconnected SCCs). Order is `elements` order, which is the
    // body's declaration order -- deterministic + readable.
    for (const e of elements) {
        if (color.get(e.id) === 'white') {
            dfs(e.id);
        }
    }
    return backEdges;
}

function edgeKey(source: string, target: string): string {
    return `${source}\u0000${target}`;
}

function stripBackEdges(
    elements: ReadonlyArray<BpmnElement>,
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

function computeInDegreeFromAdjacency(
    elements: ReadonlyArray<BpmnElement>,
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

function buildAdjacency(
    elements: ReadonlyArray<BpmnElement>,
    flows: ReadonlyArray<BpmnSequenceFlow>,
): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const e of elements) {
        out.set(e.id, []);
    }
    for (const flow of flows) {
        const bucket = out.get(flow.source);
        if (bucket !== undefined) {
            bucket.push(flow.target);
        }
    }
    return out;
}

// Silence "unused import" — `BpmnSize` is used by the inferred
// return type of `defaultGeometryFor` + via the `size: BpmnSize`
// shape elsewhere. The explicit re-export keeps the module's
// public type surface ergonomic.
export type { BpmnSize };
