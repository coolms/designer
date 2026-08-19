import { defaultGeometryFor, gatewayCarriesDirection } from '../defaults.js';
import type {
    BpmnElement,
    BpmnElementKind,
    BpmnEventSubtype,
    BpmnGatewayDirection,
    BpmnLiteModel,
    BpmnPosition,
    BpmnSequenceFlow,
    BpmnSize,
    BpmnTimerDefinition,
} from '../types.js';
import { autoLayoutBpmnLite } from './autoLayout.js';

/**
 * Errors thrown by {@link bpmnLiteJsonToModel} when the input
 * structure cannot be parsed into a {@link BpmnLiteModel}. The
 * editor's M3.3.h Angular wrapper catches these + surfaces them in
 * a banner so the user can hand-edit the JSON back into shape.
 *
 * The M2.c parser is the AUTHORITATIVE validator -- it produces
 * structured `WF.*` violation codes for engine-level issues. This
 * client-side parser only catches shape errors that would prevent
 * the editor from MOUNTING the model at all (e.g. missing required
 * keys, wrong types on required fields). Engine-semantic violations
 * (orphan elements, missing start event, gateway condition errors)
 * are M2.c's job at deploy time.
 */
export class BpmnLiteParseError extends Error {
    override readonly name = 'BpmnLiteParseError';
    constructor(message: string) {
        super(message);
    }
}

/**
 * Set of element-kind discriminators the editor renders. Items in
 * the wire `elements` array tagged with one of these become
 * {@link BpmnElement} entries; items tagged `sequenceFlow` become
 * {@link BpmnSequenceFlow} entries. Items tagged with anything else
 * (the M2.c parser supports a wider taxonomy: `userTask`,
 * `serviceTask`, `messageEvent` variants, etc.) are TOLERATED but
 * dropped from the editor model -- the wire shape is preserved
 * verbatim in `processExtras.unsupportedElements` so a re-save
 * round-trips them losslessly.
 *
 * The choice to NOT mount unsupported elements (vs e.g. drawing
 * them as "?" boxes) keeps the editor's invariants clean -- M3.3.b
 * renderers + M3.3.f schemas only handle the closed set. M3.3.h-i
 * will widen this set as variant pickers land.
 */
const SUPPORTED_ELEMENT_KINDS: ReadonlySet<BpmnElementKind> = new Set<
    BpmnElementKind
>([
    'startEvent',
    'endEvent',
    'task',
    'exclusiveGateway',
    'parallelGateway',
    'inclusiveGateway',
    'eventBasedGateway',
    'intermediateCatchEvent',
    'boundaryEvent',
    'subProcess',
    'callActivity',
]);

/**
 * Boundary subtypes the editor authors. `condition` is absent: the
 * engine's `BoundarySubtype` enum has no conditional case, so a
 * conditional boundary would fail the parser outright.
 */
const SUPPORTED_BOUNDARY_SUBTYPES: ReadonlySet<string> = new Set([
    'timer',
    'message',
    'signal',
    'error',
    'compensation',
]);

/**
 * Reconcile the wire's dual interrupting spelling into one boolean.
 *
 * Mirrors `BpmnLiteJsonParser::buildBoundaryEvent`: `interrupting` and
 * `nonInterrupting` may BOTH appear, in which case they must disagree
 * (`interrupting === !nonInterrupting`); agreeing values are a
 * contradiction the parser rejects with
 * `WF.BOUNDARY_CONTRADICTORY_FLAGS`. Neither present means interrupting.
 *
 * Returns `null` for the contradictory case so the caller can preserve
 * the entry verbatim rather than silently picking a winner -- the body
 * does not deploy, and rewriting it would hide that from the author.
 */
function readInterrupting(item: Record<string, unknown>): boolean | null {
    const hasI = Object.prototype.hasOwnProperty.call(item, 'interrupting');
    const hasNi = Object.prototype.hasOwnProperty.call(item, 'nonInterrupting');
    if (hasI && hasNi) {
        const i = Boolean(item['interrupting']);
        const ni = Boolean(item['nonInterrupting']);
        if (i === ni) return null; // contradictory
        return i;
    }
    if (hasI) return Boolean(item['interrupting']);
    if (hasNi) return !Boolean(item['nonInterrupting']);
    return true;
}

/**
 * Event subtypes the editor authors. A wire `intermediateCatchEvent`
 * whose `subtype` is outside this set (or missing) is NOT promoted into
 * the model -- it falls through to `unsupportedElements` and round-trips
 * verbatim, exactly as it did before this kind was supported. That
 * matters because the M2.c parser hard-fails an
 * `intermediateCatchEvent` with an unknown/missing `subtype`
 * (`WF.UNKNOWN_CONSTRUCT_TYPE`); silently coercing it to a default
 * subtype here would rewrite the author's body into something that
 * deploys differently from what they wrote.
 */
const SUPPORTED_EVENT_SUBTYPES: ReadonlySet<string> = new Set([
    'timer',
    'message',
    'signal',
    'condition',
]);

/**
 * Wire `timer` block ⇄ editor {@link BpmnTimerDefinition}.
 *
 * The wire keys by kind (`{"duration": "PT15M"}`); the parser takes the
 * first non-empty {@see TimerKind} case it finds, in enum order
 * (duration → date → cycle). This mirrors that precedence so a
 * hand-authored body carrying more than one key round-trips to the same
 * timer the engine would build.
 */
function readTimerDefinition(raw: unknown): BpmnTimerDefinition | null {
    if (!isObject(raw)) return null;
    for (const kind of ['duration', 'date', 'cycle'] as const) {
        const value = raw[kind];
        if (typeof value === 'string' && value !== '') {
            return { kind, value };
        }
    }
    return null;
}

/**
 * **Wire-task-type → editor-variant translation table.**
 *
 * The engine-side BPMN-Lite parser dispatches on the FULL wire
 * `type` string for the task family:
 *   - `type: "userTask"`    → `UserTaskAst`    (engine parks token, mints
 *                             a TaskInstance, awaits Inbox claim/complete)
 *   - `type: "serviceTask"` → `ServiceTaskAst` (engine invokes the
 *                             registered handler via M2.j ServiceTaskInvoker)
 *   - `type: "task"`        → `TaskAst`        (plain pass-through, no
 *                             engine-side side effect)
 *
 * The M2.c parser does NOT consult a `variant` field on task elements
 * to disambiguate them -- `variant` on the wire is reserved for
 * sub-flavours of start/end events (`message`, `timer`, `none`).
 * Trying to emit `{type: "task", variant: "userTask"}` from the
 * editor (the pre-fix shape) makes M2.c read a plain TaskAst,
 * silently losing the user-task runtime semantics.
 *
 * The M3.3.j architectural decision keeps {@link BpmnElementKind} a
 * closed 5-kind set + pivots task subtypes on a top-level `variant`
 * slot in the EDITOR model. This map is the translation layer at the
 * serializer seam that bridges the two shapes:
 *
 *   wire `type: "userTask"`        ⇄ editor `{type: "task", variant: "userTask"}`
 *   wire `type: "serviceTask"`     ⇄ editor `{type: "task", variant: "serviceTask"}`
 *   wire `type: "task"`            ⇄ editor `{type: "task"}` (no variant)
 *
 * Both `fromJson` (this file) + `toJson` (the inverse path) consult
 * this map. Adding a new task subtype (e.g. `manualTask`,
 * `scriptTask`, `sendTask`, `receiveTask`, `businessRuleTask` when
 * M2.c's `ElementKind` enum widens to support them) = (1) add the
 * entry here + (2) widen the {@link BpmnElement.variant} string union
 * docblock + (3) extend the {@link BpmnLiteSchemaProvider} variant
 * schemas.
 *
 * **Forward-compat tolerance**: when the wire body carries the OLD
 * pre-fix shape -- `type: "task"` + an explicit `variant:
 * "userTask"|"serviceTask"` slot -- the variant is still surfaced
 * because the per-element `variant` reader on line ~302 picks it up.
 * Drafts authored against the broken pre-fix `toJson` continue to
 * parse without data loss when re-loaded post-fix.
 */
const WIRE_TASK_TYPE_TO_VARIANT: Readonly<Record<string, string>> = {
    userTask: 'userTask',
    serviceTask: 'serviceTask',
};

/**
 * the inverse of {@link bpmnLiteModelToJson}. Parses a
 * BPMN-Lite JSON document into a {@link BpmnLiteModel} the editor
 * can mount via `BpmnLiteEditor.load(model)`.
 *
 * **Tolerant parser**: missing optional keys default sensibly
 * (auto-layout fallback for missing diagram geometry, empty
 * arrays for missing in/out, no condition for missing condition
 * object). The editor invariant "every element has position + size"
 * is upheld by falling back to {@link defaultGeometryFor} when no
 * diagram bounds are supplied -- gives unlabelled hand-authored
 * models a sane starting layout.
 *
 * **Strict on critical shape errors**: throws
 * {@link BpmnLiteParseError} when:
 *  - input isn't valid JSON
 *  - root isn't an object
 *  - `elements` is present but isn't an array
 *  - `process` is present but isn't an object
 *  - an element item isn't an object OR is missing its `id` / `type`
 *
 * **Preservation contract**:
 *  - Element-kind items: unknown wire fields land in
 *    {@link BpmnElement.extras}. The reserved keys (`id`, `type`,
 *    `label`, `in`, `out`, `default`) are consumed by the parser
 *    + don't leak into extras.
 *  - SequenceFlow items: unknown wire fields land in
 *    {@link BpmnSequenceFlow.extras}. Reserved keys
 *    (`id`, `type`, `source`, `target`, `condition`) are consumed.
 *  - Process header: unknown wire fields (`version`,
 *    `documentation`, `variables`, ...) land in
 *    {@link BpmnLiteModel.processExtras}.
 *  - **Unsupported elements** (kind not in {@link SUPPORTED_ELEMENT_KINDS}
 *    + not `sequenceFlow`): preserved as `processExtras.unsupportedElements`
 *    in input order. Re-emitted by toJson.
 *
 * **`default` → `isDefault` migration**: when an element carries
 * `default: <flowId>`, the parser stamps `isDefault: true` on the
 * matching flow. If the flow id doesn't exist in the elements array
 * (orphan default), the stamp is silently skipped + the flow ref
 * is preserved on the element's extras (via the implicit
 * pass-through of unrecognised wire fields -- BUT `default` itself
 * is recognised, so it's consumed; orphan defaults effectively
 * drop). M2.c validation will catch the deeper structural issue on
 * deploy.
 */
export function bpmnLiteJsonToModel(text: string): BpmnLiteModel {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new BpmnLiteParseError(
            `Invalid JSON: ${(e as Error).message}`,
        );
    }
    return bpmnLiteWireToModel(parsed);
}

/**
 * Lower-level entry point -- accepts a pre-parsed object (e.g. the
 * output of a JSONC stripper) without re-parsing. Useful for tests
 * + future M3.3.h+ shipping that consumes JSON from a fetch
 * response where the body is already an object.
 */
export function bpmnLiteWireToModel(input: unknown): BpmnLiteModel {
    if (!isObject(input)) {
        throw new BpmnLiteParseError('Root must be an object.');
    }

    const processNode = input['process'];
    if (processNode !== undefined && !isObject(processNode)) {
        throw new BpmnLiteParseError('`process` must be an object.');
    }
    const processId = readProcessId(processNode);
    const processExtras = stripKnown(processNode ?? {}, ['id']);

    const elementsRaw = input['elements'];
    if (elementsRaw !== undefined && !Array.isArray(elementsRaw)) {
        throw new BpmnLiteParseError('`elements` must be an array.');
    }
    const wireItems: ReadonlyArray<unknown> = elementsRaw ?? [];

    const diagram = readDiagram(input['diagram']);

    const elements: BpmnElement[] = [];
    const flows: BpmnSequenceFlow[] = [];
    const elementDefaults = new Map<string, string>(); // sourceId -> defaultFlowId
    const unsupported: Array<Record<string, unknown>> = [];

    for (let i = 0; i < wireItems.length; i++) {
        const item = wireItems[i];
        if (!isObject(item)) {
            throw new BpmnLiteParseError(
                `elements[${i}] must be an object.`,
            );
        }
        const id = item['id'];
        const type = item['type'];
        if (typeof id !== 'string' || id.length === 0) {
            throw new BpmnLiteParseError(
                `elements[${i}].id must be a non-empty string.`,
            );
        }
        if (typeof type !== 'string') {
            throw new BpmnLiteParseError(
                `elements[${i}].type must be a string.`,
            );
        }

        if (type === 'sequenceFlow') {
            flows.push(readSequenceFlow(item, i, diagram));
            continue;
        }
        // Translate wire task subtypes (`userTask`, `serviceTask`)
        // into the editor's `{type: 'task', variant: <name>}` shape.
        // See {@link WIRE_TASK_TYPE_TO_VARIANT} for the rationale +
        // forward-compat semantics.
        const variantFromWireType = WIRE_TASK_TYPE_TO_VARIANT[type];
        if (variantFromWireType !== undefined) {
            const { element, defaultFlow } = readElement(
                item,
                'task',
                diagram,
                variantFromWireType,
            );
            elements.push(element);
            if (defaultFlow !== null) {
                elementDefaults.set(element.id, defaultFlow);
            }
            continue;
        }
        /**
         * §2.4 DUAL SPELLING: an `intermediateCatchEvent` carrying
         * `attachedTo` IS a boundary event -- the engine parser routes
         * it to `buildBoundaryEvent`, not to the catch builder. Normalise
         * to the editor's `boundaryEvent` kind here so one wire shape
         * doesn't produce two different models. `toJson` then re-emits
         * the canonical `type: "boundaryEvent"` spelling.
         */
        const isBoundary =
            type === 'boundaryEvent' ||
            (type === 'intermediateCatchEvent' &&
                item['attachedTo'] !== undefined);

        if (isBoundary) {
            // A boundary whose subtype the engine can't build, or whose
            // interrupting flags contradict, is preserved verbatim --
            // both cases hard-fail the parser, and quietly repairing
            // them would rewrite the author's body into a different
            // process than the one they wrote.
            if (
                !SUPPORTED_BOUNDARY_SUBTYPES.has(item['subtype'] as string) ||
                readInterrupting(item) === null
            ) {
                unsupported.push({ ...item });
                continue;
            }
            const { element, defaultFlow } = readElement(
                item,
                'boundaryEvent',
                diagram,
            );
            elements.push(element);
            if (defaultFlow !== null) {
                elementDefaults.set(element.id, defaultFlow);
            }
            continue;
        }

        // A typed event is only authorable when its subtype is one the
        // editor knows. An unknown/missing subtype falls through to the
        // preserve-verbatim path below rather than being coerced -- see
        // {@link SUPPORTED_EVENT_SUBTYPES}.
        if (
            type === 'intermediateCatchEvent' &&
            !SUPPORTED_EVENT_SUBTYPES.has(item['subtype'] as string)
        ) {
            unsupported.push({ ...item });
            continue;
        }
        if (SUPPORTED_ELEMENT_KINDS.has(type as BpmnElementKind)) {
            const { element, defaultFlow } = readElement(
                item,
                type as BpmnElementKind,
                diagram,
            );
            elements.push(element);
            if (defaultFlow !== null) {
                elementDefaults.set(element.id, defaultFlow);
            }
            continue;
        }
        // Unsupported kind -- preserve the wire entry as-is so
        // toJson can re-emit it without loss. The editor won't
        // paint it but it survives the round-trip.
        unsupported.push({ ...item });
    }

    // Apply default flow stamps now that the flow set is built.
    if (elementDefaults.size > 0) {
        for (let i = 0; i < flows.length; i++) {
            const flow = flows[i]!;
            const defaultFor = elementDefaults.get(flow.source);
            if (defaultFor === flow.id) {
                flows[i] = { ...flow, isDefault: true };
            }
        }
    }

    const finalProcessExtras: Record<string, unknown> = { ...processExtras };
    if (unsupported.length > 0) {
        finalProcessExtras['unsupportedElements'] = unsupported;
    }

    // auto-layout fallback for bodies arriving without a
    // diagram sidecar. `autoLayoutBpmnLite` no-ops when ANY element
    // already has non-default position (i.e. the wire body had a
    // diagram), so this is safe to call unconditionally. Bodies
    // hand-authored at M2.n for engine-only execution finally get
    // a sensible left-to-right cascade instead of stacking at the
    // canvas origin.
    const laidOut = autoLayoutBpmnLite(elements, flows);

    const model: BpmnLiteModel = {
        processId,
        elements: laidOut,
        flows,
        ...(Object.keys(finalProcessExtras).length > 0
            ? { processExtras: finalProcessExtras }
            : {}),
    };
    return model;
}

interface DiagramData {
    readonly elements: Map<
        string,
        { position: BpmnPosition; size: BpmnSize }
    >;
    readonly flows: Map<string, BpmnPosition[]>;
}

function readDiagram(raw: unknown): DiagramData {
    const elements = new Map<
        string,
        { position: BpmnPosition; size: BpmnSize }
    >();
    const flows = new Map<string, BpmnPosition[]>();
    if (!isObject(raw)) return { elements, flows };

    const els = raw['elements'];
    if (isObject(els)) {
        for (const [id, value] of Object.entries(els)) {
            if (!isObject(value)) continue;
            const bounds = value['bounds'];
            if (!isObject(bounds)) continue;
            const x = numericOr(bounds['x'], 0);
            const y = numericOr(bounds['y'], 0);
            const width = numericOr(bounds['width'], 0);
            const height = numericOr(bounds['height'], 0);
            elements.set(id, {
                position: { x, y },
                size: { width, height },
            });
        }
    }

    const fls = raw['flows'];
    if (isObject(fls)) {
        for (const [id, value] of Object.entries(fls)) {
            if (!isObject(value)) continue;
            const waypoints = value['waypoints'];
            if (!Array.isArray(waypoints)) continue;
            const chain: BpmnPosition[] = [];
            for (const w of waypoints) {
                if (!isObject(w)) continue;
                const x = numericOr(w['x'], NaN);
                const y = numericOr(w['y'], NaN);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                chain.push({ x, y });
            }
            if (chain.length >= 2) {
                flows.set(id, chain);
            }
        }
    }

    return { elements, flows };
}

function readProcessId(processNode: unknown): string {
    if (!isObject(processNode)) return 'process.unnamed';
    const id = processNode['id'];
    if (typeof id === 'string' && id.length > 0) return id;
    return 'process.unnamed';
}

function readElement(
    item: Record<string, unknown>,
    type: BpmnElementKind,
    diagram: DiagramData,
    /**
     * **Variant override** -- set when the wire `type` field carries
     * a task subtype name (`userTask`, `serviceTask`) that the main
     * loop already translated to `'task'` via
     * {@link WIRE_TASK_TYPE_TO_VARIANT}. When non-null, takes
     * precedence over any explicit `variant` slot in the wire item
     * (which shouldn't be present, but if it is + disagrees, the
     * wire `type` field is the authoritative signal).
     */
    variantOverride: string | null = null,
): { element: BpmnElement; defaultFlow: string | null } {
    const id = item['id'] as string;
    const label =
        typeof item['label'] === 'string' ? item['label'] : undefined;
    /**
     * promote `variant`, `implementation`, `formKey` to
     * top-level slots on {@link BpmnElement}. The M2.c BPMN-Lite
     * parser already places them at the top level on the wire; the
     * editor used to leak them into `extras` because the property
     * panel didn't surface them. Now the schema provider's
     * variant-driven lookup needs them as first-class fields so
     * the field renderers' `(values as Record<string, unknown>)[key]`
     * read path resolves cleanly without an extras-aware fallback.
     *
     * Forward-compat: when the wire body carries `type: "task"` +
     * an explicit `variant` slot (the pre-fix shape that the
     * broken `toJson` emitted), the explicit slot is honoured here.
     * When the wire body carries `type: "userTask"|"serviceTask"`,
     * the main parsing loop synthesises `variantOverride` from the
     * type translation table + this slot is ignored.
     */
    const variant: string | undefined =
        variantOverride !== null
            ? variantOverride
            : typeof item['variant'] === 'string'
              ? item['variant']
              : undefined;
    const implementation =
        typeof item['implementation'] === 'string'
            ? item['implementation']
            : undefined;
    const formKey =
        typeof item['formKey'] === 'string' ? item['formKey'] : undefined;
    const layout = diagram.elements.get(id);
    const defaultGeo = defaultGeometryFor(type);
    const position = layout?.position ?? { x: 0, y: 0 };
    // Default size when bounds are missing OR have zero width/height
    // (the wire shape doesn't constrain this; a hand author could
    // omit width/height). Fall back to the kind's conventional size.
    const size: BpmnSize =
        layout !== undefined &&
        layout.size.width > 0 &&
        layout.size.height > 0
            ? layout.size
            : defaultGeo.size;
    const defaultFlow =
        typeof item['default'] === 'string' && item['default'].length > 0
            ? item['default']
            : null;
    /**
     * Typed-event promotion is SCOPED to the kinds that actually carry
     * a `subtype` discriminator -- currently only
     * `intermediateCatchEvent`.
     *
     * ⚠️ Do NOT widen this to every kind. `message` + `timer` also
     * appear on message/timer START events, where they pair with the
     * wire's `variant` slot rather than `subtype`. Promoting them
     * unconditionally would move a message-start's block out of
     * `extras` while `toJson` only re-emits promoted blocks for typed
     * events -- silently DROPPING the message definition of every
     * message start event on re-save. Keeping the promotion scoped
     * leaves those kinds on the byte-identical extras path they
     * already round-trip through. Start/end event variants get their
     * own promotion when that slice lands.
     */
    const isBoundary = type === 'boundaryEvent';
    const isTypedEvent = type === 'intermediateCatchEvent' || isBoundary;
    const subtype =
        isTypedEvent && typeof item['subtype'] === 'string'
            ? (item['subtype'] as BpmnEventSubtype)
            : undefined;
    const timer = isTypedEvent ? readTimerDefinition(item['timer']) : null;
    const messageRaw = isTypedEvent ? item['message'] : undefined;
    const message =
        isObject(messageRaw) && typeof messageRaw['name'] === 'string'
            ? {
                  name: messageRaw['name'],
                  ...(typeof messageRaw['correlation'] === 'string' &&
                  messageRaw['correlation'] !== ''
                      ? { correlation: messageRaw['correlation'] }
                      : {}),
              }
            : undefined;
    const signalRaw = isTypedEvent ? item['signal'] : undefined;
    const signal =
        isObject(signalRaw) && typeof signalRaw['name'] === 'string'
            ? { name: signalRaw['name'] }
            : undefined;
    const conditionRaw = isTypedEvent ? item['condition'] : undefined;
    const condition =
        isObject(conditionRaw) && typeof conditionRaw['expression'] === 'string'
            ? {
                  expression: conditionRaw['expression'],
                  ...(typeof conditionRaw['language'] === 'string' &&
                  conditionRaw['language'] !== ''
                      ? { language: conditionRaw['language'] }
                      : {}),
              }
            : undefined;

    // Boundary-only slots. `errorCode` is FLAT on the wire (not a nested
    // block), and `interrupting` is the reconciliation of the wire's dual
    // interrupting/nonInterrupting spelling -- so BOTH spellings are
    // consumed here and re-emitted as the single canonical one.
    const attachedTo =
        isBoundary && typeof item['attachedTo'] === 'string'
            ? item['attachedTo']
            : undefined;
    const interrupting = isBoundary
        ? (readInterrupting(item) ?? true)
        : undefined;
    const errorCode =
        isBoundary && typeof item['errorCode'] === 'string'
            ? item['errorCode']
            : undefined;

    /**
     * Gateway fork/join declaration. Promoted for the two kinds that
     * carry it -- which INCLUDES `parallelGateway`, whose `direction`
     * used to sit unread in `extras`: the editor could round-trip a
     * hand-authored converging parallel join but never create or edit
     * one, because nothing surfaced the field.
     */
    const direction =
        gatewayCarriesDirection(type) &&
        (item['direction'] === 'diverging' ||
            item['direction'] === 'converging')
            ? (item['direction'] as BpmnGatewayDirection)
            : undefined;

    /**
     * Scope membership. Unlike every other promoted field this is
     * kind-INDEPENDENT — any element can sit in a scope — so it is
     * promoted (and therefore reserved) unconditionally whenever it is
     * a non-empty string.
     */
    const parent =
        typeof item['parent'] === 'string' && item['parent'].length > 0
            ? item['parent']
            : undefined;

    /**
     * Multi-instance marker, FLATTENED out of the nested
     * `loopCharacteristics` block so the property panel (which
     * addresses values by a single key) can edit the fields directly.
     * `toJson` re-nests them.
     */
    const loopRaw = item['loopCharacteristics'];
    const loop = isObject(loopRaw) ? loopRaw : undefined;
    const loopCollection =
        typeof loop?.['collection'] === 'string'
            ? loop['collection']
            : undefined;
    const loopElementVariable =
        typeof loop?.['elementVariable'] === 'string'
            ? loop['elementVariable']
            : undefined;
    const loopCompletionCondition =
        typeof loop?.['completionCondition'] === 'string'
            ? loop['completionCondition']
            : undefined;

    /** Promoted only for the kind that carries it, like the event blocks. */
    const calledElement =
        type === 'callActivity' && typeof item['calledElement'] === 'string'
            ? item['calledElement']
            : undefined;

    const extras = stripKnown(item, [
        'id',
        'type',
        'label',
        'in',
        'out',
        'default',
        'variant',
        'implementation',
        'formKey',
        // Same "reserve only when promoted" discipline as `direction`:
        // a malformed `parent` (a number, an empty string) stays in
        // extras and round-trips verbatim instead of being silently
        // dropped.
        ...(parent !== undefined ? ['parent'] : []),
        ...(calledElement !== undefined ? ['calledElement'] : []),
        // Reserved only when the block was actually READ, so an
        // unrecognised shape (a `parallel: true` we cannot author, a
        // string where an object belongs) survives in extras and
        // round-trips verbatim to the deploy-time rule that reports it.
        ...(loopCollection !== undefined ? ['loopCharacteristics'] : []),
        // Reserved only when it was actually PROMOTED. Keying this off
        // the kind alone would strip an unrecognised value (`"sideways"`)
        // from extras while leaving no promoted field to re-emit it from
        // -- silently dropping it. Legal values are promoted; anything
        // else stays in extras and round-trips verbatim.
        ...(direction !== undefined ? ['direction'] : []),
        // Only reserved for the kinds that promote them -- see above.
        ...(isTypedEvent
            ? ['subtype', 'timer', 'message', 'signal', 'condition']
            : []),
        ...(isBoundary
            ? ['attachedTo', 'interrupting', 'nonInterrupting', 'errorCode']
            : []),
    ]);

    const element: BpmnElement = {
        id,
        type,
        position,
        size,
        ...(label !== undefined ? { label } : {}),
        ...(variant !== undefined ? { variant } : {}),
        ...(implementation !== undefined ? { implementation } : {}),
        ...(formKey !== undefined ? { formKey } : {}),
        ...(subtype !== undefined ? { subtype } : {}),
        ...(timer !== null ? { timer } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(signal !== undefined ? { signal } : {}),
        ...(condition !== undefined ? { condition } : {}),
        ...(direction !== undefined ? { direction } : {}),
        ...(parent !== undefined ? { parent } : {}),
        ...(calledElement !== undefined ? { calledElement } : {}),
        ...(loopCollection !== undefined ? { loopCollection } : {}),
        ...(loopElementVariable !== undefined ? { loopElementVariable } : {}),
        ...(loopCompletionCondition !== undefined
            ? { loopCompletionCondition }
            : {}),
        ...(attachedTo !== undefined ? { attachedTo } : {}),
        ...(interrupting !== undefined ? { interrupting } : {}),
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(Object.keys(extras).length > 0 ? { extras } : {}),
    };
    return { element, defaultFlow };
}

function readSequenceFlow(
    item: Record<string, unknown>,
    index: number,
    diagram: DiagramData,
): BpmnSequenceFlow {
    const id = item['id'] as string;
    const source = item['source'];
    const target = item['target'];
    if (typeof source !== 'string' || source.length === 0) {
        throw new BpmnLiteParseError(
            `elements[${index}].source must be a non-empty string.`,
        );
    }
    if (typeof target !== 'string' || target.length === 0) {
        throw new BpmnLiteParseError(
            `elements[${index}].target must be a non-empty string.`,
        );
    }

    const condition = readCondition(item['condition']);
    const waypoints = diagram.flows.get(id);

    const extras = stripKnown(item, [
        'id',
        'type',
        'source',
        'target',
        'condition',
    ]);

    const flow: BpmnSequenceFlow = {
        id,
        source,
        target,
        ...(condition !== undefined ? { condition } : {}),
        ...(waypoints !== undefined && waypoints.length >= 2
            ? { waypoints }
            : {}),
        ...(Object.keys(extras).length > 0 ? { extras } : {}),
    };
    return flow;
}

/**
 * Read the wire-format condition shape `{language, expression}` +
 * project to the editor's bare string. M3.3.g drops the language
 * tag on the floor -- the engine speaks only the workflow EL
 * flavour. Future ships that introduce additional flavours will
 * need to preserve the tag (probably as an `extras.conditionLanguage`
 * sidecar so the bare-string ergonomics stay clean for the
 * common case).
 *
 * Also tolerates a bare string `condition: "expr"` for
 * forward-compat -- some hand-authored corpora may use the bare
 * form. Either shape parses to the same internal representation.
 */
function readCondition(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string') {
        return raw.length > 0 ? raw : undefined;
    }
    if (isObject(raw)) {
        const expr = raw['expression'];
        if (typeof expr === 'string' && expr.length > 0) return expr;
    }
    return undefined;
}

function stripKnown(
    source: Record<string, unknown>,
    known: ReadonlyArray<string>,
): Record<string, unknown> {
    const knownSet = new Set(known);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) {
        if (knownSet.has(k)) continue;
        out[k] = v;
    }
    return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numericOr(v: unknown, fallback: number): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return fallback;
}
