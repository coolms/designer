import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    BpmnLitePropertyPanel,
    BpmnLiteSelectionController,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * BpmnLitePropertyPanel + BpmnLiteSelectionController tests.
 * These share fixtures so they live in one file -- the panel + the
 * controller form a single user-facing surface that's easier to
 * pin together.
 */
describe('BpmnLitePropertyPanel + SelectionController', () => {
    let host: HTMLElement;
    let panelHost: HTMLElement;
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

    function task(id: string, x: number, label?: string): BpmnElement {
        return {
            id,
            type: 'task',
            position: { x, y: 100 },
            size: { width: 100, height: 80 },
            ...(label !== undefined ? { label } : {}),
        };
    }

    /** Locate the painted `<g>` for an element id. */
    function elementGroup(id: string): SVGGElement {
        const root = editor.paintedRootElement!;
        for (const child of Array.from(root.children)) {
            if (child.getAttribute('data-element-id') === id) {
                return child as SVGGElement;
            }
        }
        throw new Error(`element ${id} not painted`);
    }

    function flowGroup(id: string): SVGGElement {
        const root = editor.paintedFlowsElement!;
        for (const child of Array.from(root.children)) {
            if (child.getAttribute('data-flow-id') === id) {
                return child as SVGGElement;
            }
        }
        throw new Error(`flow ${id} not painted`);
    }

    beforeEach(() => {
        host = document.createElement('div');
        panelHost = document.createElement('div');
        document.body.appendChild(host);
        document.body.appendChild(panelHost);
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
                elements: [task('a', 100, 'Task A'), task('b', 400)],
                flows: [{ id: 'f1', source: 'a', target: 'b' }],
            },
        });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        panelHost.remove();
        svg.remove();
    });

    /* ────────────────── Property panel lifecycle pins ────────────────── */

    it('mounts no fields when no selection', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });
        expect(panel.fieldKeys).toEqual([]);
        expect(panelHost.children).toHaveLength(0);
        panel.dispose();
    });

    it('mounts the element label field when an element is selected', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });

        editor.selection.select({ kind: 'element', id: 'a' });

        // task schema gained a `variant` SELECT after `label`.
        expect(panel.fieldKeys).toEqual(['label', 'variant']);
        const wrapper = panelHost.querySelector(
            '[data-field-key="label"]',
        ) as HTMLElement | null;
        expect(wrapper).not.toBeNull();
        const input = wrapper?.querySelector('input') as HTMLInputElement | null;
        expect(input?.value).toBe('Task A');

        panel.dispose();
    });

    it('mounts condition + isDefault fields when a flow is selected', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });

        editor.selection.select({ kind: 'flow', id: 'f1' });

        expect(panel.fieldKeys).toEqual(['condition', 'isDefault']);
        expect(panel.waypointDragController).not.toBeNull();

        panel.dispose();
    });

    it('rebuilds on selection change', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });

        editor.selection.select({ kind: 'element', id: 'a' });
        // task schema gained a `variant` SELECT after `label`.
        expect(panel.fieldKeys).toEqual(['label', 'variant']);

        editor.selection.select({ kind: 'flow', id: 'f1' });
        expect(panel.fieldKeys).toEqual(['condition', 'isDefault']);

        editor.selection.clear();
        expect(panel.fieldKeys).toEqual([]);

        panel.dispose();
    });

    it('disposes the waypoint controller when flow selection clears', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });

        editor.selection.select({ kind: 'flow', id: 'f1' });
        expect(panel.waypointDragController).not.toBeNull();

        editor.selection.select({ kind: 'element', id: 'a' });
        expect(panel.waypointDragController).toBeNull();

        panel.dispose();
    });

    it('field input dispatches an UpdateElementPropertyCommand through the stack', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'element', id: 'a' });

        const input = panelHost.querySelector(
            'input',
        ) as HTMLInputElement | null;
        expect(input).not.toBeNull();

        input!.value = 'New A';
        input!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(editor.findElement('a')?.label).toBe('New A');

        commands.undo();
        expect(editor.findElement('a')?.label).toBe('Task A');

        panel.dispose();
    });

    it('flow boolean toggle dispatches UpdateFlowPropertyCommand', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'flow', id: 'f1' });

        const wrapper = panelHost.querySelector(
            '[data-field-key="isDefault"]',
        );
        const checkbox = wrapper?.querySelector(
            'input[type="checkbox"]',
        ) as HTMLInputElement | null;
        expect(checkbox).not.toBeNull();

        checkbox!.checked = true;
        checkbox!.dispatchEvent(new Event('change', { bubbles: true }));

        expect(editor.findFlow('f1')?.isDefault).toBe(true);

        panel.dispose();
    });

    it('clears selection when the selected element is removed', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'element', id: 'a' });
        // task schema gained a `variant` SELECT after `label`.
        expect(panel.fieldKeys).toEqual(['label', 'variant']);

        editor.removeElement('a');

        expect(editor.selection.target).toBeNull();
        expect(panel.fieldKeys).toEqual([]);

        panel.dispose();
    });

    it('field setValue refreshes when an external command updates the property', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'element', id: 'a' });

        // Mutate via editor mutator (not panel) -- e.g. undo of a prior
        // command from another panel.
        editor.updateElementProperty('a', 'label', 'External');

        const input = panelHost.querySelector(
            'input',
        ) as HTMLInputElement | null;
        expect(input?.value).toBe('External');

        panel.dispose();
    });

    it('dispose tears down fields + waypoint controller + unsubscribes', () => {
        const panel = new BpmnLitePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'flow', id: 'f1' });
        expect(panelHost.children.length).toBeGreaterThan(0);

        panel.dispose();

        expect(panelHost.children).toHaveLength(0);
        // After dispose, further selection changes don't repopulate.
        editor.selection.select({ kind: 'element', id: 'a' });
        expect(panelHost.children).toHaveLength(0);
    });

    /* ─────────────── SelectionController canvas wiring pins ─────────────── */

    it('canvas click on element <g> selects that element', () => {
        const controller = new BpmnLiteSelectionController({ editor });
        const g = elementGroup('a');

        g.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
            }),
        );

        expect(editor.selection.target).toEqual({ kind: 'element', id: 'a' });

        controller.dispose();
    });

    it('canvas click on flow <g> selects that flow', () => {
        const controller = new BpmnLiteSelectionController({ editor });
        const g = flowGroup('f1');

        g.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
            }),
        );

        expect(editor.selection.target).toEqual({ kind: 'flow', id: 'f1' });

        controller.dispose();
    });

    it('canvas click on empty canvas clears selection', () => {
        const controller = new BpmnLiteSelectionController({ editor });
        editor.selection.select({ kind: 'element', id: 'a' });

        svg.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
            }),
        );

        expect(editor.selection.target).toBeNull();

        controller.dispose();
    });

    it('right-click does not change selection', () => {
        const controller = new BpmnLiteSelectionController({ editor });
        const g = elementGroup('a');

        g.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 2,
                clientX: 0,
                clientY: 0,
                bubbles: true,
            }),
        );

        expect(editor.selection.target).toBeNull();
        controller.dispose();
    });

    it('controller dispose detaches the listener', () => {
        const controller = new BpmnLiteSelectionController({ editor });
        controller.dispose();

        const g = elementGroup('a');
        g.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
            }),
        );

        expect(editor.selection.target).toBeNull();
    });

    /* ─────────── Selection-driven highlight in the editor pin ─────────── */

    it('selecting an element adds the selected modifier class', () => {
        editor.selection.select({ kind: 'element', id: 'a' });

        const g = elementGroup('a');
        expect(
            g.classList.contains('coolms-designer__bpmn-element--selected'),
        ).toBe(true);

        // Other elements are NOT marked.
        const gB = elementGroup('b');
        expect(
            gB.classList.contains('coolms-designer__bpmn-element--selected'),
        ).toBe(false);
    });

    it('clearing selection removes the highlight', () => {
        editor.selection.select({ kind: 'element', id: 'a' });
        editor.selection.clear();
        const g = elementGroup('a');
        expect(
            g.classList.contains('coolms-designer__bpmn-element--selected'),
        ).toBe(false);
    });

    it('selecting a flow highlights the flow group', () => {
        editor.selection.select({ kind: 'flow', id: 'f1' });
        const g = flowGroup('f1');
        expect(
            g.classList.contains('coolms-designer__bpmn-flow--selected'),
        ).toBe(true);
    });
});
