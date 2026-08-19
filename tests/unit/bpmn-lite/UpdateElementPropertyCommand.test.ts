import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    SVG_NS,
    UpdateElementPropertyCommand,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

describe('UpdateElementPropertyCommand', () => {
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

    function task(id: string, label?: string): BpmnElement {
        return {
            id,
            type: 'task',
            position: { x: 100, y: 100 },
            size: { width: 100, height: 80 },
            ...(label !== undefined ? { label } : {}),
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
                elements: [task('t1', 'Initial')],
                flows: [],
            },
        });
    }

    it('apply replaces the property + revert restores prior value', () => {
        const editor = makeEditor();
        const cmd = new UpdateElementPropertyCommand(
            editor,
            't1',
            'label',
            'Updated',
        );

        cmd.apply();
        expect(editor.findElement('t1')?.label).toBe('Updated');

        cmd.revert();
        expect(editor.findElement('t1')?.label).toBe('Initial');

        editor.dispose();
    });

    it('revert strips the property when there was none originally', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('t1')], // no label
                flows: [],
            },
        });
        const cmd = new UpdateElementPropertyCommand(
            editor,
            't1',
            'label',
            'Fresh',
        );

        cmd.apply();
        expect(editor.findElement('t1')?.label).toBe('Fresh');

        cmd.revert();
        const after = editor.findElement('t1');
        expect(after?.label).toBeUndefined();
        expect('label' in (after ?? {})).toBe(false);

        editor.dispose();
    });

    it('label is "Edit <kind> <key>"', () => {
        const editor = makeEditor();
        const cmd = new UpdateElementPropertyCommand(
            editor,
            't1',
            'label',
            'X',
        );
        expect(cmd.label).toBe('Edit task label');
        editor.dispose();
    });

    it('integrates with CommandStack: execute / undo / redo round-trip', () => {
        const editor = makeEditor();
        const cmd = new UpdateElementPropertyCommand(
            editor,
            't1',
            'label',
            'Updated',
        );

        commands.execute(cmd);
        expect(editor.findElement('t1')?.label).toBe('Updated');

        commands.undo();
        expect(editor.findElement('t1')?.label).toBe('Initial');

        commands.redo();
        expect(editor.findElement('t1')?.label).toBe('Updated');

        editor.dispose();
    });

    it('targetId getter exposes the element id', () => {
        const editor = makeEditor();
        const cmd = new UpdateElementPropertyCommand(
            editor,
            't1',
            'label',
            'X',
        );
        expect(cmd.targetId).toBe('t1');
        editor.dispose();
    });

    it('apply on a missing element id is a silent no-op', () => {
        const editor = makeEditor();
        const cmd = new UpdateElementPropertyCommand(
            editor,
            'missing',
            'label',
            'X',
        );

        expect(() => cmd.apply()).not.toThrow();
        expect(editor.findElement('t1')?.label).toBe('Initial');

        editor.dispose();
    });

    it('emits change events on apply + revert', () => {
        const editor = makeEditor();
        const captured: string[] = [];
        editor.onChange((s) => {
            captured.push(String(s.elements[0]?.label ?? ''));
        });

        const cmd = new UpdateElementPropertyCommand(
            editor,
            't1',
            'label',
            'Updated',
        );
        cmd.apply();
        cmd.revert();

        expect(captured).toEqual(['Updated', 'Initial']);
        editor.dispose();
    });
});
