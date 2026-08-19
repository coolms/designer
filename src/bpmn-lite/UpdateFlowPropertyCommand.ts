import type { Command } from '../canvas/CommandStack.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnSequenceFlow } from './types.js';

/**
 * The set of flow properties the property panel surfaces
 * for editing. Locked at compile time to keep `id` / `source` /
 * `target` / `waypoints` off-limits to the panel:
 *  - `id` mutations break command + cross-reference identity.
 *  - `source` / `target` mutations are reattach operations.
 *  - `waypoints` mutations belong to {@link UpdateFlowWaypointsCommand}
 *    which captures + restores the full chain.
 *
 * Extend this union when new editable flow properties land
 * (e.g. `documentationUrl`, `priority`).
 */
export type EditableFlowPropertyKey = 'condition' | 'isDefault';

/**
 * the SequenceFlow property update command. Parallel to
 * {@link UpdateElementPropertyCommand}. Replaces a single editable
 * property on a flow + ports the previous value so `revert()`
 * round-trips exactly.
 *
 * **Why separate from {@link UpdateFlowWaypointsCommand}**:
 * waypoints are an ordered geometry chain, not a scalar property;
 * the waypoint command captures + restores the full chain + handles
 * the auto-route ⇄ manual-route promotion. The property command
 * handles scalar conditions / boolean flags / future strings.
 *
 * **Label format**: `Edit flow <propertyKey>` -- there's no element-
 * kind dispatch (sequence flows are all the same kind today;
 * messageFlow / association may arrive later).
 */
export class UpdateFlowPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly flowId: string,
        private readonly propertyKey: EditableFlowPropertyKey,
        private readonly nextValue: unknown,
    ) {
        const flow = editor.findFlow(flowId);
        this.previousValue = flow !== null
            ? this.readProperty(flow, propertyKey)
            : undefined;
        this.label = `Edit flow ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateFlowProperty(
            this.flowId,
            this.propertyKey,
            this.nextValue,
        );
    }

    revert(): void {
        this.editor.updateFlowProperty(
            this.flowId,
            this.propertyKey,
            this.previousValue,
        );
    }

    /** Test affordance -- the flow id this command targets. */
    get targetId(): string {
        return this.flowId;
    }

    private readProperty(
        flow: BpmnSequenceFlow,
        key: EditableFlowPropertyKey,
    ): unknown {
        return flow[key];
    }
}
