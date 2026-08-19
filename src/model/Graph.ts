import { Emitter } from '../internal/Emitter.js';
import type { ChangeEvent, ChangeRecord } from './ChangeRecord.js';
import type {
    EdgeElement,
    Element,
    ElementPatch,
    NodeElement,
    Position,
} from './Element.js';

interface GraphEvents extends Record<string, unknown> {
    change: ChangeEvent;
}

/**
 * Thrown when graph operations violate documented invariants. The model
 * layer surfaces these synchronously so callers can guard at the
 * command level; renderers should never see them.
 */
export class GraphInvariantError extends Error {
    constructor(message: string) {
        super(`[@coolms/designer] ${message}`);
        this.name = 'GraphInvariantError';
    }
}

/**
 * Generic graph model for the canvas-based editor surfaces (BPMN-Lite,
 * DMN DRD, State Machine). Stores elements keyed by id, enforces
 * structural invariants, batches change events through transactions,
 * and surfaces a mutation revision counter for optimistic concurrency.
 *
 * Invariants:
 *  - **Unique ids.** {@link addElement} throws on duplicate id.
 *  - **Connected edges.** Adding or updating an {@link EdgeElement}
 *    whose `source` or `target` doesn't resolve to an existing node
 *    throws. Allows self-loops (source === target) -- per-surface
 *    validators can reject them at deploy time if the surface forbids
 *    them.
 *  - **Cascade delete.** Removing a node also removes every edge
 *    incident to it. The cascade emits one `removed` record per
 *    deleted edge plus the `removed` for the node itself, in a single
 *    change event.
 *  - **Immutable structure.** `id` + `kind` cannot change via
 *    {@link updateElement}; the {@link ElementPatch} type omits them.
 *    Changing element kind requires explicit remove + add (which
 *    cascades cleanly).
 *
 * Transactions:
 *  - {@link transaction} defers change-event emission until the
 *    outermost call completes. Nested transactions merge into the
 *    outer batch.
 *  - Transactions are NOT atomic w.r.t. mutations -- if `fn()` throws,
 *    half-applied mutations stay applied. Atomicity comes from the
 *    {@link CommandStack} pattern: commands implement `revert()` so
 *    failures can be undone explicitly.
 *  - A transaction with no mutations emits NO change event (no churn
 *    for no-op call sites).
 *
 * The DMN decision-table editor uses a different model shape
 * (rows + columns + cells) and lives in its own module; only the
 * change-event subscription pattern + the {@link Emitter} primitive
 * are shared.
 */
export class Graph {
    private readonly elements = new Map<string, Element>();
    private readonly emitter = new Emitter<GraphEvents>();

    private revisionCounter = 0;
    private transactionDepth = 0;
    private pendingChanges: ChangeRecord[] = [];
    private disposed = false;

    /** Current monotonic revision -- bumps on every emitted change event. */
    get revision(): number {
        return this.revisionCounter;
    }

    /** True after {@link dispose}. Graph is no longer usable. */
    get isDisposed(): boolean {
        return this.disposed;
    }

    /** Element count -- O(1). */
    get size(): number {
        return this.elements.size;
    }

    // ------------------------------------------------------------------
    // CRUD
    // ------------------------------------------------------------------

    /**
     * Insert a new element. Throws {@link GraphInvariantError} on
     * duplicate id; throws on edge with missing endpoints.
     *
     * Element references are stored verbatim -- callers should not
     * mutate the object they passed in. Use {@link updateElement} for
     * subsequent changes.
     */
    addElement(element: Element): void {
        this.assertNotDisposed();
        if (this.elements.has(element.id)) {
            throw new GraphInvariantError(
                `Duplicate element id "${element.id}" (already in graph).`,
            );
        }
        if (element.kind === 'edge') {
            this.assertEdgeEndpointsExist(element);
        }
        this.elements.set(element.id, element);
        this.queueChange({ type: 'added', elementId: element.id });
    }

    /**
     * Remove an element by id. Idempotent: removing an unknown id is a
     * no-op (returns false, no event).
     *
     * When the removed element is a node, all edges incident to it are
     * cascade-removed in the same change event. The cascade order is
     * deterministic: edges first (in insertion order), then the node.
     */
    removeElement(id: string): boolean {
        this.assertNotDisposed();
        const element = this.elements.get(id);
        if (!element) return false;

        // Batch the cascade + the node removal so they share a transaction
        // boundary even when the caller didn't open one.
        this.transaction(() => {
            if (element.kind === 'node') {
                // Snapshot incident edges -- we mutate the map during iteration.
                const incident: EdgeElement[] = [];
                for (const candidate of this.elements.values()) {
                    if (candidate.kind === 'edge' && (candidate.source === id || candidate.target === id)) {
                        incident.push(candidate);
                    }
                }
                for (const edge of incident) {
                    this.elements.delete(edge.id);
                    this.queueChange({ type: 'removed', elementId: edge.id });
                }
            }
            this.elements.delete(id);
            this.queueChange({ type: 'removed', elementId: id });
        });
        return true;
    }

    /**
     * Partially update an element. The patch is shallow-merged onto the
     * existing element; `properties` is REPLACED wholesale (not deep
     * merged) -- callers wanting to merge property fields must do so
     * explicitly:
     *
     *   const existing = graph.getElement(id);
     *   graph.updateElement(id, {
     *       properties: { ...existing.properties, formKey: 'new' },
     *   });
     *
     * Throws if `id` is unknown, if the patch tries to change `kind`,
     * or if the resulting element fails an invariant (e.g. edge
     * endpoints now missing).
     */
    updateElement(id: string, patch: ElementPatch): void {
        this.assertNotDisposed();
        const existing = this.elements.get(id);
        if (!existing) {
            throw new GraphInvariantError(`Cannot update unknown element "${id}".`);
        }

        // `kind` is omitted from ElementPatch at the type level; this runtime
        // check guards against unsafe casts at the call site.
        if ('kind' in patch && (patch as { kind?: string }).kind !== undefined) {
            throw new GraphInvariantError(
                `Element kind is immutable (attempted to change "${id}" kind).`,
            );
        }

        const next = { ...existing, ...(patch as Partial<Element>) } as Element;
        if (next.kind === 'edge') {
            this.assertEdgeEndpointsExist(next);
        }
        this.elements.set(id, next);
        this.queueChange({ type: 'updated', elementId: id });
    }

    /**
     * Wipe every element. Emits a single `reset` change record (NOT one
     * `removed` per element -- the renderer treats `reset` as
     * "drop everything and re-mount from getElements"). No-op when the
     * graph is already empty (no event).
     */
    clear(): void {
        this.assertNotDisposed();
        if (this.elements.size === 0) return;
        this.elements.clear();
        this.queueChange({ type: 'reset' });
    }

    // ------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------

    /** Look up an element by id. Returns `undefined` for unknown ids. */
    getElement(id: string): Element | undefined {
        return this.elements.get(id);
    }

    /** Snapshot of all elements in insertion order. */
    getElements(): ReadonlyArray<Element> {
        return [...this.elements.values()];
    }

    /** Snapshot of all nodes. */
    getNodes(): ReadonlyArray<NodeElement> {
        const out: NodeElement[] = [];
        for (const e of this.elements.values()) {
            if (e.kind === 'node') out.push(e);
        }
        return out;
    }

    /** Snapshot of all edges. */
    getEdges(): ReadonlyArray<EdgeElement> {
        const out: EdgeElement[] = [];
        for (const e of this.elements.values()) {
            if (e.kind === 'edge') out.push(e);
        }
        return out;
    }

    /** Edges ending at the given node. */
    getIncoming(nodeId: string): ReadonlyArray<EdgeElement> {
        return this.getEdges().filter((e) => e.target === nodeId);
    }

    /** Edges starting from the given node. */
    getOutgoing(nodeId: string): ReadonlyArray<EdgeElement> {
        return this.getEdges().filter((e) => e.source === nodeId);
    }

    /**
     * Find the top-most node whose bounding rect contains `point` in
     * world coordinates, or `null` if none. "Top-most" = last-inserted
     * (insertion order is the implicit z-order at M3.2.c; explicit
     * z-ordering lands when a surface needs it).
     *
     * Edges are NOT hit-tested here -- they need polyline proximity
     * math that depends on the rendered route, which the model layer
     * doesn't know. Edge hit-test lands with each surface's renderer.
     */
    findNodeAt(point: Position): NodeElement | null {
        const all = this.getNodes();
        for (let i = all.length - 1; i >= 0; i--) {
            const node = all[i]!;
            if (
                point.x >= node.position.x &&
                point.x <= node.position.x + node.size.width &&
                point.y >= node.position.y &&
                point.y <= node.position.y + node.size.height
            ) {
                return node;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Batching + ID generation
    // ------------------------------------------------------------------

    /**
     * Run `fn` with change events deferred. All mutations during the
     * call queue records into a single batch; the change event fires
     * once on the outermost transaction commit.
     *
     * Nested transactions merge into the outer batch -- the inner
     * transaction does NOT emit its own event. This makes it safe for
     * commands to call helpers that themselves open transactions.
     *
     * Returns whatever `fn` returns. If `fn` throws, the throw
     * propagates AND the queued changes still flush -- mutations
     * already applied stay applied. Use the {@link CommandStack}
     * pattern for atomicity.
     */
    transaction<T>(fn: () => T): T {
        this.assertNotDisposed();
        this.transactionDepth++;
        try {
            return fn();
        } finally {
            this.transactionDepth--;
            if (this.transactionDepth === 0) {
                this.flushChanges();
            }
        }
    }

    /**
     * Generate a stable, unused id for the given prefix. Counts up
     * (`prefix_1`, `prefix_2`, ...) skipping any value already in the
     * graph. Useful for "new user task" defaults where the surface
     * doesn't have a meaningful id to assign.
     */
    generateId(prefix: string): string {
        if (prefix.length === 0) {
            throw new GraphInvariantError('generateId: prefix must be non-empty.');
        }
        let n = 1;
        while (this.elements.has(`${prefix}_${n}`)) {
            n++;
        }
        return `${prefix}_${n}`;
    }

    // ------------------------------------------------------------------
    // Subscriptions
    // ------------------------------------------------------------------

    /**
     * Subscribe to change events. Listener fires AFTER mutations are
     * applied. Returns an unsubscribe thunk.
     */
    onChange(listener: (event: ChangeEvent) => void): () => void {
        return this.emitter.on('change', listener);
    }

    /** Active subscriber count -- test affordance + leak detection hook. */
    get listenerCount(): number {
        return this.emitter.listenerCount('change');
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.elements.clear();
        this.pendingChanges = [];
        this.emitter.dispose();
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new GraphInvariantError('Graph has been disposed.');
        }
    }

    private assertEdgeEndpointsExist(edge: EdgeElement): void {
        const sourceNode = this.elements.get(edge.source);
        const targetNode = this.elements.get(edge.target);
        if (!sourceNode || sourceNode.kind !== 'node') {
            throw new GraphInvariantError(
                `Edge "${edge.id}" source "${edge.source}" is not an existing node.`,
            );
        }
        if (!targetNode || targetNode.kind !== 'node') {
            throw new GraphInvariantError(
                `Edge "${edge.id}" target "${edge.target}" is not an existing node.`,
            );
        }
    }

    private queueChange(record: ChangeRecord): void {
        this.pendingChanges.push(record);
        if (this.transactionDepth === 0) {
            this.flushChanges();
        }
    }

    private flushChanges(): void {
        if (this.pendingChanges.length === 0) return;
        const changes = this.pendingChanges;
        this.pendingChanges = [];
        this.revisionCounter++;
        this.emitter.emit('change', { revision: this.revisionCounter, changes });
    }
}
