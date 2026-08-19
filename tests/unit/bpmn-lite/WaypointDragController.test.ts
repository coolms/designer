import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    SVG_NS,
    WaypointDragController,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement, BpmnPosition } from '../../../src/bpmn-lite/index.js';

/**
 * WaypointDragController tests. Pins:
 *   - handles paint at middle waypoints (excluding endpoints)
 *   - pointerdown on a handle captures drag state
 *   - pointermove updates the path's `d` + the handle position
 *     (transient repaint -- no editor state mutation, no change event)
 *   - pointerup dispatches UpdateFlowWaypointsCommand
 *   - dispose tears down handles + cancels in-flight drag
 *   - controller re-paints handles after the editor's `change` event
 */
describe('WaypointDragController', () => {
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
                elements: [task('a', 100), task('b', 400)],
                flows: [{ id: 'f1', source: 'a', target: 'b' }],
            },
        });
        stubCanvasRect(svg, { left: 0, top: 0, width: 1000, height: 600 });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        svg.remove();
    });

    it('paints handles at the middle waypoints (2 for auto-routed 4-waypoint Z)', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });

        expect(controller.handleElements).toHaveLength(2);
        for (const handle of controller.handleElements) {
            expect(
                handle.classList.contains(
                    'coolms-designer__bpmn-waypoint-handle',
                ),
            ).toBe(true);
        }

        controller.dispose();
    });

    it('handle positions match the resolved waypoint coords', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const wps = editor.resolveFlowWaypoints('f1')!;
        const middle = [wps[1]!, wps[2]!];

        for (let i = 0; i < controller.handleElements.length; i++) {
            const h = controller.handleElements[i]!;
            expect(parseFloat(h.getAttribute('cx') ?? '')).toBe(middle[i]!.x);
            expect(parseFloat(h.getAttribute('cy') ?? '')).toBe(middle[i]!.y);
        }

        controller.dispose();
    });

    it('does not paint handles when flow has fewer than 3 waypoints', () => {
        editor.updateFlowWaypoints('f1', [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });

        expect(controller.handleElements).toHaveLength(0);

        controller.dispose();
    });

    it('returns no handles when the flow id is unknown', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'does-not-exist',
        });

        expect(controller.handleElements).toHaveLength(0);

        controller.dispose();
    });

    it('pointerdown on a handle starts a drag', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });

        const handle = controller.handleElements[0]!;
        handle.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 250,
                clientY: 50,
                bubbles: true,
            }),
        );

        expect(controller.dragging).toBe(true);
        expect(controller.draggingIndex).toBe(1);

        controller.dispose();
    });

    it('pointermove updates the path `d` and handle position without firing change', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const handle = controller.handleElements[0]!;

        const startD = editor
            .paintedFlowsElement
            ?.querySelector('.coolms-designer__bpmn-flow-path')
            ?.getAttribute('d');

        let changeFired = 0;
        editor.onChange(() => changeFired++);

        handle.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 250,
                clientY: 50,
                bubbles: true,
            }),
        );
        document.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX: 280,
                clientY: 30,
                bubbles: true,
            }),
        );

        // Path `d` was rewritten.
        const movedD = editor
            .paintedFlowsElement
            ?.querySelector('.coolms-designer__bpmn-flow-path')
            ?.getAttribute('d');
        expect(movedD).not.toBe(startD);

        // Handle position was updated.
        expect(parseFloat(handle.getAttribute('cx') ?? '')).toBe(280);
        expect(parseFloat(handle.getAttribute('cy') ?? '')).toBe(30);

        // No editor mutation = no change event during the drag.
        expect(changeFired).toBe(0);

        controller.dispose();
    });

    it('pointerup dispatches UpdateFlowWaypointsCommand with the moved waypoint', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const handle = controller.handleElements[0]!;
        const wpsBefore = editor.resolveFlowWaypoints('f1')!;

        handle.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 250,
                clientY: 50,
                bubbles: true,
            }),
        );
        document.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX: 280,
                clientY: 30,
                bubbles: true,
            }),
        );
        document.dispatchEvent(
            new PointerEvent('pointerup', {
                clientX: 280,
                clientY: 30,
                bubbles: true,
            }),
        );

        expect(controller.dragging).toBe(false);

        const flow = editor.findFlow('f1')!;
        expect(flow.waypoints).toBeDefined();
        const wps = flow.waypoints!;
        // Waypoint at index 1 was moved to (280, 30); others verbatim.
        expect(wps[0]).toEqual(wpsBefore[0]);
        expect(wps[1]).toEqual({ x: 280, y: 30 });
        expect(wps[2]).toEqual(wpsBefore[2]);
        expect(wps[3]).toEqual(wpsBefore[3]);

        // Undo restores the auto-route (no waypoints slot).
        commands.undo();
        expect(editor.findFlow('f1')?.waypoints).toBeUndefined();

        controller.dispose();
    });

    it('right-button pointerdown on a handle does not start a drag', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const handle = controller.handleElements[0]!;

        handle.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 2,
                clientX: 250,
                clientY: 50,
                bubbles: true,
            }),
        );

        expect(controller.dragging).toBe(false);

        controller.dispose();
    });

    it('dispose removes handles and is idempotent', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const flowsRoot = editor.paintedFlowsElement!;
        const handleCountBefore = flowsRoot.querySelectorAll(
            '.coolms-designer__bpmn-waypoint-handle',
        ).length;
        expect(handleCountBefore).toBeGreaterThan(0);

        controller.dispose();

        expect(
            flowsRoot.querySelectorAll(
                '.coolms-designer__bpmn-waypoint-handle',
            ).length,
        ).toBe(0);
        expect(() => controller.dispose()).not.toThrow();
    });

    it('dispose mid-drag cancels the drag', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const handle = controller.handleElements[0]!;
        handle.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 250,
                clientY: 50,
                bubbles: true,
            }),
        );
        expect(controller.dragging).toBe(true);

        controller.dispose();
        expect(controller.dragging).toBe(false);

        // Subsequent document-level pointermove shouldn't repaint anything
        // because the controller's listeners were removed.
        expect(() =>
            document.dispatchEvent(
                new PointerEvent('pointermove', {
                    clientX: 300,
                    clientY: 100,
                    bubbles: true,
                }),
            ),
        ).not.toThrow();
    });

    it('handles re-paint after the editor emits change (e.g. another command runs)', () => {
        const controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        const handlesBefore = controller.handleElements;
        expect(handlesBefore.length).toBe(2);

        // Run an unrelated editor mutation that emits change.
        editor.addElement({
            id: 'c',
            type: 'task',
            position: { x: 700, y: 100 },
            size: { width: 100, height: 80 },
        });

        // The handles are torn down + re-painted in onChange.
        const handlesAfter = controller.handleElements;
        expect(handlesAfter.length).toBe(2);
        // They're new elements, not the same SVG references.
        expect(handlesAfter[0]).not.toBe(handlesBefore[0]);

        controller.dispose();
    });

    it('subsequent reroute drags use the updated waypoint chain as the baseline', () => {
        // First drag: move waypoint 1 from auto-route position to (280, 30).
        let controller = new WaypointDragController({
            editor,
            flowId: 'f1',
        });
        let handle = controller.handleElements[0]!;
        handle.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 250,
                clientY: 50,
                bubbles: true,
            }),
        );
        document.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX: 280,
                clientY: 30,
                bubbles: true,
            }),
        );
        document.dispatchEvent(
            new PointerEvent('pointerup', {
                clientX: 280,
                clientY: 30,
                bubbles: true,
            }),
        );

        const after1 = editor.findFlow('f1')!.waypoints!;
        expect(after1[1]).toEqual({ x: 280, y: 30 });
        controller.dispose();

        // Second drag from a fresh controller now uses the manual chain.
        controller = new WaypointDragController({ editor, flowId: 'f1' });
        handle = controller.handleElements[0]!;
        // Handle should sit at the updated (280, 30) position.
        expect(parseFloat(handle.getAttribute('cx') ?? '')).toBe(280);
        expect(parseFloat(handle.getAttribute('cy') ?? '')).toBe(30);

        controller.dispose();
    });
});
