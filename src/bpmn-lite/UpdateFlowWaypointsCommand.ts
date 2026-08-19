import type { Command } from '../canvas/CommandStack.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnPosition } from './types.js';

/**
 * the SequenceFlow waypoint update command. Replaces the
 * flow's `waypoints` slot on `apply()` with the supplied chain;
 * restores the prior chain on `revert()`. The "prior chain" is
 * captured at construction time, which is the natural moment in the
 * {@link WaypointDragController} pointerup handler: the controller
 * has just observed where the user released, the model still
 * carries whatever was there before the drag started, and the
 * command captures both in one stroke.
 *
 * **What the previous chain holds**:
 *  - `undefined` -- the flow was auto-routed before the drag (no
 *    `waypoints` slot in the model). Revert removes the manual
 *    chain + auto-routing kicks back in on next paint.
 *  - `ReadonlyArray<BpmnPosition>` -- the flow already carried
 *    manual waypoints. Revert restores that earlier manual chain
 *    verbatim.
 *
 * **Why capture at construction, not in `apply()`**: the command is
 * built immediately at pointerup with the editor state still
 * carrying the pre-drag waypoints (the controller paints transient
 * routes by direct DOM mutation, NOT through editor mutators -- see
 * the controller's docblock for the rationale). `apply()` then
 * stamps the new chain through the editor mutator + emits change.
 * Capturing at construction works for the linear undo/redo case +
 * for chained reroutes (each subsequent command captures the
 * result of the previous one's apply).
 *
 * **Label format**: `"Reroute Flow"` -- the
 * {@link CommandStack.nextUndoLabel} surfaces it in tooltips
 * ("Undo: Reroute Flow"). The flow's id isn't included in the
 * label because the user just dragged a waypoint they could see
 * with their cursor; the label form is for keyboard / toolbar
 * affordances where the spatial context isn't available.
 */
export class UpdateFlowWaypointsCommand implements Command {
    readonly label = 'Reroute Flow';
    private readonly nextWaypoints: ReadonlyArray<BpmnPosition>;
    private readonly previousWaypoints: ReadonlyArray<BpmnPosition> | undefined;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly flowId: string,
        nextWaypoints: ReadonlyArray<BpmnPosition>,
    ) {
        // Defensive clone so later edits to the caller's array don't
        // mutate the command's captured state.
        this.nextWaypoints = [...nextWaypoints];
        const flow = editor.findFlow(flowId);
        // Capture the previous waypoints verbatim (or undefined if
        // the flow was auto-routed). Treat a missing flow as
        // previous=undefined; apply() will silently no-op via the
        // editor mutator's return-false-on-missing contract.
        this.previousWaypoints = flow?.waypoints !== undefined
            ? [...flow.waypoints]
            : undefined;
    }

    apply(): void {
        this.editor.updateFlowWaypoints(this.flowId, this.nextWaypoints);
    }

    revert(): void {
        this.editor.updateFlowWaypoints(this.flowId, this.previousWaypoints);
    }

    /** Test affordance -- the flow id this command targets. */
    get target(): string {
        return this.flowId;
    }
}
