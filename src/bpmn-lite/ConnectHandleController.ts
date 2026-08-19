import { AddFlowCommand } from './AddFlowCommand.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import { svgEl } from './renderers/svg.js';
import type { BpmnSequenceFlow } from './types.js';

/**
 * Options for constructing the {@link ConnectHandleController}.
 */
export interface ConnectHandleControllerOptions {
    /**
     * The BpmnLiteEditor to attach to. The controller reads
     * `editor.canvasGroup.ownerSVGElement` for the canvas-wide hover
     * listener, mounts its handle overlay into `editor.canvasGroup`
     * (so it pans/zooms with the diagram), and paints the drag
     * rubber-band into `editor.paintedFlowsElement`.
     */
    readonly editor: BpmnLiteEditor;
    /**
     * Optional gate -- when it returns `true`, the hover handle is
     * suppressed (hidden + non-interactive). The dialog wires this to
     * `() => panMode.active || connectMode.active` so the always-on
     * hover affordance stands down while an explicit modal tool owns
     * the canvas (the hand-tool needs plain drag; the modal Connect
     * mode is a redundant second connect path). Absent = never
     * suppressed.
     */
    readonly isSuppressed?: () => boolean;
}

/**
 * Internal drag-state record. Lives only while the user is dragging a
 * connection out of the hover handle toward a target element.
 */
interface HandleDragState {
    readonly sourceId: string;
    readonly rubberband: SVGLineElement;
    readonly onMove: (ev: PointerEvent) => void;
    readonly onUp: (ev: PointerEvent) => void;
    readonly pointerId: number;
}

/**
 * A Camunda-Modeler-style **hover connect handle** -- the discoverable,
 * always-on counterpart to the modal {@link ConnectMode}.
 *
 * **Why this exists.** {@link ConnectMode} is *modal*: the user must
 * first click the toolbar's Connect (⬈) button to arm it, then drag
 * from a source element to a target. That is invisible to anyone who
 * reaches for the industry-standard gesture -- hover an element, grab
 * the little arrow that appears, drag to the target -- and instead
 * gets {@link MoveElementController}'s drag-to-MOVE (or nothing). This
 * controller ships that expected gesture so "connect elements with an
 * arrow" works with zero mode-switching.
 *
 * **Behaviour.**
 *  - A single small circular handle with an arrow glyph appears at the
 *    right-edge midpoint of whichever element the pointer is over. It
 *    lives in its own `<g>` mounted into the canvas group (world space,
 *    so it pans/zooms with the diagram) and is hoisted to the top of
 *    the group on every show so it paints above the element it hangs off.
 *  - Pressing the handle (left button) starts a connection drag: a
 *    dashed rubber-band `<line>` is painted from the source element's
 *    world-space center to the cursor, tracking the pointer via
 *    document-level `pointermove`. The handle `stopPropagation()`s its
 *    own pointerdown so neither {@link MoveElementController} nor
 *    {@link BpmnLiteSelectionController} (both listening on the canvas
 *    SVG) mistake the grab for a body-drag or a selection.
 *  - Releasing over a *different* element dispatches an
 *    {@link AddFlowCommand} through the editor's command stack (so
 *    undo/redo work); releasing over empty canvas or the source itself
 *    (self-loop) silently cancels.
 *
 * **Coexistence with drag-to-move.** The handle is a distinct, small
 * target OUTSIDE any element `<g>`, so grabbing the element *body* still
 * moves it (MoveElementController) while grabbing the *handle* connects
 * -- exactly the Camunda split. No mode flag is toggled; the two
 * gestures never collide because they start on different DOM targets.
 *
 * **Why re-use the editor primitives, not extend ConnectMode.** This
 * mirrors the package's one-controller-per-gesture pattern
 * ({@link MoveElementController}, {@link WaypointDragController}): each
 * is self-contained and drives the shared editor accessors
 * (`getElementCenter`, `clientToWorld`, `paintedFlowsElement`,
 * `nextFlowId`, `commandStack`). The connection *primitive* -- a
 * rubber-band + `AddFlowCommand` -- is the same one ConnectMode uses,
 * so the two connect surfaces stay behaviourally identical.
 *
 * **What this controller does NOT do** (deferred, same list as
 * ConnectMode): target highlight mid-drag, snap-to-center, connection
 * validation (the engine validator catches structural issues on deploy),
 * reattach existing endpoints, self-loop routing.
 *
 * **Dispose contract**: detaches the hover listener + the handle's
 * pointerdown + any in-flight drag listeners, removes the handle `<g>`
 * + rubber-band, drops the editor `change` subscription. Idempotent.
 */
export class ConnectHandleController {
    private readonly editor: BpmnLiteEditor;
    private readonly isSuppressed: () => boolean;
    private hostSvg: SVGSVGElement | null = null;
    private readonly handle: SVGGElement;
    private hoveredElementId: string | null = null;
    private dragState: HandleDragState | null = null;
    private disposed = false;

    private readonly onHoverMove: (ev: PointerEvent) => void;
    private readonly onHandleDown: (ev: PointerEvent) => void;
    private readonly offChange: () => void;

    constructor(options: ConnectHandleControllerOptions) {
        this.editor = options.editor;
        this.isSuppressed = options.isSuppressed ?? ((): boolean => false);

        const group = this.editor.canvasGroup;
        const doc = group.ownerDocument;
        this.handle = this.buildHandle(doc);
        group.appendChild(this.handle);

        this.hostSvg = group.ownerSVGElement;

        this.onHoverMove = (ev: PointerEvent): void => this.handleHoverMove(ev);
        this.onHandleDown = (ev: PointerEvent): void =>
            this.handlePointerDown(ev);
        // Hover tracking rides on the canvas SVG so it survives element
        // repaints (renderers rebuild the `<g>` tree wholesale). The
        // handle's own pointerdown is bound directly to the handle so
        // the grab is unambiguous.
        this.hostSvg?.addEventListener('pointermove', this.onHoverMove);
        this.handle.addEventListener('pointerdown', this.onHandleDown);

        // Keep the handle correctly placed + on top across model
        // mutations: a repaint re-appends the flows + elements groups to
        // the END of the canvas group (sinking the handle) and may move
        // the hovered element. Re-hoist + reposition when visible.
        this.offChange = this.editor.onChange(() => this.onModelChange());
    }

    /** Test affordance -- the handle `<g>` (always mounted; visibility via display). */
    get handleElement(): SVGGElement {
        return this.handle;
    }

    /** Test affordance -- true while the handle is shown for a hovered element. */
    get handleVisible(): boolean {
        return this.handle.style.display !== 'none';
    }

    /** Test affordance -- the element id the handle is currently attached to, or null. */
    get attachedElementId(): string | null {
        return this.handleVisible ? this.hoveredElementId : null;
    }

    /** Test affordance -- the in-flight rubber-band line, if a connect drag is active. */
    get rubberbandElement(): SVGLineElement | null {
        return this.dragState?.rubberband ?? null;
    }

    /** Test affordance -- the source element id of the in-flight connect drag, if any. */
    get connectingFromId(): string | null {
        return this.dragState?.sourceId ?? null;
    }

    /**
     * Detach + tear down. Removes the handle `<g>`, cancels any
     * in-flight drag, drops all listeners. Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelDrag();
        this.offChange();
        this.hostSvg?.removeEventListener('pointermove', this.onHoverMove);
        this.handle.removeEventListener('pointerdown', this.onHandleDown);
        this.handle.remove();
        this.hostSvg = null;
    }

    /**
     * Build the handle `<g>`: an accent circle with a white arrow glyph,
     * drawn in LOCAL coords centered on (0,0). A `translate(x,y)` on the
     * `<g>` places it in world space at show time. Starts hidden.
     */
    private buildHandle(doc: Document): SVGGElement {
        const g = doc.createElementNS(
            'http://www.w3.org/2000/svg',
            'g',
        ) as SVGGElement;
        g.classList.add('coolms-designer__bpmn-connect-handle');
        g.style.display = 'none';
        g.setAttribute('aria-hidden', 'true');
        g.appendChild(
            svgEl(doc, 'circle', { cx: '0', cy: '0', r: '9' }),
        );
        // Right-pointing arrowhead -- reads as "draw a flow from here".
        const arrow = svgEl(doc, 'path', {
            d: 'M -3 -4 L 4 0 L -3 4 Z',
        });
        arrow.classList.add('coolms-designer__bpmn-connect-handle-arrow');
        g.appendChild(arrow);
        return g;
    }

    /**
     * Hover tracking. Shows the handle at the right-edge midpoint of the
     * element under the cursor; hides it over empty canvas. No-ops while
     * a drag is in flight (the handle is hidden then) or while
     * suppressed (an explicit modal tool owns the canvas). Keeps the
     * handle put when the cursor is over the handle itself -- otherwise
     * moving onto it to grab it would immediately hide it.
     */
    private handleHoverMove(ev: PointerEvent): void {
        if (this.disposed) return;
        if (this.dragState !== null) return;
        if (this.isSuppressed()) {
            this.hideHandle();
            return;
        }
        if (!(ev.target instanceof Element)) {
            this.hideHandle();
            return;
        }
        // Pointer is over the handle -> keep the current attachment.
        if (
            ev.target.closest('.coolms-designer__bpmn-connect-handle') !== null
        ) {
            return;
        }
        const elementG = ev.target.closest('[data-element-id]');
        if (elementG === null) {
            this.hideHandle();
            return;
        }
        const elementId = elementG.getAttribute('data-element-id');
        if (elementId === null) {
            this.hideHandle();
            return;
        }
        this.showHandleFor(elementId);
    }

    /**
     * Position the handle at the right-edge midpoint of the element +
     * hoist it above the (repaint-reordered) element groups + show it.
     * Hides instead if the element can't be resolved. Returns whether
     * the handle ended up shown.
     */
    private showHandleFor(elementId: string): boolean {
        const el = this.editor.findElement(elementId);
        if (el === null) {
            this.hideHandle();
            return false;
        }
        const x = el.position.x + el.size.width;
        const y = el.position.y + el.size.height / 2;
        this.handle.setAttribute('transform', `translate(${x}, ${y})`);
        // Hoist to the end of the canvas group so it paints on top of
        // the elements group that a repaint just re-appended.
        this.editor.canvasGroup.appendChild(this.handle);
        this.handle.style.display = '';
        this.hoveredElementId = elementId;
        return true;
    }

    private hideHandle(): void {
        this.handle.style.display = 'none';
        this.hoveredElementId = null;
    }

    /**
     * Model changed (add/move/remove/repaint). If the handle is showing,
     * re-resolve + reposition its host so it tracks a moved element and
     * re-hoist above the freshly re-appended element group. Hides if the
     * host vanished.
     */
    private onModelChange(): void {
        if (this.dragState !== null) return;
        if (this.hoveredElementId === null) return;
        if (this.handle.style.display === 'none') return;
        this.showHandleFor(this.hoveredElementId);
    }

    /**
     * Begin a connection drag out of the handle. Left button only; the
     * source is the currently-hovered element. Stops propagation so the
     * canvas-level move/selection controllers don't also fire.
     */
    private handlePointerDown(ev: PointerEvent): void {
        if (this.disposed) return;
        if (ev.button !== 0) return;
        if (this.dragState !== null) return;
        if (this.isSuppressed()) return;
        const sourceId = this.hoveredElementId;
        if (sourceId === null) return;

        const sourceCenter = this.editor.getElementCenter(sourceId);
        if (sourceCenter === null) return;
        const world = this.editor.clientToWorld(ev.clientX, ev.clientY);
        if (world === null) return;

        const flowsGroup = this.editor.paintedFlowsElement;
        if (flowsGroup === null) return;

        // The grab belongs to us -- keep move/selection controllers +
        // the modal ConnectMode (all listening on the canvas SVG) out.
        ev.stopPropagation();
        ev.preventDefault();

        // Hide the handle for the duration of the drag so it never
        // becomes the pointerup target (which would misread as a
        // self-loop) and doesn't clutter the rubber-band.
        this.handle.style.display = 'none';

        const rubberband = svgEl(flowsGroup.ownerDocument, 'line', {
            x1: `${sourceCenter.x}`,
            y1: `${sourceCenter.y}`,
            x2: `${world.x}`,
            y2: `${world.y}`,
            // pointer-events: none so the cursor's pointerup target is
            // the element underneath, not the band.
            'pointer-events': 'none',
        });
        rubberband.classList.add('coolms-designer__bpmn-rubberband');
        flowsGroup.appendChild(rubberband);

        const onMove = (e: PointerEvent): void => {
            if (this.dragState === null) return;
            const w = this.editor.clientToWorld(e.clientX, e.clientY);
            if (w === null) return; // cursor left the canvas; stop tracking
            this.dragState.rubberband.setAttribute('x2', `${w.x}`);
            this.dragState.rubberband.setAttribute('y2', `${w.y}`);
        };
        const onUp = (e: PointerEvent): void => this.handlePointerUp(e);

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        this.dragState = {
            sourceId,
            rubberband,
            onMove,
            onUp,
            pointerId: ev.pointerId,
        };
    }

    private handlePointerUp(ev: PointerEvent): void {
        const drag = this.dragState;
        if (drag === null) return;

        // Read the target BEFORE teardown. The rubber-band is
        // pointer-events:none + the handle is hidden, so ev.target is
        // the element under the cursor.
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
        if (targetId === sourceId) return; // self-loop disallowed

        const flow: BpmnSequenceFlow = {
            id: this.editor.nextFlowId(),
            source: sourceId,
            target: targetId,
        };
        this.editor.commandStack.execute(new AddFlowCommand(this.editor, flow));
    }

    /**
     * Tear down the drag's DOM + document listeners WITHOUT dispatching
     * a connection. Used on release, cancel + dispose. The handle
     * re-appears on the next hover move.
     */
    private cancelDrag(): void {
        if (this.dragState === null) return;
        document.removeEventListener('pointermove', this.dragState.onMove);
        document.removeEventListener('pointerup', this.dragState.onUp);
        this.dragState.rubberband.remove();
        this.dragState = null;
    }
}
