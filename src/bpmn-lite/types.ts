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
 * **M3.3.a scope (this ship)**: minimal shape -- only the fields
 * the scaffold needs (processId, elements, flows). Concrete
 * subtype shapes for Start/End/Task/Gateway + per-element
 * properties (form key, candidates, timer durations, message
 * names, condition expressions) land in M3.3.b-f as the renderers
 * + palette + property panel come online.
 *
 * **Why mirror M2.c at the type layer, not at the editor's
 * internal graph layer**: the editor's mutation API needs to be
 * imperative (drag, drop, reroute, undo) -- that's the M3.2.c
 * `Graph` shape. The model exposed via `BpmnLiteEditor.state` is
 * the immutable serializable snapshot that maps directly onto the
 * M2.c JSON shape. M3.3.g composes Graph → BpmnLiteModel for
 * `toJson()` and BpmnLiteModel → Graph for `fromJson()`. Two
 * tier-aligned types beats one type that has to be both an undo
 * unit AND a wire-format.
 *
 * **Camunda extensions (`camunda:property`, `camunda:formKey`)**
 * land as per-element-type optional fields in M3.3.f when the
 * property panel comes online. M3.2.o XML corpus is the
 * round-trip reference.
 */

/**
 * The closed set of BPMN-Lite element kinds the renderer
 * library supports. Mirrors a subset of M2.c's `ElementKind` enum --
 * the 5 core node types every BPMN-Lite process is built from.
 * adds `sequenceFlow` as an edge type (modeled separately
 * in {@link BpmnSequenceFlow}, not as an element). M3.3.f layers
 * variant tags on top (timer / message event variants, user /
 * service task variants) without expanding this list -- the variant
 * tag lives on the element body, not the kind.
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
 * The M2.c parser reads `direction` on **parallel** and **inclusive**
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
 * **Why a `subtype` slot and not one kind per event type**: the M2.c
 * parser's canonical wire spelling for a typed intermediate event is
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
 * Element position in the canvas coordinate system. M3.3.b convention:
 * `(x, y)` is the top-left corner of the element's bounding box --
 * matches the BPMN modeler convention + makes geometry arithmetic
 * (waypoint computation in M3.3.c) straightforward.
 */
export interface BpmnPosition {
    readonly x: number;
    readonly y: number;
}

/**
 * Element bounding box in the canvas coordinate system. M3.3.b ships
 * five default sizes:
 *   - Events: 36×36 (small-icon convention from the BPMN spec)
 *   - Tasks: 100×80 (modeler convention; gives room for a label)
 *   - Gateways: 50×50 (modeler convention)
 *
 * Defaults aren't enforced in the renderers; they read whatever the
 * model carries. M3.3.d palette will set conventional defaults at
 * create time so authors get the expected starting geometry.
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
     * autocomplete vs the M2.j handler catalog). M2.c's BPMN-Lite
     * parser already carries the same `variant` slot on the wire
     * format -- this is a verbatim round-trip; the editor doesn't
     * synthesise it on save.
     *
     * Variants on non-task kinds are NOT defined at M3.3.i (timer /
     * message event variants land in a later phase via the same
     * pattern -- the schema provider's `getSchemaForElement` is
     * already variant-aware).
     */
    readonly variant?: string;
    /**
     * service-task implementation key. Set when
     * `variant === 'serviceTask'`. Mirrors the M2.c BPMN-Lite parser's
     * top-level `implementation` slot + the
     * {@see https://docs.coolms} engine's
     * handler dispatch key. The M3.3.f property panel renders a select
     * dropdown driven by the XRefs scope
     * `'workflow.handlers'` populated from the backend
     * `/api/v1/workflow/handlers` endpoint.
     */
    readonly implementation?: string;
    /**
     * user-task form key. Set when
     * `variant === 'userTask'`. Resolves to a FormModule definition
     * id resolved by the host's form registry;
     * the M2.k Inbox surface uses it to render the task's form when
     * the user opens the work item. The M3.3.f property panel
     * renders a select dropdown driven by the XRefs scope
     * `'workflow.forms'` populated from the existing
     * `/api/v1/forms` endpoint.
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
     * wire-format fields the editor doesn't author but
     * MUST preserve across JSON round-trips. The M2.c BPMN-Lite
     * parser shape carries a long tail of element-kind-specific
     * fields (`message`, `documentation`, `inputs`, `outputs`,
     * `candidateUsers`, ...) that the editor doesn't yet surface.
     * Hand-authored JSON may carry them; the editor's `fromJson`
     * parks them in `extras`; `toJson` re-emits them verbatim.
     * Authors get lossless round-trip even for fields the editor
     * can't yet edit. M3.3.i+ progressively promotes specific
     * extras to top-level fields (variant, implementation, formKey
     * landed in M3.3.i) so the property panel can surface them
     * cleanly.
     */
    readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * Sequence-flow shape -- a single connection in the process graph.
 * Each flow connects `source` → `target` by element id (matching the
 * M2.c parser's adjacency model).
 *
 * **M3.3.c additions** over M3.3.a:
 *  - `waypoints` -- optional manual route. When present, the editor
 *    paints exactly these points + skips
 *    {@link computeOrthogonalRoute}; when absent, the editor falls
 *    back to the auto-router. Manual waypoints become the default
 *    once M3.3.e connect mode + drag-to-reroute land (the user's
 *    explicit route always wins over auto-routing).
 *  - `condition` -- optional EL expression evaluated by the engine
 *    when the source is an exclusive gateway (per M2.c
 *    `WF.GATEWAY_CONDITION_*` rules). At M3.3.c the editor just
 *    holds the string; M3.3.f surfaces it as a property-panel
 *    field + paints an inline `[condition]` label between the
 *    middle waypoints.
 *  - `isDefault` -- marks the gateway's "default" outgoing flow
 *    (the one the engine picks when no condition matches). Per
 *    M2.c `WF.GATEWAY_DEFAULT_*` rules: at most one default per
 *    gateway. M3.3.c paints default flows with a small diagonal
 *    "/" marker near the source-exit waypoint (BPMN convention).
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
 * the BPMN-Lite `process.id` (matches the M2.b
 * `WorkflowDefinition.definitionKey`); the Angular wrapper
 * deploys against the same key the URL carries.
 */
export interface BpmnLiteModel {
    readonly processId: string;
    readonly elements: ReadonlyArray<BpmnElement>;
    readonly flows: ReadonlyArray<BpmnSequenceFlow>;
    /**
     * the wire-format `process` header carries fields the
     * editor doesn't author at M3.3.f (`version`, `documentation`,
     * `variables`). `fromJson` parks them here; `toJson` re-emits
     * them verbatim. Lossless round-trip even for fields the editor
     * can't yet edit.
     */
    readonly processExtras?: Readonly<Record<string, unknown>>;
}

/**
 * Default starter model -- an empty process with no elements + no
 * flows. M3.3.b adds the M2.c `WF.START_EVENT_REQUIRED` precondition
 * (every process must have at least one start event), but that's a
 * validate-on-deploy check, not an editor invariant -- authors
 * frequently work with incomplete graphs mid-edit + the M3.2.h
 * save-then-deploy split lets them save broken bodies as drafts.
 */
export function emptyBpmnLiteModel(processId = 'process.unnamed'): BpmnLiteModel {
    return {
        processId,
        elements: [],
        flows: [],
    };
}
