import type { CommandStack } from '../canvas/CommandStack.js';
import type { Viewport } from '../canvas/Viewport.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import { DeleteElementCommand } from './DeleteElementCommand.js';
import { DeleteFlowCommand } from './DeleteFlowCommand.js';

/**
 * Options for constructing the polish-bundle (F-4 / F-5)
 * {@link BpmnLiteKeyboardController}.
 */
export interface BpmnLiteKeyboardControllerOptions {
    /** The editor whose selection / command stack the controller drives. */
    readonly editor: BpmnLiteEditor;
    /** The shared command stack — same one the toolbar's undo/redo wires through. */
    readonly commands: CommandStack;
    /**
     * The viewport for arrow-key pan + +/-/0 zoom hotkeys. Optional —
     * omitting it disables the F-5 navigation bindings while keeping
     * F-4's Delete/Backspace bindings live. Useful for tests +
     * read-only mounts that don't want keyboard nav.
     */
    readonly viewport?: Viewport;
    /**
     * Per-arrow-key pan delta in DOM pixels. Default 50. Shift+arrow
     * multiplies by {@link shiftArrowMultiplier}.
     */
    readonly arrowPanStep?: number;
    /** Multiplier applied when Shift is held during arrow-key pan. Default 5. */
    readonly shiftArrowMultiplier?: number;
    /**
     * Multiplicative zoom factor applied by the +/= and - keys.
     * Default 1.25 (matches the toolbar zoom step). Floored at 1.001.
     */
    readonly zoomStep?: number;
    /**
     * Read-only mode (M3.3.m.F-5). When true, Delete / Backspace
     * become no-ops; arrow-key pan + +/-/0 zoom hotkeys still work
     * (viewing a read-only diagram still benefits from navigation).
     * Mirrors the shell Toolbar's `readOnly` flag — same intent.
     */
    readonly readOnly?: boolean;
    /**
     * Optional document override (default: `editor.canvasGroup.ownerSVGElement?.ownerDocument ?? window.document`).
     * Tests can pass a jsdom document; the dialog can pass its host document.
     */
    readonly doc?: Document;
}

/**
 * polish-bundle (F-4) — listens for document-level keydown
 * events and dispatches the matching command for the current
 * selection.
 *
 * **Bindings** (M3.3 minimum viable set; future ships extend):
 *  - `Delete` / `Backspace` → if a flow is selected, dispatch a
 *    {@link DeleteFlowCommand}; if an element is selected, dispatch
 *    a {@link DeleteElementCommand} (which cascades incident flows).
 *    No-op when nothing is selected.
 *
 * **Why document-level, not canvas-SVG-level**: when the user
 * clicks on an element, the SVG group captures focus only briefly
 * — once the pointer moves anywhere outside the SVG, the canvas
 * isn't the focused element anymore and SVG keydown listeners
 * don't fire. The document-level listener fires regardless of
 * focus location. The trade-off is we have to ignore keystrokes
 * that originated from form inputs (text inputs, textareas, the
 * property panel's `<input>` fields) so the user can type
 * "Delete" inside a label field without nuking the selected
 * element. The `isEditableTarget()` helper handles that.
 *
 * **Why dispatch through the CommandStack, not directly call
 * `editor.removeElement`**: the toolbar's undo button needs to
 * reverse the action. Direct editor mutations don't push onto
 * the command stack, so a direct call would make the deletion
 * non-undoable + surprise users who hit Cmd-Z right after.
 *
 * **Dispose contract**: detaches the keydown listener. Safe to
 * call multiple times.
 *
 * **What this controller does NOT do** (future ships):
 *  - Cmd-Z / Cmd-Shift-Z for undo/redo (the CommandStack
 *    exposes the API; F-4 doesn't bind keys for it because the
 *    toolbar buttons exist and the dialog's modal context already
 *    captures those keystrokes for the host browser's "Find" /
 *    "Reload" patterns).
 *  - Arrow-key navigation between selected elements.
 *  - Cmd-D for duplicate.
 *  - Cmd-A for select-all (requires multi-select first).
 */
export class BpmnLiteKeyboardController {
    private readonly editor: BpmnLiteEditor;
    private readonly commands: CommandStack;
    private readonly viewport: Viewport | null;
    private readonly arrowPanStep: number;
    private readonly shiftArrowMultiplier: number;
    private readonly zoomStep: number;
    private readonly readOnly: boolean;
    private readonly doc: Document;
    private readonly onKeyDown: (ev: KeyboardEvent) => void;
    private disposed = false;

    constructor(options: BpmnLiteKeyboardControllerOptions) {
        this.editor = options.editor;
        this.commands = options.commands;
        this.viewport = options.viewport ?? null;
        this.arrowPanStep = options.arrowPanStep ?? 50;
        this.shiftArrowMultiplier = options.shiftArrowMultiplier ?? 5;
        this.zoomStep = Math.max(1.001, options.zoomStep ?? 1.25);
        this.readOnly = options.readOnly ?? false;
        this.doc =
            options.doc ??
            this.editor.canvasGroup.ownerSVGElement?.ownerDocument ??
            (typeof window !== 'undefined' ? window.document : (null as unknown as Document));
        this.onKeyDown = (ev: KeyboardEvent): void => this.handleKeyDown(ev);
        this.doc?.addEventListener('keydown', this.onKeyDown);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.doc?.removeEventListener('keydown', this.onKeyDown);
    }

    private handleKeyDown(ev: KeyboardEvent): void {
        if (this.disposed) return;
        if (isEditableTarget(ev.target)) return;

        // F-4 delete bindings — Delete / Backspace on selected
        // element/flow. Suppressed in read-only (F-5) mode so the
        // canvas behaves like a viewer the user can navigate but
        // not edit.
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
            if (this.readOnly) return;
            this.handleDelete(ev);
            return;
        }

        // F-5 navigation bindings (only if viewport was wired). All
        // these branches preventDefault so they don't steal browser
        // shortcuts the user didn't trigger.
        if (this.viewport === null) return;

        // Arrow-key pan. Step is `arrowPanStep` (default 50px),
        // multiplied by `shiftArrowMultiplier` when Shift is held.
        // Pan direction matches the user's intent: ArrowRight =
        // "show me content to the right" = camera moves right =
        // panX decreases.
        if (
            ev.key === 'ArrowLeft' ||
            ev.key === 'ArrowRight' ||
            ev.key === 'ArrowUp' ||
            ev.key === 'ArrowDown'
        ) {
            const step = ev.shiftKey
                ? this.arrowPanStep * this.shiftArrowMultiplier
                : this.arrowPanStep;
            let dx = 0;
            let dy = 0;
            switch (ev.key) {
                case 'ArrowLeft':
                    dx = step;
                    break;
                case 'ArrowRight':
                    dx = -step;
                    break;
                case 'ArrowUp':
                    dy = step;
                    break;
                case 'ArrowDown':
                    dy = -step;
                    break;
            }
            ev.preventDefault();
            this.viewport.panBy(dx, dy);
            return;
        }

        // Zoom hotkeys — matches the Figma / draw.io / VSCode
        // editor convention. '+' (with Shift) and '=' (without
        // Shift) both zoom in so the user doesn't need to think
        // about whether to press Shift. '0' resets to 100%.
        if (ev.key === '+' || ev.key === '=') {
            ev.preventDefault();
            this.viewport.zoomBy(this.zoomStep);
            return;
        }
        if (ev.key === '-' || ev.key === '_') {
            ev.preventDefault();
            this.viewport.zoomBy(1 / this.zoomStep);
            return;
        }
        if (ev.key === '0') {
            ev.preventDefault();
            this.viewport.setZoom(1);
            return;
        }
    }

    /** Extracted from handleKeyDown so the delete logic stays grouped. */
    private handleDelete(ev: KeyboardEvent): void {
        const sel = this.editor.selection.target;
        if (sel === null) return;

        if (sel.kind === 'flow') {
            const flow = this.editor.state.flows.find((f) => f.id === sel.id);
            if (flow === undefined) return;
            ev.preventDefault();
            this.commands.execute(new DeleteFlowCommand(this.editor, flow));
            this.editor.selection.clear();
            return;
        }
        if (sel.kind === 'element') {
            const element = this.editor.state.elements.find((e) => e.id === sel.id);
            if (element === undefined) return;
            ev.preventDefault();
            this.commands.execute(new DeleteElementCommand(this.editor, element));
            this.editor.selection.clear();
            return;
        }
    }
}

/**
 * Returns true if the keystroke originated from a form field where
 * the user is editing text. Lets `Delete` / `Backspace` reach the
 * input naturally instead of nuking the canvas selection.
 *
 * Exported for testability — DOM helpers like this are easier to
 * test in isolation than via a full keyboard-controller mount.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return true;
    }
    if (target instanceof HTMLSelectElement) return true;
    // contenteditable surfaces (Tiptap labels, future inline-edit support)
    const editable = target.getAttribute('contenteditable');
    if (editable === 'true' || editable === 'plaintext-only') return true;
    return false;
}
