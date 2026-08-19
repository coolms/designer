import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    AddElementCommand,
    BpmnLiteEditor,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * AddElementCommand tests -- the first BPMN-Lite editor
 * command. Pins:
 *   - apply() appends + revert() removes the element verbatim
 *   - label is "Add <Title Case>" for the kind
 *   - target getter exposes the held element for inspection
 *   - command is symmetric under arbitrary apply/revert sequences
 */
describe('AddElementCommand', () => {
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

    function startEvent(id = 'startEvent_1'): BpmnElement {
        return {
            id,
            type: 'startEvent',
            position: { x: 100, y: 100 },
            size: { width: 36, height: 36 },
        };
    }

    function task(id = 'task_1'): BpmnElement {
        return {
            id,
            type: 'task',
            position: { x: 200, y: 100 },
            size: { width: 100, height: 80 },
            label: 'Task',
        };
    }

    it('apply() appends the element to editor.state.elements', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const el = task('task_42');
        const cmd = new AddElementCommand(editor, el);

        cmd.apply();

        expect(editor.state.elements).toHaveLength(1);
        expect(editor.state.elements[0]).toBe(el);

        editor.dispose();
    });

    it('revert() removes the element added by apply()', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const el = task('task_42');
        const cmd = new AddElementCommand(editor, el);

        cmd.apply();
        cmd.revert();

        expect(editor.state.elements).toHaveLength(0);

        editor.dispose();
    });

    it('apply/revert is symmetric -- state matches initial after both', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const before = editor.state;
        const cmd = new AddElementCommand(editor, task());

        cmd.apply();
        cmd.revert();

        // processId is the SAME string; elements + flows are both empty.
        expect(editor.state.processId).toBe(before.processId);
        expect(editor.state.elements).toEqual([]);
        expect(editor.state.flows).toEqual([]);

        editor.dispose();
    });

    it('label is "Add Task" for a task element', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const cmd = new AddElementCommand(editor, task());

        expect(cmd.label).toBe('Add Task');

        editor.dispose();
    });

    it('label is "Add Start Event" for a startEvent', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const cmd = new AddElementCommand(editor, startEvent());

        expect(cmd.label).toBe('Add Start Event');

        editor.dispose();
    });

    it('label uses kind-appropriate title case for all 5 kinds', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const cases: Array<[BpmnElement['type'], string]> = [
            ['startEvent', 'Add Start Event'],
            ['endEvent', 'Add End Event'],
            ['task', 'Add Task'],
            ['exclusiveGateway', 'Add Exclusive Gateway'],
            ['parallelGateway', 'Add Parallel Gateway'],
        ];
        for (const [kind, label] of cases) {
            const el: BpmnElement = {
                id: `${kind}_1`,
                type: kind,
                position: { x: 0, y: 0 },
                size: { width: 50, height: 50 },
            };
            expect(new AddElementCommand(editor, el).label).toBe(label);
        }
        editor.dispose();
    });

    it('target getter exposes the held element verbatim', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const el = task('task_99');
        const cmd = new AddElementCommand(editor, el);

        expect(cmd.target).toBe(el);

        editor.dispose();
    });

    it('integrates with CommandStack: execute appends, undo removes', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const el = task('task_via_stack');
        const cmd = new AddElementCommand(editor, el);

        commands.execute(cmd);
        expect(editor.state.elements).toEqual([el]);

        commands.undo();
        expect(editor.state.elements).toEqual([]);

        commands.redo();
        expect(editor.state.elements).toEqual([el]);

        editor.dispose();
    });

    it('emits change events on apply + revert through the editor', () => {
        const editor = new BpmnLiteEditor({ host, commands, svgGroup });
        const changes: number[] = [];
        editor.onChange((state) => changes.push(state.elements.length));

        const cmd = new AddElementCommand(editor, task());

        cmd.apply();
        cmd.revert();

        expect(changes).toEqual([1, 0]);

        editor.dispose();
    });
});
