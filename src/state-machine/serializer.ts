import { DEFAULT_PLACE_SIZE } from './types.js';
import type { SmPlace, SmTransition, StateMachineModel } from './types.js';

/**
 * Symfony Workflow serializer.
 *
 * Converts the designer's {@link StateMachineModel} to/from the
 * `framework.workflows.{name}` config shape Symfony's Workflow
 * component consumes. The canonical, dependency-free round-trip is
 * **model ↔ config object** (a plain JSON-serializable structure);
 * the deployed YAML file is emitted server-side by Symfony's Yaml
 * component so escaping stays canonical. A small
 * {@link stateMachineModelToYaml} preview emitter is provided for the
 * designer's live YAML pane — it is **preview-grade**, not the deploy path.
 *
 * **The key transform — coalesce edges by transition name.** The model
 * holds one {@link SmTransition} per drawn edge (single `from`, single
 * `to`). Symfony groups transitions by NAME: a `cancel` reachable from
 * `draft`, `submitted`, AND `approved` is ONE transition with
 * `from: [draft, submitted, approved], to: cancelled`. So
 * {@link stateMachineModelToConfig} groups same-named edges, unions their
 * `from` places, and emits `from` as a bare scalar (one source) or a list
 * (many). The reverse expands a list `from` back into one edge per source.
 */

/** Symfony `marking_store` config — always `method` (the subject owns its `status`). */
export interface WorkflowMarkingStore {
    readonly type: 'method';
    readonly property: string;
}

/** One Symfony Workflow transition (coalesced — `from` may fan in from many places). */
export interface WorkflowTransitionConfig {
    readonly from: string | string[];
    readonly to: string;
    readonly guard?: string;
}

/** The `framework.workflows.{name}` body for a single state machine. */
export interface StateMachineWorkflowConfig {
    readonly type: 'state_machine';
    readonly marking_store: WorkflowMarkingStore;
    readonly supports: string[];
    readonly initial_marking?: string;
    readonly places: string[];
    readonly transitions: Record<string, WorkflowTransitionConfig>;
    /** Symfony `audit_trail` — emitted only when the model flags it enabled. */
    readonly audit_trail?: { readonly enabled: boolean };
}

/** The full `framework: { workflows: { {name}: {...} } }` wrapper. */
export interface FrameworkWorkflowsConfig {
    readonly framework: {
        readonly workflows: Record<string, StateMachineWorkflowConfig>;
    };
}

/**
 * Serialize the model to the Symfony `framework.workflows.{name}` body.
 * Places keep their declared order; transitions coalesce by name in
 * first-appearance order. Self-transitions and dangling endpoints are
 * preserved verbatim (a transition references whatever place names it
 * holds — the validator / Symfony compiler surface bad refs on
 * deploy, not here).
 */
export function stateMachineModelToConfig(
    model: StateMachineModel,
): StateMachineWorkflowConfig {
    const initial = model.places.find((p) => p.initial === true);

    const config: {
        type: 'state_machine';
        marking_store: WorkflowMarkingStore;
        supports: string[];
        initial_marking?: string;
        places: string[];
        transitions: Record<string, WorkflowTransitionConfig>;
        audit_trail?: { enabled: boolean };
    } = {
        type: 'state_machine',
        marking_store: { type: 'method', property: model.markingProperty },
        supports: [...model.supports],
        places: model.places.map((p) => p.id),
        transitions: coalesceTransitions(model.transitions),
    };
    if (initial !== undefined) {
        config.initial_marking = initial.id;
    }
    if (auditTrailEnabled(model)) {
        config.audit_trail = { enabled: true };
    }
    return config;
}

/** Whether the model's `workflowExtras.audit_trail.enabled` is set. */
function auditTrailEnabled(model: StateMachineModel): boolean {
    const at = model.workflowExtras?.['audit_trail'];
    return (
        typeof at === 'object' &&
        at !== null &&
        (at as { enabled?: unknown }).enabled === true
    );
}

/** Wrap {@link stateMachineModelToConfig} in the `framework.workflows.{name}` envelope. */
export function stateMachineModelToFrameworkConfig(
    model: StateMachineModel,
): FrameworkWorkflowsConfig {
    return {
        framework: {
            workflows: { [model.workflowName]: stateMachineModelToConfig(model) },
        },
    };
}

/**
 * Group same-named edges into Symfony transitions. Each group unions its
 * source places (dedup, first-appearance order) into `from`; `to` + guard
 * come from the group's first edge (a well-formed state machine has one
 * `to` + one guard per transition name). `from` collapses to a bare scalar
 * when there is exactly one source.
 */
function coalesceTransitions(
    transitions: ReadonlyArray<SmTransition>,
): Record<string, WorkflowTransitionConfig> {
    const order: string[] = [];
    const froms = new Map<string, string[]>();
    const meta = new Map<string, { to: string; guard?: string }>();

    for (const t of transitions) {
        if (!froms.has(t.name)) {
            order.push(t.name);
            froms.set(t.name, []);
            const m: { to: string; guard?: string } = { to: t.to };
            if (t.guard !== undefined && t.guard.trim().length > 0) {
                m.guard = t.guard;
            }
            meta.set(t.name, m);
        }
        const list = froms.get(t.name)!;
        if (!list.includes(t.from)) {
            list.push(t.from);
        }
    }

    const out: Record<string, WorkflowTransitionConfig> = {};
    for (const name of order) {
        const sources = froms.get(name)!;
        const m = meta.get(name)!;
        const config: { from: string | string[]; to: string; guard?: string } = {
            from: sources.length === 1 ? sources[0]! : sources,
            to: m.to,
        };
        if (m.guard !== undefined) {
            config.guard = m.guard;
        }
        out[name] = config;
    }
    return out;
}

/**
 * Deserialize a Symfony `framework.workflows.{name}` body back into a
 * {@link StateMachineModel}. Places come back at the origin with the
 * default size (the config carries no diagram geometry) — the
 * StateMachineEditor's load path runs auto-layout to position
 * them. A list `from` expands into one {@link SmTransition} per source,
 * id `{name}__{from}`; a single `from` keeps id `{name}`.
 */
export function stateMachineConfigToModel(
    workflowName: string,
    config: StateMachineWorkflowConfig,
): StateMachineModel {
    const places: SmPlace[] = config.places.map((id) => {
        const place: SmPlace = {
            id,
            position: { x: 0, y: 0 },
            size: DEFAULT_PLACE_SIZE,
        };
        return id === config.initial_marking ? { ...place, initial: true } : place;
    });

    const transitions: SmTransition[] = [];
    for (const [name, tc] of Object.entries(config.transitions)) {
        const sources = Array.isArray(tc.from) ? tc.from : [tc.from];
        for (const from of sources) {
            const t: SmTransition = {
                id: sources.length === 1 ? name : `${name}__${from}`,
                name,
                from,
                to: tc.to,
            };
            transitions.push(tc.guard !== undefined ? { ...t, guard: tc.guard } : t);
        }
    }

    const model: StateMachineModel = {
        workflowName,
        supports: [...config.supports],
        markingProperty: config.marking_store.property,
        places,
        transitions,
    };
    if (config.audit_trail?.enabled === true) {
        return { ...model, workflowExtras: { audit_trail: { enabled: true } } };
    }
    return model;
}

/** Read the first (typically only) workflow out of a `framework.workflows` envelope. */
export function frameworkConfigToStateMachineModel(
    config: FrameworkWorkflowsConfig,
): StateMachineModel | null {
    const entries = Object.entries(config.framework.workflows);
    const first = entries[0];
    if (first === undefined) return null;
    return stateMachineConfigToModel(first[0], first[1]);
}

// ─── Preview-grade YAML emitter ─────────────────────────────────────────
// Dependency-free, tuned for the constrained state_machine config shape.
// NOT the deploy path — the backend emits canonical YAML via Symfony Yaml.

const INDENT = '    ';

/**
 * Emit the `framework.workflows.{name}` block as YAML text for the
 * designer's live preview pane. Scalars that aren't safe bare YAML
 * identifiers are double-quoted with `\` + `"` escaped (so FQCNs like
 * `Acme\Shop\Order` and EL guards like `is_granted('ROLE_MANAGER')`
 * round-trip through a YAML parser). Transitions + inline maps use
 * flow style to stay compact + readable.
 */
export function stateMachineModelToYaml(model: StateMachineModel): string {
    const config = stateMachineModelToConfig(model);
    const i1 = INDENT;
    const i2 = INDENT.repeat(2);
    const i3 = INDENT.repeat(3);
    const i4 = INDENT.repeat(4);
    const lines: string[] = [];

    lines.push('framework:');
    lines.push(`${i1}workflows:`);
    lines.push(`${i2}${scalar(model.workflowName)}:`);
    lines.push(`${i3}type: state_machine`);
    lines.push(
        `${i3}marking_store: { type: method, property: ${scalar(config.marking_store.property)} }`,
    );
    lines.push(`${i3}supports: ${flowList(config.supports)}`);
    if (config.initial_marking !== undefined) {
        lines.push(`${i3}initial_marking: ${scalar(config.initial_marking)}`);
    }
    if (config.audit_trail?.enabled === true) {
        lines.push(`${i3}audit_trail: { enabled: true }`);
    }
    lines.push(`${i3}places: ${flowList(config.places)}`);
    lines.push(`${i3}transitions:`);
    for (const [name, tc] of Object.entries(config.transitions)) {
        lines.push(`${i4}${scalar(name)}: ${transitionFlow(tc)}`);
    }
    return lines.join('\n') + '\n';
}

function transitionFlow(tc: WorkflowTransitionConfig): string {
    const from = Array.isArray(tc.from) ? flowList(tc.from) : scalar(tc.from);
    const parts = [`from: ${from}`, `to: ${scalar(tc.to)}`];
    if (tc.guard !== undefined) {
        parts.push(`guard: ${scalar(tc.guard)}`);
    }
    return `{ ${parts.join(', ')} }`;
}

function flowList(items: ReadonlyArray<string>): string {
    return `[${items.map(scalar).join(', ')}]`;
}

/** Bare for safe identifiers; double-quoted (with `\` + `"` escaped) otherwise. */
function scalar(value: string): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        return value;
    }
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
