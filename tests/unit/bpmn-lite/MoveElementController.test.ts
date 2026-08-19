import { beforeEach, describe, expect, it } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import { BpmnLiteEditor } from '../../../src/bpmn-lite/BpmnLiteEditor.js';
import { MoveElementController } from '../../../src/bpmn-lite/MoveElementController.js';
import type { BpmnLiteModel } from '../../../src/bpmn-lite/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * F-7.6 take-2 regression test — pins the position-transform-strip bug
 * surfaced by the user after F-7.4 (auto-fit on open) shipped.
 *
 * The bug: a real click on an element typically lasts 150–250ms with
 * 5–10px of trackpad/mouse drift, which crossed both the 5px screen-
 * pixel arm threshold AND the 120ms hold gate, ARMING the drag. The
 * armed-frame returned without writing a transform (so workingPosition
 * stayed at startPosition), and pointerup then took the no-op-move
 * branch (finalPosition === startPosition → skip command dispatch). BUT
 * the pre-take-2 cancelDrag() did `removeAttribute('transform')`, which
 * left the element `<g>` with NO transform. Without a follow-up repaint
 * (no command = no repaint), the renderer's `translate(position.x,
 * position.y)` was gone, so SVG painted the element at world (0,0).
 * Identity zoom+pan made (0,0) off-screen so the bug was invisible
 * pre-F-7.4; the auto-fit zoom moved (0,0) into the visible viewport,
 * exposing the teleport.
 *
 * The fix: cancelDrag now WRITES the position transform back instead
 * of stripping it, so the element snaps to its pre-drag position on
 * any cancel path (armed-no-op, Escape, dispose).
 */
describe('MoveElementController — F-7.6 take-2 cancelDrag transform restore', () => {
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let host: HTMLDivElement;
    let editor: BpmnLiteEditor;
    let controller: MoveElementController;

    /**
     * Build a model with one task at (100, 200) so we can pin the
     * exact transform string the controller should write back on
     * cancel. Geometry sizing matches the task default.
     */
    const initialModel: BpmnLiteModel = {
        processId: 'test',
        elements: [
            {
                id: 'task_1',
                type: 'task',
                position: { x: 100, y: 200 },
                size: { width: 100, height: 80 },
                label: 'Task 1',
            },
        ],
        flows: [],
    };

    beforeEach(() => {
        host = document.createElement('div');
        svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);
        document.body.appendChild(host);

        editor = new BpmnLiteEditor({
            host,
            commands: new CommandStack(),
            svgGroup,
            initialModel,
        });
        controller = new MoveElementController({ editor });
    });

    function fireEv(
        target: Element | Document,
        type: string,
        opts: { clientX: number; clientY: number; pointerId?: number; button?: number; timeStamp?: number },
    ): PointerEvent {
        const ev = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: opts.pointerId ?? 1,
            button: opts.button ?? 0,
            clientX: opts.clientX,
            clientY: opts.clientY,
        });
        // PointerEvent's timeStamp is read-only — override via
        // Object.defineProperty so the controller's time-gate sees the
        // values we want. The browser-side test environment uses a
        // synthetic JSDOM-shimmed event so defineProperty works.
        if (opts.timeStamp !== undefined) {
            Object.defineProperty(ev, 'timeStamp', {
                value: opts.timeStamp,
                configurable: true,
            });
        }
        target.dispatchEvent(ev);
        return ev;
    }

    it('armed-then-released-with-no-motion restores the position transform', () => {
        // Find the rendered <g> for task_1 — the editor's repaint
        // already minted it in the constructor.
        const elementG = svgGroup.querySelector<SVGGElement>(
            '[data-element-id="task_1"]',
        );
        expect(elementG).not.toBeNull();
        const initialTransform = elementG!.getAttribute('transform');
        // The renderer writes "translate(100, 200)" — exact format
        // varies by string template (with/without space), so just
        // pin the numeric content.
        expect(initialTransform).toMatch(/translate\(\s*100\s*,\s*200\s*\)/);

        // 1) Pointerdown on the element. Dispatch on the element `<g>`
        // (not the SVG root) so `ev.target.closest('[data-element-id]')`
        // resolves in JSDOM — the controller's pointerdown handler is
        // attached at the SVG root but the event bubbles up, so
        // ev.target stays as the element we dispatched to.
        fireEv(elementG!, 'pointerdown', {
            clientX: 150,
            clientY: 240,
            timeStamp: 1000,
        });

        // 2) Tiny mouse drift past BOTH gates (5px + 120ms) — typical
        // for a casual click on a trackpad. This ARMS the drag.
        fireEv(document, 'pointermove', {
            clientX: 158,
            clientY: 245,
            timeStamp: 1150,
        });
        expect(controller.dragging).toBe(true);

        // 3) Pointerup with no further motion. finalPosition ===
        // startPosition → no-op-move branch → no command dispatched
        // → no repaint. BEFORE the take-2 fix, the cancelDrag would
        // have stripped the transform here.
        fireEv(document, 'pointerup', {
            clientX: 158,
            clientY: 245,
            timeStamp: 1200,
        });

        // The drag has ended.
        expect(controller.dragging).toBe(false);

        // CRITICAL: the element's `<g>` must still carry the
        // canonical position transform. Pre-fix: this was missing
        // and the element rendered at world (0,0).
        const finalTransform = elementG!.getAttribute('transform');
        expect(finalTransform).not.toBeNull();
        expect(finalTransform).toMatch(/translate\(\s*100\s*,?\s*200\s*\)/);
    });

    it('click without arming (under threshold) keeps the position transform intact', () => {
        const elementG = svgGroup.querySelector<SVGGElement>(
            '[data-element-id="task_1"]',
        );
        const initialTransform = elementG!.getAttribute('transform');

        // Pointerdown + immediate pointerup with NO motion → drag
        // never arms. This was always safe (no transform write), but
        // pin it so a future refactor can't accidentally introduce a
        // strip on the un-armed cancel path.
        fireEv(elementG!, 'pointerdown', {
            clientX: 150,
            clientY: 240,
            timeStamp: 1000,
        });
        fireEv(document, 'pointerup', {
            clientX: 150,
            clientY: 240,
            timeStamp: 1050,
        });

        expect(controller.dragging).toBe(false);
        // The element's pre-drag position is preserved. cancelDrag()
        // always WRITES the canonical transform back (no-space style
        // `translate(100,200)`) where the renderer's first paint used
        // a with-space style (`translate(100, 200)`); SVG parses both
        // identically, so compare numeric content not byte equality.
        // Both before initialTransform and the post-cancel transform
        // must encode the same (100, 200) world coords.
        expect(initialTransform).toMatch(/translate\(\s*100\s*,\s*200\s*\)/);
        expect(elementG!.getAttribute('transform')).toMatch(
            /translate\(\s*100\s*,?\s*200\s*\)/,
        );
    });

    it('real drag past arming + actual displacement dispatches a command + repaints', () => {
        const elementG = svgGroup.querySelector<SVGGElement>(
            '[data-element-id="task_1"]',
        );
        expect(elementG).not.toBeNull();

        fireEv(elementG!, 'pointerdown', {
            clientX: 150,
            clientY: 240,
            timeStamp: 1000,
        });
        // Arming frame.
        fireEv(document, 'pointermove', {
            clientX: 158,
            clientY: 245,
            timeStamp: 1150,
        });
        // Real drag motion AFTER arming — moves the element by 50px in screen px.
        // At identity zoom (1.0) this is 50 world px.
        fireEv(document, 'pointermove', {
            clientX: 208,
            clientY: 295,
            timeStamp: 1200,
        });
        fireEv(document, 'pointerup', {
            clientX: 208,
            clientY: 295,
            timeStamp: 1250,
        });

        // After pointerup, the command is executed → repaint → new
        // `<g>` minted with the new position transform. Look up the
        // element by id again (the old reference is stale post-repaint).
        const movedG = svgGroup.querySelector<SVGGElement>(
            '[data-element-id="task_1"]',
        );
        expect(movedG).not.toBeNull();
        // 100 + 50 = 150 in x; 200 + 50 = 250 in y.
        expect(movedG!.getAttribute('transform')).toMatch(
            /translate\(\s*150\s*,?\s*250\s*\)/,
        );
        // And the model is updated.
        expect(editor.findElement('task_1')!.position).toEqual({ x: 150, y: 250 });
    });
});
