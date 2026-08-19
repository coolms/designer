import { describe, it, expect, beforeEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    MoveElementCommand,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/types.js';

/**
 * polish-bundle (F-7.1) — pins {@link MoveElementCommand}'s
 * apply/revert symmetry + the editor's `updateElementPosition`
 * mutator. The companion {@link MoveElementController} tests live
 * separately (they need the SVG + pointer-event plumbing).
 */
describe('MoveElementCommand (M3.3.m F-7.1)', () => {
    let editor: BpmnLiteEditor;
    let stack: CommandStack;
    let host: HTMLElement;
    let svgGroup: SVGGElement;

    const mkEl = (
        id: string,
        type: BpmnElement['type'] = 'task',
        position = { x: 100, y: 100 },
    ): BpmnElement => ({
        id,
        type,
        label: `${id}-label`,
        position,
        size: { width: 100, height: 80 },
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
            elements: [mkEl('task_1')],
            flows: [],
        });
    });

    it('apply() moves the element to the new position', () => {
        const cmd = new MoveElementCommand(
            editor,
            'task_1',
            { x: 100, y: 100 },
            { x: 250, y: 175 },
        );
        stack.execute(cmd);

        const moved = editor.state.elements.find((e) => e.id === 'task_1')!;
        expect(moved.position).toEqual({ x: 250, y: 175 });
    });

    it('revert() restores the pre-drag position', () => {
        const cmd = new MoveElementCommand(
            editor,
            'task_1',
            { x: 100, y: 100 },
            { x: 250, y: 175 },
        );
        stack.execute(cmd);
        stack.undo();

        const restored = editor.state.elements.find((e) => e.id === 'task_1')!;
        expect(restored.position).toEqual({ x: 100, y: 100 });
    });

    it('redo() replays the move deterministically', () => {
        const cmd = new MoveElementCommand(
            editor,
            'task_1',
            { x: 100, y: 100 },
            { x: 250, y: 175 },
        );
        stack.execute(cmd);
        stack.undo();
        stack.redo();

        const moved = editor.state.elements.find((e) => e.id === 'task_1')!;
        expect(moved.position).toEqual({ x: 250, y: 175 });
    });

    it('label uses the element label when present', () => {
        const cmd = new MoveElementCommand(
            editor,
            'task_1',
            { x: 100, y: 100 },
            { x: 250, y: 175 },
            'Send OTP email',
        );
        expect(cmd.label).toBe('Move Send OTP email');
    });

    it('label falls back to the element id when no label is provided', () => {
        const cmd = new MoveElementCommand(
            editor,
            'task_1',
            { x: 100, y: 100 },
            { x: 250, y: 175 },
        );
        expect(cmd.label).toBe('Move task_1');
    });

    it('updateElementPosition emits change + repaints', () => {
        let changeCount = 0;
        editor.onChange(() => {
            changeCount += 1;
        });
        const before = changeCount;
        editor.updateElementPosition('task_1', { x: 50, y: 60 });
        expect(changeCount).toBe(before + 1);
        const moved = editor.state.elements.find((e) => e.id === 'task_1')!;
        expect(moved.position).toEqual({ x: 50, y: 60 });
    });

    it('updateElementPosition is a no-op on missing element + returns false', () => {
        const ok = editor.updateElementPosition('nope', { x: 1, y: 2 });
        expect(ok).toBe(false);
    });

    it('command exposes from/to/target test affordances', () => {
        const cmd = new MoveElementCommand(
            editor,
            'task_1',
            { x: 0, y: 0 },
            { x: 7, y: 11 },
        );
        expect(cmd.target).toBe('task_1');
        expect(cmd.from).toEqual({ x: 0, y: 0 });
        expect(cmd.to).toEqual({ x: 7, y: 11 });
    });
});
