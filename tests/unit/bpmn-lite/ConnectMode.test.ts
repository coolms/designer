import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    ConnectMode,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * ConnectMode tests. Pins:
 *   - enter/exit/active lifecycle
 *   - successful drag from element A to element B creates a flow
 *   - release on empty canvas cancels without adding
 *   - release on the source arms it for a click-then-click connection
 *   - click source then click target creates the flow (the gesture the
 *     host's action-footer hint actually advertises)
 *   - rubber-band is painted in the flows group while dragging
 *   - dispose tears down state cleanly
 *
 * **jsdom note**: like Palette tests, we stub `getBoundingClientRect`
 * on the SVG so the editor's hit-test sees the cursor inside.
 */
describe('ConnectMode', () => {
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

    it('starts inactive; enter() flips active to true', () => {
        const mode = new ConnectMode({ editor });
        expect(mode.active).toBe(false);
        mode.enter();
        expect(mode.active).toBe(true);
        mode.exit();
    });

    it('enter() adds the connect-mode CSS class to the canvas SVG', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        expect(svg.classList.contains('coolms-designer__bpmn-connect-mode')).toBe(
            true,
        );
        mode.exit();
        expect(svg.classList.contains('coolms-designer__bpmn-connect-mode')).toBe(
            false,
        );
    });

    it('enter() is idempotent', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        mode.enter();
        expect(mode.active).toBe(true);
        mode.exit();
    });

    it('exit() while not active is a no-op', () => {
        const mode = new ConnectMode({ editor });
        expect(() => mode.exit()).not.toThrow();
        expect(mode.active).toBe(false);
    });

    it('pointerdown on an element starts a rubber-band drag', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150, // inside element a (100, 100, 100x80)
                clientY: 140,
                bubbles: true,
            }),
        );

        expect(mode.connectingFromId).toBe('a');
        expect(mode.rubberbandElement).not.toBeNull();
        // Rubber-band lives inside the flows group.
        expect(mode.rubberbandElement?.parentNode).toBe(
            editor.paintedFlowsElement,
        );

        mode.dispose();
    });

    it('pointerdown on empty canvas is ignored', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();

        svg.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 900,
                clientY: 500,
                bubbles: true,
            }),
        );

        expect(mode.connectingFromId).toBeNull();
        expect(mode.rubberbandElement).toBeNull();

        mode.dispose();
    });

    it('pointermove updates the rubber-band endpoint', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
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

        const band = mode.rubberbandElement!;
        expect(band.getAttribute('x2')).toBe('300');
        expect(band.getAttribute('y2')).toBe('200');

        mode.dispose();
    });

    it('pointerup on a different element dispatches AddFlowCommand', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );

        const gB = elementGroup('b');
        gB.dispatchEvent(
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

        // Rubber-band gone; drag state cleared.
        expect(mode.rubberbandElement).toBeNull();
        expect(mode.connectingFromId).toBeNull();
        // Mode stays active (chain-mode UX).
        expect(mode.active).toBe(true);

        // Command stack picked it up -- undo reverses.
        commands.undo();
        expect(editor.state.flows).toHaveLength(0);

        mode.dispose();
    });

    it('pointerup on empty canvas silently cancels the drag', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
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
        expect(mode.rubberbandElement).toBeNull();
        expect(mode.connectingFromId).toBeNull();
        // Mode stays active -- chain mode.
        expect(mode.active).toBe(true);

        mode.dispose();
    });

    /**
     * CLICK-THEN-CLICK. The action-footer hint the host renders while
     * this mode is active reads "Click a source element, then a target
     * to connect." -- and the sibling DMN DRD editor really is
     * click-then-click. Before this, a click (press + release on ONE
     * element) hit the "self-loop, silently cancel" path, so an author
     * following the on-screen instruction could never connect anything.
     */
    describe('click-then-click gesture (matches the on-screen hint)', () => {
        function clickElement(id: string, x: number, y: number): void {
            const g = elementGroup(id);
            g.dispatchEvent(
                new PointerEvent('pointerdown', {
                    button: 0,
                    clientX: x,
                    clientY: y,
                    bubbles: true,
                }),
            );
            g.dispatchEvent(
                new PointerEvent('pointerup', {
                    button: 0,
                    clientX: x,
                    clientY: y,
                    bubbles: true,
                }),
            );
        }

        it('click source then click target creates the flow', () => {
            const mode = new ConnectMode({ editor });
            mode.enter();

            clickElement('a', 150, 140);
            // Armed, but nothing connected yet.
            expect(mode.pendingFromId).toBe('a');
            expect(editor.state.flows).toHaveLength(0);

            clickElement('b', 450, 140);
            expect(editor.state.flows).toHaveLength(1);
            expect(editor.state.flows[0]).toMatchObject({
                source: 'a',
                target: 'b',
            });
            // Disarmed after completing.
            expect(mode.pendingFromId).toBeNull();

            mode.dispose();
        });

        it('clicking the armed element again disarms it', () => {
            const mode = new ConnectMode({ editor });
            mode.enter();

            clickElement('a', 150, 140);
            expect(mode.pendingFromId).toBe('a');
            clickElement('a', 150, 140);
            expect(mode.pendingFromId).toBeNull();
            expect(editor.state.flows).toHaveLength(0);

            mode.dispose();
        });

        it('chains: after connecting, a new click arms a fresh source', () => {
            const mode = new ConnectMode({ editor });
            mode.enter();

            clickElement('a', 150, 140);
            clickElement('b', 450, 140);
            clickElement('b', 450, 140);
            expect(mode.pendingFromId).toBe('b');
            clickElement('c', 750, 140);

            expect(editor.state.flows).toHaveLength(2);
            expect(editor.state.flows[1]).toMatchObject({
                source: 'b',
                target: 'c',
            });

            mode.dispose();
        });

        it('exit() clears an armed source', () => {
            const mode = new ConnectMode({ editor });
            mode.enter();
            clickElement('a', 150, 140);
            expect(mode.pendingFromId).toBe('a');

            mode.exit();
            expect(mode.pendingFromId).toBeNull();

            // Re-entering must not resume the stale arm.
            mode.enter();
            clickElement('b', 450, 140);
            expect(mode.pendingFromId).toBe('b');
            expect(editor.state.flows).toHaveLength(0);

            mode.dispose();
        });

        it('drag A→B still works alongside the click gesture', () => {
            const mode = new ConnectMode({ editor });
            mode.enter();
            const gA = elementGroup('a');
            const gB = elementGroup('b');

            gA.dispatchEvent(
                new PointerEvent('pointerdown', {
                    button: 0,
                    clientX: 150,
                    clientY: 140,
                    bubbles: true,
                }),
            );
            gB.dispatchEvent(
                new PointerEvent('pointerup', {
                    button: 0,
                    clientX: 450,
                    clientY: 140,
                    bubbles: true,
                }),
            );

            expect(editor.state.flows).toHaveLength(1);
            // A completed drag must not leave a source armed.
            expect(mode.pendingFromId).toBeNull();

            mode.dispose();
        });
    });

    // Releasing on the source no longer creates a self-loop NOR silently
    // throws the gesture away -- it now ARMS that element as the source
    // for a following target click. Still no flow at this point, which is
    // what this case pins.
    it('release on the source element adds no flow (it arms instead)', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );
        gA.dispatchEvent(
            new PointerEvent('pointerup', {
                button: 0,
                clientX: 160,
                clientY: 150,
                bubbles: true,
            }),
        );

        expect(editor.state.flows).toHaveLength(0);
        expect(mode.rubberbandElement).toBeNull();

        mode.dispose();
    });

    it('right-button pointerdown does not start a drag', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 2,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );

        expect(mode.connectingFromId).toBeNull();
        expect(mode.rubberbandElement).toBeNull();

        mode.dispose();
    });

    it('a second pointerdown while a drag is in flight is ignored', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');
        const gB = elementGroup('b');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );
        const firstRubber = mode.rubberbandElement;
        expect(firstRubber).not.toBeNull();

        gB.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 450,
                clientY: 140,
                bubbles: true,
            }),
        );

        // Still dragging from a, with the same rubber-band.
        expect(mode.connectingFromId).toBe('a');
        expect(mode.rubberbandElement).toBe(firstRubber);

        mode.dispose();
    });

    it('exit() during in-flight drag clears the rubber-band', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        const gA = elementGroup('a');

        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );
        expect(mode.rubberbandElement).not.toBeNull();

        mode.exit();

        expect(mode.active).toBe(false);
        expect(mode.rubberbandElement).toBeNull();
        expect(mode.connectingFromId).toBeNull();
    });

    it('dispose is idempotent + after dispose, enter() is a no-op', () => {
        const mode = new ConnectMode({ editor });
        mode.dispose();
        expect(() => mode.dispose()).not.toThrow();
        mode.enter();
        expect(mode.active).toBe(false);
    });

    it('pointerdown after exit() is not handled', () => {
        const mode = new ConnectMode({ editor });
        mode.enter();
        mode.exit();

        const gA = elementGroup('a');
        gA.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 150,
                clientY: 140,
                bubbles: true,
            }),
        );

        expect(mode.connectingFromId).toBeNull();
        expect(editor.state.flows).toHaveLength(0);
    });
});
