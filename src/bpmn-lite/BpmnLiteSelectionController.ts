import type { BpmnLiteEditor } from './BpmnLiteEditor.js';

/**
 * Options for constructing a {@link BpmnLiteSelectionController}.
 */
export interface BpmnLiteSelectionControllerOptions {
    readonly editor: BpmnLiteEditor;
}

/**
 * selection controller -- wires canvas pointer events into
 * the editor's selection state. Constructed once per editor; lives
 * for the editor's lifetime.
 *
 * **Behaviour**:
 *  - Pointerdown on the canvas SVG walks the event target chain.
 *    Finds the closest `[data-flow-id]` OR `[data-element-id]`
 *    ancestor + calls `editor.selection.select({kind, id})`.
 *    **Flow takes precedence** when both are matched (the flow
 *    `<g>` is a child of the flows group, NOT a child of any
 *    element `<g>`, so a single closest-walk reaches whichever sits
 *    above the cursor first).
 *  - Pointerdown on empty canvas (no data attribute matched) clears
 *    the selection.
 *  - Coexistence with {@link ConnectMode}: the controller
 *    skips its own work when an event was handled at the SVG-root
 *    level by ConnectMode (left-button pointerdowns on elements
 *    are already consumed by ConnectMode + start a connection
 *    drag). The seam is at the `editor.selection` -- ConnectMode
 *    doesn't touch it, so a selection click on a different element
 *    while connect mode is OFF is the regular path. When connect
 *    mode is ON, the controller still selects on element clicks
 *    (so the user sees the element light up + the property panel
 *    opens), AND ConnectMode starts its drag in parallel -- the
 *    user gets both affordances at once, no conflict.
 *  - Coexistence with {@link WaypointDragController}: the
 *    waypoint handles call `ev.stopPropagation()` on pointerdown
 *    so the canvas-level listener never sees the down -- a click
 *    on a handle does NOT change selection.
 *
 * **What this controller does NOT do** (deferred):
 *  - Multi-select on Shift+click (single-target only for now).
 *  - Marquee selection.
 *  - Keyboard navigation (arrow keys between selected elements).
 *  - Right-click context menu surfacing.
 *
 * **Dispose contract**: detaches the pointer listener. Safe to call
 * multiple times.
 */
export class BpmnLiteSelectionController {
    private readonly editor: BpmnLiteEditor;
    private hostSvg: SVGSVGElement | null = null;
    private onDown: ((ev: PointerEvent) => void) | null = null;
    private disposed = false;

    constructor(options: BpmnLiteSelectionControllerOptions) {
        this.editor = options.editor;
        const svg = this.editor.canvasGroup.ownerSVGElement;
        if (svg === null) return;
        this.hostSvg = svg;
        this.onDown = (ev: PointerEvent): void => this.handlePointerDown(ev);
        svg.addEventListener('pointerdown', this.onDown);
    }

    /**
     * Detach + tear down. Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.hostSvg !== null && this.onDown !== null) {
            this.hostSvg.removeEventListener('pointerdown', this.onDown);
        }
        this.hostSvg = null;
        this.onDown = null;
    }

    private handlePointerDown(ev: PointerEvent): void {
        // Left button only -- right-click context menus + middle-click
        // pan should not change selection.
        if (ev.button !== 0) return;
        if (!(ev.target instanceof Element)) return;
        const flowG = ev.target.closest('[data-flow-id]');
        if (flowG !== null) {
            const id = flowG.getAttribute('data-flow-id');
            if (id !== null) {
                this.editor.selection.select({ kind: 'flow', id });
                return;
            }
        }
        const elementG = ev.target.closest('[data-element-id]');
        if (elementG !== null) {
            const id = elementG.getAttribute('data-element-id');
            if (id !== null) {
                this.editor.selection.select({ kind: 'element', id });
                return;
            }
        }
        // Click on empty canvas -- clear the selection.
        this.editor.selection.clear();
    }
}
