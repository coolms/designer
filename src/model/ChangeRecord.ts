/**
 * Change records describe individual graph mutations within a single
 * {@link ChangeEvent}. Renderers diff against the record set to decide
 * what to repaint; the Editor's `onChange` user callback also receives
 * a {@link ChangeEvent} so consumers can drive auto-save / dirty
 * indicators / collaboration sync.
 *
 * Discriminated union so consumers can `switch (record.type)` and get
 * full type-narrowing on the payload:
 *  - `added`: a new element entered the graph. Renderer creates the
 *    SVG sub-tree.
 *  - `removed`: an element left the graph (user-initiated OR cascade
 *    from a connected node deletion). Renderer removes the SVG
 *    sub-tree.
 *  - `updated`: an element's mutable fields changed (position, size,
 *    properties, waypoints, source/target). Renderer diffs the new
 *    Element vs its last-rendered snapshot.
 *  - `reset`: the entire graph was wiped (load a different file).
 *    Renderer should drop all rendered nodes/edges and re-mount from
 *    {@link Graph.getElements}. NO elementId because the operation is
 *    graph-wide.
 *
 * Order within a {@link ChangeEvent.changes} list reflects the order
 * in which mutations were queued; the renderer can replay them
 * sequentially or merge into a minimal patch -- both are correct
 * because change records are idempotent (re-running the same record
 * set against the same starting state yields the same final state).
 */
export type ChangeRecord =
    | { readonly type: 'added'; readonly elementId: string }
    | { readonly type: 'removed'; readonly elementId: string }
    | { readonly type: 'updated'; readonly elementId: string }
    | { readonly type: 'reset' };

/**
 * A batch of change records emitted as a single subscriber notification.
 * Transactions coalesce multiple records into one event; standalone
 * mutations (outside a transaction) still go through this shape
 * carrying a single record.
 */
export interface ChangeEvent {
    /**
     * Monotonic revision counter. Incremented once per emit, regardless
     * of how many records are in the batch. Useful for "did anything
     * change since I last looked" comparisons + optimistic-concurrency
     * checks during async save.
     */
    readonly revision: number;
    /** Ordered records describing what changed in this batch. */
    readonly changes: ReadonlyArray<ChangeRecord>;
}
