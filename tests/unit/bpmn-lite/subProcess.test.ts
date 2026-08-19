import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    SVG_NS,
    bpmnLiteModelToWire,
    bpmnLiteWireToModel,
    defaultElementRendererRegistry,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * Embedded subprocess authoring -- the canvas half of the engine's
 * subprocess support.
 *
 * The canvas mirrors the engine's FLAT model exactly: a scope's children
 * are ordinary elements carrying `parent`, never nested objects. These
 * tests pin the three things that flatness does NOT give for free —
 * capture on drop, paint order, and the move cascade — plus the wire
 * round-trip.
 */
/** Package-relative fixture path (this file sits two levels under `tests/`). */
function fixturePath(relative: string): string {
    return resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../fixtures',
        relative,
    );
}

/** `start -> [sub.review: start -> service -> end] -> end`, as the canvas builds it. */
function designerAuthoredScope(): Parameters<typeof bpmnLiteModelToWire>[0] {
    return {
        processId: 'designer.subprocess',
        elements: [
            {
                id: 'start.go',
                type: 'startEvent',
                position: { x: 60, y: 220 },
                size: { width: 36, height: 36 },
            },
            {
                id: 'sub.review',
                type: 'subProcess',
                position: { x: 160, y: 140 },
                size: { width: 340, height: 200 },
                label: 'Review block',
            },
            {
                id: 'sub.start',
                type: 'startEvent',
                position: { x: 190, y: 220 },
                size: { width: 36, height: 36 },
                parent: 'sub.review',
            },
            {
                id: 'sub.work',
                type: 'task',
                position: { x: 260, y: 198 },
                size: { width: 100, height: 80 },
                variant: 'serviceTask',
                implementation: 'noop:echo',
                parent: 'sub.review',
            },
            {
                id: 'sub.end',
                type: 'endEvent',
                position: { x: 420, y: 220 },
                size: { width: 36, height: 36 },
                parent: 'sub.review',
            },
            {
                id: 'end.ok',
                type: 'endEvent',
                position: { x: 560, y: 220 },
                size: { width: 36, height: 36 },
            },
        ],
        flows: [
            { id: 'flow.s2sub', source: 'start.go', target: 'sub.review' },
            { id: 'flow.i1', source: 'sub.start', target: 'sub.work' },
            { id: 'flow.i2', source: 'sub.work', target: 'sub.end' },
            { id: 'flow.sub2e', source: 'sub.review', target: 'end.ok' },
        ],
    };
}

describe('embedded subprocess', () => {
    let host: HTMLDivElement;
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let editor: BpmnLiteEditor;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svg = document.createElementNS(SVG_NS, 'svg');
        svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);
        editor = new BpmnLiteEditor({
            host,
            svgGroup,
            commands: new CommandStack(),
            initialModel: { processId: 'p', elements: [], flows: [] },
        });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        svg.remove();
    });

    /** Places a container at a known world rect so drops are predictable. */
    function seedContainer(
        id = 'sub_1',
        rect = { x: 100, y: 100, width: 300, height: 200 },
    ): BpmnElement {
        const el: BpmnElement = {
            id,
            type: 'subProcess',
            position: { x: rect.x, y: rect.y },
            size: { width: rect.width, height: rect.height },
            label: 'Scope',
        };
        editor.addElement(el);
        return el;
    }

    describe('scope capture', () => {
        it('a point inside the container resolves to it', () => {
            seedContainer();
            expect(editor.containerAtWorldPoint({ x: 200, y: 180 })?.id).toBe(
                'sub_1',
            );
        });

        it('a point outside the container resolves to the root scope', () => {
            seedContainer();
            expect(editor.containerAtWorldPoint({ x: 20, y: 20 })).toBeNull();
        });

        /**
         * The INNERMOST container wins, not the last-painted one.
         * Containers paint outermost-first so a plain reverse scan would
         * pick the outer box and silently drop into the wrong scope.
         */
        it('nested containers resolve innermost-first', () => {
            seedContainer('sub_outer', {
                x: 0,
                y: 0,
                width: 600,
                height: 400,
            });
            seedContainer('sub_inner', {
                x: 100,
                y: 100,
                width: 200,
                height: 150,
            });
            editor.updateElementProperty('sub_inner', 'parent', 'sub_outer');

            expect(editor.containerAtWorldPoint({ x: 150, y: 150 })?.id).toBe(
                'sub_inner',
            );
            expect(editor.containerAtWorldPoint({ x: 500, y: 350 })?.id).toBe(
                'sub_outer',
            );
        });
    });

    describe('paint order', () => {
        /**
         * SVG has no z-index — paint order IS stacking order. A container
         * painted after its children would cover them with its own
         * hit-testable rect and make the whole scope unclickable.
         */
        /**
         * The child is added FIRST on purpose. Adding the container
         * first would make document order alone produce the right
         * answer, and the test would pass with the sort deleted —
         * proving nothing. This ordering can only come out right if
         * `paintRank` actually reorders.
         */
        it('containers paint before the elements inside them', () => {
            editor.addElement({
                id: 'task_1',
                type: 'task',
                position: { x: 150, y: 150 },
                size: { width: 100, height: 80 },
                parent: 'sub_1',
            });
            seedContainer();

            const painted = Array.from(
                svg.querySelectorAll('[data-element-id]'),
            ).map((n) => n.getAttribute('data-element-id'));

            expect(painted.indexOf('sub_1')).toBeLessThan(
                painted.indexOf('task_1'),
            );
        });

        /** Inner container added first, for the same reason. */
        it('an outer container paints before the container nested in it', () => {
            seedContainer('sub_inner', {
                x: 50,
                y: 50,
                width: 200,
                height: 150,
            });
            seedContainer('sub_outer', { x: 0, y: 0, width: 600, height: 400 });
            editor.updateElementProperty('sub_inner', 'parent', 'sub_outer');

            const painted = Array.from(
                svg.querySelectorAll('[data-element-id]'),
            ).map((n) => n.getAttribute('data-element-id'));

            expect(painted.indexOf('sub_outer')).toBeLessThan(
                painted.indexOf('sub_inner'),
            );
        });
    });

    describe('move cascade', () => {
        it('dragging the container carries its children', () => {
            seedContainer();
            editor.addElement({
                id: 'task_1',
                type: 'task',
                position: { x: 150, y: 150 },
                size: { width: 100, height: 80 },
                parent: 'sub_1',
            });

            editor.updateElementPosition('sub_1', { x: 300, y: 400 });

            const child = editor.state.elements.find((e) => e.id === 'task_1')!;
            // Container moved +200/+300, so the child must too — otherwise
            // the box slides off its own contents and leaves them behind.
            expect(child.position).toEqual({ x: 350, y: 450 });
        });

        it('carries grandchildren of a nested scope', () => {
            seedContainer('sub_outer', { x: 0, y: 0, width: 600, height: 400 });
            seedContainer('sub_inner', {
                x: 50,
                y: 50,
                width: 200,
                height: 150,
            });
            editor.updateElementProperty('sub_inner', 'parent', 'sub_outer');
            editor.addElement({
                id: 'task_1',
                type: 'task',
                position: { x: 80, y: 80 },
                size: { width: 100, height: 80 },
                parent: 'sub_inner',
            });

            editor.updateElementPosition('sub_outer', { x: 10, y: 20 });

            const inner = editor.state.elements.find(
                (e) => e.id === 'sub_inner',
            )!;
            const task = editor.state.elements.find((e) => e.id === 'task_1')!;
            expect(inner.position).toEqual({ x: 60, y: 70 });
            expect(task.position).toEqual({ x: 90, y: 100 });
        });

        it('leaves elements that merely OVERLAP the box behind', () => {
            // Geometry alone must not move anything: `parent` is the
            // relationship, and an element sitting on top of a container
            // without being in its scope is a legal (if untidy) diagram.
            seedContainer();
            editor.addElement({
                id: 'task_1',
                type: 'task',
                position: { x: 150, y: 150 },
                size: { width: 100, height: 80 },
            });

            editor.updateElementPosition('sub_1', { x: 300, y: 400 });

            const stray = editor.state.elements.find((e) => e.id === 'task_1')!;
            expect(stray.position).toEqual({ x: 150, y: 150 });
        });
    });

    describe('rendering', () => {
        it('draws a container rect and a top-left label', () => {
            const el = seedContainer();
            const node = defaultElementRendererRegistry().resolve('subProcess')(
                el,
                document,
            );

            expect(node.getAttribute('data-element-kind')).toBe('subProcess');
            expect(node.querySelector('rect')).not.toBeNull();

            // Top-left, NOT centred: a centred caption would sit under
            // whatever the author drops in the middle of the scope.
            const text = node.querySelector('text')!;
            expect(text.getAttribute('text-anchor')).toBe('start');
            expect(Number(text.getAttribute('y'))).toBeLessThan(
                el.size.height / 2,
            );
        });
    });

    describe('wire round-trip', () => {
        const body = {
            process: { id: 'demo.scope', version: 1 },
            elements: [
                { id: 'start.go', type: 'startEvent', out: ['f1'] },
                {
                    id: 'f1',
                    type: 'sequenceFlow',
                    source: 'start.go',
                    target: 'sub.review',
                },
                { id: 'sub.review', type: 'subProcess', in: ['f1'] },
                {
                    id: 'sub.start',
                    type: 'startEvent',
                    parent: 'sub.review',
                },
                {
                    id: 'sub.end',
                    type: 'endEvent',
                    parent: 'sub.review',
                },
            ],
        };

        it('reads `parent` into the model and writes it back', () => {
            const model = bpmnLiteWireToModel(body);
            const child = model.elements.find((e) => e.id === 'sub.start')!;
            expect(child.parent).toBe('sub.review');
            // Promoted, so it must NOT also linger in extras — a
            // double-write would emit it twice on save.
            expect(child.extras?.['parent']).toBeUndefined();

            const out = bpmnLiteModelToWire(model) as unknown as {
                elements: Array<Record<string, unknown>>;
            };
            const emitted = out.elements.find((e) => e['id'] === 'sub.start')!;
            expect(emitted['parent']).toBe('sub.review');
        });

        it('omits `parent` entirely for root-scope elements', () => {
            const model = bpmnLiteWireToModel(body);
            const out = bpmnLiteModelToWire(model) as unknown as {
                elements: Array<Record<string, unknown>>;
            };
            const root = out.elements.find((e) => e['id'] === 'start.go')!;
            // Absent, not `""` — an empty string would trip
            // `WF.SCOPE_UNKNOWN_PARENT` at deploy.
            expect('parent' in root).toBe(false);
        });

        /**
         * CROSS-LANGUAGE positive control.
         *
         * The fixture on disk is consumed by
         * `tests/Integration/Workflow/BpmnLiteValidationPipelineTest`,
         * which runs it through the REAL `BpmnLiteJsonParser` +
         * validator. Generating it here rather than hand-writing it on
         * the PHP side is the whole point: a hand-written fixture only
         * proves the parser accepts JSON someone BELIEVED the designer
         * emits. This one fails the moment the serializer drifts from
         * what the engine can deploy.
         *
         * Regenerate with `UPDATE_FIXTURES=1 npx vitest run`.
         */
        it('emits a scope the backend parser can deploy (fixture)', () => {
            const wire = bpmnLiteModelToWire(designerAuthoredScope());
            const path = fixturePath('designer-subprocess.bpmn.json');
            const serialized = `${JSON.stringify(wire, null, 2)}\n`;

            if (process.env['UPDATE_FIXTURES'] === '1') {
                writeFileSync(path, serialized, 'utf8');
            }

            expect(readFileSync(path, 'utf8')).toBe(serialized);
        });

        /**
         * A call activity is NOT a subprocess: no `parent`, and its one
         * load-bearing field is the callee's key.
         */
        it('round-trips a call activity and always emits `calledElement`', () => {
            const model = bpmnLiteWireToModel({
                process: { id: 'demo.caller', version: 1 },
                elements: [
                    {
                        id: 'call.child',
                        type: 'callActivity',
                        calledElement: 'billing.credit_check',
                    },
                    { id: 'call.blank', type: 'callActivity' },
                ],
            });

            expect(model.elements[0]!.calledElement).toBe(
                'billing.credit_check',
            );
            expect(model.elements[0]!.extras?.['calledElement']).toBeUndefined();

            const out = bpmnLiteModelToWire(model) as unknown as {
                elements: Array<Record<string, unknown>>;
            };
            const emitted = out.elements.find((e) => e['id'] === 'call.child')!;
            expect(emitted['calledElement']).toBe('billing.credit_check');

            // Emitted even when blank: "dropped the tile, haven't typed
            // the key yet" is a real authoring state, and the engine's
            // WF.CALL_NO_CALLED_ELEMENT is what reports it on deploy.
            const blank = out.elements.find((e) => e['id'] === 'call.blank')!;
            expect(blank['calledElement']).toBe('');
        });

        /**
         * The loop block is FLAT in the editor model and NESTED on the
         * wire; the serializer is the translation seam.
         */
        it('flattens and re-nests the multi-instance loop block', () => {
            const model = bpmnLiteWireToModel({
                process: { id: 'demo.mi', version: 1 },
                elements: [
                    {
                        id: 'svc.each',
                        type: 'serviceTask',
                        implementation: 'noop:echo',
                        loopCharacteristics: {
                            collection: 'variables["items"]',
                            elementVariable: 'row',
                            completionCondition: 'variables["done"]',
                        },
                    },
                ],
            });

            const el = model.elements[0]!;
            expect(el.loopCollection).toBe('variables["items"]');
            expect(el.loopElementVariable).toBe('row');
            expect(el.loopCompletionCondition).toBe('variables["done"]');
            expect(el.extras?.['loopCharacteristics']).toBeUndefined();

            const out = bpmnLiteModelToWire(model) as unknown as {
                elements: Array<Record<string, unknown>>;
            };
            expect(out.elements[0]!['loopCharacteristics']).toEqual({
                collection: 'variables["items"]',
                elementVariable: 'row',
                completionCondition: 'variables["done"]',
            });
        });

        it('drops the loop block entirely when the collection is cleared', () => {
            // Emitting `loopCharacteristics: {collection: ""}` would make
            // the engine reject the body with WF.MI_NO_COLLECTION, so
            // clearing the field has to mean "plain activity again".
            const out = bpmnLiteModelToWire({
                processId: 'demo.mi',
                elements: [
                    {
                        id: 'svc.each',
                        type: 'task',
                        position: { x: 0, y: 0 },
                        size: { width: 100, height: 80 },
                        variant: 'serviceTask',
                        loopCollection: '',
                        loopElementVariable: 'row',
                    },
                ],
                flows: [],
            }) as unknown as { elements: Array<Record<string, unknown>> };

            expect('loopCharacteristics' in out.elements[0]!).toBe(false);
        });

        it('keeps a malformed `parent` in extras rather than dropping it', () => {
            const model = bpmnLiteWireToModel({
                process: { id: 'demo.bad', version: 1 },
                elements: [{ id: 'a', type: 'task', parent: 42 }],
            });
            expect(model.elements[0]!.parent).toBeUndefined();
            expect(model.elements[0]!.extras?.['parent']).toBe(42);
        });
    });
});
