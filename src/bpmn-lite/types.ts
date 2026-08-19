/**
 * BPMN-Lite editor model types.
 *
 * Mirrors the engine's BPMN-Lite parser AST shape so the serializer
 * (`writeBpmnLiteJson` / `readBpmnLiteJson`) is a near-identity
 * transform between the in-memory editor model and the JSON body the
 * engine's workflow deployer reads back through that parser. Editor
 * → storage → deployer → engine has no translation layer, the same
 * shape the DMN serializer and its deployer established.
 *
 * **Why mirror the engine at the type layer, not at the editor's
 * internal graph layer**: the editor's mutation API has to be
 * imperative (drag, drop, reroute, undo) -- that is the `Graph`
 * shape. The model exposed via `BpmnLiteEditor.state` is the
 * immutable serializable snapshot that maps directly onto the
 * engine's JSON shape, and the serializer composes Graph →
 * BpmnLiteModel for `toJson()` and BpmnLiteModel → Graph for
 * `fromJson()`. Two tier-aligned types beats one type that has to
 * be both an undo unit AND a wire format.
 *
 * **Camunda extensions (`camunda:property`, `camunda:formKey`)**
 * are not modelled as first-class fields yet -- they survive in
 * `extras`, and the XML corpus is the round-trip reference for
 * when they get promoted.
 */

/**
 * The closed set of BPMN-Lite element kinds the renderer
 * library supports. Mirrors a subset of the engine's `ElementKind`
 * enum -- the 5 core node types every BPMN-Lite process is built
 * from. `sequenceFlow` is modelled separately as an edge type in
 * {@link BpmnSequenceFlow}, not as an element. Variant tags layer
 * on top (timer / message event variants, user / service task
 * variants) without expanding this list -- the variant tag lives on
 * the element body, not the kind.
 *
 * Adding a new kind = (1) extend this union + (2) ship a renderer +
 * (3) register it in {@link defaultElementRendererRegistry}.
 */
export type BpmnElementKind =
    | 'startEvent'
    | 'endEvent'
    | 'task'
    | 'exclusiveGateway'
    | 'parallelGateway'
    | 'inclusiveGateway'
    | 'eventBasedGateway'
    | 'intermediateCatchEvent'
    | 'boundaryEvent'
    | 'subProcess'
    | 'callActivity';

/**
 * Fork-vs-join declaration for the gateway kinds that carry one.
 *
 * The engine parser reads `direction` on **parallel** and **inclusive**
 * gateways (exclusive + event-based have none). It defaults to
 * `diverging` when the field is absent or unparseable -- and its own
 * comment calls that "a safe lie", leaving `GatewayDegreeRule` to
 * report the real problem at deploy. So an author who omits it on a
 * JOIN gets a body that parses and then fails validation.
 *
 * That is why the editor authors it explicitly rather than relying on
 * the default: until this shipped, a converging PARALLEL gateway was
 * not expressible on the canvas at all.
 */
export type BpmnGatewayDirection = 'diverging' | 'converging';

/**
 * Event subtype discriminator for typed events.
 *
 * **Why a `subtype` slot and not one kind per event type**: the
 * engine parser's canonical wire spelling for a typed intermediate event is
 * `{type: "intermediateCatchEvent", subtype: "timer"}` -- verified
 * against the engine's own integration corpus (67 `intermediateCatchEvent`
 * occurrences vs. a handful of the distinct-type spelling, which are
 * engine-side class/enum identifiers rather than JSON). The
 * engine's element-kind enum DOES carry
 * distinct `intermediateTimerEvent` / `intermediateMessageEvent` /
 * `intermediateSignalEvent` / `intermediateConditionalEvent` cases, but
 * they are a trap: `BpmnLiteJsonParser::buildElementHeader` routes all
 * of them into `buildIntermediateCatchEvent`, which dispatches SOLELY on
 * `$entry['subtype']` and throws `WF.UNKNOWN_CONSTRUCT_TYPE` when it is
 * absent. So `{type: "intermediateTimerEvent"}` alone does NOT parse --
 * it still needs a redundant `subtype: "timer"`. The editor therefore
 * emits the one spelling that is unambiguous and matches the corpus.
 *
 * **One union, per-kind slices.** This is every subtype across every
 * event kind; which ones are LEGAL for a given kind is expressed by the
 * palette tiles ({@link PALETTE_ITEMS}) + the schema table, not by the
 * type. `condition` is catch-only; `error` + `compensation` are
 * boundary-only (they have no standalone catch form). Splitting the
 * union per kind was tried and just pushed the same knowledge into two
 * places that then disagree.
 */
export type BpmnEventSubtype =
    | 'timer'
    | 'message'
    | 'signal'
    | 'condition'
    | 'error'
    | 'compensation';

/**
 * Timer definition -- the editor-side shape of the wire's `timer` block.
 *
 * **Deliberate translation**: the wire keys the timer by its KIND
 * (`{"duration": "PT15M"}` / `{"date": "2026-01-01T00:00:00Z"}` /
 * `{"cycle": "R3/PT10M"}`) -- the parser's `buildTimerDefinition` walks
 * the engine's timer-kind cases and takes the
 * first non-empty one. A single-key-whose-name-is-the-kind object is
 * awkward to bind a property panel to, so the editor normalises it to an
 * explicit `{kind, value}` pair (a kind select + a value input) and the
 * serializer converts on the way out. Same spirit as the
 * task-variant ⇄ wire-type translation in `fromJson.ts`.
 */
export interface BpmnTimerDefinition {
    readonly kind: 'duration' | 'date' | 'cycle';
    readonly value: string;
}

/**
 * Message definition -- catch-event correlation.
 *
 * ⚠️ The wire key is `correlation`, NOT `correlationKey` (the latter
 * is the constructor argument on the engine's message definition). The
 * serializer must emit `correlation` or the engine silently correlates
 * on an empty key.
 */
export interface BpmnMessageDefinition {
    readonly name: string;
    readonly correlation?: string;
}

/**
 * Signal definition -- a broadcast name only. Signals carry no
 * correlation key; the name is the sole routing key (see
 * `SignalDeclarationRule`, which rejects a blank name at deploy time
 * rather than parse time).
 */
export interface BpmnSignalDefinition {
    readonly name: string;
}

/**
 * Conditional-event definition. `language` defaults to `EL` server-side
 * when absent/blank; the editor leaves it optional so an unset value
 * round-trips as absent rather than a redundant `"EL"`.
 */
export interface BpmnConditionDefinition {
    readonly expression: string;
    readonly language?: string;
}

/**
 * Element position in the canvas coordinate system. `(x, y)` is the
 * top-left corner of the element's bounding box -- it matches the
 * BPMN modeler convention and makes the waypoint arithmetic
 * straightforward.
 */
export interface BpmnPosition {
    readonly x: number;
    readonly y: number;
}

/**
 * Element bounding box in the canvas coordinate system. The
 * conventional default sizes are:
 *   - Events: 36×36 (small-icon convention from the BPMN spec)
 *   - Tasks: 100×80 (modeler convention; gives room for a label)
 *   - Gateways: 50×50 (modeler convention)
 *
 * Defaults aren't enforced in the renderers; they read whatever the
 * model carries; the palette sets these defaults at create time so
 * authors get the expected starting geometry.
 */
export interface BpmnSize {
    readonly width: number;
    readonly height: number;
}

/**
 * BPMN element shape -- one of the core nodes. The `type` is
 * a narrow union of {@link BpmnElementKind}; the placeholder
 * `string` typing is gone now that the renderer registry needs a
 * closed set to dispatch on.
 *
 * `position` + `size` carry the geometry; `label` is an optional
 * display string the renderer places below events / gateways +
 * inside tasks per BPMN convention. Variant-specific fields (timer
 * expression, message name, candidate users, form key) land in
 * as the property panel surfaces them; they ride on optional
 * shape extensions per kind, not in this base interface.
 */
export interface BpmnElement {
    readonly id: string;
    readonly type: BpmnElementKind;
    readonly position: BpmnPosition;
    readonly size: BpmnSize;
    readonly label?: string;
    /**
     * task variant tag. When the element is a `task` the
     * editor pivots its property-panel schema on this slot: missing
     * / `'task'` -> plain task; `'userTask'` -> user-task fields
     * (`formKey` autocomplete vs the forms catalog);
     * `'serviceTask'` -> service-task fields (`implementation`
     * autocomplete vs the engine's handler catalog). The engine's
     * BPMN-Lite parser already carries the same `variant` slot on
     * the wire format -- this is a verbatim round-trip; the editor
     * doesn't synthesise it on save.
     *
     * Variants on non-task kinds are NOT defined yet (timer /
     * message event variants land later via the same pattern -- the
     * schema provider's `getSchemaForElement` is already
     * variant-aware).
     */
    readonly variant?: string;
    /**
     * Service-task implementation key, set when
     * `variant === 'serviceTask'`. Mirrors the engine parser's
     * top-level `implementation` slot and the engine's handler
     * dispatch key. The property panel renders it as a select
     * driven by the `'workflow.handlers'` XRefs scope, which the
     * host populates from its own handler catalogue.
     */
    readonly implementation?: string;
    /**
     * User-task form key, set when `variant === 'userTask'`. It
     * resolves to a form definition id in the host's form registry,
     * which the host's task inbox uses to render the form when a
     * user opens the work item. The property panel renders it as a
     * select driven by the `'workflow.forms'` XRefs scope.
     */
    readonly formKey?: string;
    /**
     * Typed-event discriminator. Set when `type` is
     * `'intermediateCatchEvent'` (and, once the boundary family lands,
     * `'boundaryEvent'`). The property panel pivots its schema on this
     * slot exactly as it pivots task fields on {@link variant}, and the
     * renderer picks the inner glyph from it.
     *
     * Unlike {@link variant} -- which the editor synthesises from the
     * wire `type` for tasks -- `subtype` is a REAL wire field and
     * round-trips verbatim.
     */
    readonly subtype?: BpmnEventSubtype;
    /**
     * Timer block. Set when `subtype === 'timer'`. See
     * {@link BpmnTimerDefinition} for the wire ⇄ editor translation.
     */
    readonly timer?: BpmnTimerDefinition;
    /**
     * Message block. Set when `subtype === 'message'`.
     */
    readonly message?: BpmnMessageDefinition;
    /**
     * Signal block. Set when `subtype === 'signal'`.
     */
    readonly signal?: BpmnSignalDefinition;
    /**
     * Condition block. Set when `subtype === 'condition'`.
     */
    readonly condition?: BpmnConditionDefinition;
    /**
     * BPMN `errorRef` code. Set when `subtype === 'error'` on a
     * boundary event. Unlike the other definitions this is a FLAT
     * top-level wire field, not a nested block (`$raw['errorCode']`).
     * An empty/absent code means catch-all.
     */
    readonly errorCode?: string;
    /**
     * Fork-vs-join declaration. Set on `parallelGateway` +
     * `inclusiveGateway`; the other gateway kinds have no such field on
     * the wire. See {@link BpmnGatewayDirection} for why the editor
     * authors it rather than leaning on the parser's default.
     */
    readonly direction?: BpmnGatewayDirection;
    /**
     * Host element id -- the activity this boundary event is attached
     * to. Set only when `type === 'boundaryEvent'`; it is what turns an
     * event into a boundary event (the parser also treats an
     * `intermediateCatchEvent` CARRYING `attachedTo` as a boundary, per
     * the §2.4 dual spelling).
     *
     * The editor is permissive about WHICH kinds may host a boundary --
     * `BoundaryAttachmentRule` restricts it to userTask / serviceTask /
     * intermediate timer or message events / parallelGateway at DEPLOY
     * time, and duplicating that allow-list here would just drift from
     * the engine. Same stance the palette already takes on drop points.
     */
    readonly attachedTo?: string;
    /**
     * Whether firing this boundary event CANCELS its host activity
     * (BPMN solid ring) or leaves it running (dashed ring).
     *
     * Absent means interrupting -- that is the parser's default when
     * neither `interrupting` nor `nonInterrupting` is present. Engine
     * constraints per subtype (message = non-interrupting only, error =
     * interrupting only) are enforced by deploy-time rules, not here.
     */
    readonly interrupting?: boolean;
    /**
     * Owning `subProcess` element id -- the SCOPE this element lives
     * in. Absent means the root of the process.
     *
     * The engine's AST is deliberately FLAT: a subprocess's children
     * stay in the same `elements[]` array and point back with this
     * field, rather than nesting inside the container. The canvas
     * mirrors that exactly — a child is an ordinary element whose
     * geometry happens to sit inside the container's rect — so
     * dragging something out of a scope is a `parent` edit, never a
     * tree re-parent.
     *
     * Distinct from {@link attachedTo}: a boundary event is attached to
     * an activity's EDGE and lives in the activity's own scope; a child
     * is INSIDE the scope.
     */
    readonly parent?: string;
    /**
     * Definition key the call activity invokes. Set only when
     * `type === 'callActivity'`.
     *
     * Resolved at CALL time against the callee's currently-deployed
     * version — not pinned here — so the editor accepts any string,
     * including a definition that does not exist yet. Validating it
     * against the deployed set would make a legal authoring order
     * (caller before callee) impossible.
     */
    readonly calledElement?: string;
    /**
     * Multi-instance marker: run this activity once per item of a
     * collection. Legal on tasks, subprocesses and call activities.
     *
     * Flat fields rather than a nested `loopCharacteristics` object
     * because the property panel's field registry addresses values by a
     * single key — the serializer nests them on the way out, which is
     * the same translation seam the editor already uses for task
     * `variant`.
     */
    readonly loopCollection?: string;
    readonly loopElementVariable?: string;
    readonly loopCompletionCondition?: string;
    /**
     * Wire-format fields the editor doesn't author but MUST
     * preserve across JSON round-trips. The engine's BPMN-Lite
     * parser shape carries a long tail of element-kind-specific
     * fields (`message`, `documentation`, `inputs`, `outputs`,
     * `candidateUsers`, ...) that the editor doesn't yet surface.
     * Hand-authored JSON may carry them; the editor's `fromJson`
     * parks them in `extras`; `toJson` re-emits them verbatim.
     * Authors get lossless round-trip even for fields the editor
     * can't yet edit. Specific extras get promoted to top-level
     * fields over time -- `variant`, `implementation` and `formKey`
     * already have been -- so the property panel can surface them
     * cleanly.
     */
    readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * Sequence-flow shape -- a single connection in the process graph.
 * Each flow connects `source` → `target` by element id (matching the
 * engine parser's adjacency model).
 *
 *  - `waypoints` -- optional manual route. When present, the editor
 *    paints exactly these points + skips
 *    {@link computeOrthogonalRoute}; when absent, the editor falls
 *    back to the auto-router. A manual route always wins over
 *    auto-routing: the user's explicit intent outranks the
 *    heuristic.
 *  - `condition` -- optional EL expression evaluated by the engine
 *    when the source is an exclusive gateway (per its
 *    `WF.GATEWAY_CONDITION_*` rules). The editor holds the string
 *    and the property panel surfaces it, painting an inline
 *    `[condition]` label between the middle waypoints.
 *  - `isDefault` -- marks the gateway's "default" outgoing flow
 *    (the one the engine picks when no condition matches). Per the
 *    engine's `WF.GATEWAY_DEFAULT_*` rules there is at most one per
 *    gateway. Default flows paint with a small diagonal "/" marker
 *    near the source-exit waypoint (BPMN convention).
 */
export interface BpmnSequenceFlow {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly waypoints?: ReadonlyArray<BpmnPosition>;
    readonly condition?: string;
    readonly isDefault?: boolean;
    /**
     * preserved unknown wire fields (mirror of
     * {@link BpmnElement.extras}).
     */
    readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * Top-level model the editor exposes via `state`. `processId` is
 * the BPMN-Lite `process.id`, which matches the engine's
 * `WorkflowDefinition.definitionKey` -- a host deploys against the
 * same key it loaded.
 */
export interface BpmnLiteModel {
    readonly processId: string;
    readonly elements: ReadonlyArray<BpmnElement>;
    readonly flows: ReadonlyArray<BpmnSequenceFlow>;
    /**
     * The wire-format `process` header carries fields the editor
     * doesn't author (`version`, `documentation`, `variables`).
     * `fromJson` parks them here; `toJson` re-emits
     * them verbatim. Lossless round-trip even for fields the editor
     * can't yet edit.
     */
    readonly processExtras?: Readonly<Record<string, unknown>>;
}

/**
 * Default starter model -- an empty process with no elements + no
 * flows. The engine's `WF.START_EVENT_REQUIRED` rule (every process
 * must have at least one start event) is a validate-on-deploy
 * check, NOT an editor invariant -- authors work with incomplete
 * graphs mid-edit, and the save-then-deploy split lets them save
 * broken bodies as drafts.
 */
export function emptyBpmnLiteModel(processId = 'process.unnamed'): BpmnLiteModel {
    return {
        processId,
        elements: [],
        flows: [],
    };
}
