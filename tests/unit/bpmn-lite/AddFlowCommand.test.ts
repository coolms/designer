import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    AddFlowCommand,
    BpmnLiteEditor,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnSequenceFlow,
} from '../../../src/bpmn-lite/index.js';

/**
 * AddFlowCommand tests. Pins:
 *   - apply() appends + revert() removes the flow verbatim
 *   - label is `Connect <sourceId> → <targetId>`
 *   - target getter exposes the held flow
 *   - integrates with CommandStack
 */
describe('AddFlowCommand', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;
    let commands: CommandStack;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    function task(id: string, x = 100): BpmnElement {
        return {
            id,
            type: 'task',
            position: { x, y: 100 },
            size: { width: 100, height: 80 },
        };
    }

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svgGroup = makeSvgGroup();
        commands = new CommandStack();
    });

    afterEach(() => {
        host.remove();
        svgGroup.ownerSVGElement?.remove();
    });

    function newEditorWithElements(): BpmnLiteEditor {
        return new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [],
            },
        });
    }

    it('apply() appends the flow to editor.state.flows', () => {
        const editor = newEditorWithElements();
        const flow: BpmnSequenceFlow = { id: 'flow_1', source: 'a', target: 'b' };
        const cmd = new AddFlowCommand(editor, flow);

        cmd.apply();

        expect(editor.state.flows).toEqual([flow]);

        editor.dispose();
    });

    it('revert() removes the flow added by apply()', () => {
        const editor = newEditorWithElements();
        const flow: BpmnSequenceFlow = { id: 'flow_1', source: 'a', target: 'b' };
        const cmd = new AddFlowCommand(editor, flow);

        cmd.apply();
        cmd.revert();

        expect(editor.state.flows).toEqual([]);

        editor.dispose();
    });

    it('label is `Connect <source> → <target>`', () => {
        const editor = newEditorWithElements();
        const cmd = new AddFlowCommand(editor, {
            id: 'flow_1',
            source: 'startEvent_1',
            target: 'task_1',
        });

        expect(cmd.label).toBe('Connect startEvent_1 → task_1');

        editor.dispose();
    });

    it('target getter exposes the held flow verbatim', () => {
        const editor = newEditorWithElements();
        const flow: BpmnSequenceFlow = { id: 'flow_x', source: 'a', target: 'b' };
        const cmd = new AddFlowCommand(editor, flow);

        expect(cmd.target).toBe(flow);

        editor.dispose();
    });

    it('integrates with CommandStack: execute appends, undo removes, redo reapplies', () => {
        const editor = newEditorWithElements();
        const flow: BpmnSequenceFlow = { id: 'flow_1', source: 'a', target: 'b' };
        const cmd = new AddFlowCommand(editor, flow);

        commands.execute(cmd);
        expect(editor.state.flows).toEqual([flow]);

        commands.undo();
        expect(editor.state.flows).toEqual([]);

        commands.redo();
        expect(editor.state.flows).toEqual([flow]);

        editor.dispose();
    });

    it('emits change events on apply + revert through the editor', () => {
        const editor = newEditorWithElements();
        const changes: number[] = [];
        editor.onChange((state) => changes.push(state.flows.length));

        const cmd = new AddFlowCommand(editor, {
            id: 'flow_1',
            source: 'a',
            target: 'b',
        });

        cmd.apply();
        cmd.revert();

        expect(changes).toEqual([1, 0]);

        editor.dispose();
    });
});
