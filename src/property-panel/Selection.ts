import { Emitter } from '../internal/Emitter.js';

interface SelectionEvents extends Record<string, unknown> {
    /** Fired when the selected element id changes. Payload is the new id (or null when cleared). */
    change: string | null;
}

/**
 * Tracks which element is currently selected. Single-selection at
 * multi-selection lands when a surface needs it (BPMN marquee
 * select, probably).
 *
 * Subscribers:
 *  - {@link PropertyPanel} reacts to selection changes by re-binding
 *    its field instances to the new element's properties.
 *  - Surface renderers subscribe to highlight the selected
 *    element in the canvas + adjust palette behaviour (e.g.
 *    "selected user task → show user-task-specific palette").
 *
 * Selection holds element IDs as strings, not Element references --
 * IDs survive across graph mutations (an element with a stable id
 * may be replaced by a new object on every updateElement). Consumers
 * resolve to the current Element via `graph.getElement(selection.id)`.
 *
 * Living in property-panel/ for now because the property panel is
 * its first consumer; future canvas-side selection rendering may
 * justify promoting it to a top-level `selection/` module.
 */
export class Selection {
    private readonly emitter = new Emitter<SelectionEvents>();
    private selected: string | null = null;
    private disposed = false;

    /** Currently-selected element id, or `null` when cleared. */
    get id(): string | null {
        return this.selected;
    }

    /** Returns `true` when the given id is currently selected. */
    isSelected(id: string): boolean {
        return this.selected === id;
    }

    /**
     * Set the selection. `null` clears. No-op if the value is unchanged
     * (prevents redundant events when the same id is selected twice).
     */
    select(id: string | null): void {
        if (this.disposed) return;
        if (id === this.selected) return;
        this.selected = id;
        this.emitter.emit('change', id);
    }

    /** Clear selection. Sugar for `select(null)`. */
    clear(): void {
        this.select(null);
    }

    /** Subscribe to selection changes. Returns unsubscribe thunk. */
    onChange(listener: (id: string | null) => void): () => void {
        return this.emitter.on('change', listener);
    }

    /** Listener count -- test affordance. */
    get listenerCount(): number {
        return this.emitter.listenerCount('change');
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.selected = null;
        this.emitter.dispose();
    }
}
