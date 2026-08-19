import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import { MoveElementCommand } from './MoveElementCommand.js';
import type { BpmnPosition } from './types.js';

/**
 * Options for constructing the F-7.1 {@link MoveElementController}.
 */
export interface MoveElementControllerOptions {
    readonly editor: BpmnLiteEditor;
    /**
     * Optional gate -- when this returns `true`, pointerdown on an
     * element is IGNORED (no drag-move starts) so the
     * {@link ConnectMode} drag-from-source-edge gesture wins.
     *
     * The dialog wires this to `() => connectMode.active` after both
     * controllers are constructed. When the user opts out of connect
     * mode (toolbar toggle off OR Escape pressed), drag-move resumes
     * normally.
     */
    readonly isConnectActive?: () => boolean;
    /**
     * Optional gate -- when this returns `true`, pointerdown is
     * IGNORED so the {@link PanMode} hand-tool wins (its canvas
     * pointerdown listener panes the viewport rather than dragging the
     * element). The dialog wires this to `() => panMode.active`.
     */
    readonly isPanActive?: () => boolean;
}

/**
 * Internal drag-state record. Lives only while a drag is in flight.
 *
 * **F-7.6 take-2** -- the original F-7.6 ship attempted to fix a
 * "click-to-select teleports the element" bug by switching to screen-
 * space delta arithmetic + a 5px screen-pixel + 120ms time gate on
 * arming. Those changes were sound (they reduce accidental arms) but
 * they did NOT fix the user-visible jump. The real culprit was in
 * {@link MoveElementController.cancelDrag}: it called
 * `elementG.removeAttribute('transform')` on tear-down. The element's
 * transform is its CANONICAL position carrier (every renderer in
 * `nodeRenderers.makeWrapper` writes `translate(position.x,
 * position.y)` on each repaint), so stripping it dropped the element
 * to world (0,0). The pre-take-2 thinking was "the next repaint will
 * restore it" -- but the armed-then-released-with-no-motion path
 * (very common: any click with 5+ px of drift AND 120+ ms of hold
 * arms the drag, but releasing with no further motion takes the
 * `finalPosition === startPosition` no-op-move branch in
 * onPointerUp) bails BEFORE dispatching a command, so no repaint
 * fires, so the transform stays stripped. Pre-F-7.4 (auto-fit on
 * open), world (0,0) sat off-screen at identity pan+zoom so the bug
 * was invisible; after F-7.4 zoomed the viewport to center the
 * diagram, world (0,0) became a real visible point + clicks started
 * teleporting elements there.
 *
 * Take-2 fix: cancelDrag WRITES the canonical position transform
 * back instead of stripping it (using `startPosition`, the drag's
 * captured pre-drag world coords). Idempotent on all cancel paths
 * (armed-no-op, Escape, dispose) since the model never changed.
 *
 * The screen-space delta arithmetic + 5px/120ms arming gates from
 * F-7.6 take-1 stay -- they remain the right answer for accidental-
 * arm avoidance, just not the answer to the visible-jump bug.
 */
interface DragState {
    /** The element id being dragged. */
    readonly elementId: string;
    /** The element's position at the time the drag started (revert target). */
    readonly startPosition: BpmnPosition;
    /** The element's label at the time the drag started -- used for the command label. */
    readonly elementLabel: string | undefined;
    /** The cursor's SCREEN (DOM client) coords at the time the drag started (F-7.6). */
    readonly startClientX: number;
    readonly startClientY: number;
    /**
     * F-7.6 -- the cursor's SCREEN coords at the moment the drag
     * ARMED (which is later than pointerdown by at least 120ms +
     * 8px of motion). The element's working position is computed
     * from this anchor, NOT from `startClientX/Y`, so any motion
     * accumulated DURING the dead-zone is discarded — no teleport-
     * on-arm. Set to (NaN, NaN) until armed.
     */
    armedClientX: number;
    armedClientY: number;
    /**
     * The viewport zoom at the time the drag started (F-7.6). Cached so
     * the screen→world conversion stays consistent through the drag
     * even if the viewport is mutated mid-drag (rare).
     */
    readonly startZoom: number;
    /** Timestamp (performance.now-ish ms) of pointerdown (F-7.6 time-gate). */
    readonly startTimeMs: number;
    /** The element's `<g>` -- mutated directly via SVG transform during drag. */
    readonly elementG: SVGGElement;
    /** The id of the captured pointer (released on pointerup). */
    readonly pointerId: number;
    readonly onMove: (ev: PointerEvent) => void;
    readonly onUp: (ev: PointerEvent) => void;
    readonly onCancel: (ev: PointerEvent) => void;
    /** Latest working position (read on pointerup to build the command). */
    workingPosition: BpmnPosition;
    /** Set on pointermove past the dead-zone -- before this drag is "candidate" only. */
    armed: boolean;
}

/**
 * F-7.1 MoveElementController -- drives drag-to-move on the canvas's
 * existing elements. One instance per editor, constructed in the
 * dialog component alongside Selection + Connect + Pan + Waypoint
 * controllers.
 *
 * **Why drag-to-move arrived after the other drags**: the palette
 * delivered drag-to-CREATE (elements appear from the palette) and
 * connect mode delivered drag-to-CONNECT (sequence-flow edges between existing
 * elements) + waypoint-drag-to-REROUTE (flow path waypoints). The
 * obvious-in-hindsight gap was drag-to-MOVE -- once an element was
 * placed, it was immovable except by editing its x/y via the property
 * panel. F-7.1 closes the gap.
 *
 * **Behaviour**:
 *  - Pointerdown on an element `<g>` (matched via the
 *    `data-element-id` attribute) captures the element's pre-drag
 *    position + cursor world coords. The drag starts as a "candidate"
 *    -- the controller doesn't begin painting transient transforms
 *    until the pointer moves past a ~3px dead-zone. Without the
 *    dead-zone, every click-to-select gesture would fire a no-op move
 *    command + pollute undo history with empty entries.
 *  - Pointermove (after arming) translates the element's `<g>` via
 *    SVG `transform="translate(dx,dy)"`. **NO** editor mutator calls
 *    during drag -- the editor's `change` event would fire 60x/s + the
 *    Angular wrapper's auto-save would storm.
 *  - Pointerup dispatches a {@link MoveElementCommand} carrying the
 *    pre- + post-positions through the editor's command stack so
 *    undo/redo work atomically. The repaint triggered by the command's
 *    apply() also redraws the connected flows at the new geometry --
 *    {@link computeOrthogonalRoute} re-routes each
 *    connected flow based on the element's NEW source/target box.
 *    Manual waypoints (user-rerouted) are preserved as-is.
 *  - Pointerup BEFORE arming (no drag past dead-zone) is treated as
 *    a click-to-select gesture + does NOT dispatch a command. The
 *    {@link BpmnLiteSelectionController} already handled the
 *    selection via its own pointerdown listener (the controllers
 *    coexist; we don't need to also call select() here).
 *  - Pointercancel + Escape during a live drag REVERT to the
 *    pre-drag position by clearing the SVG transform + suppressing
 *    the command dispatch.
 *
 * **Suppression contract** -- the drag is gated by two callbacks
 * (`isConnectActive` + `isPanActive`) so the three mode-style
 * gestures (drag-to-connect, hand-pan, drag-to-move) are mutually
 * exclusive on pointerdown. The dialog flips the gates on its mode
 * toggles.
 *
 * **Why the controller listens on the canvas SVG, not per-element**:
 * elements are minted + removed by the model on every paint
 * (renderers rebuild the `<g>` tree from scratch). Per-element
 * listeners would need re-binding on every repaint. Listening at the
 * canvas root + walking `closest('[data-element-id]')` is robust
 * across repaints + matches the {@link BpmnLiteSelectionController}
 * pattern.
 *
 * **What this controller does NOT do** (deferred):
 *  - **Snap-to-grid** -- raw cursor world coords. The `Snap` utility
 *    can wire up later if the property panel surfaces grid affordances.
 *  - **Multi-select drag** -- single-element only. Marquee +
 *    multi-target drag land later.
 *  - **Drop-onto-container reparenting** -- elements have no parent
 *    concept yet at the BPMN-Lite level.
 *  - **Auto-scroll** -- drag near a viewport edge doesn't scroll the
 *    canvas. The F-5 wheel-pan + arrow-key pan already give the user
 *    that affordance via parallel pointer paths.
 *
 * **Dispose contract**: detaches the pointer listener + cancels
 * in-flight drag (reverts transient transform). Idempotent.
 */
export class MoveElementController {
    private readonly editor: BpmnLiteEditor;
    private readonly isConnectActive: () => boolean;
    private readonly isPanActive: () => boolean;
    private hostSvg: SVGSVGElement | null = null;
    private onDown: ((ev: PointerEvent) => void) | null = null;
    private dragState: DragState | null = null;
    private disposed = false;

    /**
     * F-7.6 -- pointer must move at least this many SCREEN pixels
     * (DOM client coords) before the drag arms. Below the threshold a
     * pointerup is treated as a click-to-select + no command is
     * dispatched. **Why screen instead of world**: at non-identity
     * viewport zoom (post F-7.4 auto-fit, ~0.86 typical, can drop to
     * 0.1 for very large diagrams) a small world threshold maps to a
     * sub-pixel screen threshold that trackpad-click drift trips on
     * every click. 8 screen pixels is generous enough to absorb
     * trackpad jitter AND synthetic pointer events that automation
     * tools sometimes emit between mousedown + mouseup (matching what
     * Camunda Modeler + bpmn-io use for their drag handlers).
     */
    private static readonly ARM_THRESHOLD_PX = 5;

    /**
     * F-7.6 -- pointer must ALSO be held for at least this many
     * milliseconds before the drag arms. A real click completes in
     * 50-200ms with negligible motion; a real drag is sustained at
     * 100ms+ with continuous motion. Requiring BOTH the screen
     * distance AND the time gate eliminates accidental arms from
     * (a) trackpad-click drift, (b) synthetic pointer-event sequences
     * that inject motion between mousedown + mouseup, (c) high-DPI
     * mice that emit sub-pixel jitter as full-pixel deltas.
     *
     * 120ms is the canonical lower bound for "deliberate hold" — fast
     * enough that intentional drags feel responsive, slow enough that
     * a casual single click never crosses it.
     */
    private static readonly ARM_HOLD_MS = 120;

    constructor(options: MoveElementControllerOptions) {
        this.editor = options.editor;
        this.isConnectActive = options.isConnectActive ?? (() => false);
        this.isPanActive = options.isPanActive ?? (() => false);
        const svg = this.editor.canvasGroup.ownerSVGElement;
        if (svg === null) return;
        this.hostSvg = svg;
        this.onDown = (ev: PointerEvent): void => this.handlePointerDown(ev);
        svg.addEventListener('pointerdown', this.onDown);
    }

    /** Test affordance -- true while a drag is in flight (past arming). */
    get dragging(): boolean {
        return this.dragState !== null && this.dragState.armed;
    }

    /** Test affordance -- the element id currently being dragged, or null. */
    get draggingId(): string | null {
        return this.dragState?.elementId ?? null;
    }

    /**
     * Detach + tear down + cancel any in-flight drag. Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelDrag();
        if (this.hostSvg !== null && this.onDown !== null) {
            this.hostSvg.removeEventListener('pointerdown', this.onDown);
        }
        this.hostSvg = null;
        this.onDown = null;
    }

    private handlePointerDown(ev: PointerEvent): void {
        if (this.disposed) return;
        if (this.dragState !== null) return;
        if (ev.button !== 0) return;
        if (this.isConnectActive()) return;
        if (this.isPanActive()) return;
        if (!(ev.target instanceof Element)) return;
        // Don't trigger move when the user grabbed a waypoint handle --
        // the WaypointDragController owns that gesture + already calls
        // stopPropagation, but the closest() walk would still match the
        // ancestor element if a handle ever lived under an element `<g>`.
        // Today handles live under the flow `<g>`, not under element
        // `<g>`s, so the closest() walk wouldn't match -- this guard is
        // defensive against future renderer changes.
        if (ev.target.closest('.coolms-designer__bpmn-waypoint-handle') !== null) return;
        const elementG = ev.target.closest<SVGGElement>('[data-element-id]');
        if (elementG === null) return;
        const elementId = elementG.getAttribute('data-element-id');
        if (elementId === null) return;
        const element = this.editor.findElement(elementId);
        if (element === null) return;
        // F-7.6 -- sample the viewport zoom ONCE here so the screen-
        // delta-to-world-delta conversion stays stable across the drag
        // even if the viewport state mutates mid-drag (rare, but the
        // pre-F-7.6 controller re-read it on every pointermove which
        // produced spurious huge deltas when F-7.4 auto-fit raced with
        // a pointerdown). 1.0 is the safe identity default if the
        // transform attribute is malformed or missing.
        const startZoom = this.readViewportZoom();

        const onMove = (e: PointerEvent): void => this.onPointerMove(e);
        const onUp = (e: PointerEvent): void => this.onPointerUp(e);
        const onCancel = (e: PointerEvent): void => this.onPointerCancel(e);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);

        this.dragState = {
            elementId,
            startPosition: { x: element.position.x, y: element.position.y },
            elementLabel: element.label,
            startClientX: ev.clientX,
            startClientY: ev.clientY,
            armedClientX: Number.NaN,
            armedClientY: Number.NaN,
            startZoom,
            startTimeMs: ev.timeStamp,
            elementG,
            pointerId: ev.pointerId,
            onMove,
            onUp,
            onCancel,
            workingPosition: { x: element.position.x, y: element.position.y },
            armed: false,
        };
    }

    /**
     * F-7.6 -- read the current viewport zoom from the canvas group's
     * SVG transform. Mirrors the parsing in BpmnLiteEditor.domToWorld
     * (which is private) so the controller can sample zoom without
     * routing through clientToWorld (which would re-read it every
     * frame + couple us to pan changes we don't want to track).
     *
     * Returns 1 on parse failure / malformed transform; that's safer
     * than `null` because a missing transform usually means identity,
     * and producing a delta against identity is the right behaviour
     * in the absence of viewport state.
     */
    private readViewportZoom(): number {
        const transform =
            this.editor.canvasGroup.getAttribute('transform') ?? '';
        const scaleMatch = transform.match(/scale\(\s*(-?[\d.]+)\s*\)/);
        if (scaleMatch === null) return 1;
        const z = parseFloat(scaleMatch[1]!);
        if (!Number.isFinite(z) || z === 0) return 1;
        return z;
    }

    private onPointerMove(ev: PointerEvent): void {
        if (this.dragState === null) return;
        if (ev.pointerId !== this.dragState.pointerId) return;
        // F-7.6 -- screen-space delta. Arm against a SCREEN-pixel
        // dead-zone (constant across viewport zoom). Convert to world-
        // space delta via `screen_delta / startZoom` for the SVG
        // transform + the working position. Both math + dead-zone
        // are zoom-invariant and viewport-pan-change-invariant.
        if (!this.dragState.armed) {
            // Use the ORIGINAL pointerdown point for the arm test --
            // we want cumulative distance from pointerdown, not from
            // the previous pointermove.
            const screenDxFromStart =
                ev.clientX - this.dragState.startClientX;
            const screenDyFromStart =
                ev.clientY - this.dragState.startClientY;
            const screenDistSq =
                screenDxFromStart * screenDxFromStart +
                screenDyFromStart * screenDyFromStart;
            const threshold = MoveElementController.ARM_THRESHOLD_PX;
            if (screenDistSq < threshold * threshold) return;
            // F-7.6 -- time gate. Even past the screen distance
            // threshold, the drag stays unarmed for the first
            // ARM_HOLD_MS so accidental motion (trackpad drift,
            // synthetic pointer events, sub-pixel jitter rounded up
            // to a full px) during a normal click can't arm a drag.
            const elapsedMs = ev.timeStamp - this.dragState.startTimeMs;
            if (elapsedMs < MoveElementController.ARM_HOLD_MS) return;
            // F-7.6 -- ARM + REBASE. From this frame on, the element
            // tracks the cursor RELATIVE to the current screen
            // position, NOT relative to pointerdown. This is the
            // crucial bit: if 30+ pixels of motion accumulated during
            // the dead-zone (whether trackpad jitter, synthetic
            // events, or simply a fast pre-arm drag), the element
            // would otherwise teleport by that whole accumulated
            // delta on the first armed frame. Rebasing to (currentX,
            // currentY) discards the dead-zone motion and starts the
            // drag fresh from where the cursor IS RIGHT NOW. The
            // user experience: "drag now picks up the element under
            // the cursor smoothly," instead of the element snapping
            // by the cumulative delta on the first armed frame.
            this.dragState.armed = true;
            this.dragState.armedClientX = ev.clientX;
            this.dragState.armedClientY = ev.clientY;
            // Visual cue while dragging -- adds a CSS hook the dialog
            // can use to dim other elements, raise this one above the
            // selection ring, etc. The class is removed on dispose /
            // pointerup.
            this.dragState.elementG.classList.add(
                'coolms-designer__bpmn-element--dragging',
            );
            // First armed frame produces ZERO delta -- the cursor IS
            // at the just-captured armedClient coords. Nothing to
            // paint yet; return so the workingPosition + transform
            // stay at their initial (zero-delta) values. The next
            // pointermove will produce a real delta against
            // armedClient.
            return;
        }
        // Armed -- compute delta from the rebase anchor, not from
        // startClient.
        const screenDx = ev.clientX - this.dragState.armedClientX;
        const screenDy = ev.clientY - this.dragState.armedClientY;
        const zoom = this.dragState.startZoom;
        const worldDx = screenDx / zoom;
        const worldDy = screenDy / zoom;
        this.dragState.workingPosition = {
            x: this.dragState.startPosition.x + worldDx,
            y: this.dragState.startPosition.y + worldDy,
        };
        // SVG transform on the existing `<g>` -- no model mutation,
        // no change event. The flows STAY at the old endpoints during
        // drag; they snap to the new geometry on pointerup when the
        // command applies + repaints. (A nicer-but-bigger ship would
        // re-route the flows continuously during drag; deferred.)
        //
        // **The element's own transform carries its POSITION**, not
        // just a drag offset. The nodeRenderers set this to
        // `translate(position.x, position.y)` on every repaint. If we
        // overwrite it with just the delta, the element teleports to
        // world (delta.x, delta.y) -- effectively to the upper-left
        // corner of the canvas plus the delta. The bug surfaced at
        // F-7.4: at identity zoom + identity pan it looked OK because
        // (0,0) wasn't on screen and small deltas were invisible; at
        // F-7.4 fit-zoom 0.86 the same bug now placed the element in
        // visible canvas space. Fix: combine startPosition + delta so
        // the transform represents the element's CURRENT live world
        // position throughout the drag.
        const newX = this.dragState.startPosition.x + worldDx;
        const newY = this.dragState.startPosition.y + worldDy;
        this.dragState.elementG.setAttribute(
            'transform',
            `translate(${newX},${newY})`,
        );
    }

    private onPointerUp(ev: PointerEvent): void {
        const drag = this.dragState;
        if (drag === null) return;
        if (ev.pointerId !== drag.pointerId) return;
        const wasArmed = drag.armed;
        const finalPosition = drag.workingPosition;
        const elementId = drag.elementId;
        const startPosition = drag.startPosition;
        const elementLabel = drag.elementLabel;
        this.cancelDrag();
        if (!wasArmed) return; // click-to-select, not a move
        // No-op move -- pointer ended exactly where it started. Don't
        // pollute undo history with a no-op entry.
        if (
            finalPosition.x === startPosition.x &&
            finalPosition.y === startPosition.y
        ) {
            return;
        }
        this.editor.commandStack.execute(
            new MoveElementCommand(
                this.editor,
                elementId,
                startPosition,
                finalPosition,
                elementLabel,
            ),
        );
    }

    private onPointerCancel(ev: PointerEvent): void {
        if (this.dragState === null) return;
        if (ev.pointerId !== this.dragState.pointerId) return;
        this.cancelDrag();
    }

    /** Tear down the drag's listeners + restore the transient transform. */
    private cancelDrag(): void {
        if (this.dragState === null) return;
        document.removeEventListener('pointermove', this.dragState.onMove);
        document.removeEventListener('pointerup', this.dragState.onUp);
        document.removeEventListener('pointercancel', this.dragState.onCancel);
        // **F-7.6 take-2** -- RESTORE the position transform to its
        // pre-drag value rather than stripping it. The transform on
        // each element `<g>` is its CANONICAL position carrier (see
        // nodeRenderers.makeWrapper -- every renderer sets
        // `translate(position.x, position.y)` on the wrapper). The
        // pre-F-7.6 cancelDrag stripped the attribute under the
        // assumption that "next repaint will re-set it" -- but the
        // armed-then-no-op-move path (very common: a real click with
        // any trackpad drift past the 5px screen threshold AND past
        // the 120ms hold gate ARMS the drag, but releasing with no
        // further motion leaves `finalPosition === startPosition`)
        // bails OUT of onPointerUp BEFORE dispatching a command, so
        // no repaint fires, so the stripped transform stays stripped
        // -- the element snaps to world (0,0). At identity pan+zoom
        // (pre-F-7.4) world (0,0) sat off-screen at the canvas corner
        // so the bug was invisible; after F-7.4 auto-fit panned the
        // viewport to center the diagram, world (0,0) became a real
        // visible point, and clicks started teleporting elements
        // there. Writing the position transform back is idempotent
        // with the renderer's contract + safe in BOTH paths (no-op
        // pointerup AND Escape / dispose mid-drag): in both cases
        // the model never moved, so the element belongs at its
        // pre-drag position.
        this.dragState.elementG.setAttribute(
            'transform',
            `translate(${this.dragState.startPosition.x},${this.dragState.startPosition.y})`,
        );
        this.dragState.elementG.classList.remove(
            'coolms-designer__bpmn-element--dragging',
        );
        this.dragState = null;
    }
}
