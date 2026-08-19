import type { Command } from '../canvas/CommandStack.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnPosition } from './types.js';

/**
 * F-7.1 -- move an element to a new world-space position, with
 * apply/revert symmetry so undo/redo restore the prior position
 * exactly. Thin wrapper over {@link BpmnLiteEditor.updateElementPosition},
 * matching the command pattern + the
 * {@link UpdateFlowWaypointsCommand} shape.
 *
 * **Why the command holds both positions**: the controller captures
 * the pre-drag position at pointerdown + passes the post-drag position
 * at pointerup. Both ride into the command's constructor so revert()
 * doesn't need to ask the editor "what was the position before?" --
 * the editor's state already moved by the time apply() returns.
 *
 * **Label format**: "Move <Element name | id>" -- the controller can
 * cheaply resolve a human label via {@link BpmnLiteEditor.findElement}
 * before constructing the command. Falls back to the id if no
 * `label` is set on the element. The CommandStack's `nextUndoLabel`
 * getter surfaces this in tooltips ("Undo: Move Send OTP").
 */
export class MoveElementCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly elementId: string,
        private readonly fromPosition: BpmnPosition,
        private readonly toPosition: BpmnPosition,
        elementLabel?: string,
    ) {
        const tag = elementLabel !== undefined && elementLabel.length > 0
            ? elementLabel
            : elementId;
        this.label = `Move ${tag}`;
    }

    apply(): void {
        this.editor.updateElementPosition(this.elementId, this.toPosition);
    }

    revert(): void {
        this.editor.updateElementPosition(this.elementId, this.fromPosition);
    }

    /** Test affordance -- the element id this command targets. */
    get target(): string {
        return this.elementId;
    }

    /** Test affordance -- the pre-drag position the command will restore on revert. */
    get from(): BpmnPosition {
        return this.fromPosition;
    }

    /** Test affordance -- the post-drag position the command will install on apply. */
    get to(): BpmnPosition {
        return this.toPosition;
    }
}
