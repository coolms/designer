import { Emitter } from '../internal/Emitter.js';

/**
 * The kind of thing currently selected in the BPMN-Lite editor.
 *
 * **Why a tagged union, not a bare id**: elements + flows live in
 * separate `state` arrays + carry different property shapes. The
 * downstream property panel + the waypoint-drag controller need to
 * dispatch by kind before they can look the thing up. A bare id
 * would force every consumer to scan both arrays.
 */
export type BpmnLiteSelectionTarget =
    | { readonly kind: 'element'; readonly id: string }
    | { readonly kind: 'flow'; readonly id: string };

interface BpmnLiteSelectionEvents extends Record<string, unknown> {
    /**
     * Fired on every successful {@link BpmnLiteSelection.select}
     * call (including selects-to-null). Payload is the new target
     * (or null). Subscribers receive the value AFTER the internal
     * state has been updated -- so reading `selection.target`
     * inside a listener returns the same value as the payload.
     */
    change: BpmnLiteSelectionTarget | null;
}

/**
 * BPMN-Lite selection state -- the single source of truth
 * for "what's the user currently focused on" within a single
 * editor instance.
 *
 * **Why per-editor, not global**: matches the M3.2.e
 * {@link Selection} pattern -- each editor instance carries its
 * own selection so multi-editor pages (e.g. a side-by-side
 * compare view) don't fight over a global focus.
 *
 * **Reset semantics**: `select(null)` is the explicit clear path;
 * the panel responds by unmounting all field controls. The editor
 * also clears selection automatically on `load(model)` so a fresh
 * model doesn't keep stale references.
 *
 * **What this class does NOT do** (deferred):
 *  - **Multi-select** -- M3.3.f ships single-target only. Multi-
 *    select on Shift+click + the property-panel "common fields"
 *    merge land in a later ship.
 *  - **Selection history** -- no back/forward navigation through
 *    prior selections. The {@link CommandStack} is the source of
 *    truth for what-was-selected-at-this-undo-step (each command
 *    can capture + restore selection if it wants -- M3.3.f's
 *    commands don't, but they're free to in the future).
 */
export class BpmnLiteSelection {
    private current: BpmnLiteSelectionTarget | null = null;
    private readonly emitter = new Emitter<BpmnLiteSelectionEvents>();
    private disposed = false;

    /** The currently selected target, or `null` if nothing is selected. */
    get target(): BpmnLiteSelectionTarget | null {
        return this.current;
    }

    /** Convenience accessor -- the selected element id, or null when no element is selected. */
    get elementId(): string | null {
        return this.current?.kind === 'element' ? this.current.id : null;
    }

    /** Convenience accessor -- the selected flow id, or null when no flow is selected. */
    get flowId(): string | null {
        return this.current?.kind === 'flow' ? this.current.id : null;
    }

    /**
     * Update the selection. Fires `change` even when the new target
     * equals the prior target by deep value (because the EQUALITY
     * check via `===` would miss new {kind, id} object identities --
     * subscribers depending on the firing as a "your selection got
     * re-confirmed" pulse would otherwise miss the signal). For the
     * "select the same thing twice in a row" case, panel rebuild is
     * a cheap no-op so re-firing is harmless.
     *
     * Pass `null` to clear.
     */
    select(target: BpmnLiteSelectionTarget | null): void {
        if (this.disposed) return;
        this.current = target;
        this.emitter.emit('change', target);
    }

    /** Clear the selection. Shorthand for `select(null)`. */
    clear(): void {
        this.select(null);
    }

    /** Subscribe to selection-change events. Returns an unsubscribe thunk. */
    onChange(
        listener: (target: BpmnLiteSelectionTarget | null) => void,
    ): () => void {
        return this.emitter.on('change', listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.emitter.dispose();
    }
}
