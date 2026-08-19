import { AddFlowCommand } from './AddFlowCommand.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import { SVG_NS } from './renderers/svg.js';
import type { BpmnSequenceFlow } from './types.js';

/**
 * Options for constructing a {@link ConnectMode}.
 */
export interface ConnectModeOptions {
    /**
     * The BpmnLiteEditor instance to attach to. Connect mode reads
     * `editor.canvasGroup.ownerSVGElement` to attach the canvas-wide
     * pointerdown listener + `editor.paintedFlowsElement` to mount
     * the rubber-band line into.
     */
    readonly editor: BpmnLiteEditor;
}

/**
 * Internal drag-state record. Lives only while the user is mid-drag
 * from a source element toward a target element.
 */
interface DragState {
    readonly sourceId: string;
    readonly rubberband: SVGLineElement;
    readonly onMove: (ev: PointerEvent) => void;
    readonly onUp: (ev: PointerEvent) => void;
}

/**
 * ConnectMode -- modal surface for creating SequenceFlow edges.
 *
 * **Two gestures, both supported:**
 *  - **Drag** from source to target (press A, release over B).
 *  - **Click-then-click**: click A (arms it), then click B. This is the
 *    gesture the host's action-footer hint advertises while the mode is
 *    active ("Click a source element, then a target to connect.") and
 *    the one the sibling DMN DRD editor uses. It was NOT implemented
 *    originally -- a click landed on the "release on source = self-loop,
 *    silently cancel" path, so an author following the on-screen
 *    instruction could never connect anything. Clicking the armed
 *    element again disarms it.
 *
 * When active:
 *  - Adds the `coolms-designer__bpmn-connect-mode` class to the
 *    canvas SVG so CSS can flip the cursor + dim non-element regions
 *    while the mode is engaged.
 *  - Listens for `pointerdown` on the canvas SVG. The handler walks
 *    up the event target chain via `closest('[data-element-id]')`
 *    to find the source element. If the down didn't land on an
 *    element, the click is ignored (the mode stays active; the user
 *    can try again).
 *  - On valid source click: paints a dashed `<line>` rubber-band in
 *    the flows group from the source's world-space center to the
 *    cursor's world coords. Registers document-level pointermove +
 *    pointerup listeners so the band tracks the cursor even when it
 *    leaves the canvas.
 *  - On `pointerup`: tears down the rubber-band. If the release
 *    landed on a different element, dispatches an
 *    {@link AddFlowCommand} through the editor's command stack with
 *    a fresh flow id from {@link BpmnLiteEditor.nextFlowId}. A release
 *    on empty canvas cancels; a release on the SOURCE is treated as a
 *    click and arms that element (see above). The mode stays active
 *    either way (a chain-mode UX: the user can keep connecting until
 *    they explicitly exit).
 *
 * **Why modal + sticky over hover-handle**: an explicit modal flow
 * (toolbar button or keyboard shortcut "C") is discoverable + works
 * with keyboard-only authors. The hover-handle pattern (Camunda
 * Modeler's "click an element, blue arrow appears, drag from arrow")
 * is more polished but requires per-element bbox tracking + hover
 * state propagation, which is property-panel territory. The modal
 * mode is the floor; a host toolbar surfaces an "enter connect mode"
 * button and an "Esc" key handler.
 *
 * **Why self-loops are silently disallowed**: a source==target flow
 * would auto-route through {@link computeOrthogonalRoute} where the
 * source-exit + target-entry coincide (both edges of the same
 * element), producing a zero-length path. The engine validator DOES
 * permit self-loops on activities (look-back patterns), so this is
 * an editor-UX choice, not a model constraint -- the property panel
 * may grow a "self-loop" affordance that lays a deliberate curved
 * route around the host. Until then, release-on-source is treated as
 * a cancel signal.
 *
 * **What ConnectMode does NOT do** (deferred):
 *  - **Target highlight** -- hovering over an element mid-drag
 *    doesn't pulse / outline it.
 *  - **Snap-to-element-center for the rubber-band** -- the band
 *    follows the cursor verbatim. Snap is a future affordance.
 *  - **Esc-to-cancel** -- handled at the wrapper level (the
 *    keyboard shortcut calls `connectMode.exit()`).
 *  - **Connection validation** -- connect mode creates whatever the
 *    user drags. The engine validator catches structural issues on
 *    deploy.
 *  - **Reattach existing flow endpoints**.
 *
 * **Dispose contract**: detaches all listeners + removes any
 * in-flight rubber-band + the CSS mode class on the SVG. Safe to
 * call multiple times. Calling `exit()` while not active is a no-op.
 */
export class ConnectMode {
    private readonly editor: BpmnLiteEditor;
    private active_ = false;
    private hostSvg: SVGSVGElement | null = null;
    private onDown: ((ev: PointerEvent) => void) | null = null;
    private dragState: DragState | null = null;
    /**
     * Source element armed by a CLICK (press + release on the same
     * element), waiting for a second click to pick the target.
     *
     * **Why this exists**: the mode shipped as drag-only, but the
     * action-footer hint the host renders while it is active reads
     * "Click a source element, then a target to connect." -- and the
     * sibling DMN DRD editor really is click-then-click. An author
     * following that instruction pressed and released on one element,
     * which the drag path reads as a self-loop and silently cancels, so
     * NOTHING ever connected. Both gestures are now supported: drag
     * A→B, or click A then click B.
     */
    private pendingSourceId: string | null = null;
    private disposed = false;

    constructor(options: ConnectModeOptions) {
        this.editor = options.editor;
    }

    /**
     * Internal-package test affordance -- the element armed by a first
     * click, waiting for the target click.
     */
    get pendingFromId(): string | null {
        return this.pendingSourceId;
    }

    /** True while the mode is active (between {@link enter} + {@link exit}). */
    get active(): boolean {
        return this.active_;
    }

    /** Internal-package test affordance -- the in-flight rubber-band line, if any. */
    get rubberbandElement(): SVGLineElement | null {
        return this.dragState?.rubberband ?? null;
    }

    /** Internal-package test affordance -- the source element id of the in-flight drag, if any. */
    get connectingFromId(): string | null {
        return this.dragState?.sourceId ?? null;
    }

    /**
     * Engage the mode: attach the canvas-wide pointerdown listener +
     * add the CSS mode class. No-op if already active or if the
     * editor's canvas SVG is missing (a corner case during dispose
     * sequencing).
     */
    enter(): void {
        if (this.disposed) return;
        if (this.active_) return;
        const svg = this.editor.canvasGroup.ownerSVGElement;
        if (svg === null) return;
        this.hostSvg = svg;
        this.active_ = true;
        this.onDown = (ev: PointerEvent): void => this.handlePointerDown(ev);
        svg.addEventListener('pointerdown', this.onDown);
        svg.classList.add('coolms-designer__bpmn-connect-mode');
    }

    /**
     * Disengage the mode: detach pointerdown + remove CSS class +
     * cancel any in-flight drag. Idempotent.
     */
    exit(): void {
        if (!this.active_) return;
        this.active_ = false;
        if (this.hostSvg !== null && this.onDown !== null) {
            this.hostSvg.removeEventListener('pointerdown', this.onDown);
            this.hostSvg.classList.remove('coolms-designer__bpmn-connect-mode');
        }
        this.onDown = null;
        this.cancelDrag();
        // Leaving the mode must not leave a source armed for the next
        // time it is entered.
        this.pendingSourceId = null;
        this.hostSvg = null;
    }

    /**
     * Tear down both the in-flight drag (if any) AND the mode
     * itself. After `dispose()` the mode cannot be re-entered.
     * Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.exit();
    }

    private handlePointerDown(ev: PointerEvent): void {
        // Left button only -- right/middle are typically pan / context
        // menu in canvas tools; ConnectMode should not intercept.
        if (ev.button !== 0) return;
        if (this.dragState !== null) return; // single drag at a time
        if (!(ev.target instanceof Element)) return;

        const elementG = ev.target.closest('[data-element-id]');
        if (elementG === null) return;
        const sourceId = elementG.getAttribute('data-element-id');
        if (sourceId === null) return;

        // CLICK-THEN-CLICK completion: a source is already armed and the
        // author just pressed a DIFFERENT element -- that is the target.
        // Handled on pointerdown (not up) so the connection lands even if
        // the release drifts off the element.
        if (this.pendingSourceId !== null && this.pendingSourceId !== sourceId) {
            const from = this.pendingSourceId;
            this.pendingSourceId = null;
            ev.preventDefault();
            this.createFlow(from, sourceId);
            return;
        }
        // Pressing the armed element again DISARMS it, so a mis-click is
        // recoverable without leaving the mode.
        if (this.pendingSourceId === sourceId) {
            this.pendingSourceId = null;
            ev.preventDefault();
            return;
        }

        const sourceCenter = this.editor.getElementCenter(sourceId);
        if (sourceCenter === null) return;
        const world = this.editor.clientToWorld(ev.clientX, ev.clientY);
        if (world === null) return;

        ev.preventDefault();

        const flowsGroup = this.editor.paintedFlowsElement;
        if (flowsGroup === null) return;
        const doc = flowsGroup.ownerDocument;

        const rubberband = doc.createElementNS(
            SVG_NS,
            'line',
        ) as SVGLineElement;
        rubberband.classList.add('coolms-designer__bpmn-rubberband');
        rubberband.setAttribute('x1', `${sourceCenter.x}`);
        rubberband.setAttribute('y1', `${sourceCenter.y}`);
        rubberband.setAttribute('x2', `${world.x}`);
        rubberband.setAttribute('y2', `${world.y}`);
        // pointer-events: none on the band so the cursor's pointerup
        // target is the element underneath, not the band itself.
        rubberband.setAttribute('pointer-events', 'none');
        flowsGroup.appendChild(rubberband);

        const onMove = (e: PointerEvent): void => {
            if (this.dragState === null) return;
            const w = this.editor.clientToWorld(e.clientX, e.clientY);
            if (w === null) return; // cursor left the canvas; stop tracking
            this.dragState.rubberband.setAttribute('x2', `${w.x}`);
            this.dragState.rubberband.setAttribute('y2', `${w.y}`);
        };
        const onUp = (e: PointerEvent): void => {
            this.handlePointerUp(e);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        this.dragState = { sourceId, rubberband, onMove, onUp };
    }

    private handlePointerUp(ev: PointerEvent): void {
        const drag = this.dragState;
        if (drag === null) return;

        // Read the target BEFORE teardown -- after cancelDrag the
        // rubber-band is gone but we still need to know which
        // element the cursor was over.
        let targetId: string | null = null;
        if (ev.target instanceof Element) {
            const elementG = ev.target.closest('[data-element-id]');
            if (elementG !== null) {
                targetId = elementG.getAttribute('data-element-id');
            }
        }

        const sourceId = drag.sourceId;
        this.cancelDrag();

        if (targetId === null) return; // release on empty canvas
        if (targetId === sourceId) {
            // Press + release on the SAME element is a CLICK, not a
            // zero-length drag: arm it as the source and wait for the
            // target click. This used to fall through to "self-loop
            // disallowed" and silently cancel, which is what made the
            // advertised click-then-click gesture do nothing at all.
            this.pendingSourceId = sourceId;
            return;
        }

        this.pendingSourceId = null;
        this.createFlow(sourceId, targetId);
    }

    /** Dispatch an undoable AddFlowCommand for a resolved source→target pair. */
    private createFlow(sourceId: string, targetId: string): void {
        const flow: BpmnSequenceFlow = {
            id: this.editor.nextFlowId(),
            source: sourceId,
            target: targetId,
        };
        this.editor.commandStack.execute(new AddFlowCommand(this.editor, flow));
    }

    /**
     * Tear down the drag's DOM + listeners WITHOUT dispatching a
     * connection. Used by `exit()` / `dispose()` / cancellation
     * paths + by the pointerup handler after it's read the target.
     */
    private cancelDrag(): void {
        if (this.dragState === null) return;
        document.removeEventListener('pointermove', this.dragState.onMove);
        document.removeEventListener('pointerup', this.dragState.onUp);
        this.dragState.rubberband.remove();
        this.dragState = null;
    }
}
