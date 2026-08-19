/**
 * State Machine Designer model types.
 *
 * Mirrors the **Symfony Workflow `state_machine`** config shape
 * (`framework.workflows.<name>`), so the YAML serializer
 * (`stateMachineModelToYaml` / `…FromYaml`) is a near-identity
 * transform between this in-memory editor model and the
 * `framework.workflows.*` YAML the runtime compiles. Same tier
 * separation the BPMN editor uses: the editor's imperative
 * mutation API lives on the canvas `Graph`; this `StateMachineModel`
 * is the immutable serializable snapshot the editor exposes via
 * `state`.
 *
 * **Identity:** Symfony places are identified by their NAME (a plain
 * string); there is no separate place id. So a {@link SmPlace}'s `id`
 * IS its place name — what serializes into `places:` and what
 * transitions reference in `from`/`to`. A rename updates the
 * id + cascades to every incident transition.
 *
 * **Transitions are per-edge here, coalesced on save.** Symfony allows
 * `cancel: { from: [draft, submitted], to: cancelled }` — one named
 * transition with multiple `from` places. The editor models that as
 * TWO visual {@link SmTransition} edges sharing the same `name`; the
 * serializer groups edges by name into one `{ from: [...], to }`
 * block. Keeping one edge per arrow keeps the canvas model simple
 * (drag, route, select all operate on a single edge).
 *
 * The fields the renderers + paint loop need — places
 * (id/position/size/initial) + transitions
 * (id/name/from/to/guard) + the workflow-level metadata slots
 * (`workflowName`, `supports`, `markingProperty`) the property
 * panel + the serializer fill in. Lossless `*Extras` passthrough
 * mirrors the bpmn-lite pattern.
 */

/** Position in the canvas coordinate system — top-left of the bounding box. */
export interface SmPosition {
    readonly x: number;
    readonly y: number;
}

/** Bounding box in the canvas coordinate system. */
export interface SmSize {
    readonly width: number;
    readonly height: number;
}

/**
 * A state-machine **place** (a state). `id` is the Symfony place name
 * — serialized into `places:` verbatim and referenced by transitions.
 * `initial === true` marks the place Symfony emits as `initial_marking`
 * (a `state_machine` has exactly one; the panel enforces single-
 * initial, and the serializer falls back to the first place when
 * none is flagged).
 */
export interface SmPlace {
    readonly id: string;
    readonly position: SmPosition;
    readonly size: SmSize;
    readonly initial?: boolean;
    /** Lossless passthrough for `metadata:` on a place the editor doesn't yet surface. */
    readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * One transition edge: a named arrow from `from` → `to`. Multiple
 * edges may share `name` (multi-`from` transitions, coalesced by the
 * serializer). `guard` is an optional Symfony EL expression
 * (`subject.totalAmount > 0`, `is_granted('ROLE_MANAGER')`) the
 * panel surfaces as an expression field.
 */
export interface SmTransition {
    readonly id: string;
    readonly name: string;
    readonly from: string;
    readonly to: string;
    readonly guard?: string;
    /** Lossless passthrough for transition keys the editor doesn't yet surface. */
    readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * Top-level model the editor exposes via `state`. `workflowName` is the
 * `framework.workflows.<name>` config key; `supports` is the list of
 * entity FQCNs the workflow applies to; `markingProperty` is
 * `marking_store.property` (the entity property holding the current
 * place — default `status`).
 */
export interface StateMachineModel {
    readonly workflowName: string;
    readonly supports: ReadonlyArray<string>;
    readonly markingProperty: string;
    readonly places: ReadonlyArray<SmPlace>;
    readonly transitions: ReadonlyArray<SmTransition>;
    /**
     * Lossless passthrough for workflow-level keys the editor doesn't
     * yet author (`audit_trail`, `marking_store.type`, `metadata`).
     * `fromYaml` parks them; `toYaml` re-emits them verbatim.
     */
    readonly workflowExtras?: Readonly<Record<string, unknown>>;
}

/** Conventional place geometry — a rounded rectangle wide enough for a place name. */
export const DEFAULT_PLACE_SIZE: SmSize = { width: 132, height: 48 };

/** Default starter model — an empty `state_machine` with no places/transitions. */
export function emptyStateMachineModel(
    workflowName = 'workflow.unnamed',
): StateMachineModel {
    return {
        workflowName,
        supports: [],
        markingProperty: 'status',
        places: [],
        transitions: [],
    };
}
