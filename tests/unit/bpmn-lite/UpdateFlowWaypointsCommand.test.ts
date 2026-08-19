import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    SVG_NS,
    UpdateFlowWaypointsCommand,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnPosition,
    BpmnSequenceFlow,
} from '../../../src/bpmn-lite/index.js';

/**
 * UpdateFlowWaypointsCommand tests. Pins:
 *  - apply() stamps the next waypoints; revert() restores the prior
 *    chain (which may be undefined for an originally auto-routed flow)
 *  - construction-time snapshot of the previous chain survives intermediate
 *    edits (the linear undo/redo case)
 *  - integrates with CommandStack
 *  - chained reroutes round-trip correctly under undo/redo
 */
describe('UpdateFlowWaypointsCommand', () => {
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

    function flow(
        id: string,
        source: string,
        target: string,
        waypoints?: BpmnPosition[],
    ): BpmnSequenceFlow {
        return waypoints === undefined
            ? { id, source, target }
            : { id, source, target, waypoints };
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

    it('apply() stamps the next waypoints onto the flow', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            },
        });
        const next = [
            { x: 200, y: 140 },
            { x: 250, y: 50 },
            { x: 350, y: 50 },
            { x: 400, y: 140 },
        ];
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', next);

        cmd.apply();

        const f = editor.findFlow('f1')!;
        expect(f.waypoints).toEqual(next);

        editor.dispose();
    });

    it('revert() restores the prior waypoints when the flow had a manual chain', () => {
        const prior: BpmnPosition[] = [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 100, y: 0 },
            { x: 150, y: 0 },
        ];
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b', prior)],
            },
        });
        const next: BpmnPosition[] = [
            { x: 10, y: 0 },
            { x: 60, y: 0 },
            { x: 110, y: 0 },
            { x: 160, y: 0 },
        ];
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', next);

        cmd.apply();
        cmd.revert();

        const f = editor.findFlow('f1')!;
        expect(f.waypoints).toEqual(prior);

        editor.dispose();
    });

    it('revert() removes the waypoints slot when the flow was originally auto-routed', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')], // no waypoints
            },
        });
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);

        cmd.apply();
        expect(editor.findFlow('f1')?.waypoints).toEqual([
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);

        cmd.revert();
        expect(editor.findFlow('f1')?.waypoints).toBeUndefined();

        editor.dispose();
    });

    it('target getter exposes the flow id this command targets', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            },
        });
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ]);

        expect(cmd.target).toBe('f1');

        editor.dispose();
    });

    it('integrates with CommandStack: execute + undo + redo round-trip', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            },
        });
        const next: BpmnPosition[] = [
            { x: 200, y: 140 },
            { x: 250, y: 50 },
            { x: 350, y: 50 },
            { x: 400, y: 140 },
        ];
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', next);

        commands.execute(cmd);
        expect(editor.findFlow('f1')?.waypoints).toEqual(next);

        commands.undo();
        expect(editor.findFlow('f1')?.waypoints).toBeUndefined();

        commands.redo();
        expect(editor.findFlow('f1')?.waypoints).toEqual(next);

        editor.dispose();
    });

    it('chained reroutes round-trip correctly under undo', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            },
        });
        const wpA: BpmnPosition[] = [
            { x: 200, y: 140 },
            { x: 250, y: 50 },
            { x: 350, y: 50 },
            { x: 400, y: 140 },
        ];
        const wpB: BpmnPosition[] = [
            { x: 200, y: 140 },
            { x: 280, y: 80 },
            { x: 380, y: 80 },
            { x: 400, y: 140 },
        ];

        commands.execute(new UpdateFlowWaypointsCommand(editor, 'f1', wpA));
        commands.execute(new UpdateFlowWaypointsCommand(editor, 'f1', wpB));

        expect(editor.findFlow('f1')?.waypoints).toEqual(wpB);

        commands.undo();
        // After undo of B: waypoints should be back to A's value.
        expect(editor.findFlow('f1')?.waypoints).toEqual(wpA);

        commands.undo();
        // After undo of A: waypoints should be back to original (undefined).
        expect(editor.findFlow('f1')?.waypoints).toBeUndefined();

        editor.dispose();
    });

    it('label is "Reroute Flow"', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            },
        });
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ]);

        expect(cmd.label).toBe('Reroute Flow');

        editor.dispose();
    });

    it('defensive clone -- mutating the caller waypoints array does not affect the command', () => {
        const editor = new BpmnLiteEditor({
            host,
            commands,
            svgGroup,
            initialModel: {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            },
        });
        const next: BpmnPosition[] = [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ];
        const cmd = new UpdateFlowWaypointsCommand(editor, 'f1', next);

        // Mutate caller's array AFTER construction.
        next.push({ x: 999, y: 999 });

        cmd.apply();
        const stamped = editor.findFlow('f1')?.waypoints;
        expect(stamped).toHaveLength(2);
        expect(stamped).toEqual([
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);

        editor.dispose();
    });
});
