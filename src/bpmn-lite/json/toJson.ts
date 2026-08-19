import { defaultGeometryFor } from '../defaults.js';
import type {
    BpmnElement,
    BpmnLiteModel,
    BpmnPosition,
    BpmnSequenceFlow,
} from '../types.js';

/**
 * Options for {@link bpmnLiteModelToJson}.
 */
export interface ToJsonOptions {
    /**
     * Number of spaces for pretty-printing. `0` produces compact
     * JSON. Defaults to `2` -- matches the engine parser's input
     * convention (BPMN-Lite definitions are hand-readable + tracked
     * in Git, so pretty-printed by default).
     */
    readonly indent?: number;
}

/**
 * The BPMN-Lite editor's wire-format serializer. Projects the
 * editor's internal {@link BpmnLiteModel} onto the engine's
 * BPMN-Lite parser JSON shape, so the round-trip
 *   editor → draft storage → deployer → parser → engine
 * has no translation layer at any seam.
 *
 * **Wire shape**:
 * ```jsonc
 * {
 *   "process": { "id": <processId>, ...processExtras },
 *   "elements": [
 *     // Element shape (one of {startEvent, endEvent, task,
 *     // exclusiveGateway, parallelGateway}):
 *     {
 *       "id": <id>,
 *       "type": <kind>,
 *       "label"?: <label>,
 *       "default"?: <flowId>,    // only when this is a gateway
 *                                // whose outgoing default flow
 *                                // has isDefault=true
 *       "in"?:  [<flowId>, ...], // incoming flow ids -- derived
 *       "out"?: [<flowId>, ...], // outgoing flow ids -- derived
 *       ...extras                // preserved unknown fields
 *     },
 *     // SequenceFlow shape:
 *     {
 *       "id": <id>,
 *       "type": "sequenceFlow",
 *       "source": <elementId>,
 *       "target": <elementId>,
 *       "condition"?: {           // only when the editor carries a
 *         "language": "EL",       // condition string
 *         "expression": <expr>
 *       },
 *       ...extras                // preserved unknown fields
 *     }
 *   ],
 *   "diagram"?: {                // omitted when empty
 *     "elements": {
 *       <id>: { "bounds": { "x", "y", "width", "height" } }
 *     },
 *     "flows": {
 *       <id>: { "waypoints": [{ "x", "y" }, ...] }
 *     }
 *   }
 * }
 * ```
 *
 * **Three boundary translations** between the editor's internal
 * model + the wire shape:
 *  1. **Mixed elements array** -- the wire `elements` array carries
 *     BOTH elements + sequence flows tagged by `type`. The editor
 *     keeps them in separate `elements` + `flows` arrays for clean
 *     mutators + paint loops. `toJson` interleaves elements first,
 *     then flows (the engine parser is order-agnostic on the wire).
 *     `fromJson` buckets them back out.
 *  2. **`isDefault` ⇄ `default` migration** -- the editor's flow
 *     model carries `isDefault: true` on the flow itself. The wire
 *     shape puts `default: <flowId>` on the SOURCE element (the
 *     gateway). `toJson` scans flows with `isDefault === true` +
 *     stamps `default` on their sources + drops the flag from the
 *     wire flow. `fromJson` reads `default` off elements + stamps
 *     `isDefault` on the matching flow. This matches the engine's
 *     `WF.GATEWAY_DEFAULT_*` validator rules (default lives on the
 *     gateway in the wire format).
 *  3. **`condition` shape adapter** -- the editor's flow model
 *     carries `condition: <expression>` as a bare string (the
 *     workflow EL is the only flavour the engine speaks). The wire
 *     shape uses `condition: {language: 'EL', expression: <expr>}`.
 *     `toJson` always emits language='EL'; `fromJson` reads the
 *     expression + drops the language tag. Future ships that
 *     introduce non-EL flavours will need to preserve the tag.
 *
 * **`in`/`out` synthesis**: the wire shape carries each element's
 * incoming + outgoing flow ids explicitly (the engine parser uses
 * these as the adjacency model). `toJson` derives them from the
 * flows array + emits `in: [...]`/`out: [...]` on each element.
 * `fromJson` IGNORES them (the separate sequenceFlow rows are
 * authoritative). Hand-authored JSON where in/out disagrees with
 * the flows array is silently corrected on save.
 *
 * **`extras` preservation**: hand-authored JSON may carry fields
 * the editor doesn't surface (`variant`, `message`, `documentation`,
 * `implementation`, `inputs`, `outputs`, `formKey`, `candidateUsers`,
 * timer / message event definitions, ...). `fromJson` parks them
 * in `element.extras` / `flow.extras` / `model.processExtras`;
 * `toJson` re-emits them verbatim BEFORE the editor-managed keys
 * so the editor-managed fields take precedence on key collision
 * (e.g. an extras `label` is overridden by a real `label` edit).
 * The reserved keys (`id`, `type`, `source`, `target`, `condition`,
 * `default`, `in`, `out`) are stripped from extras on serialization
 * to prevent collision.
 *
 * **Diagram sidecar**: position / size / manual-waypoint geometry
 * lives in a sibling `diagram` object keyed by element / flow id.
 * Mirrors the BPMN 2.0 DI standard (`<bpmndi:BPMNDiagram>`) lifted
 * to JSON. Keeping geometry out of the `elements` array means the
 * engine sees pure semantics + the diagram is a separate concern
 * (consistent with what bpmn.io / Camunda Modeler do). `toJson`
 * omits the `diagram` key entirely when nothing geometric has
 * been authored (an entirely auto-layout-able model).
 */
export function bpmnLiteModelToJson(
    model: BpmnLiteModel,
    options: ToJsonOptions = {},
): string {
    const wire = bpmnLiteModelToWire(model);
    const indent = options.indent ?? 2;
    return JSON.stringify(wire, null, indent);
}

/**
 * Lower-level entry point -- produces the JSON-shaped object
 * without stringifying. Useful for tests that want to assert on
 * the structure without a parse round-trip.
 */
export function bpmnLiteModelToWire(
    model: BpmnLiteModel,
): Record<string, unknown> {
    const wireProcess: Record<string, unknown> = {
        ...(model.processExtras ?? {}),
        id: model.processId,
    };

    // Build adjacency maps for in/out synthesis.
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const flow of model.flows) {
        if (!outgoing.has(flow.source)) outgoing.set(flow.source, []);
        outgoing.get(flow.source)!.push(flow.id);
        if (!incoming.has(flow.target)) incoming.set(flow.target, []);
        incoming.get(flow.target)!.push(flow.id);
    }

    // Build default-flow map: source element id -> default flow id.
    const defaultsBySource = new Map<string, string>();
    for (const flow of model.flows) {
        if (flow.isDefault === true) {
            defaultsBySource.set(flow.source, flow.id);
        }
    }

    const wireElements: Array<Record<string, unknown>> = [];

    for (const element of model.elements) {
        /**
         * **Task-variant ⇄ wire-type encoding**.
         *
         * The engine's BPMN-Lite parser dispatches the task family on
         * the full wire `type` string (`userTask`, `serviceTask`,
         * `task`), not on a top-level `variant` slot -- see the
         * docblock on `WIRE_TASK_TYPE_TO_VARIANT` in `fromJson.ts`.
         * So when the editor model carries
         * `{type: 'task', variant: 'userTask'|'serviceTask'}`, the
         * wire body must emit `type: <variant>` and NOT a separate
         * `variant` slot. Emitting the pre-fix shape
         * `{type: 'task', variant: 'userTask'}` would have the engine read
         * a plain `TaskAst`, silently losing the user-task runtime
         * semantics (no task-inbox entry when the engine parks).
         *
         * `wireType` defaults to the editor kind; for tasks with a
         * recognised variant we substitute the variant name as the
         * wire type + suppress the variant slot below.
         */
        let wireType: string = element.type;
        let suppressVariantSlot = false;
        if (
            element.type === 'task' &&
            (element.variant === 'userTask' ||
                element.variant === 'serviceTask')
        ) {
            wireType = element.variant;
            suppressVariantSlot = true;
        }
        const out: Record<string, unknown> = {
            ...sanitizeElementExtras(element.extras),
            id: element.id,
            type: wireType,
        };
        if (element.label !== undefined) {
            out['label'] = element.label;
        }
        /**
         * emit promoted slots at the top level after the
         * extras spread (so an explicit edit always wins over an
         * extras-sourced ghost). The companion {@link fromJson}
         * strips these keys from extras at parse time so a clean
         * round-trip stays clean.
         *
         * Suppress the `variant` slot when it was encoded into the
         * wire type above -- emitting both would be redundant + the
         * engine parser ignores `variant` on tasks anyway, but the
         * extra noise would clutter hand-edited bodies.
         */
        if (element.variant !== undefined && !suppressVariantSlot) {
            out['variant'] = element.variant;
        }
        if (element.implementation !== undefined) {
            out['implementation'] = element.implementation;
        }
        if (element.formKey !== undefined) {
            out['formKey'] = element.formKey;
        }
        /**
         * Typed-event slots. `subtype` is a REAL wire field (unlike the
         * task `variant`, which encodes into the wire type) -- the
         * engine parser's `buildIntermediateCatchEvent` dispatches solely on
         * it, so it must survive verbatim.
         *
         * Blank definition blocks are OMITTED: a freshly-dropped, not-
         * yet-configured timer emits `{type, subtype:"timer"}` with no
         * `timer` key rather than `{"duration": ""}`. Both parse to the
         * same empty-valued AST definition (the parser skips empty
         * strings), and the deploy-time validators are what flag the
         * missing value -- so omitting keeps saved bodies clean without
         * changing engine behaviour.
         */
        if (element.subtype !== undefined) {
            out['subtype'] = element.subtype;
        }
        if (element.timer !== undefined && element.timer.value !== '') {
            // Re-key by kind: editor {kind:'duration',value:'PT15M'}
            // -> wire {"duration": "PT15M"}.
            out['timer'] = { [element.timer.kind]: element.timer.value };
        }
        if (element.message !== undefined && element.message.name !== '') {
            out['message'] = {
                name: element.message.name,
                // ⚠️ wire key is `correlation`, NOT `correlationKey`.
                ...(element.message.correlation !== undefined &&
                element.message.correlation !== ''
                    ? { correlation: element.message.correlation }
                    : {}),
            };
        }
        if (element.signal !== undefined && element.signal.name !== '') {
            out['signal'] = { name: element.signal.name };
        }
        if (
            element.condition !== undefined &&
            element.condition.expression !== ''
        ) {
            out['condition'] = {
                expression: element.condition.expression,
                ...(element.condition.language !== undefined &&
                element.condition.language !== ''
                    ? { language: element.condition.language }
                    : {}),
            };
        }
        /**
         * Boundary slots. `attachedTo` is what MAKES it a boundary, so
         * it is emitted whenever present.
         *
         * `interrupting` is emitted only when FALSE: true is the
         * parser's default for an absent flag, so writing it adds noise
         * to every saved body for no semantic gain. The `nonInterrupting`
         * spelling is deliberately never emitted -- accepting both on
         * read and emitting one on write is what keeps the round-trip
         * stable (emitting both risks the contradictory-flags error).
         *
         * `errorCode` is FLAT, and blank means catch-all, so a blank is
         * omitted rather than written as `""`.
         */
        /**
         * Gateway fork/join declaration -- emitted whenever set, INCLUDING
         * a plain `diverging`. The parser defaults a missing `direction`
         * to diverging but calls that "a safe lie" and leaves
         * `GatewayDegreeRule` to report the real problem, so the engine
         * wants it author-declared. Suppressing the default value to keep
         * bodies tidy would risk a deploy-time failure on a join.
         */
        if (element.direction !== undefined) {
            out['direction'] = element.direction;
        }
        /**
         * Scope membership. Absent means the root scope, and the engine
         * treats a missing `parent` exactly that way, so an empty value
         * is omitted rather than written as `""` — which
         * `SubProcessScopeRule` would then reject as an unknown parent.
         */
        if (element.parent !== undefined && element.parent !== '') {
            out['parent'] = element.parent;
        }
        /**
         * Emitted even when BLANK, unlike `parent`. A call activity with
         * no `calledElement` is a real authoring state (the tile was
         * dropped, the key not yet typed) and the engine's
         * `WF.CALL_NO_CALLED_ELEMENT` is what tells the author about it
         * on deploy. Omitting the key would instead surface as a
         * confusing "unknown construct"-shaped body.
         */
        if (element.type === 'callActivity') {
            out['calledElement'] = element.calledElement ?? '';
        }
        /**
         * Re-nest the flat loop fields. Keyed off `loopCollection`
         * ALONE: it is the field that makes an activity multi-instance,
         * so an author who cleared it back to blank gets a plain
         * activity again rather than a `loopCharacteristics` block that
         * `WF.MI_NO_COLLECTION` would then reject.
         */
        if (
            element.loopCollection !== undefined &&
            element.loopCollection !== ''
        ) {
            const loop: Record<string, unknown> = {
                collection: element.loopCollection,
                elementVariable: element.loopElementVariable ?? 'item',
            };
            if (
                element.loopCompletionCondition !== undefined &&
                element.loopCompletionCondition !== ''
            ) {
                loop['completionCondition'] = element.loopCompletionCondition;
            }
            out['loopCharacteristics'] = loop;
        }
        if (element.attachedTo !== undefined) {
            out['attachedTo'] = element.attachedTo;
        }
        if (element.interrupting === false) {
            out['interrupting'] = false;
        }
        if (element.errorCode !== undefined && element.errorCode !== '') {
            out['errorCode'] = element.errorCode;
        }
        const elIn = incoming.get(element.id);
        if (elIn !== undefined && elIn.length > 0) {
            out['in'] = elIn;
        }
        const elOut = outgoing.get(element.id);
        if (elOut !== undefined && elOut.length > 0) {
            out['out'] = elOut;
        }
        const def = defaultsBySource.get(element.id);
        if (def !== undefined) {
            out['default'] = def;
        }
        wireElements.push(out);
    }

    for (const flow of model.flows) {
        const out: Record<string, unknown> = {
            ...sanitizeFlowExtras(flow.extras),
            id: flow.id,
            type: 'sequenceFlow',
            source: flow.source,
            target: flow.target,
        };
        if (flow.condition !== undefined && flow.condition.length > 0) {
            out['condition'] = { language: 'EL', expression: flow.condition };
        }
        wireElements.push(out);
    }

    const wire: Record<string, unknown> = {
        process: wireProcess,
        elements: wireElements,
    };

    const diagram = buildDiagram(model);
    if (diagram !== null) {
        wire['diagram'] = diagram;
    }

    return wire;
}

/**
 * Reserved keys on elements that the editor manages directly + must
 * never be sourced from `extras`. Re-using these as extras keys
 * would let a hand-authored field override the editor-managed
 * value, which breaks the lossless contract.
 */
const RESERVED_ELEMENT_KEYS = new Set([
    'id',
    'type',
    'label',
    'in',
    'out',
    'default',
    'variant',
    'implementation',
    'formKey',
    // Safe to reserve unconditionally, unlike the event blocks below:
    // `parent` has ONE meaning for every kind, and `fromJson` promotes
    // it for every kind, so there is never a kind whose `parent` rides
    // in extras with no promoted field to re-emit it from.
    'parent',
    'calledElement',
    'loopCharacteristics',
]);

/**
 * ⚠️ `subtype` / `timer` / `message` / `signal` / `condition` are
 * deliberately NOT reserved here.
 *
 * Reserving a key strips it from `extras` on the way out. For an
 * `intermediateCatchEvent` that is harmless (fromJson already promoted
 * those keys out of extras, and the explicit emit above runs AFTER the
 * extras spread, so it wins either way). But the SAME key names ride in
 * `extras` for kinds that don't promote them -- a message start event
 * keeps its `message` block there, a timer start event its `timer`.
 * Reserving them would strip those blocks from extras while leaving no
 * promoted field to re-emit from, silently dropping the definition of
 * every message/timer start event on re-save. Keep them unreserved so
 * the extras path stays byte-identical for those kinds.
 */

const RESERVED_FLOW_KEYS = new Set([
    'id',
    'type',
    'source',
    'target',
    'condition',
]);

function sanitizeElementExtras(
    extras: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
    if (extras === undefined) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extras)) {
        if (RESERVED_ELEMENT_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out;
}

function sanitizeFlowExtras(
    extras: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
    if (extras === undefined) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extras)) {
        if (RESERVED_FLOW_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out;
}

/**
 * Build the diagram sidecar object. Returns `null` when the model
 * carries no non-default geometry AND no manual waypoints -- in
 * that case the `diagram` key is omitted entirely from the wire
 * format. An auto-layout-able model serialises clean.
 */
function buildDiagram(
    model: BpmnLiteModel,
): { elements: Record<string, unknown>; flows: Record<string, unknown> } | null {
    const elements: Record<string, unknown> = {};
    let anyElement = false;
    for (const el of model.elements) {
        const geo = defaultGeometryFor(el.type);
        const hasDefaultPosition = el.position.x === 0 && el.position.y === 0;
        const hasDefaultSize =
            el.size.width === geo.size.width &&
            el.size.height === geo.size.height;
        if (hasDefaultPosition && hasDefaultSize) continue;
        elements[el.id] = {
            bounds: {
                x: el.position.x,
                y: el.position.y,
                width: el.size.width,
                height: el.size.height,
            },
        };
        anyElement = true;
    }

    const flows: Record<string, unknown> = {};
    let anyFlow = false;
    for (const flow of model.flows) {
        if (flow.waypoints === undefined || flow.waypoints.length === 0) {
            continue;
        }
        flows[flow.id] = {
            waypoints: flow.waypoints.map((w) => ({ x: w.x, y: w.y })),
        };
        anyFlow = true;
    }

    if (!anyElement && !anyFlow) return null;
    return { elements, flows };
}

/** Internal-package -- the BpmnPosition emitter for tests. */
export function _positionToWire(p: BpmnPosition): {
    x: number;
    y: number;
} {
    return { x: p.x, y: p.y };
}
