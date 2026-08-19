import { Emitter } from '../internal/Emitter.js';

/**
 * What's currently selected in the State Machine editor — a place
 * (state) or a transition (arrow). `null` means "nothing selected",
 * which the property panel treats as the **workflow scope**
 * (it surfaces the machine-level fields: name / marking property /
 * supports / audit). Mirrors {@link BpmnLiteSelection}'s tagged-union
 * shape so the property-panel binding code is symmetric.
 */
export type SmSelectionTarget =
    | { readonly kind: 'place'; readonly id: string }
    | { readonly kind: 'transition'; readonly id: string };

interface SmSelectionEvents extends Record<string, unknown> {
    change: SmSelectionTarget | null;
}

/**
 * Per-editor selection state — the single source of truth for "what is
 * the user focused on" within one State Machine editor instance.
 * `select(null)` is the explicit clear path; the panel responds by
 * swapping to the workflow-scope fields. The editor clears selection on
 * `load(model)` so a fresh model keeps no stale references.
 */
export class SmSelection {
    private current: SmSelectionTarget | null = null;
    private readonly emitter = new Emitter<SmSelectionEvents>();
    private disposed = false;

    get target(): SmSelectionTarget | null {
        return this.current;
    }

    /** The selected place id, or null when a place isn't what's selected. */
    get placeId(): string | null {
        return this.current?.kind === 'place' ? this.current.id : null;
    }

    /** The selected transition id, or null when a transition isn't what's selected. */
    get transitionId(): string | null {
        return this.current?.kind === 'transition' ? this.current.id : null;
    }

    /**
     * Update the selection + fire `change`. Fires even when the new
     * target value-equals the prior one (object identity differs), so a
     * "re-confirm the same selection" pulse still reaches subscribers;
     * a panel rebuild on an unchanged selection is a cheap no-op.
     */
    select(target: SmSelectionTarget | null): void {
        if (this.disposed) return;
        this.current = target;
        this.emitter.emit('change', target);
    }

    /** Clear the selection — shorthand for `select(null)` (workflow scope). */
    clear(): void {
        this.select(null);
    }

    onChange(listener: (target: SmSelectionTarget | null) => void): () => void {
        return this.emitter.on('change', listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.emitter.dispose();
    }
}
