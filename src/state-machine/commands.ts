import type { Command } from '../canvas/CommandStack.js';
import type { StateMachineEditor } from './StateMachineEditor.js';
import type { SmPlace, SmTransition } from './types.js';

/**
 * State Machine editing commands. Each is a reversible mutation
 * the property panel dispatches through the editor's {@link CommandStack}
 * so every edit is a single undo step. They call the editor's mutator
 * seam (the editor owns the immutable-model swap + repaint + `change`
 * emit); the commands only capture the inverse state they need.
 */

/**
 * Editable transition property keys the panel surfaces. Constrained so a
 * stray key can't write junk onto a transition. `id` is deliberately
 * absent — transition ids are stable canvas identity, not user-editable.
 */
export type EditableTransitionPropertyKey = 'name' | 'from' | 'to' | 'guard';

/**
 * Editable workflow-scope keys. `supports` + `auditTrail` are display-shaped
 * (a newline-joined FQCN string / a boolean); the editor mutator translates
 * them to the model's `string[]` / `workflowExtras.audit_trail` on write.
 */
export type EditableWorkflowPropertyKey =
    | 'workflowName'
    | 'markingProperty'
    | 'supports'
    | 'auditTrail';

/**
 * Rename a place — which IS its Symfony place name — and cascade the new
 * id to every incident transition's `from`/`to`. Reversible by renaming
 * back. The editor's `renamePlace` is symmetric, so apply/revert are the
 * same call with the ids swapped.
 */
export class RenamePlaceCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: StateMachineEditor,
        private readonly fromId: string,
        private readonly toId: string,
    ) {
        this.label = `Rename place ${fromId} → ${toId}`;
    }

    apply(): void {
        this.editor.renamePlace(this.fromId, this.toId);
    }

    revert(): void {
        this.editor.renamePlace(this.toId, this.fromId);
    }
}

/**
 * Set (or clear) the initial place. A `state_machine` has exactly one
 * initial place, so applying this clears `initial` on every other place;
 * the command snapshots the FULL set of previously-initial place ids so
 * revert restores it exactly (handles the prior-initial place too).
 */
export class SetInitialPlaceCommand implements Command {
    readonly label: string;
    private readonly before: string[];
    private readonly after: string[];

    constructor(
        editor: StateMachineEditor,
        placeId: string,
        makeInitial: boolean,
    ) {
        this.editor = editor;
        this.before = editor.currentInitialPlaceIds();
        this.after = makeInitial
            ? [placeId]
            : this.before.filter((id) => id !== placeId);
        this.label = makeInitial
            ? `Make ${placeId} the initial state`
            : `Clear initial state on ${placeId}`;
    }

    private readonly editor: StateMachineEditor;

    apply(): void {
        this.editor.applyInitialPlaces(this.after);
    }

    revert(): void {
        this.editor.applyInitialPlaces(this.before);
    }
}

/**
 * Update one editable property on a transition (name / from / to / guard).
 * Captures the previous value at construction so revert round-trips
 * exactly — including `guard` going back to `undefined` (the editor drops
 * a blank guard).
 */
export class UpdateTransitionPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: StateMachineEditor,
        private readonly transitionId: string,
        private readonly propertyKey: EditableTransitionPropertyKey,
        private readonly nextValue: unknown,
    ) {
        const transition = editor.findTransition(transitionId);
        this.previousValue = transition !== null ? transition[propertyKey] : undefined;
        this.label = `Edit transition ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateTransitionProperty(
            this.transitionId,
            this.propertyKey,
            this.nextValue,
        );
    }

    revert(): void {
        this.editor.updateTransitionProperty(
            this.transitionId,
            this.propertyKey,
            this.previousValue,
        );
    }

    /** Test affordance — the transition id this command targets. */
    get targetId(): string {
        return this.transitionId;
    }
}

/**
 * Update one workflow-scope property (name / marking property / supports
 * / audit). Captures the previous DISPLAY value (the same shape the field
 * reads) so apply + revert both flow through the editor's translating
 * mutator symmetrically.
 */
export class UpdateWorkflowPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: StateMachineEditor,
        private readonly propertyKey: EditableWorkflowPropertyKey,
        private readonly nextValue: unknown,
    ) {
        this.previousValue = editor.readWorkflowDisplayValue(propertyKey);
        this.label = `Edit workflow ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateWorkflowProperty(this.propertyKey, this.nextValue);
    }

    revert(): void {
        this.editor.updateWorkflowProperty(this.propertyKey, this.previousValue);
    }
}

/**
 * Add a place (state).
 *
 * **Why this did not exist before:** the editor shipped rename /
 * set-initial / property-edit / remove but NO create path at all, so a
 * state machine could be pruned and re-pointed but never BUILT — the
 * blank canvas even said "Add a place to start modelling your state
 * machine" with no affordance to do it. Authoring was VFS-JSON-only.
 *
 * Snapshots before/after and goes through `replaceElements`, matching
 * {@link RemovePlaceCommand} — structural edits on this editor are
 * whole-array swaps, which keeps undo a single verbatim restore.
 */
export class AddPlaceCommand implements Command {
    readonly label: string;
    private readonly beforePlaces: ReadonlyArray<SmPlace>;
    private readonly afterPlaces: ReadonlyArray<SmPlace>;
    private readonly transitions: ReadonlyArray<SmTransition>;

    constructor(
        private readonly editor: StateMachineEditor,
        place: SmPlace,
    ) {
        const state = editor.state;
        this.beforePlaces = state.places;
        this.transitions = state.transitions;
        /**
         * The FIRST place becomes the initial one. A `state_machine`
         * must declare exactly one initial place — `validate()` rejects
         * a machine without it — so defaulting here means an author who
         * just clicks "+ State" twice still has a deployable model
         * instead of a validation error they have to decode.
         */
        const isFirst = state.places.length === 0;
        this.afterPlaces = [
            ...state.places,
            isFirst ? { ...place, initial: true } : place,
        ];
        this.label = `Add state ${place.id}`;
    }

    apply(): void {
        this.editor.replaceElements(this.afterPlaces, this.transitions);
    }

    revert(): void {
        this.editor.replaceElements(this.beforePlaces, this.transitions);
    }
}

/**
 * Add a transition edge between two existing places.
 *
 * Counterpart to {@link RemoveTransitionCommand}; places are untouched.
 */
export class AddTransitionCommand implements Command {
    readonly label: string;
    private readonly places: ReadonlyArray<SmPlace>;
    private readonly beforeTransitions: ReadonlyArray<SmTransition>;
    private readonly afterTransitions: ReadonlyArray<SmTransition>;

    constructor(
        private readonly editor: StateMachineEditor,
        transition: SmTransition,
    ) {
        const state = editor.state;
        this.places = state.places;
        this.beforeTransitions = state.transitions;
        this.afterTransitions = [...state.transitions, transition];
        this.label = `Add transition ${transition.name}`;
    }

    apply(): void {
        this.editor.replaceElements(this.places, this.afterTransitions);
    }

    revert(): void {
        this.editor.replaceElements(this.places, this.beforeTransitions);
    }
}

/**
 * delete — remove a place and CASCADE-remove every incident transition
 * (a `state_machine` transition must reference live places on both ends).
 * Snapshots the full places + transitions arrays at construction so revert
 * restores them verbatim (positions, ids, order, the prior incident edges).
 */
export class RemovePlaceCommand implements Command {
    readonly label: string;
    private readonly beforePlaces: ReadonlyArray<SmPlace>;
    private readonly beforeTransitions: ReadonlyArray<SmTransition>;
    private readonly afterPlaces: ReadonlyArray<SmPlace>;
    private readonly afterTransitions: ReadonlyArray<SmTransition>;

    constructor(
        private readonly editor: StateMachineEditor,
        placeId: string,
    ) {
        const state = editor.state;
        this.beforePlaces = state.places;
        this.beforeTransitions = state.transitions;
        this.afterPlaces = state.places.filter((p) => p.id !== placeId);
        this.afterTransitions = state.transitions.filter(
            (t) => t.from !== placeId && t.to !== placeId,
        );
        this.label = `Remove state ${placeId}`;
    }

    apply(): void {
        this.editor.replaceElements(this.afterPlaces, this.afterTransitions);
    }

    revert(): void {
        this.editor.replaceElements(this.beforePlaces, this.beforeTransitions);
    }
}

/**
 * delete — remove a single transition (places untouched). Snapshots the
 * transitions array before/after so revert re-adds the edge verbatim.
 */
export class RemoveTransitionCommand implements Command {
    readonly label: string;
    private readonly places: ReadonlyArray<SmPlace>;
    private readonly beforeTransitions: ReadonlyArray<SmTransition>;
    private readonly afterTransitions: ReadonlyArray<SmTransition>;

    constructor(
        private readonly editor: StateMachineEditor,
        transitionId: string,
    ) {
        const state = editor.state;
        this.places = state.places;
        this.beforeTransitions = state.transitions;
        this.afterTransitions = state.transitions.filter((t) => t.id !== transitionId);
        this.label = `Remove transition ${transitionId}`;
    }

    apply(): void {
        this.editor.replaceElements(this.places, this.afterTransitions);
    }

    revert(): void {
        this.editor.replaceElements(this.places, this.beforeTransitions);
    }
}
