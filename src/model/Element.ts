/**
 * Generic graph element types -- the substrate the BPMN-Lite, DMN DRD,
 * and State Machine surfaces all model in. The DMN table editor uses a
 * different shape (rows + columns + cells, NOT nodes + edges) and lives
 * in its own `src/dmn/table/` module.
 *
 * Design notes:
 *  - `id` is owner-assigned + immutable. The model layer enforces
 *    uniqueness; serializers (BPMN-Lite JSON, DMN XML) round-trip the
 *    same id through deploy/load so process instances stay stable
 *    across edits.
 *  - `kind` is the structural discriminator (node vs edge). Renderers
 *    typically dispatch on `kind` first to choose a layout strategy
 *    (positioned rect vs polyline), then on `type` to choose the
 *    specific glyph (start event vs user task vs service task).
 *  - `type` is the surface-specific subtype string. The model layer
 *    treats it as opaque -- per-surface validators decide what's
 *    legal. e.g. BPMN-Lite valid node types are
 *    {'startEvent','endEvent','userTask','serviceTask','exclusiveGateway',
 *     'parallelGateway','intermediateTimerEvent','intermediateMessageEvent',
 *     'boundaryTimerEvent','boundaryMessageEvent'}, but the Graph
 *    accepts any string.
 *  - `properties` is the surface-specific data bag. The model layer
 *    treats it as opaque. Specific renderers + property panel fields
 *    define the schema per (kind, type) tuple.
 *  - Elements are conceptually immutable: every mutation creates a new
 *    element object. Callers should NOT hold onto element references
 *    across mutations -- they go stale. Use the id and re-query
 *    via {@link Graph.getElement} when needed.
 */

/** 2D point. Used for positions, waypoints, and pointer coordinates. */
export interface Position {
    readonly x: number;
    readonly y: number;
}

/** 2D size. Non-negative width/height. */
export interface Size {
    readonly width: number;
    readonly height: number;
}

/**
 * Axis-aligned bounding rect. Useful for hit-test math + selection
 * marquees. The model layer doesn't store Bounds directly -- nodes
 * carry (position, size) instead -- but renderers + the
 * {@link Graph.findNodeAt} hit-test convert to Bounds for the
 * inclusion check.
 */
export interface Bounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Discriminator between positioned shapes and connectors. */
export type ElementKind = 'node' | 'edge';

/** Common shape across both element kinds. */
interface ElementCommon {
    /** Owner-assigned, immutable identity. Unique across the graph. */
    readonly id: string;
    /**
     * Surface-specific subtype string. Renderers dispatch on this to
     * pick a glyph; serializers map it to BPMN/DMN/StateMachine xml
     * type names. Opaque to the model layer.
     */
    readonly type: string;
    /** Opaque surface-specific data bag. Replaced (not merged) on update. */
    readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * A positioned, sized element. BPMN tasks/events/gateways,
 * DMN decisions, StateMachine states all map to NodeElement.
 *
 * Position is the top-left corner in world coordinates. Renderers
 * derive label anchors, port positions, and bounds from
 * (position, size).
 */
export interface NodeElement extends ElementCommon {
    readonly kind: 'node';
    readonly position: Position;
    readonly size: Size;
}

/**
 * A directed connection between two nodes. BPMN sequence flows, DMN
 * information requirements, StateMachine transitions all map to
 * EdgeElement.
 *
 * `source` and `target` are node ids -- they MUST resolve to existing
 * nodes at the moment of insert/update (the Graph enforces this). On
 * cascade-delete of a node, all connected edges are removed in the
 * same change event.
 *
 * `waypoints` are intermediate routing points in world coordinates.
 * Empty list means "renderer computes the route" (straight line from
 * source center to target center, or orthogonal routing per the
 * surface's preference). Non-empty list pins the route; the user can
 * drag waypoints to bend connectors.
 */
export interface EdgeElement extends ElementCommon {
    readonly kind: 'edge';
    readonly source: string;
    readonly target: string;
    readonly waypoints: ReadonlyArray<Position>;
}

/** Discriminated union of all element kinds the generic Graph stores. */
export type Element = NodeElement | EdgeElement;

/**
 * Partial patch for {@link Graph.updateElement}. Omits structurally
 * immutable fields (id + kind) -- the type system catches attempts to
 * patch them.
 */
export type ElementPatch =
    | Partial<Omit<NodeElement, 'id' | 'kind'>>
    | Partial<Omit<EdgeElement, 'id' | 'kind'>>;
