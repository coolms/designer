import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    ElementRendererRegistry,
    emptyBpmnLiteModel,
    SVG_NS,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnLiteModel,
} from '../../../src/bpmn-lite/index.js';

/**
 * b BpmnLiteEditor tests.
 *
 * pinned the lifecycle scaffold; M3.3.b extends that with the
 * paint-on-construct + paint-on-load + banner-toggle behaviour. The
 * lifecycle assertions from M3.3.a still hold verbatim; the new
 * `svgGroup` constructor arg + the paint cases land here.
 */
describe('BpmnLiteEditor', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;
    let commands: CommandStack;

    /** Build a fresh `<g>` standalone -- mirrors what the Angular wrapper passes from `editor.canvasGroup`. */
    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    /** Build a sample task element for paint tests. */
    function task(
        id: string,
        position = { x: 100, y: 100 },
        label?: string,
    ): BpmnElement {
        return {
            id,
            type: 'task',
            position,
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

    /* ─────────────────────── M3.3.a lifecycle pins ─────────────────────── */

    describe('lifecycle (M3.3.a invariants)', () => {
        it('constructs with default empty model when no initialModel supplied', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            expect(editor.state).toEqual({
                processId: 'process.unnamed',
                elements: [],
                flows: [],
            });

            editor.dispose();
        });

        it('seeds state from the supplied initialModel', () => {
            const initial: BpmnLiteModel = {
                processId: 'process.test',
                elements: [],
                flows: [],
            };

            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: initial,
            });

            expect(editor.state).toBe(initial);

            editor.dispose();
        });

        it('mounts the placeholder banner inside the host on construct', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const banner = host.querySelector(
                '.coolms-designer__bpmn-lite-banner',
            );
            expect(banner).not.toBeNull();
            expect(banner?.getAttribute('data-coolms-designer-scaffold')).toBe(
                'bpmn-lite',
            );
            expect(editor.bannerElement).toBe(banner);

            editor.dispose();
        });

        it('removes the banner from the DOM on dispose', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(
                host.querySelector('.coolms-designer__bpmn-lite-banner'),
            ).not.toBeNull();

            editor.dispose();

            expect(
                host.querySelector('.coolms-designer__bpmn-lite-banner'),
            ).toBeNull();
            expect(editor.bannerElement).toBeNull();
        });

        it('dispose is idempotent -- second call is a no-op', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            editor.dispose();
            expect(() => editor.dispose()).not.toThrow();
        });

        it('load() replaces state and fires change to subscribers', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((state) => captured.push(state));

            const next = emptyBpmnLiteModel('process.next');
            editor.load(next);

            expect(editor.state).toBe(next);
            expect(captured).toHaveLength(1);
            expect(captured[0]).toBe(next);
        });

        it('onChange returns a thunk that unsubscribes on call', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const captured: BpmnLiteModel[] = [];
            const off = editor.onChange((state) => captured.push(state));

            editor.load(emptyBpmnLiteModel('process.first'));
            off();
            editor.load(emptyBpmnLiteModel('process.second'));

            expect(captured).toHaveLength(1);
            expect(captured[0]?.processId).toBe('process.first');
        });

        it('load() after dispose is a no-op (no throw, no event)', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((state) => captured.push(state));

            editor.dispose();

            const before = editor.state;
            expect(() =>
                editor.load(emptyBpmnLiteModel('process.after-dispose')),
            ).not.toThrow();
            expect(editor.state).toBe(before);
            expect(captured).toHaveLength(0);
        });

        it('multiple subscribers all receive the load() event', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const a: BpmnLiteModel[] = [];
            const b: BpmnLiteModel[] = [];
            const c: BpmnLiteModel[] = [];
            editor.onChange((s) => a.push(s));
            editor.onChange((s) => b.push(s));
            editor.onChange((s) => c.push(s));

            const next = emptyBpmnLiteModel('process.multi');
            editor.load(next);

            expect(a).toEqual([next]);
            expect(b).toEqual([next]);
            expect(c).toEqual([next]);
        });

        it('commandStack accessor returns the constructor-supplied stack', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.commandStack).toBe(commands);
            editor.dispose();
        });

        it('emptyBpmnLiteModel respects a custom processId', () => {
            const model = emptyBpmnLiteModel('process.custom');
            expect(model).toEqual({
                processId: 'process.custom',
                elements: [],
                flows: [],
            });
        });
    });

    /* ─────────────────────── M3.3.b paint surface ─────────────────────── */

    describe('paint', () => {
        it('mounts a painted root group inside svgGroup on construct', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const painted = svgGroup.querySelector(
                '.coolms-designer__bpmn-lite-elements',
            );
            expect(painted).not.toBeNull();
            expect(editor.paintedRootElement).toBe(painted);

            editor.dispose();
        });

        it('paints zero element <g>s when the model is empty', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const painted = editor.paintedRootElement;
            expect(painted?.children.length).toBe(0);

            editor.dispose();
        });

        it('paints one element <g> per model element', () => {
            const initial: BpmnLiteModel = {
                processId: 'process.with-elements',
                elements: [
                    task('t1'),
                    task('t2', { x: 250, y: 100 }),
                    task('t3', { x: 400, y: 100 }),
                ],
                flows: [],
            };

            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: initial,
            });

            const painted = editor.paintedRootElement;
            expect(painted?.children.length).toBe(3);

            const ids = Array.from(painted?.children ?? []).map((c) =>
                c.getAttribute('data-element-id'),
            );
            expect(ids).toEqual(['t1', 't2', 't3']);

            editor.dispose();
        });

        it('load() clears prior painted root + repaints', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const firstRoot = editor.paintedRootElement;

            editor.load({
                processId: 'process.populated',
                elements: [task('t1'), task('t2')],
                flows: [],
            });

            const secondRoot = editor.paintedRootElement;
            expect(secondRoot).not.toBeNull();
            expect(secondRoot).not.toBe(firstRoot);
            expect(secondRoot?.children.length).toBe(2);
            // The old root is detached from the SVG.
            expect(firstRoot?.parentNode).toBeNull();
        });

        it('dispose removes the painted root from svgGroup', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('t1')],
                    flows: [],
                },
            });
            const painted = editor.paintedRootElement;
            expect(painted?.parentNode).toBe(svgGroup);

            editor.dispose();

            expect(painted?.parentNode).toBeNull();
            expect(editor.paintedRootElement).toBeNull();
        });

        it('banner is visible when elements is empty', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const banner = editor.bannerElement!;
            expect(banner.style.display).toBe('');

            editor.dispose();
        });

        it('banner is hidden after load() with populated elements', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            editor.load({
                processId: 'p',
                elements: [task('t1')],
                flows: [],
            });

            expect(editor.bannerElement?.style.display).toBe('none');

            editor.dispose();
        });

        it('banner becomes visible again after load() with empty elements', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('t1')],
                    flows: [],
                },
            });
            expect(editor.bannerElement?.style.display).toBe('none');

            editor.load(emptyBpmnLiteModel('p'));

            expect(editor.bannerElement?.style.display).toBe('');
            editor.dispose();
        });

        it('rendererRegistry accessor returns the constructor-supplied registry', () => {
            const custom = new ElementRendererRegistry();
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                renderers: custom,
            });

            expect(editor.rendererRegistry).toBe(custom);

            editor.dispose();
        });

        it('throws on load() with an element whose kind has no renderer', () => {
            // Custom empty registry -- no renderers at all.
            const empty = new ElementRendererRegistry();
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                renderers: empty,
            });

            expect(() =>
                editor.load({
                    processId: 'p',
                    elements: [task('t1')],
                    flows: [],
                }),
            ).toThrow(/No renderer registered for BPMN element kind "task"/);

            editor.dispose();
        });
    });

    /* ─────────────────────── M3.3.c flow surface ─────────────────────── */

    describe('flow paint', () => {
        it('mounts the flows group inside svgGroup on construct', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const flows = svgGroup.querySelector(
                '.coolms-designer__bpmn-lite-flows',
            );
            expect(flows).not.toBeNull();
            expect(editor.paintedFlowsElement).toBe(flows);

            editor.dispose();
        });

        it('flows group is appended BEFORE elements group (paints behind)', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const flows = editor.paintedFlowsElement;
            const elements = editor.paintedRootElement;
            expect(flows?.parentNode).toBe(svgGroup);
            expect(elements?.parentNode).toBe(svgGroup);

            // Document order: flows before elements -> flows paint underneath.
            const relation = flows!.compareDocumentPosition(elements!);
            expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

            editor.dispose();
        });

        it('flows group always carries the per-instance arrowhead <defs>', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });

            const defs = editor.paintedFlowsElement?.querySelector('defs');
            expect(defs).not.toBeNull();
            const marker = defs?.querySelector('marker');
            expect(marker?.id).toBe(editor.arrowheadMarkerId);

            editor.dispose();
        });

        it('paints one <g> per flow whose source + target resolve', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [
                        task('a', { x: 100, y: 100 }),
                        task('b', { x: 400, y: 100 }),
                        task('c', { x: 700, y: 100 }),
                    ],
                    flows: [
                        { id: 'f1', source: 'a', target: 'b' },
                        { id: 'f2', source: 'b', target: 'c' },
                    ],
                },
            });

            const flowGs = editor.paintedFlowsElement?.querySelectorAll(
                '.coolms-designer__bpmn-flow',
            );
            expect(flowGs).toHaveLength(2);
            const ids = Array.from(flowGs ?? []).map((g) =>
                g.getAttribute('data-flow-id'),
            );
            expect(ids).toEqual(['f1', 'f2']);

            editor.dispose();
        });

        it('skips flows with dangling source ref silently', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a')],
                    flows: [
                        { id: 'f1', source: 'missing-source', target: 'a' },
                    ],
                },
            });

            const flowGs = editor.paintedFlowsElement?.querySelectorAll(
                '.coolms-designer__bpmn-flow',
            );
            expect(flowGs).toHaveLength(0);

            editor.dispose();
        });

        it('skips flows with dangling target ref silently', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a')],
                    flows: [
                        { id: 'f1', source: 'a', target: 'missing-target' },
                    ],
                },
            });

            const flowGs = editor.paintedFlowsElement?.querySelectorAll(
                '.coolms-designer__bpmn-flow',
            );
            expect(flowGs).toHaveLength(0);

            editor.dispose();
        });

        it('load() repaints flows -- prior flows root detached, new one mounted', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const firstFlowsRoot = editor.paintedFlowsElement;

            editor.load({
                processId: 'p',
                elements: [task('a'), task('b', { x: 400, y: 100 })],
                flows: [{ id: 'f1', source: 'a', target: 'b' }],
            });

            const secondFlowsRoot = editor.paintedFlowsElement;
            expect(secondFlowsRoot).not.toBe(firstFlowsRoot);
            expect(firstFlowsRoot?.parentNode).toBeNull();
            expect(secondFlowsRoot?.parentNode).toBe(svgGroup);
        });

        it('dispose removes the flows group from svgGroup', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const flows = editor.paintedFlowsElement;
            expect(flows?.parentNode).toBe(svgGroup);

            editor.dispose();

            expect(flows?.parentNode).toBeNull();
            expect(editor.paintedFlowsElement).toBeNull();
        });

        it('banner is hidden when model has flows but no elements (edge case)', () => {
            // The banner toggle considers elements + flows; both empty
            // means banner visible. With a non-empty flows array (even
            // if it would dangle without elements), banner hides.
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [],
                    flows: [{ id: 'f1', source: 'a', target: 'b' }],
                },
            });

            expect(editor.bannerElement?.style.display).toBe('none');

            editor.dispose();
        });

        it('arrowheadMarkerId is unique per instance', () => {
            const editor1 = new BpmnLiteEditor({ host, commands, svgGroup });
            const svg2 = document.createElementNS(SVG_NS, 'svg');
            const g2 = document.createElementNS(SVG_NS, 'g') as SVGGElement;
            svg2.appendChild(g2);
            document.body.appendChild(svg2);
            const host2 = document.createElement('div');
            document.body.appendChild(host2);

            const editor2 = new BpmnLiteEditor({
                host: host2,
                commands: new (commands.constructor as new () => typeof commands)(),
                svgGroup: g2,
            });

            expect(editor1.arrowheadMarkerId).not.toBe(editor2.arrowheadMarkerId);

            editor1.dispose();
            editor2.dispose();
            svg2.remove();
            host2.remove();
        });
    });

    /* ─────────────────────── M3.3.d mutators + drop ─────────────────────── */

    describe('mutators + dropElementAt', () => {
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

        it('addElement appends + emits change', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            editor.addElement(task('t1'));

            expect(editor.state.elements).toHaveLength(1);
            expect(editor.state.elements[0]?.id).toBe('t1');
            expect(captured).toHaveLength(1);

            editor.dispose();
        });

        it('addElement after dispose is a no-op', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            editor.dispose();
            expect(() => editor.addElement(task('t1'))).not.toThrow();
            expect(editor.state.elements).toHaveLength(0);
        });

        it('removeElement removes by id + emits change + returns the removed element', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b'), task('c')],
                    flows: [],
                },
            });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            const removed = editor.removeElement('b');

            expect(removed?.id).toBe('b');
            expect(editor.state.elements.map((e) => e.id)).toEqual(['a', 'c']);
            expect(captured).toHaveLength(1);

            editor.dispose();
        });

        it('removeElement with unknown id returns null + does NOT emit', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a')],
                    flows: [],
                },
            });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            const removed = editor.removeElement('not-there');

            expect(removed).toBeNull();
            expect(editor.state.elements).toHaveLength(1);
            expect(captured).toHaveLength(0);

            editor.dispose();
        });

        it('nextElementId mints fresh ids per kind', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.nextElementId('task')).toBe('task_1');

            editor.addElement(task('task_1'));
            expect(editor.nextElementId('task')).toBe('task_2');

            editor.addElement(task('task_5'));
            expect(editor.nextElementId('task')).toBe('task_6');

            // Different kind starts fresh.
            expect(editor.nextElementId('startEvent')).toBe('startEvent_1');

            editor.dispose();
        });

        it('nextElementId ignores ids that do not match the <kind>_<digits> pattern', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [
                        { ...task('task_abc'), id: 'task_abc' },
                        task('task_3'),
                    ],
                    flows: [],
                },
            });

            expect(editor.nextElementId('task')).toBe('task_4');

            editor.dispose();
        });

        it('dropElementAt creates an element centered on the drop point', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            stubCanvasRect(svgGroup.ownerSVGElement!, {
                left: 0,
                top: 0,
                width: 800,
                height: 600,
            });

            const el = editor.dropElementAt(400, 300, 'task');

            expect(el).not.toBeNull();
            expect(el?.type).toBe('task');
            // 100x80 task -> position = drop minus half-size = (350, 260).
            expect(el?.position).toEqual({ x: 350, y: 260 });
            expect(el?.size).toEqual({ width: 100, height: 80 });
            expect(el?.label).toBe('Task');
            // Fresh id.
            expect(el?.id).toBe('task_1');

            editor.dispose();
        });

        it('dropElementAt offsets by the SVG bounding rect', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            stubCanvasRect(svgGroup.ownerSVGElement!, {
                left: 200,
                top: 100,
                width: 800,
                height: 600,
            });

            // Drop at client (600, 400) -> canvas-local (400, 300) -> world (400, 300).
            const el = editor.dropElementAt(600, 400, 'startEvent');

            // 36x36 event -> position = (400 - 18, 300 - 18) = (382, 282).
            expect(el?.position).toEqual({ x: 382, y: 282 });

            editor.dispose();
        });

        it('dropElementAt outside the canvas returns null + does not add', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            stubCanvasRect(svgGroup.ownerSVGElement!, {
                left: 1000,
                top: 1000,
                width: 100,
                height: 100,
            });

            const el = editor.dropElementAt(10, 10, 'task');

            expect(el).toBeNull();
            expect(editor.state.elements).toHaveLength(0);

            editor.dispose();
        });

        it('dropElementAt accounts for canvas pan/zoom on the transform', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            stubCanvasRect(svgGroup.ownerSVGElement!, {
                left: 0,
                top: 0,
                width: 800,
                height: 600,
            });
            // Pan (50, 30) + zoom 2x -- the canvas group's transform attr.
            svgGroup.setAttribute('transform', 'translate(50 30) scale(2)');

            // Drop at client (250, 230). Canvas-local: (250, 230).
            // World: ((250 - 50) / 2, (230 - 30) / 2) = (100, 100).
            const el = editor.dropElementAt(250, 230, 'task');

            // Task 100x80 -> position = (100 - 50, 100 - 40) = (50, 60).
            expect(el?.position).toEqual({ x: 50, y: 60 });

            editor.dispose();
        });

        it('dropElementAt dispatches through the CommandStack -- undo reverses', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            stubCanvasRect(svgGroup.ownerSVGElement!, {
                left: 0,
                top: 0,
                width: 800,
                height: 600,
            });

            const el = editor.dropElementAt(400, 300, 'task');
            expect(editor.state.elements).toHaveLength(1);

            commands.undo();
            expect(editor.state.elements).toHaveLength(0);

            commands.redo();
            expect(editor.state.elements).toHaveLength(1);
            expect(editor.state.elements[0]?.id).toBe(el?.id);

            editor.dispose();
        });

        it('dropElementAt after dispose returns null', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            editor.dispose();

            expect(editor.dropElementAt(100, 100, 'task')).toBeNull();
        });
    });

    /* ─────────────────── M3.3.e flow mutators + helpers ─────────────────── */

    describe('flow mutators + helpers', () => {
        function modelWithFlow(): BpmnLiteModel {
            return {
                processId: 'p',
                elements: [
                    task('a', { x: 100, y: 100 }),
                    task('b', { x: 400, y: 100 }),
                ],
                flows: [{ id: 'f1', source: 'a', target: 'b' }],
            };
        }

        it('addFlow appends + emits change', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [],
                },
            });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            editor.addFlow({ id: 'f1', source: 'a', target: 'b' });

            expect(editor.state.flows).toHaveLength(1);
            expect(editor.state.flows[0]?.id).toBe('f1');
            expect(captured).toHaveLength(1);

            editor.dispose();
        });

        it('removeFlow removes + returns the removed flow', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: modelWithFlow(),
            });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            const removed = editor.removeFlow('f1');

            expect(removed?.id).toBe('f1');
            expect(editor.state.flows).toEqual([]);
            expect(captured).toHaveLength(1);

            editor.dispose();
        });

        it('removeFlow with unknown id returns null + does not emit', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: modelWithFlow(),
            });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            expect(editor.removeFlow('does-not-exist')).toBeNull();
            expect(editor.state.flows).toHaveLength(1);
            expect(captured).toHaveLength(0);

            editor.dispose();
        });

        it('nextFlowId mints fresh ids based on the highest flow_<n> suffix', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.nextFlowId()).toBe('flow_1');

            editor.addFlow({ id: 'flow_1', source: 'a', target: 'b' });
            editor.addFlow({ id: 'flow_5', source: 'a', target: 'b' });
            // Ids that don't match `flow_<digits>` don't bump the counter.
            editor.addFlow({ id: 'connection_xyz', source: 'a', target: 'b' });

            expect(editor.nextFlowId()).toBe('flow_6');

            editor.dispose();
        });

        it('updateFlowWaypoints sets waypoints + emits change + returns true', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: modelWithFlow(),
            });
            const captured: BpmnLiteModel[] = [];
            editor.onChange((s) => captured.push(s));

            const waypoints = [
                { x: 200, y: 140 },
                { x: 280, y: 80 },
                { x: 380, y: 80 },
                { x: 400, y: 140 },
            ];
            expect(editor.updateFlowWaypoints('f1', waypoints)).toBe(true);
            expect(editor.findFlow('f1')?.waypoints).toEqual(waypoints);
            expect(captured).toHaveLength(1);

            editor.dispose();
        });

        it('updateFlowWaypoints with undefined strips the waypoints slot', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [
                        {
                            id: 'f1',
                            source: 'a',
                            target: 'b',
                            waypoints: [
                                { x: 1, y: 1 },
                                { x: 2, y: 2 },
                            ],
                        },
                    ],
                },
            });

            expect(editor.updateFlowWaypoints('f1', undefined)).toBe(true);
            const flow = editor.findFlow('f1')!;
            expect('waypoints' in flow).toBe(false);

            editor.dispose();
        });

        it('updateFlowWaypoints returns false for an unknown flow id', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.updateFlowWaypoints('missing', [{ x: 0, y: 0 }])).toBe(
                false,
            );
            editor.dispose();
        });

        it('findElement + findFlow + getElementCenter return null for unknown ids', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: modelWithFlow(),
            });

            expect(editor.findElement('missing')).toBeNull();
            expect(editor.findFlow('missing')).toBeNull();
            expect(editor.getElementCenter('missing')).toBeNull();

            // Hit case.
            expect(editor.findElement('a')?.id).toBe('a');
            expect(editor.findFlow('f1')?.id).toBe('f1');
            // Element a is at (100, 100) with size 100x80 -- center (150, 140).
            expect(editor.getElementCenter('a')).toEqual({ x: 150, y: 140 });

            editor.dispose();
        });

        it('resolveFlowWaypoints returns 4-waypoint auto-route when no manual chain', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: modelWithFlow(),
            });

            const wps = editor.resolveFlowWaypoints('f1');
            expect(wps).not.toBeNull();
            expect(wps).toHaveLength(4);

            editor.dispose();
        });

        it('resolveFlowWaypoints returns manual chain verbatim', () => {
            const manual = [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
                { x: 3, y: 3 },
            ];
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [
                        {
                            id: 'f1',
                            source: 'a',
                            target: 'b',
                            waypoints: manual,
                        },
                    ],
                },
            });

            expect(editor.resolveFlowWaypoints('f1')).toEqual(manual);

            editor.dispose();
        });

        it('resolveFlowWaypoints returns null for a dangling-ref flow', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a')],
                    flows: [{ id: 'f1', source: 'a', target: 'missing' }],
                },
            });

            expect(editor.resolveFlowWaypoints('f1')).toBeNull();

            editor.dispose();
        });

        it('clientToWorld returns null when point is outside the canvas', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const svg = svgGroup.ownerSVGElement!;
            svg.getBoundingClientRect = (): DOMRect => ({
                left: 100,
                top: 100,
                right: 200,
                bottom: 200,
                width: 100,
                height: 100,
                x: 100,
                y: 100,
                toJSON(): unknown {
                    return this;
                },
            });

            expect(editor.clientToWorld(50, 50)).toBeNull();
            expect(editor.clientToWorld(150, 150)).toEqual({ x: 50, y: 50 });

            editor.dispose();
        });

        it('canvasGroup accessor returns the constructor-supplied svgGroup', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.canvasGroup).toBe(svgGroup);
            editor.dispose();
        });
    });

    /* ─────── M3.3.f property mutators + selection + condition paint ─────── */

    describe('property mutators + selection', () => {
        it('updateElementProperty replaces value + emits change + returns true', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('t1', { x: 100, y: 100 }, 'Initial')],
                    flows: [],
                },
            });
            const captured: number[] = [];
            editor.onChange(() => captured.push(1));

            expect(editor.updateElementProperty('t1', 'label', 'Updated')).toBe(
                true,
            );
            expect(editor.findElement('t1')?.label).toBe('Updated');
            expect(captured).toHaveLength(1);

            editor.dispose();
        });

        it('updateElementProperty with undefined on label strips the key', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('t1', { x: 100, y: 100 }, 'X')],
                    flows: [],
                },
            });
            editor.updateElementProperty('t1', 'label', undefined);
            const el = editor.findElement('t1')!;
            expect(el.label).toBeUndefined();
            expect('label' in el).toBe(false);
            editor.dispose();
        });

        it('updateElementProperty on unknown id returns false + no emit', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            const captured: number[] = [];
            editor.onChange(() => captured.push(1));
            expect(editor.updateElementProperty('missing', 'label', 'X')).toBe(
                false,
            );
            expect(captured).toHaveLength(0);
            editor.dispose();
        });

        it('updateFlowProperty stamps condition + revert via undefined strips', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [{ id: 'f1', source: 'a', target: 'b' }],
                },
            });

            editor.updateFlowProperty('f1', 'condition', 'expr');
            expect(editor.findFlow('f1')?.condition).toBe('expr');

            editor.updateFlowProperty('f1', 'condition', undefined);
            const f = editor.findFlow('f1')!;
            expect(f.condition).toBeUndefined();
            expect('condition' in f).toBe(false);

            editor.dispose();
        });

        it('updateFlowProperty stamps isDefault + revert via undefined strips', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [{ id: 'f1', source: 'a', target: 'b' }],
                },
            });

            editor.updateFlowProperty('f1', 'isDefault', true);
            expect(editor.findFlow('f1')?.isDefault).toBe(true);

            editor.updateFlowProperty('f1', 'isDefault', undefined);
            const f = editor.findFlow('f1')!;
            expect(f.isDefault).toBeUndefined();
            expect('isDefault' in f).toBe(false);

            editor.dispose();
        });

        it('updateFlowProperty on unknown id returns false', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.updateFlowProperty('missing', 'condition', 'X')).toBe(
                false,
            );
            editor.dispose();
        });

        it('editor exposes a selection state via the `selection` getter', () => {
            const editor = new BpmnLiteEditor({ host, commands, svgGroup });
            expect(editor.selection).toBeDefined();
            expect(editor.selection.target).toBeNull();
            editor.dispose();
        });

        it('load() clears selection', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a')],
                    flows: [],
                },
            });
            editor.selection.select({ kind: 'element', id: 'a' });

            editor.load(emptyBpmnLiteModel('q'));

            expect(editor.selection.target).toBeNull();
            editor.dispose();
        });

        it('repaint preserves the highlight class when selection survives', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a')],
                    flows: [],
                },
            });
            editor.selection.select({ kind: 'element', id: 'a' });

            // Trigger a repaint via an unrelated mutator.
            editor.updateElementProperty('a', 'label', 'X');

            const root = editor.paintedRootElement!;
            const g = Array.from(root.children).find(
                (c) => c.getAttribute('data-element-id') === 'a',
            )!;
            expect(
                g.classList.contains(
                    'coolms-designer__bpmn-element--selected',
                ),
            ).toBe(true);

            editor.dispose();
        });

        it('flow with condition paints an inline [condition] label', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [
                        {
                            id: 'f1',
                            source: 'a',
                            target: 'b',
                            condition: 'variables.x > 0',
                        },
                    ],
                },
            });

            const flowG = Array.from(
                editor.paintedFlowsElement?.children ?? [],
            ).find((c) => c.getAttribute('data-flow-id') === 'f1')!;
            const text = flowG.querySelector(
                '.coolms-designer__bpmn-flow-condition',
            );
            expect(text?.textContent).toBe('[variables.x > 0]');

            editor.dispose();
        });

        it('flow without condition paints no inline label', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [{ id: 'f1', source: 'a', target: 'b' }],
                },
            });

            const flowG = Array.from(
                editor.paintedFlowsElement?.children ?? [],
            ).find((c) => c.getAttribute('data-flow-id') === 'f1')!;
            const text = flowG.querySelector(
                '.coolms-designer__bpmn-flow-condition',
            );
            expect(text).toBeNull();

            editor.dispose();
        });

        it('whitespace-only condition does NOT paint the label', () => {
            const editor = new BpmnLiteEditor({
                host,
                commands,
                svgGroup,
                initialModel: {
                    processId: 'p',
                    elements: [task('a'), task('b', { x: 400, y: 100 })],
                    flows: [
                        {
                            id: 'f1',
                            source: 'a',
                            target: 'b',
                            condition: '   ',
                        },
                    ],
                },
            });

            const flowG = Array.from(
                editor.paintedFlowsElement?.children ?? [],
            ).find((c) => c.getAttribute('data-flow-id') === 'f1')!;
            expect(
                flowG.querySelector(
                    '.coolms-designer__bpmn-flow-condition',
                ),
            ).toBeNull();

            editor.dispose();
        });
    });
});
