import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import { Viewport } from '../../../src/canvas/Viewport.js';
import {
    BpmnLiteEditor,
    BpmnLiteKeyboardController,
    SVG_NS,
    isEditableTarget,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/types.js';

describe('BpmnLiteKeyboardController (M3.3.m F-4)', () => {
    let editor: BpmnLiteEditor;
    let stack: CommandStack;
    let host: HTMLElement;
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let controller: BpmnLiteKeyboardController;

    const mkEl = (id: string, type: BpmnElement['type'] = 'task'): BpmnElement => ({
        id,
        type,
        label: id,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 80 },
        extras: {},
    });

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svgGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(svgGroup);
        host.appendChild(svg);
        stack = new CommandStack();
        editor = new BpmnLiteEditor({ host, commands: stack, svgGroup });
        editor.load({
            processId: 'p',
            processExtras: {},
            elements: [mkEl('task_1'), mkEl('task_2')],
            flows: [],
        });
        controller = new BpmnLiteKeyboardController({
            editor,
            commands: stack,
            doc: document,
        });
    });

    afterEach(() => {
        controller.dispose();
        host.remove();
    });

    it('Delete on selected element dispatches DeleteElementCommand', () => {
        editor.selection.select({ kind: 'element', id: 'task_1' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeUndefined();
        expect(editor.state.elements).toHaveLength(1);
        // Stack carries the executed command + can be undone.
        expect(stack.canUndo).toBe(true);
    });

    it('Backspace works the same as Delete', () => {
        editor.selection.select({ kind: 'element', id: 'task_1' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeUndefined();
    });

    it('Delete with no selection is a no-op', () => {
        expect(editor.selection.target).toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(editor.state.elements).toHaveLength(2);
        expect(stack.canUndo).toBe(false);
    });

    it('Delete clears selection after dispatching', () => {
        editor.selection.select({ kind: 'element', id: 'task_1' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(editor.selection.target).toBeNull();
    });

    it('Delete from inside an <input> is ignored', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        editor.selection.select({ kind: 'element', id: 'task_1' });
        // The keyboard event must be dispatched ON the input element so
        // event.target reads correctly. We bubble through the document.
        const ev = new KeyboardEvent('keydown', {
            key: 'Delete',
            bubbles: true,
            cancelable: true,
        });
        input.focus();
        input.dispatchEvent(ev);
        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeDefined();
        input.remove();
    });

    it('Other keys are ignored entirely', () => {
        editor.selection.select({ kind: 'element', id: 'task_1' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeDefined();
    });

    it('dispose() detaches the listener', () => {
        controller.dispose();
        editor.selection.select({ kind: 'element', id: 'task_1' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeDefined();
    });
});

describe('BpmnLiteKeyboardController F-5 navigation', () => {
    let editor: BpmnLiteEditor;
    let stack: CommandStack;
    let viewport: Viewport;
    let host: HTMLElement;
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let controller: BpmnLiteKeyboardController;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svgGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(svgGroup);
        host.appendChild(svg);
        stack = new CommandStack();
        viewport = new Viewport(svgGroup);
        editor = new BpmnLiteEditor({ host, commands: stack, svgGroup });
        controller = new BpmnLiteKeyboardController({
            editor,
            commands: stack,
            viewport,
            doc: document,
            // small fixed steps to keep arithmetic deterministic
            arrowPanStep: 50,
            shiftArrowMultiplier: 5,
            zoomStep: 2,
        });
    });

    afterEach(() => {
        controller.dispose();
        host.remove();
    });

    it('ArrowRight pans the camera right (panX decreases by step)', () => {
        const before = viewport.state.panX;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(viewport.state.panX).toBe(before - 50);
    });

    it('ArrowLeft pans the camera left (panX increases by step)', () => {
        const before = viewport.state.panX;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        expect(viewport.state.panX).toBe(before + 50);
    });

    it('ArrowDown / ArrowUp pan vertically', () => {
        const before = viewport.state.panY;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(viewport.state.panY).toBe(before - 50);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
        expect(viewport.state.panY).toBe(before);
    });

    it('Shift+arrow pans by step × multiplier (default 5)', () => {
        const before = viewport.state.panX;
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }),
        );
        expect(viewport.state.panX).toBe(before - 250);
    });

    it('"=" and "+" both zoom in', () => {
        const baseZoom = viewport.state.zoom;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
        expect(viewport.state.zoom).toBeCloseTo(baseZoom * 2);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
        expect(viewport.state.zoom).toBeCloseTo(baseZoom * 4);
    });

    it('"-" zooms out', () => {
        viewport.setZoom(2);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
        expect(viewport.state.zoom).toBeCloseTo(1);
    });

    it('"0" resets zoom to 100%', () => {
        viewport.setZoom(3);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
        expect(viewport.state.zoom).toBe(1);
    });

    it('navigation keys are ignored when target is editable', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        const before = viewport.state.panX;
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
        expect(viewport.state.panX).toBe(before);
        input.remove();
    });

    it('without viewport: navigation keys are no-ops', () => {
        controller.dispose();
        const noNavController = new BpmnLiteKeyboardController({
            editor,
            commands: stack,
            doc: document,
            // viewport omitted
        });
        // No throw + no change to anything observable.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
        noNavController.dispose();
    });
});

describe('BpmnLiteKeyboardController readOnly mode (M3.3.m F-5)', () => {
    let editor: BpmnLiteEditor;
    let stack: CommandStack;
    let viewport: Viewport;
    let host: HTMLElement;
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let controller: BpmnLiteKeyboardController;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svgGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(svgGroup);
        host.appendChild(svg);
        stack = new CommandStack();
        viewport = new Viewport(svgGroup);
        editor = new BpmnLiteEditor({ host, commands: stack, svgGroup });
        editor.load({
            processId: 'p',
            processExtras: {},
            elements: [
                {
                    id: 'task_1',
                    type: 'task',
                    label: 'task_1',
                    position: { x: 0, y: 0 },
                    size: { width: 100, height: 80 },
                    extras: {},
                },
            ],
            flows: [],
        });
        controller = new BpmnLiteKeyboardController({
            editor,
            commands: stack,
            viewport,
            doc: document,
            readOnly: true,
            zoomStep: 2,
        });
    });

    afterEach(() => {
        controller.dispose();
        host.remove();
    });

    it('Delete is suppressed in read-only mode', () => {
        editor.selection.select({ kind: 'element', id: 'task_1' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeDefined();
        expect(stack.canUndo).toBe(false);
    });

    it('Arrow + zoom keys still work in read-only mode', () => {
        const before = viewport.state.panX;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(viewport.state.panX).toBe(before - 50);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
        expect(viewport.state.zoom).toBeCloseTo(2);
    });
});

describe('isEditableTarget (M3.3.m F-4)', () => {
    it('detects HTMLInputElement', () => {
        expect(isEditableTarget(document.createElement('input'))).toBe(true);
    });

    it('detects HTMLTextAreaElement', () => {
        expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    });

    it('detects HTMLSelectElement', () => {
        expect(isEditableTarget(document.createElement('select'))).toBe(true);
    });

    it('detects contenteditable=true', () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        expect(isEditableTarget(div)).toBe(true);
    });

    it('detects contenteditable=plaintext-only', () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'plaintext-only');
        expect(isEditableTarget(div)).toBe(true);
    });

    it('returns false for null', () => {
        expect(isEditableTarget(null)).toBe(false);
    });

    it('returns false for non-editable elements', () => {
        expect(isEditableTarget(document.createElement('div'))).toBe(false);
        expect(isEditableTarget(document.createElement('span'))).toBe(false);
    });
});
