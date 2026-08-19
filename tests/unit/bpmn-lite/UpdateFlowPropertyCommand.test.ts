import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    SVG_NS,
    UpdateFlowPropertyCommand,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

describe('UpdateFlowPropertyCommand', () => {
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

    function task(id: string, x: number): BpmnElement {
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

    function makeEditor(): BpmnLiteEditor {
        return new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [{ id: 'f1', source: 'a', target: 'b' }],
            },
        });
    }

    it('apply sets condition + revert restores undefined', () => {
        const editor = makeEditor();
        const cmd = new UpdateFlowPropertyCommand(
            editor,
            'f1',
            'condition',
            'variables.status == "approved"',
        );

        cmd.apply();
        expect(editor.findFlow('f1')?.condition).toBe(
            'variables.status == "approved"',
        );

        cmd.revert();
        const after = editor.findFlow('f1');
        expect(after?.condition).toBeUndefined();
        expect('condition' in (after ?? {})).toBe(false);

        editor.dispose();
    });

    it('apply sets isDefault to true + revert restores undefined', () => {
        const editor = makeEditor();
        const cmd = new UpdateFlowPropertyCommand(
            editor,
            'f1',
            'isDefault',
            true,
        );

        cmd.apply();
        expect(editor.findFlow('f1')?.isDefault).toBe(true);

        cmd.revert();
        expect(editor.findFlow('f1')?.isDefault).toBeUndefined();

        editor.dispose();
    });

    it('label is "Edit flow <key>"', () => {
        const editor = makeEditor();
        const cmd = new UpdateFlowPropertyCommand(
            editor,
            'f1',
            'condition',
            'X',
        );
        expect(cmd.label).toBe('Edit flow condition');
        editor.dispose();
    });

    it('integrates with CommandStack: execute / undo / redo round-trip', () => {
        const editor = makeEditor();
        const cmd = new UpdateFlowPropertyCommand(
            editor,
            'f1',
            'condition',
            'expr',
        );

        commands.execute(cmd);
        expect(editor.findFlow('f1')?.condition).toBe('expr');

        commands.undo();
        expect(editor.findFlow('f1')?.condition).toBeUndefined();

        commands.redo();
        expect(editor.findFlow('f1')?.condition).toBe('expr');

        editor.dispose();
    });

    it('chained edits round-trip under undo (construction-time snapshot)', () => {
        const editor = makeEditor();

        commands.execute(
            new UpdateFlowPropertyCommand(editor, 'f1', 'condition', 'A'),
        );
        commands.execute(
            new UpdateFlowPropertyCommand(editor, 'f1', 'condition', 'B'),
        );
        expect(editor.findFlow('f1')?.condition).toBe('B');

        commands.undo();
        expect(editor.findFlow('f1')?.condition).toBe('A');

        commands.undo();
        expect(editor.findFlow('f1')?.condition).toBeUndefined();

        editor.dispose();
    });

    it('targetId getter exposes the flow id', () => {
        const editor = makeEditor();
        const cmd = new UpdateFlowPropertyCommand(editor, 'f1', 'condition', 'X');
        expect(cmd.targetId).toBe('f1');
        editor.dispose();
    });

    it('apply on a missing flow id is a silent no-op', () => {
        const editor = makeEditor();
        const cmd = new UpdateFlowPropertyCommand(
            editor,
            'missing',
            'condition',
            'X',
        );

        expect(() => cmd.apply()).not.toThrow();
        expect(editor.findFlow('f1')?.condition).toBeUndefined();

        editor.dispose();
    });
});
