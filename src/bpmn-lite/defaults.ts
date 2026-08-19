import type {
    BpmnElement,
    BpmnElementKind,
    BpmnEventSubtype,
    BpmnGatewayDirection,
    BpmnSize,
} from './types.js';

/**
 * default geometry + labels for the palette.
 *
 * Per BPMN modeler convention:
 *  - Events (start/end + future intermediate/boundary): 36×36, the
 *    "small icon" sizing.
 *  - Tasks: 100×80, gives room for an inside label.
 *  - Gateways (exclusive/parallel): 50×50, the canonical diamond.
 *
 * Default labels: the kind name in title case, so the user can see
 * "what" they just dropped without immediately editing the label.
 * the property panel surfaces a label field so authors can
 * rename freely.
 */
interface GeometryDefault {
    readonly size: BpmnSize;
    readonly label?: string;
}

const GEOMETRY: Record<BpmnElementKind, GeometryDefault> = {
    startEvent: { size: { width: 36, height: 36 } },
    endEvent: { size: { width: 36, height: 36 } },
    task: { size: { width: 100, height: 80 }, label: 'Task' },
    exclusiveGateway: { size: { width: 50, height: 50 } },
    parallelGateway: { size: { width: 50, height: 50 } },
    inclusiveGateway: { size: { width: 50, height: 50 } },
    eventBasedGateway: { size: { width: 50, height: 50 } },
    intermediateCatchEvent: { size: { width: 36, height: 36 } },
    boundaryEvent: { size: { width: 36, height: 36 } },
    // A CONTAINER, not a node: it has to be large enough on drop to
    // hold a start event, an activity and an end event without the
    // author resizing first, because until it does the palette can
    // produce a subprocess that `WF.SUBPROCESS_EMPTY` rejects.
    subProcess: { size: { width: 340, height: 200 }, label: 'Subprocess' },
    // Task-sized, not container-sized: the called definition's body
    // lives in ANOTHER diagram, so there is nothing to draw inside.
    callActivity: { size: { width: 100, height: 80 }, label: 'Call Activity' },
};

/**
 * Default geometry + label for a freshly-dropped element of the given
 * kind. The position is up to the caller (typically the drop point
 * minus half-size so the cursor lands at the element's center).
 */
export function defaultGeometryFor(kind: BpmnElementKind): GeometryDefault {
    return GEOMETRY[kind];
}

/**
 * Human-readable label for the palette button. Title case + spaced
 * for readability ("Start Event" not "startEvent"). Surface tooltips
 * + screen-reader labels reuse these.
 */
export const PALETTE_LABELS: Record<BpmnElementKind, string> = {
    startEvent: 'Start Event',
    endEvent: 'End Event',
    task: 'Task',
    exclusiveGateway: 'Exclusive Gateway',
    parallelGateway: 'Parallel Gateway',
    inclusiveGateway: 'Inclusive Gateway',
    eventBasedGateway: 'Event Gateway',
    intermediateCatchEvent: 'Catch Event',
    boundaryEvent: 'Boundary Event',
    subProcess: 'Subprocess',
    callActivity: 'Call Activity',
};

/**
 * Display name per event subtype. Used to build the per-subtype
 * palette tiles ("Timer Event") + the {@link AddElementCommand} undo
 * label, shared by the catch + boundary families.
 */
export const EVENT_SUBTYPE_LABELS: Record<BpmnEventSubtype, string> = {
    timer: 'Timer',
    message: 'Message',
    signal: 'Signal',
    condition: 'Condition',
    error: 'Error',
    compensation: 'Compensation',
};

/**
 * The ordered list of element kinds the palette ships with.
 * Order matches BPMN modeler conventions: events first (start →
 * end), then activity, then gateways.
 *
 * **Superseded by {@link PALETTE_ITEMS}** now that typed events need a
 * `subtype` alongside the kind. Kept as the kind-only projection
 * because `PaletteOptions.kinds` is public API + several tests pin it;
 * new callers should prefer `PALETTE_ITEMS`.
 */
export const PALETTE_KINDS: readonly BpmnElementKind[] = [
    'startEvent',
    'endEvent',
    'task',
    'exclusiveGateway',
    'parallelGateway',
];

/**
 * One palette tile. A tile is a `kind` plus -- for typed events -- the
 * `subtype` that tile drops.
 *
 * **Why per-subtype tiles instead of one "Catch Event" tile the author
 * then re-types in the property panel**: this epic exists because
 * post-M2.f constructs were unauthorable, and a generic tile just
 * relocates the discovery problem into a dropdown. bpmn.io's
 * create-anything popup lists the typed variants for the same reason.
 * The cost is one optional `subtype` argument threaded through
 * `dropElementAt`; the renderer registry still keys on `kind` alone
 * and reads `subtype` off the element for its glyph.
 */
export interface PaletteItem {
    readonly kind: BpmnElementKind;
    readonly subtype?: BpmnEventSubtype;
    /**
     * Task flavour for the activity tiles (`userTask` / `serviceTask`).
     *
     * **Why the tiles are typed rather than one generic "Task"**: the
     * engine's `ElementKind` enum has **no plain `task` case** — only
     * `userTask` and `serviceTask`, with no `TaskAst` behind it, and
     * `"type": "task"` appears nowhere in its corpus. So the old generic
     * tile emitted a body that failed the parser outright with
     * `WF.UNKNOWN_CONSTRUCT_TYPE`: the most basic element on the palette
     * could not deploy. Typed tiles make the only two real choices
     * explicit, the same way the event families do.
     */
    readonly variant?: string;
}

/**
 * The ordered palette. BPMN modeler convention: events (start →
 * intermediate catch family → end), then activity, then gateways.
 */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
    { kind: 'startEvent' },
    { kind: 'intermediateCatchEvent', subtype: 'timer' },
    { kind: 'intermediateCatchEvent', subtype: 'message' },
    { kind: 'intermediateCatchEvent', subtype: 'signal' },
    { kind: 'intermediateCatchEvent', subtype: 'condition' },
    { kind: 'endEvent' },
    { kind: 'task', variant: 'userTask' },
    { kind: 'task', variant: 'serviceTask' },
    // Sits with the activities because that is what it is: a
    // subprocess IS an activity, one whose body happens to be a
    // scope. Dropping it yields an empty container the author then
    // fills; the deploy-time `WF.SUBPROCESS_EMPTY` rule is what stops
    // a forgotten one shipping.
    { kind: 'subProcess' },
    { kind: 'callActivity' },
    { kind: 'exclusiveGateway' },
    { kind: 'parallelGateway' },
    { kind: 'inclusiveGateway' },
    { kind: 'eventBasedGateway' },
    // Boundary tiles drop ONTO an activity rather than onto empty
    // canvas -- see `dropElementAt`. `compensation` is offered because
    // it is authorable (it marks a host compensable) even though it
    // never diverts a token during normal flow.
    { kind: 'boundaryEvent', subtype: 'timer' },
    { kind: 'boundaryEvent', subtype: 'message' },
    { kind: 'boundaryEvent', subtype: 'signal' },
    { kind: 'boundaryEvent', subtype: 'error' },
    { kind: 'boundaryEvent', subtype: 'compensation' },
];

/**
 * Display label for a palette tile / undo entry. Typed events read
 * "Timer Event"; untyped kinds fall back to {@link PALETTE_LABELS}.
 */
export function paletteItemLabel(
    kind: BpmnElementKind,
    subtype?: BpmnEventSubtype,
    variant?: string,
): string {
    if (kind === 'task' && variant !== undefined) {
        return TASK_VARIANT_LABELS[variant] ?? PALETTE_LABELS[kind];
    }
    if (subtype === undefined) return PALETTE_LABELS[kind];
    if (kind === 'intermediateCatchEvent') {
        return `${EVENT_SUBTYPE_LABELS[subtype]} Event`;
    }
    if (kind === 'boundaryEvent') {
        // "Timer Boundary" reads better on a narrow tile than
        // "Boundary Timer Event", and keeps the subtype word first so
        // the tiles sort/scan by what they catch.
        return `${EVENT_SUBTYPE_LABELS[subtype]} Boundary`;
    }
    return PALETTE_LABELS[kind];
}

/**
 * A stable DOM/test hook for a tile: `intermediateCatchEvent:timer`
 * for typed events, bare `task` otherwise. Kept in one place so the
 * palette button attribute, the drag ghost + the tests agree.
 */
export function paletteItemKey(
    kind: BpmnElementKind,
    subtype?: BpmnEventSubtype,
    variant?: string,
): string {
    // A kind carries EITHER a subtype (events) or a variant (tasks),
    // never both, so one `kind:discriminator` shape covers all tiles.
    const discriminator = subtype ?? variant;
    return discriminator === undefined ? kind : `${kind}:${discriminator}`;
}

/** Human labels for the task flavours the palette ships as tiles. */
const TASK_VARIANT_LABELS: Record<string, string> = {
    userTask: 'User Task',
    serviceTask: 'Service Task',
};

/**
 * Kinds that carry a fork/join `direction` on the wire.
 *
 * Exclusive + event-based gateways have no such field: an exclusive
 * gateway's shape is implied by its degree, and an event gateway is
 * always diverging.
 */
export function gatewayCarriesDirection(kind: BpmnElementKind): boolean {
    return kind === 'parallelGateway' || kind === 'inclusiveGateway';
}

/**
 * The direction a freshly-dropped gateway carries.
 *
 * Stamped EXPLICITLY for the same reason boundary `interrupting` is:
 * the property panel renders an unset select as blank, which
 * would show "no direction" over an element the engine reads as
 * diverging. Authors then see a field that looks unset but isn't.
 *
 * ⚠️ Unlike `interrupting`, this one is also ALWAYS EMITTED on save.
 * The parser defaults a missing `direction` to diverging but calls that
 * "a safe lie" and leaves `GatewayDegreeRule` to report the real
 * problem -- i.e. the engine wants it author-declared. Omitting a
 * `diverging` to keep bodies tidy would risk a validation failure on a
 * join, so tidiness loses here.
 */
export function defaultDirectionFor(
    kind: BpmnElementKind,
): BpmnGatewayDirection | undefined {
    return gatewayCarriesDirection(kind) ? 'diverging' : undefined;
}

/**
 * The empty definition block a freshly-dropped typed event carries, so
 * the property panel always has a bound object to edit rather than
 * having to materialise one on first keystroke.
 *
 * These blanks are deliberately NOT emitted on the wire -- the M3.3.g
 * serializer omits an all-blank block, so a dropped-but-unconfigured
 * timer serialises as `{type, subtype:"timer"}`. The M2.c parser
 * tolerates that (`buildTimerDefinition` returns null and the AST gets
 * an empty-valued definition); the deploy-time validators are what
 * tell the author the timer needs a value. Emitting `{"duration": ""}`
 * would be equivalent but noisier in the saved body.
 */
export function blankEventDefinitionFor(
    subtype: BpmnEventSubtype,
): Partial<
    Pick<BpmnElement, 'timer' | 'message' | 'signal' | 'condition'>
> {
    switch (subtype) {
        case 'timer':
            return { timer: { kind: 'duration', value: '' } };
        case 'message':
            return { message: { name: '' } };
        case 'signal':
            return { signal: { name: '' } };
        case 'condition':
            return { condition: { expression: '' } };
        case 'error':
            // `errorCode` is a FLAT wire field, and blank legitimately
            // means "catch every error" -- so there is no block to
            // pre-create and no value to seed.
            return {};
        case 'compensation':
            // Pure association: no definition block at all.
            return {};
    }
}
