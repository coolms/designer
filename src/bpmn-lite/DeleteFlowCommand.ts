import type { Command } from '../canvas/CommandStack.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnSequenceFlow } from './types.js';

/**
 * polish-bundle (F-4) -- delete a single BPMN-Lite flow as
 * an undoable step. Mirrors {@link DeleteElementCommand} but for
 * the simpler case: a flow has no incident-sub-edges to cascade,
 * so apply/revert is just remove/add.
 *
 * **Why a dedicated command vs. reusing {@link AddFlowCommand}'s
 * inverse**: AddFlowCommand's `revert()` removes; semantically the
 * deletion path needs its own forward command so the CommandStack
 * surfaces "Delete Flow" in undo tooltips instead of the confusing
 * "Undo Add Flow". User intent should match command intent.
 *
 * **Label format**: simply "Delete Flow" — flows don't carry a
 * human-readable kind label (they're all sequence flows in
 * BPMN-Lite). A future ship that adds named flow kinds
 * (message flow, association) can extend this with a label arg.
 */
export class DeleteFlowCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly flow: BpmnSequenceFlow,
    ) {
        this.label = editor.t('designer.command.deleteFlow', 'Delete Flow');
    }

    apply(): void {
        this.editor.removeFlow(this.flow.id);
    }

    revert(): void {
        this.editor.addFlow(this.flow);
    }

    /** Test affordance — the flow this command will delete. */
    get target(): BpmnSequenceFlow {
        return this.flow;
    }
}
