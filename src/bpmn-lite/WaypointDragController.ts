import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import { SVG_NS } from './renderers/svg.js';
import { waypointsToPathD } from './renderers/routing.js';
import type { BpmnPosition } from './types.js';
import { UpdateFlowWaypointsCommand } from './UpdateFlowWaypointsCommand.js';

/**
 * Options for constructing the M3.3.e {@link WaypointDragController}.
 */
export interface WaypointDragControllerOptions {
    readonly editor: BpmnLiteEditor;
    /**
     * The id of the flow whose waypoints should get drag handles.
     * Typically driven by the property panel's selection;
     * for M3.3.e the host constructs one controller per selected
     * flow + disposes it when the selection changes.
     */
    readonly flowId: string;
}

/**
 * Internal drag-state record. Lives only while the user is mid-drag
 * on a waypoint handle.
 */
interface DragState {
    /** Index of the waypoint being dragged in the working waypoints array. */
    readonly waypointIndex: number;
    /**
     * The full waypoints chain at the time the drag started. The
     * pointermove handler clones this + replaces entry
     * [waypointIndex] each frame to produce the transient chain
     * the path is painted with.
     */
    readonly startingWaypoints: ReadonlyArray<BpmnPosition>;
    /** The flow's `<path>` element -- mutated directly during drag. */
    readonly path: SVGPathElement;
    readonly onMove: (ev: PointerEvent) => void;
    readonly onUp: (ev: PointerEvent) => void;
    /** Latest working waypoints (read on pointerup to build the command). */
    workingWaypoints: BpmnPosition[];
}

/**
 * WaypointDragController -- paints small SVG circles at the
 * middle waypoints of a focused flow + drives waypoint drag to
 * reroute. Constructed per-focused-flow + disposed when the focus
 * changes.
 *
 * **Which waypoints get handles**: the *middle* waypoints --
 * everything between waypoints[0] (source-exit) and waypoints[N-1]
 * (target-entry). The endpoints are pinned to element bbox edges by
 * the router + dragging them would conceptually mean
 * "reattach to a different element," which is M3.3.f territory.
 *
 * For an auto-routed Z-route (4 waypoints), that's the 2 middle
 * points -- both editable, drag-promotes the route to manual.
 * For a manual chain with N waypoints, that's N-2 handles.
 *
 * **Drag flow** (single-arm):
 *  1. Constructor reads the flow's resolved waypoint chain via
 *     {@link BpmnLiteEditor.resolveFlowWaypoints}; paints handle
 *     circles at the middle waypoints + a transient hidden path
 *     overlay (the existing flow `<path>` is mutated in-place).
 *  2. Pointerdown on a handle captures the waypoint index + clones
 *     the full chain into a working array.
 *  3. Pointermove (document-level) translates cursor world coords +
 *     mutates the working array entry at the dragged index +
 *     repaints the flow's `<path>` `d` attribute + moves the handle
 *     circle. **NO** editor mutator calls during drag -- the editor's
 *     `change` event would fire 60 times a second + downstream
 *     subscribers (e.g. the Angular wrapper's auto-save) would
 *     storm. Only the final pointerup dispatches a command.
 *  4. Pointerup dispatches an {@link UpdateFlowWaypointsCommand}
 *     with the final waypoints chain. The command's apply() goes
 *     through the editor mutator which calls repaint() -- the
 *     handles are re-painted at the new positions because the
 *     controller listens to editor `change` events + refreshes its
 *     handles.
 *
 * **Drag cancellation**: if dispose() is called mid-drag, the
 * working waypoints are discarded + the flow's `<path>` is restored
 * via editor.repaint(). The user sees the route snap back to
 * pre-drag.
 *
 * **What this controller does NOT do** (deferred):
 *  - **Add a new waypoint via mid-segment drag** -- handles paint
 *    only at existing waypoint positions; M3.3.f polish adds
 *    midpoint "ghost handles" that, when dragged, splice a new
 *    waypoint into the chain.
 *  - **Reattach the source/target endpoints** -- M3.3.f territory.
 *  - **Snap-to-grid** -- raw cursor world coords. M3.2.b `Snap`
 *    utility wires up at M3.3.f when the property panel surfaces
 *    grid affordances.
 *  - **Constrain to orthogonal axes** -- middle handles drag freely
 *    even on auto-routed Z-routes; the user can produce a non-
 *    orthogonal route. M3.3.f polish may add Shift-to-axis-constrain.
 *
 * **Dispose contract**: removes handles + cancels in-flight drag +
 * unsubscribes from editor change events + restores the flow's
 * `<path>` to its non-transient state via editor.repaint() if a
 * drag was active. Idempotent.
 */
export class WaypointDragController {
    private readonly editor: BpmnLiteEditor;
    private readonly flowId: string;
    private readonly offChange: () => void;
    private handles: SVGCircleElement[] = [];
    private dragState: DragState | null = null;
    private disposed = false;

    constructor(options: WaypointDragControllerOptions) {
        this.editor = options.editor;
        this.flowId = options.flowId;
        this.paintHandles();
        // When state changes (e.g. another command runs), repaint
        // handles so they track the new waypoint positions.
        this.offChange = this.editor.onChange(() => {
            if (this.disposed) return;
            if (this.dragState !== null) return; // mid-drag; ignore
            this.refreshHandles();
        });
    }

    /** Internal-package test affordance -- the painted handle circles. */
    get handleElements(): ReadonlyArray<SVGCircleElement> {
        return this.handles;
    }

    /** Internal-package test affordance -- true while a handle drag is in flight. */
    get dragging(): boolean {
        return this.dragState !== null;
    }

    /** Internal-package test affordance -- the waypoint index currently being dragged, if any. */
    get draggingIndex(): number | null {
        return this.dragState?.waypointIndex ?? null;
    }

    /**
     * Tear down handles + cancel in-flight drag + unsubscribe.
     * Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelDrag();
        this.removeHandles();
        this.offChange();
    }

    private removeHandles(): void {
        for (const handle of this.handles) {
            handle.remove();
        }
        this.handles = [];
    }

    private refreshHandles(): void {
        this.removeHandles();
        this.paintHandles();
    }

    private paintHandles(): void {
        const waypoints = this.editor.resolveFlowWaypoints(this.flowId);
        if (waypoints === null) return;
        if (waypoints.length < 3) return; // no middle waypoints
        const flowG = this.findFlowGroup();
        if (flowG === null) return;
        const doc = flowG.ownerDocument;

        // Paint handles at indices 1..N-2 (middle waypoints).
        for (let i = 1; i < waypoints.length - 1; i++) {
            const point = waypoints[i]!;
            const handle = doc.createElementNS(
                SVG_NS,
                'circle',
            ) as SVGCircleElement;
            handle.classList.add('coolms-designer__bpmn-waypoint-handle');
            handle.setAttribute('cx', `${point.x}`);
            handle.setAttribute('cy', `${point.y}`);
            handle.setAttribute('r', '5');
            handle.setAttribute('data-waypoint-index', `${i}`);
            const index = i;
            handle.addEventListener('pointerdown', (ev) =>
                this.onHandlePointerDown(ev, index),
            );
            flowG.appendChild(handle);
            this.handles.push(handle);
        }
    }

    private onHandlePointerDown(ev: PointerEvent, index: number): void {
        if (this.disposed) return;
        if (this.dragState !== null) return;
        if (ev.button !== 0) return;
        // Stop propagation so ConnectMode's canvas-level pointerdown
        // listener (if active) doesn't try to start a connection.
        ev.stopPropagation();
        ev.preventDefault();

        const startingWaypoints = this.editor.resolveFlowWaypoints(this.flowId);
        if (startingWaypoints === null) return;
        const flowG = this.findFlowGroup();
        if (flowG === null) return;
        const path = flowG.querySelector<SVGPathElement>(
            '.coolms-designer__bpmn-flow-path',
        );
        if (path === null) return;

        const onMove = (e: PointerEvent): void => this.onPointerMove(e);
        const onUp = (e: PointerEvent): void => this.onPointerUp(e);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);

        this.dragState = {
            waypointIndex: index,
            startingWaypoints,
            workingWaypoints: [...startingWaypoints],
            path,
            onMove,
            onUp,
        };
    }

    private onPointerMove(ev: PointerEvent): void {
        if (this.dragState === null) return;
        const world = this.editor.clientToWorld(ev.clientX, ev.clientY);
        if (world === null) return;
        const next = [...this.dragState.workingWaypoints];
        next[this.dragState.waypointIndex] = { x: world.x, y: world.y };
        this.dragState.workingWaypoints = next;
        // Repaint the path's `d` directly -- no state mutation, no
        // change event, no subscriber storm.
        this.dragState.path.setAttribute('d', waypointsToPathD(next));
        // Move the dragged handle to match.
        const handle = this.handles[this.dragState.waypointIndex - 1];
        if (handle !== undefined) {
            handle.setAttribute('cx', `${world.x}`);
            handle.setAttribute('cy', `${world.y}`);
        }
    }

    private onPointerUp(_ev: PointerEvent): void {
        const drag = this.dragState;
        if (drag === null) return;
        const finalWaypoints = drag.workingWaypoints;
        this.cancelDrag();
        // Dispatch the command through the shared command stack so
        // undo/redo work. The command's apply() runs the editor
        // mutator + emits `change`; this controller's onChange
        // subscriber will then re-paint handles at the new positions
        // (the refreshHandles path is skipped while dragging, so
        // re-entrancy isn't a concern -- the drag is already done).
        this.editor.commandStack.execute(
            new UpdateFlowWaypointsCommand(
                this.editor,
                this.flowId,
                finalWaypoints,
            ),
        );
    }

    /** Tear down the drag's listeners. Used by both pointerup + dispose. */
    private cancelDrag(): void {
        if (this.dragState === null) return;
        document.removeEventListener('pointermove', this.dragState.onMove);
        document.removeEventListener('pointerup', this.dragState.onUp);
        this.dragState = null;
    }

    /**
     * Locate the painted `<g>` for this controller's flow inside the
     * editor's flows group. Returns null if the flow has been
     * removed from the model or the flows group hasn't been painted
     * yet (corner case during dispose sequencing). Iterates children
     * manually + matches on the `data-flow-id` attribute -- avoids a
     * `CSS.escape` dependency that jsdom doesn't always polyfill.
     */
    private findFlowGroup(): SVGGElement | null {
        const flowsRoot = this.editor.paintedFlowsElement;
        if (flowsRoot === null) return null;
        for (const child of Array.from(flowsRoot.children)) {
            if (child.getAttribute('data-flow-id') === this.flowId) {
                return child as SVGGElement;
            }
        }
        return null;
    }
}
