import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    ConnectHandleController,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * ConnectHandleController tests -- the Camunda-style hover connect
 * handle. Pins:
 *   - handle hidden until the pointer hovers an element
 *   - handle sits at the element's right-edge midpoint + tracks moves
 *   - grabbing the handle + dragging to a target dispatches AddFlowCommand
 *   - release on empty canvas / the source (self-loop) adds nothing
 *   - suppression gate hides the handle + blocks the grab
 *   - pointer over the handle itself keeps it shown (grabbable)
 *   - dispose tears down cleanly
 *
 * **jsdom note**: like the ConnectMode + Palette suites, we stub
 * `getBoundingClientRect` on the SVG so the editor's client→world
 * hit-test sees the cursor inside the canvas.
 */
describe('ConnectHandleController', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;
    let svg: SVGSVGElement;
    let commands: CommandStack;
    let editor: BpmnLiteEditor;

    function makeSvgGroup(): { svg: SVGSVGElement; g: SVGGElement } {
        const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return { svg, g };
    }

    function stubCanvasRect(
        svg: SVGSVGElement,
        rect: { left: number; top: number; width: number; height: number },
    ): void {
        svg.getBoundingClientRect = (): DOMRect => ({
            left: rect.left,
            top: rect.top,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            width: rect.width,
            height: rect.height,
            x: rect.left,
            y: rect.top,
            toJSON(): unknown {
                return this;
            },
        });
    }

    function task(id: string, x: number, y = 100): BpmnElement {
        return {
            id,
            type: 'task',
            position: { x, y },
            size: { width: 100, height: 80 },
        };
    }

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const made = makeSvgGroup();
        svg = made.svg;
        svgGroup = made.g;
        commands = new CommandStack();
        editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400), task('c', 700)],
                flows: [],
            },
        });
        stubCanvasRect(svg, { left: 0, top: 0, width: 1000, height: 600 });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        svg.remove();
    });

    /** Find the rendered `<g>` for an element id within the elements group. */
    function elementGroup(elementId: string): SVGGElement {
        const root = editor.paintedRootElement!;
        for (const child of Array.from(root.children)) {
            if (child.getAttribute('data-element-id') === elementId) {
                return child as SVGGElement;
            }
        }
        throw new Error(`element ${elementId} not painted`);
    }

    /** Dispatch a bubbling pointermove whose target is `target`. */
    function hover(target: Element, clientX: number, clientY: number): void {
        target.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX,
                clientY,
                bubbles: true,
            }),
        );
    }

    it('the handle starts hidden + mounted in the canvas group', () => {
        const c = new ConnectHandleController({ editor });
        expect(c.handleVisible).toBe(false);
        expect(c.handleElement.parentNode).toBe(editor.canvasGroup);
        c.dispose();
    });

    it('hovering an element shows the handle at its right-edge midpoint', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140); // inside task a (100,100,100x80)

        expect(c.handleVisible).toBe(true);
        expect(c.attachedElementId).toBe('a');
        // right edge x = 100 + 100 = 200; mid y = 100 + 80/2 = 140.
        expect(c.handleElement.getAttribute('transform')).toBe(
            'translate(200, 140)',
        );
        c.dispose();
    });

    it('hovering empty canvas hides the handle', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        expect(c.handleVisible).toBe(true);

        hover(svg, 900, 500); // empty region
        expect(c.handleVisible).toBe(false);
        expect(c.attachedElementId).toBeNull();
        c.dispose();
    });

    it('hovering the handle itself keeps it shown (so it stays grabbable)', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        expect(c.handleVisible).toBe(true);

        // Pointer sweeps onto the handle -> must NOT hide it.
        hover(c.handleElement, 205, 140);
        expect(c.handleVisible).toBe(true);
        expect(c.attachedElementId).toBe('a');
        c.dispose();
    });

    it('the handle re-positions when its host element moves', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        expect(c.handleElement.getAttribute('transform')).toBe(
            'translate(200, 140)',
        );

        editor.updateElementPosition('a', { x: 300, y: 100 });
        // right edge x = 300 + 100 = 400; mid y still 140.
        expect(c.handleVisible).toBe(true);
        expect(c.handleElement.getAttribute('transform')).toBe(
            'translate(400, 140)',
        );
        c.dispose();
    });

    it('grabbing the handle starts a rubber-band from the source center', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);

        c.handleElement.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 205,
                clientY: 140,
                bubbles: true,
            }),
        );

        expect(c.connectingFromId).toBe('a');
        const band = c.rubberbandElement;
        expect(band).not.toBeNull();
        expect(band?.parentNode).toBe(editor.paintedFlowsElement);
        // Source center of task a = (150, 140).
        expect(band?.getAttribute('x1')).toBe('150');
        expect(band?.getAttribute('y1')).toBe('140');
        // Handle hides for the duration of the drag.
        expect(c.handleVisible).toBe(false);
        c.dispose();
    });

    it('dragging the handle to another element dispatches AddFlowCommand', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);

        c.handleElement.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 205,
                clientY: 140,
                bubbles: true,
            }),
        );
        document.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX: 300,
                clientY: 200,
                bubbles: true,
            }),
        );
        const band = c.rubberbandElement!;
        expect(band.getAttribute('x2')).toBe('300');
        expect(band.getAttribute('y2')).toBe('200');

        elementGroup('b').dispatchEvent(
            new PointerEvent('pointerup', {
                button: 0,
                clientX: 450,
                clientY: 140,
                bubbles: true,
            }),
        );

        expect(editor.state.flows).toHaveLength(1);
        const created = editor.state.flows[0]!;
        expect(created.source).toBe('a');
        expect(created.target).toBe('b');
        expect(created.id).toBe('flow_1');
        expect(c.rubberbandElement).toBeNull();
        expect(c.connectingFromId).toBeNull();

        // Undoable via the shared command stack.
        commands.undo();
        expect(editor.state.flows).toHaveLength(0);
        c.dispose();
    });

    it('release on empty canvas adds no flow', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        c.handleElement.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 205,
                clientY: 140,
                bubbles: true,
            }),
        );
        svg.dispatchEvent(
            new PointerEvent('pointerup', {
                button: 0,
                clientX: 900,
                clientY: 500,
                bubbles: true,
            }),
        );
        expect(editor.state.flows).toHaveLength(0);
        expect(c.rubberbandElement).toBeNull();
        c.dispose();
    });

    it('release on the source element (self-loop) adds no flow', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        c.handleElement.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 205,
                clientY: 140,
                bubbles: true,
            }),
        );
        elementGroup('a').dispatchEvent(
            new PointerEvent('pointerup', {
                button: 0,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );
        expect(editor.state.flows).toHaveLength(0);
        c.dispose();
    });

    it('right-button grab does not start a drag', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        c.handleElement.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 2,
                clientX: 205,
                clientY: 140,
                bubbles: true,
            }),
        );
        expect(c.connectingFromId).toBeNull();
        expect(c.rubberbandElement).toBeNull();
        c.dispose();
    });

    it('the suppression gate hides the handle + blocks the grab', () => {
        let suppressed = true;
        const c = new ConnectHandleController({
            editor,
            isSuppressed: () => suppressed,
        });

        hover(elementGroup('a'), 150, 140);
        expect(c.handleVisible).toBe(false); // suppressed -> never shows

        suppressed = false;
        hover(elementGroup('a'), 150, 140);
        expect(c.handleVisible).toBe(true);

        // Re-suppress mid-hover, then attempt a grab -> no drag.
        suppressed = true;
        c.handleElement.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 205,
                clientY: 140,
                bubbles: true,
            }),
        );
        expect(c.connectingFromId).toBeNull();
        c.dispose();
    });

    it('dispose removes the handle + is idempotent + inert afterwards', () => {
        const c = new ConnectHandleController({ editor });
        hover(elementGroup('a'), 150, 140);
        expect(c.handleVisible).toBe(true);

        c.dispose();
        expect(c.handleElement.parentNode).toBeNull();
        expect(() => c.dispose()).not.toThrow();

        // A late pointermove after dispose must not throw or re-mount.
        expect(() => hover(elementGroup('a'), 150, 140)).not.toThrow();
        expect(c.handleElement.parentNode).toBeNull();
    });
});
