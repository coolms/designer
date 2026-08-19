import type { Command } from '../canvas/CommandStack.js';
import { paletteItemLabel } from './defaults.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnElement, BpmnSequenceFlow } from './types.js';

/**
 * polish-bundle (F-4) -- delete a BPMN-Lite element + every
 * flow incident to it (cascade) as a single undoable step. The
 * docblock on {@link BpmnLiteEditor.removeElement} called this out
 * as deferred: "DeleteElementCommand will handle the cascade +
 * emit a single coalesced change". This is that command.
 *
 * **Cascade semantics**: `apply()` captures every flow whose
 * `source === element.id || target === element.id`, removes those
 * flows first (so the model never carries dangling flow refs), then
 * removes the element. `revert()` restores the element first, then
 * re-adds the captured flows in their original order (so the
 * post-undo state matches the pre-delete state byte-for-byte).
 *
 * **Why capture flows at apply-time, not at construct-time**: the
 * model may mutate between command construction and dispatch (other
 * commands in the queue, a `load()` call, etc). Capturing at
 * `apply()` means the cascade reflects the model state at the
 * moment of execution, which is what the user sees + expects.
 *
 * **Selection side-effects**: the editor's selection model isn't
 * touched here. The caller (keyboard controller, context-menu, etc)
 * is responsible for clearing selection before / after delete. Why:
 * commands shouldn't depend on selection state for replayability.
 *
 * **Label format**: "Delete Task" / "Delete Start Event" — uses
 * the {@link PALETTE_LABELS} title case for symmetry with
 * {@link AddElementCommand}'s "Add Task" label.
 */
export class DeleteElementCommand implements Command {
    readonly label: string;

    /** Captured at apply() time; restored on revert(). */
    private removedFlows: BpmnSequenceFlow[] = [];

    /**
     * Boundary events attached to the deleted element, captured at
     * apply() time. A boundary cannot outlive its host -- an orphan
     * `attachedTo` fails deploy with `WF.BOUNDARY_UNKNOWN_HOST`.
     */
    private removedBoundaries: BpmnElement[] = [];

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly element: BpmnElement,
    ) {
        const kindLabel = paletteItemLabel(element.type, element.subtype, undefined, editor.t);
        this.label = editor.t('designer.command.deleteElement', 'Delete %kind%', {
            kind: kindLabel,
        });
    }

    apply(): void {
        // Cascade attached boundaries FIRST: each is itself an element
        // with its own incident flows, so collecting them up-front lets
        // the flow sweep below cover host + boundaries in one pass.
        this.removedBoundaries = [
            ...this.editor.attachedBoundaries(this.element.id),
        ];
        const doomed = new Set<string>([
            this.element.id,
            ...this.removedBoundaries.map((b) => b.id),
        ]);

        // Snapshot incident flows BEFORE the elements disappear so
        // the cascade is deterministic. ReadonlyArray + spread to
        // copy — the editor's repaint pass may invalidate the
        // referenced array between iterations.
        const incident = this.editor.state.flows.filter(
            (f) => doomed.has(f.source) || doomed.has(f.target),
        );
        this.removedFlows = [...incident];

        for (const flow of incident) {
            this.editor.removeFlow(flow.id);
        }
        for (const boundary of this.removedBoundaries) {
            this.editor.removeElement(boundary.id);
        }
        this.editor.removeElement(this.element.id);
    }

    revert(): void {
        // Restore the host first, then its boundaries, then the flows —
        // otherwise a boundary would momentarily reference a missing
        // host, and the flows a missing source/target.
        this.editor.addElement(this.element);
        for (const boundary of this.removedBoundaries) {
            this.editor.addElement(boundary);
        }
        for (const flow of this.removedFlows) {
            this.editor.addFlow(flow);
        }
        this.removedFlows = [];
        this.removedBoundaries = [];
    }

    /** Test affordance — the element this command will delete. */
    get target(): BpmnElement {
        return this.element;
    }

    /**
     * Test affordance — the flows captured + slated for cascade
     * deletion at the most recent `apply()` call. Empty before
     * `apply()` runs or after `revert()` restores them.
     */
    get capturedFlows(): ReadonlyArray<BpmnSequenceFlow> {
        return this.removedFlows;
    }
}
