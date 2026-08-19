import type { FieldDescriptor } from '../property-panel/FieldDescriptor.js';
import type { BpmnElement, BpmnElementKind } from './types.js';

/**
 * The kind discriminator the schema provider dispatches on. Elements
 * carry their own {@link BpmnElementKind}; the literal `'flow'`
 * stands in for sequence flows so the lookup table is a single
 * Record<string, FieldDescriptor[]>.
 *
 * **M3.3.i additions** layered on top of M3.3.f's 5-kind set:
 *  - `'userTask'` -- task variant; surfaces a `formKey` autocomplete
 *    driven by the XRefs scope `'workflow.forms'`.
 *  - `'serviceTask'` -- task variant; surfaces an `implementation`
 *    autocomplete driven by XRefs scope `'workflow.handlers'`.
 *
 * Both variants live in the same SCHEMA TABLE as the kind set; the
 * dispatch is `getSchemaForElement` deciding which key to use.
 *
 * **In the EDITOR model**, `BpmnElement.type` stays `'task'` for all
 * three variants -- the variant tag in {@link BpmnElement.variant} is
 * the pivot per the closed-set decision. **On the WIRE**, the
 * M2.c BPMN-Lite parser dispatches on the full type string (`userTask`,
 * `serviceTask`, `task`) -- it doesn't consult `variant` on tasks --
 * so the {@link bpmnLiteModelToJson} serializer encodes the editor
 * variant into the wire `type` field (see the docblock on
 * `WIRE_TASK_TYPE_TO_VARIANT` in `fromJson.ts` + the inverse encoder
 * in `toJson.ts`). Editor model + wire shape stay distinct + the
 * translation is at the serializer seam, not in the editor's runtime.
 */
export type BpmnLiteSchemaKey =
    | BpmnElementKind
    | 'flow'
    | 'userTask'
    | 'serviceTask'
    // Typed-event schemas, keyed `<kind>:<subtype>` -- the same pivot
    // idea as the task variants above, but the discriminator is a real
    // wire field rather than one the serializer synthesises.
    | 'intermediateCatchEvent:timer'
    | 'intermediateCatchEvent:message'
    | 'intermediateCatchEvent:signal'
    | 'intermediateCatchEvent:condition'
    | 'boundaryEvent:timer'
    | 'boundaryEvent:message'
    | 'boundaryEvent:signal'
    | 'boundaryEvent:error'
    | 'boundaryEvent:compensation';

/**
 * Static option list that pivots a `task` element's schema. M3.3.i
 * ships three variants; later phases can expand without touching the
 * lookup mechanism.
 *
 * The empty-value option (rendered by the SELECT field renderer
 * when `allowEmpty: true`) maps to the plain-task schema; the named
 * options switch to the variant schemas.
 */
const TASK_VARIANT_OPTIONS = [
    { value: 'userTask', label: 'User task' },
    { value: 'serviceTask', label: 'Service task' },
] as const;

/**
 * Option list that re-types an intermediate catch event in place, so an
 * author who dropped the wrong tile can pivot without deleting +
 * re-connecting the element.
 *
 * NOT `allowEmpty` -- the M2.c parser hard-fails an
 * `intermediateCatchEvent` with no `subtype`
 * (`WF.UNKNOWN_CONSTRUCT_TYPE`), so offering "none" would let the
 * author build a body that cannot deploy.
 */
const EVENT_SUBTYPE_OPTIONS = [
    { value: 'timer', label: 'Timer' },
    { value: 'message', label: 'Message' },
    { value: 'signal', label: 'Signal' },
    { value: 'condition', label: 'Conditional' },
] as const;

/**
 * Fork/join picker shared by the gateway kinds that carry a `direction`
 * (parallel + inclusive). NOT `allowEmpty`: the parser silently defaults
 * a missing direction to diverging and leaves `GatewayDegreeRule` to
 * report the consequences, so offering "unset" would let an author
 * build a join that reads as a fork.
 */
const GATEWAY_DIRECTION_FIELD: FieldDescriptor = {
    type: 'select',
    key: 'direction',
    label: 'Direction',
    description:
        'Diverging forks the flow into its outgoing branches; Converging joins incoming branches back together.',
    options: [
        { value: 'diverging', label: 'Diverging (fork)' },
        { value: 'converging', label: 'Converging (join)' },
    ],
    // ⚠️ `allowEmpty` DEFAULTS TO TRUE in SelectField -- it must be
    // switched off explicitly or the control offers a blank option.
    allowEmpty: false,
};

/** Subtypes a BOUNDARY event may carry (no `condition`; plus error + compensation). */
const BOUNDARY_SUBTYPE_OPTIONS = [
    { value: 'timer', label: 'Timer' },
    { value: 'message', label: 'Message' },
    { value: 'signal', label: 'Signal' },
    { value: 'error', label: 'Error' },
    { value: 'compensation', label: 'Compensation' },
] as const;

/**
 * Label + subtype picker + the interrupting toggle every boundary
 * event opens with.
 *
 * The interrupting toggle is deliberately NOT constrained per subtype
 * here even though the engine is strict (message = non-interrupting
 * only, error = interrupting only). Those live in deploy-time rules
 * (`G7ScopeGuardRule`, `ErrorBoundaryScopeRule`); duplicating them in
 * the panel would drift from the engine and silently disagree. The
 * descriptions say what the engine will enforce instead.
 */
const BOUNDARY_COMMON: FieldDescriptor[] = [
    {
        type: 'text',
        key: 'label',
        label: 'Label',
        description: 'Optional human-readable name displayed below the event.',
        placeholder: 'On timeout',
        maxLength: 80,
    },
    {
        type: 'select',
        key: 'subtype',
        label: 'Event type',
        description:
            'What interrupts the host activity. Changing this re-types the event in place.',
        options: BOUNDARY_SUBTYPE_OPTIONS,
        allowEmpty: false,
    },
    {
        type: 'boolean',
        key: 'interrupting',
        label: 'Interrupting',
        checkboxLabel: 'Cancels the host activity when it fires',
        description:
            'On: firing cancels the host activity (solid ring). Off: the host keeps running (dashed ring). The engine requires message boundaries to be non-interrupting and error boundaries to be interrupting.',
    },
];

/** The label + subtype picker every typed catch event opens with. */
const CATCH_EVENT_COMMON: FieldDescriptor[] = [
    {
        type: 'text',
        key: 'label',
        label: 'Label',
        description: 'Optional human-readable name displayed below the event.',
        placeholder: 'Wait',
        maxLength: 80,
    },
    {
        type: 'select',
        key: 'subtype',
        label: 'Event type',
        description:
            'What the token waits for. Changing this re-types the event in place.',
        options: EVENT_SUBTYPE_OPTIONS,
        allowEmpty: false,
    },
];

/**
 * Default schema table -- the per-kind field set + M3.3.i's
 * variant schemas + a `variant` picker on the `task` schema so the
 * author can pivot the task subkind without re-creating the element.
 *
 * **All kinds get a `label` text field**, which the node
 * renderers paint inside (task) or below (events + gateways) per
 * BPMN convention. **Sequence flows get a `condition`** EL field
 * (evaluated by the engine when the source is an exclusive gateway,
 * per M2.c's `WF.GATEWAY_CONDITION_*` validator rules) and an
 * **`isDefault`** boolean (marks the default outgoing flow per
 * `WF.GATEWAY_DEFAULT_*`).
 *
 * **Tasks** get a variant SELECT after the label; the M3.3.i
 * variant-aware lookup picks `userTask` / `serviceTask` schemas
 * when the user selects a variant + falls back to the plain `task`
 * schema otherwise.
 *
 * **User tasks** inherit label + variant + add `formKey` --
 * autocomplete-backed by the XRefs scope `'workflow.forms'`
 * (populated by the Angular wrapper from
 * `GET /api/v1/forms`).
 *
 * **Service tasks** inherit label + variant + add `implementation`
 * -- autocomplete-backed by the XRefs scope
 * `'workflow.handlers'` (populated by the wrapper from
 * `GET /api/v1/workflow/handlers`).
 *
 * Surface authors that want a different schema construct a custom
 * provider + pass it to {@link BpmnLitePropertyPanel}.
 */
/**
 * Multi-instance fields, shared by every activity that can carry the
 * marker (both task variants, subprocess, call activity).
 *
 * **No "parallel" toggle.** The engine rejects parallel multi-instance
 * at deploy (`WF.MI_PARALLEL_UNSUPPORTED`) because concurrent
 * iterations would each need their own `elementVariable` and process
 * variables are shared per instance — so offering the checkbox would
 * only let an author build something that cannot ship.
 *
 * Leaving the collection blank turns the activity back into a plain
 * one; the serializer keys the whole block off that field.
 */
const MULTI_INSTANCE_FIELDS: FieldDescriptor[] = [
    {
        type: 'text',
        key: 'loopCollection',
        label: 'Repeat over (collection)',
        description:
            'Optional. EL yielding a list; the activity then runs once per item, in order. Leave blank for a normal single run. An empty list at runtime skips the activity entirely.',
        placeholder: 'variables["lineItems"]',
        maxLength: 255,
    },
    {
        type: 'text',
        key: 'loopElementVariable',
        label: 'Item variable',
        description:
            'Process-variable name the current item is written to before each iteration. Defaults to "item".',
        placeholder: 'item',
        maxLength: 80,
    },
    {
        type: 'text',
        key: 'loopCompletionCondition',
        label: 'Stop early when',
        description:
            'Optional EL re-checked after each iteration; when true the loop stops before the collection is exhausted (e.g. "two approvals are enough").',
        placeholder: 'variables["approvals"] >= 2',
        maxLength: 255,
    },
];

const DEFAULT_SCHEMAS: Record<BpmnLiteSchemaKey, FieldDescriptor[]> = {
    startEvent: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description: 'Optional human-readable name displayed below the event.',
            placeholder: 'Start',
            maxLength: 80,
        },
    ],
    endEvent: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description: 'Optional human-readable name displayed below the event.',
            placeholder: 'End',
            maxLength: 80,
        },
    ],
    // Bare kind schema -- reached only by an event whose subtype is
    // somehow unset (hand-authored bodies with an unknown subtype are
    // kept out of the model entirely, so in practice the `:subtype`
    // keys below are what render).
    intermediateCatchEvent: CATCH_EVENT_COMMON,
    'intermediateCatchEvent:timer': [
        ...CATCH_EVENT_COMMON,
        {
            type: 'select',
            key: 'timer.kind',
            label: 'Timer type',
            description:
                'Duration waits a relative span; Date waits until an instant; Cycle repeats.',
            options: [
                { value: 'duration', label: 'Duration' },
                { value: 'date', label: 'Date' },
                { value: 'cycle', label: 'Cycle' },
            ],
            // Clearing the kind would leave `toJson` emitting a timer
            // block keyed by the literal string "undefined".
            allowEmpty: false,
        },
        {
            type: 'text',
            key: 'timer.value',
            label: 'Timer expression',
            description:
                'ISO-8601 literal (PT15M, 2026-01-01T00:00:00Z, R3/PT10M) or an EL expression resolved when the token arrives.',
            placeholder: 'PT15M',
            maxLength: 255,
        },
    ],
    'intermediateCatchEvent:message': [
        ...CATCH_EVENT_COMMON,
        {
            type: 'text',
            key: 'message.name',
            label: 'Message name',
            description:
                'Name the inbound message must carry to wake this token.',
            placeholder: 'OrderApproved',
            maxLength: 255,
        },
        {
            type: 'text',
            key: 'message.correlation',
            label: 'Correlation key',
            description:
                'Process variable matched against the message payload to pick the right instance.',
            placeholder: 'orderId',
            maxLength: 255,
        },
    ],
    'intermediateCatchEvent:signal': [
        ...CATCH_EVENT_COMMON,
        {
            type: 'text',
            key: 'signal.name',
            label: 'Signal name',
            description:
                'Broadcast name. Signals carry no correlation key -- every waiting token with this name resumes.',
            placeholder: 'ShipmentDelayed',
            maxLength: 255,
        },
    ],
    'intermediateCatchEvent:condition': [
        ...CATCH_EVENT_COMMON,
        {
            type: 'text',
            key: 'condition.expression',
            label: 'Condition',
            description:
                'EL expression re-evaluated when process variables change; the token resumes when it becomes true.',
            placeholder: 'order.total > 1000',
            maxLength: 500,
        },
    ],
    // Boundary events. `attachedTo` is intentionally NOT an editable
    // field: the attachment is expressed by the docking gesture on the
    // canvas, and a free-text host id would let the author point it at
    // a non-existent element.
    boundaryEvent: BOUNDARY_COMMON,
    'boundaryEvent:timer': [
        ...BOUNDARY_COMMON,
        {
            type: 'select',
            key: 'timer.kind',
            label: 'Timer type',
            description:
                'Duration waits a relative span; Date waits until an instant; Cycle repeats.',
            options: [
                { value: 'duration', label: 'Duration' },
                { value: 'date', label: 'Date' },
                { value: 'cycle', label: 'Cycle' },
            ],
            // Clearing the kind would leave `toJson` emitting a timer
            // block keyed by the literal string "undefined".
            allowEmpty: false,
        },
        {
            type: 'text',
            key: 'timer.value',
            label: 'Timer expression',
            description:
                'ISO-8601 literal (PT15M, R3/PT10M) or an EL expression. The clock starts when the host activity begins.',
            placeholder: 'PT15M',
            maxLength: 255,
        },
    ],
    'boundaryEvent:message': [
        ...BOUNDARY_COMMON,
        {
            type: 'text',
            key: 'message.name',
            label: 'Message name',
            description:
                'Name the inbound message must carry to fire this boundary while the host is live.',
            placeholder: 'OrderCancelled',
            maxLength: 255,
        },
        {
            type: 'text',
            key: 'message.correlation',
            label: 'Correlation key',
            description:
                'Process variable matched against the message payload to pick the right instance.',
            placeholder: 'orderId',
            maxLength: 255,
        },
    ],
    'boundaryEvent:signal': [
        ...BOUNDARY_COMMON,
        {
            type: 'text',
            key: 'signal.name',
            label: 'Signal name',
            description:
                'Broadcast name. Fires whenever a matching signal is broadcast while the host is live.',
            placeholder: 'ShipmentDelayed',
            maxLength: 255,
        },
    ],
    'boundaryEvent:error': [
        ...BOUNDARY_COMMON,
        {
            type: 'text',
            key: 'errorCode',
            label: 'Error code',
            description:
                'BPMN errorRef to catch. Leave blank to catch ANY error from the host. The engine allows error boundaries on service tasks only.',
            placeholder: 'PAYMENT_DECLINED',
            maxLength: 255,
        },
    ],
    'boundaryEvent:compensation': BOUNDARY_COMMON,
    task: [
        {
            type: 'text',
            key: 'label',
            label: 'Name',
            description: 'Name displayed inside the task box.',
            placeholder: 'Task',
            maxLength: 80,
        },
        {
            type: 'select',
            key: 'variant',
            label: 'Task type',
            description:
                'User task surfaces a form key; service task surfaces an implementation key. Plain task is a placeholder for hand-tuned definitions.',
            options: TASK_VARIANT_OPTIONS,
            /**
             * `allowEmpty` stays TRUE here, unlike the other pickers --
             * NOT because an untyped task is a legitimate choice, but so
             * a legacy body that already contains one DISPLAYS honestly
             * as unset. Forcing the picker closed would make the browser
             * fall back to the first option, showing "User task" over an
             * element the model says is untyped.
             *
             * The palette can no longer CREATE one (its tiles stamp a
             * variant), and the placeholder says what happens if it is
             * left this way.
             */
            allowEmpty: true,
            placeholder: 'Not set — will not deploy',
        },
    ],
    userTask: [
        {
            type: 'text',
            key: 'label',
            label: 'Name',
            description: 'Name displayed inside the task box.',
            placeholder: 'User task',
            maxLength: 80,
        },
        {
            type: 'select',
            key: 'variant',
            label: 'Task type',
            description:
                'Pick "User task" to surface a form key; "Service task" to surface an implementation key.',
            options: TASK_VARIANT_OPTIONS,
            /**
             * `allowEmpty` stays TRUE here, unlike the other pickers --
             * NOT because an untyped task is a legitimate choice, but so
             * a legacy body that already contains one DISPLAYS honestly
             * as unset. Forcing the picker closed would make the browser
             * fall back to the first option, showing "User task" over an
             * element the model says is untyped.
             *
             * The palette can no longer CREATE one (its tiles stamp a
             * variant), and the placeholder says what happens if it is
             * left this way.
             */
            allowEmpty: true,
            placeholder: 'Not set — will not deploy',
        },
        {
            type: 'select',
            key: 'formKey',
            label: 'Form key',
            description:
                'FormModule definition id rendered by the Inbox when the user opens the task.',
            xrefScope: 'workflow.forms',
            allowEmpty: true,
        },
        ...MULTI_INSTANCE_FIELDS,
    ],
    serviceTask: [
        {
            type: 'text',
            key: 'label',
            label: 'Name',
            description: 'Name displayed inside the task box.',
            placeholder: 'Service task',
            maxLength: 80,
        },
        {
            type: 'select',
            key: 'variant',
            label: 'Task type',
            description:
                'Pick "User task" to surface a form key; "Service task" to surface an implementation key.',
            options: TASK_VARIANT_OPTIONS,
            /**
             * `allowEmpty` stays TRUE here, unlike the other pickers --
             * NOT because an untyped task is a legitimate choice, but so
             * a legacy body that already contains one DISPLAYS honestly
             * as unset. Forcing the picker closed would make the browser
             * fall back to the first option, showing "User task" over an
             * element the model says is untyped.
             *
             * The palette can no longer CREATE one (its tiles stamp a
             * variant), and the placeholder says what happens if it is
             * left this way.
             */
            allowEmpty: true,
            placeholder: 'Not set — will not deploy',
        },
        {
            type: 'select',
            key: 'implementation',
            label: 'Implementation',
            description:
                'Service-task handler key dispatched by the engine. Picks from the live `coolms.workflow.handler` registry.',
            xrefScope: 'workflow.handlers',
            allowEmpty: true,
        },
        ...MULTI_INSTANCE_FIELDS,
    ],
    inclusiveGateway: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description:
                'Optional human-readable name displayed below the gateway.',
            placeholder: 'Which channels?',
            maxLength: 80,
        },
        GATEWAY_DIRECTION_FIELD,
    ],
    eventBasedGateway: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description:
                'Optional human-readable name displayed below the gateway. Each outgoing branch must target an intermediate timer, message or signal catch event; the first to fire cancels its siblings.',
            placeholder: 'Await reply',
            maxLength: 80,
        },
    ],
    /**
     * A subprocess carries only a label. Everything that makes it a
     * scope — which elements are inside it — is authored by DROPPING
     * them in the container, not typed into a field here, so a
     * "children" or "parent" input would be a second, contradictory way
     * to say the same thing.
     */
    subProcess: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description:
                'Optional name for this block of work, shown at the top-left of the container. Drop elements inside the box to put them in the scope; the token entering the subprocess waits until everything inside it finishes.',
            placeholder: 'Review block',
            maxLength: 80,
        },
        ...MULTI_INSTANCE_FIELDS,
    ],
    /**
     * `calledElement` is the ONE field that makes a call activity work,
     * so it is a plain text input rather than a picker: the key resolves
     * at CALL time against whatever is deployed, which means a caller
     * may legitimately reference a definition that does not exist yet.
     * A dropdown of currently-deployed keys would make that legal case
     * unauthorable.
     */
    callActivity: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description:
                'Optional human-readable name shown inside the activity.',
            placeholder: 'Run credit check',
            maxLength: 80,
        },
        {
            type: 'text',
            key: 'calledElement',
            label: 'Called definition',
            description:
                'Definition key of the workflow to run as a child process. Resolved against its CURRENTLY-DEPLOYED version each time the call runs, so redeploying the callee changes what later calls execute. The caller waits until the child instance finishes; data crosses only through declared input/output mappings.',
            placeholder: 'billing.credit_check',
            maxLength: 255,
        },
        ...MULTI_INSTANCE_FIELDS,
    ],
    exclusiveGateway: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description:
                'Optional human-readable name (e.g. the decision question).',
            placeholder: 'Decision?',
            maxLength: 80,
        },
    ],
    parallelGateway: [
        {
            type: 'text',
            key: 'label',
            label: 'Label',
            description: 'Optional human-readable name.',
            maxLength: 80,
        },
        // Pre-existing authorability gap closed alongside the inclusive
        // gateway: the wire has always carried `direction` on parallel
        // gateways, but nothing surfaced it, so a converging JOIN could
        // be hand-authored yet never created or edited on the canvas.
        GATEWAY_DIRECTION_FIELD,
    ],
    flow: [
        {
            type: 'el-expression',
            key: 'condition',
            label: 'Condition',
            description:
                'Expression evaluated when the source is an exclusive gateway. The flow is taken when truthy.',
            placeholder: 'variables.status == "approved"',
            elFlavour: 'workflow',
        },
        {
            type: 'boolean',
            key: 'isDefault',
            label: 'Default flow',
            description:
                'When the source is an exclusive gateway and no other outgoing condition matches, this flow is taken.',
            checkboxLabel: 'Mark as default outgoing flow',
        },
    ],
};

/**
 * schema provider for the BPMN-Lite property panel, extended
 * by M3.3.i with variant-aware lookup so a `task` element carrying
 * `variant: 'userTask'` / `'serviceTask'` resolves to the variant
 * schema instead of the plain task schema.
 *
 * **Why a class with a `schemas` constructor map**: surface authors
 * that want a tenant-specific schema (additional fields, custom
 * field types) construct a provider with the extended map. Future
 * ships can layer a per-instance override (e.g. a task with
 * `extensionElements.fields` from the wire payload) without
 * changing the consumer interface.
 *
 * **What this provider does NOT do** (deferred):
 *  - **Per-element overrides** -- the M2.c BPMN-Lite JSON shape
 *    can carry `extensionElements` on individual elements; later
 *    ships can layer those as instance-level extra fields on top
 *    of the kind / variant schema.
 *  - **Non-task variants** -- timer / message event variants
 *    (startEvent + timerEventDefinition, intermediateThrowEvent +
 *    messageEventDefinition, ...) follow the same variant pivot
 *    pattern but aren't shipped at M3.3.i. The mechanism is here;
 *    those variants land when their renderers + palette tiles do.
 */
export class BpmnLiteSchemaProvider {
    private readonly schemas: Record<string, FieldDescriptor[]>;

    constructor(
        schemas: Partial<Record<BpmnLiteSchemaKey, FieldDescriptor[]>> = {},
    ) {
        // Merge caller overrides over defaults so partial customisation
        // (e.g. "swap the task label field for a richer renderer") works
        // without replicating the whole table.
        this.schemas = { ...DEFAULT_SCHEMAS, ...schemas };
    }

    /**
     * Get the field descriptor list for the given key. Returns the
     * empty array when no schema is registered.
     *
     * **Variant pivot is NOT applied here** -- this entry point is
     * still keyed on a literal {@link BpmnLiteSchemaKey}. Tests + the
     * surface API for "give me the schema for variant X" continue to
     * call this. Use {@link getSchemaForElement} when you have an
     * element + want the variant-aware dispatch.
     */
    getSchema(key: BpmnLiteSchemaKey): ReadonlyArray<FieldDescriptor> {
        return this.schemas[key] ?? [];
    }

    /**
     * variant-aware schema lookup for an element.
     *
     * Currently `task` is the only kind with declared variants; for
     * other kinds this just falls through to {@link getSchema}.
     * When a task carries `variant: 'userTask'` or
     * `variant: 'serviceTask'`, the resolved schema is the variant's
     * fields (label + variant picker + variant-specific field). A
     * task with no `variant` (or with `variant === 'task'`) gets
     * the plain task schema.
     *
     * The variant pivot is intentionally permissive: an unknown
     * variant value (e.g. `'workflowTask'` from a custom tenant
     * extension) falls back to the plain task schema. The schema
     * provider is a UI affordance, not a validator -- M2.c is the
     * authoritative validator at deploy time.
     */
    getSchemaForElement(
        element: BpmnElement,
    ): ReadonlyArray<FieldDescriptor> {
        if (element.type === 'task' && typeof element.variant === 'string') {
            if (element.variant === 'userTask' || element.variant === 'serviceTask') {
                return this.getSchema(element.variant);
            }
        }
        // Typed-event pivot -- same permissiveness as the task variant
        // pivot above: an unrecognised subtype falls back to the bare
        // kind schema (label + subtype picker) rather than rendering
        // nothing, so the author can always re-type the element.
        if (element.subtype !== undefined) {
            const keyed = `${element.type}:${element.subtype}`;
            if (this.schemas[keyed] !== undefined) {
                return this.getSchema(keyed as BpmnLiteSchemaKey);
            }
        }
        return this.getSchema(element.type satisfies BpmnLiteSchemaKey);
    }

    /** All registered kind keys -- test affordance + future tooling. */
    keys(): ReadonlyArray<string> {
        return Object.keys(this.schemas);
    }
}

/** Factory that returns the default M3.3.f + M3.3.i schema set. */
export function defaultBpmnLiteSchemaProvider(): BpmnLiteSchemaProvider {
    return new BpmnLiteSchemaProvider();
}
