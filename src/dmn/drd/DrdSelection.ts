import { Emitter } from '../../internal/Emitter.js';

/**
 * What's currently selected in the DMN DRD editor — an element (a
 * Decision or InputData node) or a requirement (an arrow). `null` means
 * "nothing selected", which the future property panel treats as the
 * **diagram scope** (it surfaces the DRG-level fields: name / extras).
 * Mirrors {@link SmSelectionTarget}'s tagged-union shape so the
 * property-panel binding code stays symmetric across surfaces.
 */
export type DrdSelectionTarget =
    | { readonly kind: 'element'; readonly id: string }
    | { readonly kind: 'requirement'; readonly id: string };

interface DrdSelectionEvents extends Record<string, unknown> {
    change: DrdSelectionTarget | null;
}

/**
 * Per-editor selection state — the single source of truth for "what is
 * the user focused on" within one DRD editor instance. `select(null)`
 * is the explicit clear path; the editor clears selection on
 * `load(model)` so a fresh model keeps no stale references.
 */
export class DrdSelection {
    private current: DrdSelectionTarget | null = null;
    private readonly emitter = new Emitter<DrdSelectionEvents>();
    private disposed = false;

    get target(): DrdSelectionTarget | null {
        return this.current;
    }

    /** The selected element id, or null when an element isn't what's selected. */
    get elementId(): string | null {
        return this.current?.kind === 'element' ? this.current.id : null;
    }

    /** The selected requirement id, or null when a requirement isn't what's selected. */
    get requirementId(): string | null {
        return this.current?.kind === 'requirement' ? this.current.id : null;
    }

    /**
     * Update the selection + fire `change`. Fires even when the new
     * target value-equals the prior one (object identity differs), so a
     * "re-confirm the same selection" pulse still reaches subscribers.
     */
    select(target: DrdSelectionTarget | null): void {
        if (this.disposed) return;
        this.current = target;
        this.emitter.emit('change', target);
    }

    /** Clear the selection — shorthand for `select(null)` (diagram scope). */
    clear(): void {
        this.select(null);
    }

    onChange(listener: (target: DrdSelectionTarget | null) => void): () => void {
        return this.emitter.on('change', listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.emitter.dispose();
    }
}
