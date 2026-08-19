import type { Command } from '../canvas/CommandStack.js';
import { paletteItemLabel } from './defaults.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnElement } from './types.js';

/**
 * the first BPMN-Lite editor command. Pushes a new
 * element onto the model on `apply()`; pops it back off on
 * `revert()`. Both ride through the editor's mutator API
 * (`addElement` / `removeElement`) so the editor stays the single
 * source of mutation truth -- commands don't reach into `state_`
 * directly.
 *
 * **Symmetry with the table commands**: the DMN table
 * editor's 14 commands followed the same pattern -- thin Command
 * wrappers over editor-side mutators that emit `change`. M3.3.d
 * picks up the convention.
 *
 * **Why the command holds the full element + its id**: the user
 * may add the element, undo, then add a different element -- the
 * id minted by {@link BpmnLiteEditor.nextElementId} the first time
 * around isn't necessarily the same id the editor would mint after
 * undo. Holding the element verbatim makes the command's revert
 * deterministic: it knows exactly which id to remove.
 *
 * **Label format**: "Add Task" / "Add Start Event" -- uses the
 * {@link paletteItemLabel} title case for symmetry with the palette
 * UI. The CommandStack's `nextUndoLabel` getter surfaces
 * this in tooltips ("Undo: Add Task").
 */
export class AddElementCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly element: BpmnElement,
    ) {
        const kindLabel = paletteItemLabel(
            element.type,
            element.subtype,
            element.variant,
        );
        this.label = `Add ${kindLabel}`;
    }

    apply(): void {
        this.editor.addElement(this.element);
    }

    revert(): void {
        this.editor.removeElement(this.element.id);
    }

    /** Test affordance -- the element this command will add / removed. */
    get target(): BpmnElement {
        return this.element;
    }
}
