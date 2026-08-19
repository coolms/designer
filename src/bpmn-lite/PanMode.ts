import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { Viewport } from '../canvas/Viewport.js';

/**
 * Options for constructing the polish-bundle (F-4)
 * {@link PanMode}.
 */
export interface PanModeOptions {
    /** The editor whose canvas SVG the controller wires pointer events on. */
    readonly editor: BpmnLiteEditor;
    /** The viewport whose pan offset is mutated as the user drags. */
    readonly viewport: Viewport;
}

/**
 * polish-bundle (F-4) — explicit "hand tool" pan mode.
 *
 * **Why this exists**: the {@link Canvas} already binds middle-click
 * drag (`button === 1`) to `viewport.panBy`, but two real
 * problems made that affordance discoverability-blind:
 *  1. Trackpad users on Mac don't have a middle button at all
 *     unless they hold a modifier — middle-click pan is invisible
 *     to them.
 *  2. Mouse users don't know the affordance exists. The user
 *     surfaced exactly this gap: "when I zoom in - how do I move
 *     left right up down?"
 *
 * PanMode flips left-click drag into a pan gesture, with a hand
 * cursor + a CSS class on the host SVG so users have an explicit,
 * always-discoverable affordance. Toggled from a hand-tool button
 * in the dialog header (parallels the Image Editor's
 * `bi-hand-index` button).
 *
 * **Pattern mirrors {@link ConnectMode}** verbatim:
 *  - `active_` flag + `enter()` / `exit()` toggles
 *  - CSS class on the host SVG so the canvas gets a hand cursor +
 *    selection rendering can dim itself if it wants
 *  - Document-level pointermove/pointerup listeners so the drag
 *    tracks even when the cursor leaves the canvas (matching the
 *    standard rubber-band UX)
 *  - Dispose contract: exits if active, releases all listeners
 *
 * **Why pan doesn't go through the CommandStack**: pan is a view-
 * state mutation, not a model mutation. The CommandStack records
 * undoable model edits (add/remove element, edit property, etc).
 * Re-doing a pan after "undo last edit, redo last edit" would
 * surprise the user — they'd expect the canvas to stay where they
 * left it. So pan never touches the stack.
 *
 * **Mouse-only**: while active, suppresses left-click selection on
 * the canvas (the SelectionController checks for the active class
 * is NOT YET wired — F-4 ships PanMode + the toggle; future ship
 * adds the selection-controller guard if users find dual-mode
 * confusing). Today the SelectionController still runs, so a click
 * on an element WHILE PanMode is active still selects + then pans
 * if dragged. F-4's CSS hand cursor + tooltip handle the
 * communication; tightening the selection guard lands in F-5 if
 * the dual behaviour confuses users in practice.
 */
export class PanMode {
    private readonly editor: BpmnLiteEditor;
    private readonly viewport: Viewport;
    private readonly hostSvg: SVGSVGElement | null;
    private active_ = false;
    private disposed = false;

    private dragState: {
        readonly pointerId: number;
        lastX: number;
        lastY: number;
        readonly onMove: (ev: PointerEvent) => void;
        readonly onUp: (ev: PointerEvent) => void;
    } | null = null;

    private readonly onDown: (ev: PointerEvent) => void;

    constructor(options: PanModeOptions) {
        this.editor = options.editor;
        this.viewport = options.viewport;
        this.hostSvg = this.editor.canvasGroup.ownerSVGElement;
        this.onDown = (ev: PointerEvent): void => this.handlePointerDown(ev);
    }

    /** True while the mode is active (between {@link enter} + {@link exit}). */
    get active(): boolean {
        return this.active_;
    }

    /** Test affordance — the current drag state, or null if idle. */
    get dragging(): boolean {
        return this.dragState !== null;
    }

    /**
     * Activate hand-tool pan mode. Attaches a pointerdown listener
     * to the host SVG + adds the `--pan-mode` CSS class so the
     * cursor flips to `grab`. No-op if already active or if no
     * host SVG is attached.
     */
    enter(): void {
        if (this.disposed) return;
        if (this.active_) return;
        if (this.hostSvg === null) return;
        this.active_ = true;
        this.hostSvg.classList.add('coolms-designer__bpmn-pan-mode');
        this.hostSvg.addEventListener('pointerdown', this.onDown);
    }

    /**
     * Deactivate hand-tool pan mode. Releases any in-flight drag +
     * drops the listener + CSS class. No-op if not active.
     */
    exit(): void {
        if (!this.active_) return;
        this.active_ = false;
        this.endDrag();
        if (this.hostSvg !== null) {
            this.hostSvg.classList.remove('coolms-designer__bpmn-pan-mode');
            this.hostSvg.removeEventListener('pointerdown', this.onDown);
        }
    }

    /**
     * Tear down completely. Exits if active + releases the host
     * SVG reference. After dispose() the mode cannot be re-entered.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.exit();
    }

    private handlePointerDown(ev: PointerEvent): void {
        if (!this.active_) return;
        if (ev.button !== 0) return; // left-click only
        if (this.dragState !== null) return; // single drag at a time
        ev.preventDefault();
        ev.stopPropagation();

        const doc = ev.target instanceof Element ? ev.target.ownerDocument : document;
        const onMove = (e: PointerEvent): void => {
            if (this.dragState === null) return;
            const dx = e.clientX - this.dragState.lastX;
            const dy = e.clientY - this.dragState.lastY;
            this.dragState.lastX = e.clientX;
            this.dragState.lastY = e.clientY;
            this.viewport.panBy(dx, dy);
        };
        const onUp = (_e: PointerEvent): void => {
            this.endDrag();
        };

        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onUp);
        doc.addEventListener('pointercancel', onUp);

        this.dragState = {
            pointerId: ev.pointerId,
            lastX: ev.clientX,
            lastY: ev.clientY,
            onMove,
            onUp,
        };
    }

    private endDrag(): void {
        if (this.dragState === null) return;
        const doc =
            this.hostSvg?.ownerDocument ??
            (typeof document !== 'undefined' ? document : null);
        if (doc !== null) {
            doc.removeEventListener('pointermove', this.dragState.onMove);
            doc.removeEventListener('pointerup', this.dragState.onUp);
            doc.removeEventListener('pointercancel', this.dragState.onUp);
        }
        this.dragState = null;
    }
}
