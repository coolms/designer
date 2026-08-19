import { describe, it, expect, beforeEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    DeleteElementCommand,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnSequenceFlow,
} from '../../../src/bpmn-lite/types.js';

/**
 * polish-bundle (F-4) — pins the cascade semantics + undo
 * roundtrip for {@link DeleteElementCommand}.
 */
describe('DeleteElementCommand (M3.3.m F-4)', () => {
    let editor: BpmnLiteEditor;
    let stack: CommandStack;
    let host: HTMLElement;
    let svgGroup: SVGGElement;

    const mkEl = (id: string, type: BpmnElement['type'] = 'task'): BpmnElement => ({
        id,
        type,
        label: id,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 80 },
        extras: {},
    });

    const mkFlow = (
        id: string,
        source: string,
        target: string,
    ): BpmnSequenceFlow => ({
        id,
        source,
        target,
        waypoints: [],
        extras: {},
    });

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        const svg = document.createElementNS(SVG_NS, 'svg');
        svgGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(svgGroup);
        host.appendChild(svg);
        stack = new CommandStack();
        editor = new BpmnLiteEditor({
            host,
            commands: stack,
            svgGroup,
        });
        editor.load({
            processId: 'p',
            processExtras: {},
            elements: [mkEl('start_1', 'startEvent'), mkEl('task_1'), mkEl('end_1', 'endEvent')],
            flows: [mkFlow('flow_1', 'start_1', 'task_1'), mkFlow('flow_2', 'task_1', 'end_1')],
        });
    });

    it('cascades incident flows + removes the element', () => {
        const task = editor.state.elements.find((e) => e.id === 'task_1')!;
        const cmd = new DeleteElementCommand(editor, task);
        stack.execute(cmd);

        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeUndefined();
        // Both flows incident to task_1 are gone.
        expect(editor.state.flows.find((f) => f.id === 'flow_1')).toBeUndefined();
        expect(editor.state.flows.find((f) => f.id === 'flow_2')).toBeUndefined();
        // The 2 untouched elements survive.
        expect(editor.state.elements).toHaveLength(2);
        // Captured flows tracked for revert.
        expect(cmd.capturedFlows).toHaveLength(2);
    });

    it('undo restores the element + every cascaded flow', () => {
        const task = editor.state.elements.find((e) => e.id === 'task_1')!;
        const cmd = new DeleteElementCommand(editor, task);
        stack.execute(cmd);
        stack.undo();

        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeDefined();
        expect(editor.state.flows.find((f) => f.id === 'flow_1')).toBeDefined();
        expect(editor.state.flows.find((f) => f.id === 'flow_2')).toBeDefined();
        expect(editor.state.elements).toHaveLength(3);
        expect(editor.state.flows).toHaveLength(2);
    });

    it('redo replays the cascade deterministically', () => {
        const task = editor.state.elements.find((e) => e.id === 'task_1')!;
        const cmd = new DeleteElementCommand(editor, task);
        stack.execute(cmd);
        stack.undo();
        stack.redo();

        expect(editor.state.elements.find((e) => e.id === 'task_1')).toBeUndefined();
        expect(editor.state.flows).toHaveLength(0);
    });

    it('label uses the PALETTE_LABELS title case', () => {
        const task = editor.state.elements.find((e) => e.id === 'task_1')!;
        const cmd = new DeleteElementCommand(editor, task);
        expect(cmd.label).toBe('Delete Task');

        const start = editor.state.elements.find((e) => e.id === 'start_1')!;
        const startCmd = new DeleteElementCommand(editor, start);
        expect(startCmd.label).toBe('Delete Start Event');
    });
});
