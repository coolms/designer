import type { Command } from '../canvas/CommandStack.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnSequenceFlow } from './types.js';

/**
 * the SequenceFlow add command. Pushes a new flow onto
 * the model on `apply()`; pops it back off on `revert()`. Both ride
 * through the editor's mutator API ({@link BpmnLiteEditor.addFlow}
 * / {@link BpmnLiteEditor.removeFlow}) so the editor stays the
 * single source of mutation truth.
 *
 * **Symmetry with {@link AddElementCommand}**: same thin wrapper
 * pattern. The {@link ConnectMode} (the drag-from-source-to-target
 * canvas surface) constructs + dispatches one of these
 * per successful release; the Angular wrapper's undo/redo
 * buttons + Ctrl+Z / Ctrl+Y bindings reverse the connection.
 *
 * **Why the command holds the full flow + its id**: same reason as
 * {@link AddElementCommand} -- the user may add the flow, undo, then
 * add a different flow (different endpoint pair), and the original
 * revert must still know exactly which id to remove. Holding the
 * flow verbatim makes the inverse deterministic.
 *
 * **Label format**: `"Connect <sourceId> → <targetId>"` -- the
 * arrow + endpoint ids carry the semantic in a way the
 * {@link CommandStack.nextUndoLabel} getter can surface in tooltips
 * ("Undo: Connect startEvent_1 → task_1"). The property panel may
 * later swap to element labels when those are available
 * (e.g. "Connect Start → Approve"), but the id form is unambiguous
 * + readable for now.
 */
export class AddFlowCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly flow: BpmnSequenceFlow,
    ) {
        this.label = `Connect ${flow.source} → ${flow.target}`;
    }

    apply(): void {
        this.editor.addFlow(this.flow);
    }

    revert(): void {
        this.editor.removeFlow(this.flow.id);
    }

    /** Test affordance -- the flow this command will add / remove. */
    get target(): BpmnSequenceFlow {
        return this.flow;
    }
}
