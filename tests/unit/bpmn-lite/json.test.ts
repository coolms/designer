import { describe, it, expect } from 'vitest';

import {
    bpmnLiteJsonToModel,
    bpmnLiteModelToJson,
    bpmnLiteModelToWire,
    bpmnLiteWireToModel,
    BpmnLiteParseError,
    emptyBpmnLiteModel,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnLiteModel,
    BpmnSequenceFlow,
} from '../../../src/bpmn-lite/index.js';

/**
 * BPMN-Lite JSON round-trip serializer tests.
 *
 * **Pinning strategy**: each test exercises one or both of:
 *  - `toJson(model)` -- structural assertions on the wire shape
 *  - `roundTrip(model)` -- toJson then fromJson, assert equality
 *    (the round-trip invariant is the headline)
 */
describe('BPMN-Lite JSON serializer', () => {
    function task(id: string, x = 100, label?: string): BpmnElement {
        return {
            id,
            type: 'task',
            position: { x, y: 100 },
            size: { width: 100, height: 80 },
            ...(label !== undefined ? { label } : {}),
        };
    }

    function flow(
        id: string,
        source: string,
        target: string,
        extras?: Partial<BpmnSequenceFlow>,
    ): BpmnSequenceFlow {
        return { id, source, target, ...extras };
    }

    /** Round-trip a model through JSON + assert deep equality. */
    function roundTrip(model: BpmnLiteModel): BpmnLiteModel {
        const json = bpmnLiteModelToJson(model);
        return bpmnLiteJsonToModel(json);
    }

    /* ──────────────────────── toJson structural pins ─────────────────────── */

    describe('toJson', () => {
        it('emits process header + empty elements array for empty model', () => {
            const wire = bpmnLiteModelToWire(emptyBpmnLiteModel('p1'));
            expect(wire).toEqual({
                process: { id: 'p1' },
                elements: [],
            });
        });

        it('omits diagram key when no non-default geometry is present', () => {
            const wire = bpmnLiteModelToWire(emptyBpmnLiteModel('p1'));
            expect('diagram' in wire).toBe(false);
        });

        it('emits elements before flows in the wire array', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            };
            const wire = bpmnLiteModelToWire(model);
            const elements = wire['elements'] as Array<Record<string, unknown>>;
            expect(elements[0]?.['id']).toBe('a');
            expect(elements[1]?.['id']).toBe('b');
            expect(elements[2]?.['id']).toBe('f1');
            expect(elements[2]?.['type']).toBe('sequenceFlow');
        });

        it('synthesises in/out arrays on each element from the flows', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            };
            const wire = bpmnLiteModelToWire(model);
            const elements = wire['elements'] as Array<Record<string, unknown>>;
            expect(elements[0]?.['out']).toEqual(['f1']);
            expect(elements[0]?.['in']).toBeUndefined();
            expect(elements[1]?.['in']).toEqual(['f1']);
            expect(elements[1]?.['out']).toBeUndefined();
        });

        it('emits condition as {language, expression} object', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a'), task('b', 400)],
                flows: [flow('f1', 'a', 'b', { condition: 'x > 0' })],
            };
            const wire = bpmnLiteModelToWire(model);
            const flowWire = (wire['elements'] as Array<Record<string, unknown>>)[2];
            expect(flowWire?.['condition']).toEqual({
                language: 'EL',
                expression: 'x > 0',
            });
        });

        it('migrates isDefault on flow to `default` on the source element', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [
                    {
                        id: 'gw',
                        type: 'exclusiveGateway',
                        position: { x: 100, y: 100 },
                        size: { width: 50, height: 50 },
                    },
                    task('a', 400),
                ],
                flows: [flow('f1', 'gw', 'a', { isDefault: true })],
            };
            const wire = bpmnLiteModelToWire(model);
            const elements = wire['elements'] as Array<Record<string, unknown>>;
            // Gateway element carries the default ref.
            expect(elements[0]?.['default']).toBe('f1');
            // Flow itself does NOT carry isDefault in wire format.
            const flowWire = elements[2];
            expect(flowWire?.['isDefault']).toBeUndefined();
        });

        it('emits diagram.elements only when geometry differs from defaults', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [
                    // Position (100, 100) is non-default (defaults are 0, 0).
                    task('a', 100),
                ],
                flows: [],
            };
            const wire = bpmnLiteModelToWire(model);
            const diagram = wire['diagram'] as Record<string, unknown>;
            expect(diagram).toBeDefined();
            expect(diagram['elements']).toEqual({
                a: {
                    bounds: { x: 100, y: 100, width: 100, height: 80 },
                },
            });
        });

        it('emits diagram.flows when manual waypoints are present', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a'), task('b', 400)],
                flows: [
                    flow('f1', 'a', 'b', {
                        waypoints: [
                            { x: 200, y: 140 },
                            { x: 300, y: 140 },
                        ],
                    }),
                ],
            };
            const wire = bpmnLiteModelToWire(model);
            const diagram = wire['diagram'] as Record<string, unknown>;
            const flowsDi = diagram['flows'] as Record<string, unknown>;
            expect(flowsDi['f1']).toEqual({
                waypoints: [
                    { x: 200, y: 140 },
                    { x: 300, y: 140 },
                ],
            });
        });

        it('re-emits processExtras verbatim alongside id', () => {
            const model: BpmnLiteModel = {
                processId: 'p1',
                elements: [],
                flows: [],
                processExtras: {
                    version: 2,
                    documentation: 'desc',
                    variables: { userId: { type: 'uuid' } },
                },
            };
            const wire = bpmnLiteModelToWire(model);
            const proc = wire['process'] as Record<string, unknown>;
            expect(proc['id']).toBe('p1');
            expect(proc['version']).toBe(2);
            expect(proc['documentation']).toBe('desc');
            expect(proc['variables']).toEqual({ userId: { type: 'uuid' } });
        });

        it('re-emits element extras verbatim BEFORE managed keys', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [
                    {
                        id: 'svc',
                        type: 'task',
                        position: { x: 0, y: 0 },
                        size: { width: 100, height: 80 },
                        label: 'Real label',
                        extras: {
                            label: 'Should be overridden',
                            // Use non-reserved keys here -- M3.3.i promoted
                            // variant + implementation + formKey to top-level
                            // slots; they're now in {@link RESERVED_ELEMENT_KEYS}
                            // and stripped from extras at serialise time.
                            documentation: 'svc desc',
                            inputs: { a: 1 },
                        },
                    },
                ],
                flows: [],
            };
            const wire = bpmnLiteModelToWire(model);
            const elements = wire['elements'] as Array<Record<string, unknown>>;
            const el = elements[0]!;
            // Managed `label` wins.
            expect(el['label']).toBe('Real label');
            // Unknown extras flow through.
            expect(el['documentation']).toBe('svc desc');
            expect(el['inputs']).toEqual({ a: 1 });
        });

        it('omits empty condition strings', () => {
            const model: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a'), task('b', 400)],
                flows: [flow('f1', 'a', 'b', { condition: '' })],
            };
            const wire = bpmnLiteModelToWire(model);
            const elements = wire['elements'] as Array<Record<string, unknown>>;
            expect(elements[2]?.['condition']).toBeUndefined();
        });

        it('pretty-prints with 2-space indent by default', () => {
            const json = bpmnLiteModelToJson(emptyBpmnLiteModel('p'));
            expect(json.includes('\n')).toBe(true);
            expect(json.startsWith('{\n  "process"')).toBe(true);
        });

        it('supports compact emission with indent: 0', () => {
            const json = bpmnLiteModelToJson(emptyBpmnLiteModel('p'), {
                indent: 0,
            });
            expect(json.includes('\n')).toBe(false);
        });
    });

    /* ────────────────────── fromJson structural pins ────────────────────── */

    describe('fromJson', () => {
        it('throws BpmnLiteParseError on invalid JSON', () => {
            expect(() => bpmnLiteJsonToModel('not json')).toThrow(
                BpmnLiteParseError,
            );
        });

        it('throws on non-object root', () => {
            expect(() => bpmnLiteJsonToModel('[]')).toThrow(BpmnLiteParseError);
            expect(() => bpmnLiteJsonToModel('"str"')).toThrow(
                BpmnLiteParseError,
            );
        });

        it('throws on non-array elements field', () => {
            expect(() =>
                bpmnLiteJsonToModel('{"elements": "nope"}'),
            ).toThrow(BpmnLiteParseError);
        });

        it('throws on element without id', () => {
            expect(() =>
                bpmnLiteJsonToModel(
                    '{"elements":[{"type":"task"}]}',
                ),
            ).toThrow(BpmnLiteParseError);
        });

        it('throws on element without type', () => {
            expect(() =>
                bpmnLiteJsonToModel('{"elements":[{"id":"a"}]}'),
            ).toThrow(BpmnLiteParseError);
        });

        it('throws on sequenceFlow without source', () => {
            expect(() =>
                bpmnLiteJsonToModel(
                    '{"elements":[{"id":"f","type":"sequenceFlow","target":"b"}]}',
                ),
            ).toThrow(BpmnLiteParseError);
        });

        it('defaults missing process to process.unnamed', () => {
            const model = bpmnLiteJsonToModel('{}');
            expect(model.processId).toBe('process.unnamed');
            expect(model.elements).toEqual([]);
            expect(model.flows).toEqual([]);
        });

        it('parses condition object back to bare string', () => {
            const json = `{
                "elements": [
                    {"id":"a","type":"task"},
                    {"id":"b","type":"task"},
                    {"id":"f1","type":"sequenceFlow","source":"a","target":"b",
                     "condition":{"language":"EL","expression":"x > 0"}}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.flows[0]?.condition).toBe('x > 0');
        });

        it('tolerates bare-string condition shape (forward compat)', () => {
            const json = `{
                "elements": [
                    {"id":"a","type":"task"},
                    {"id":"b","type":"task"},
                    {"id":"f1","type":"sequenceFlow","source":"a","target":"b",
                     "condition":"x > 0"}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.flows[0]?.condition).toBe('x > 0');
        });

        it('migrates `default` on element to `isDefault` on the matching flow', () => {
            const json = `{
                "elements": [
                    {"id":"gw","type":"exclusiveGateway","default":"f1"},
                    {"id":"a","type":"task"},
                    {"id":"f1","type":"sequenceFlow","source":"gw","target":"a"}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.flows[0]?.isDefault).toBe(true);
        });

        it('preserves unknown element fields in extras', () => {
            // promoted variant/implementation/formKey to top-level
            // slots; this test now uses keys that are NOT promoted (they
            // continue to land in extras for lossless round-trip).
            const json = `{
                "elements": [
                    {"id":"svc","type":"task","documentation":"doc",
                     "inputs":{"a":1},"label":"Send"}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            const el = model.elements[0]!;
            expect(el.label).toBe('Send');
            expect(el.extras).toEqual({
                documentation: 'doc',
                inputs: { a: 1 },
            });
        });

        it('preserves unknown process fields in processExtras', () => {
            const json = `{
                "process": {"id":"p1","version":2,"documentation":"x"},
                "elements": []
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.processExtras).toEqual({
                version: 2,
                documentation: 'x',
            });
        });

        it('preserves unsupported element kinds in processExtras.unsupportedElements', () => {
            const json = `{
                "elements": [
                    {"id":"u1","type":"messageEvent","name":"Foo"}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.elements).toEqual([]);
            const unsupported = (model.processExtras ?? {})[
                'unsupportedElements'
            ] as Array<Record<string, unknown>>;
            expect(unsupported).toEqual([
                { id: 'u1', type: 'messageEvent', name: 'Foo' },
            ]);
        });

        it('reads bounds from diagram sidecar', () => {
            const json = `{
                "elements": [{"id":"a","type":"task"}],
                "diagram": {
                    "elements": {
                        "a": { "bounds": {"x":300,"y":200,"width":120,"height":90} }
                    }
                }
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.elements[0]?.position).toEqual({ x: 300, y: 200 });
            expect(model.elements[0]?.size).toEqual({ width: 120, height: 90 });
        });

        it('falls back to default geometry when diagram bounds missing', () => {
            const json = `{
                "elements": [{"id":"a","type":"task"}]
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.elements[0]?.size).toEqual({ width: 100, height: 80 });
        });

        it('reads manual waypoints from diagram sidecar', () => {
            const json = `{
                "elements": [
                    {"id":"a","type":"task"},
                    {"id":"b","type":"task"},
                    {"id":"f1","type":"sequenceFlow","source":"a","target":"b"}
                ],
                "diagram": {
                    "flows": {
                        "f1": {
                            "waypoints": [
                                {"x":0,"y":0},
                                {"x":100,"y":100}
                            ]
                        }
                    }
                }
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.flows[0]?.waypoints).toEqual([
                { x: 0, y: 0 },
                { x: 100, y: 100 },
            ]);
        });

        it('ignores in/out fields (flows array is authoritative)', () => {
            const json = `{
                "elements": [
                    {"id":"a","type":"task","out":["nonexistent_flow"]},
                    {"id":"b","type":"task","in":["nonexistent_flow"]}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            expect(model.flows).toEqual([]);
            // The bogus in/out arrays should not contaminate extras either.
            expect(model.elements[0]?.extras).toBeUndefined();
            expect(model.elements[1]?.extras).toBeUndefined();
        });
    });

    /* ────────────────────── Round-trip invariants ────────────────────── */

    describe('round-trip', () => {
        it('empty model survives', () => {
            const m = emptyBpmnLiteModel('p');
            const back = roundTrip(m);
            expect(back).toEqual(m);
        });

        it('single element with label survives', () => {
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [task('t1', 150, 'Hello')],
                flows: [],
            };
            const back = roundTrip(m);
            expect(back.elements[0]?.label).toBe('Hello');
            expect(back.elements[0]?.position).toEqual(m.elements[0]?.position);
            expect(back.elements[0]?.size).toEqual(m.elements[0]?.size);
        });

        it('element + auto-routed flow survives', () => {
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b')],
            };
            const back = roundTrip(m);
            expect(back.elements.length).toBe(2);
            expect(back.flows.length).toBe(1);
            expect(back.flows[0]?.waypoints).toBeUndefined();
        });

        it('element + flow with condition survives', () => {
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a', 100), task('b', 400)],
                flows: [flow('f1', 'a', 'b', { condition: 'x > 0' })],
            };
            const back = roundTrip(m);
            expect(back.flows[0]?.condition).toBe('x > 0');
        });

        it('flow with isDefault survives via the default migration', () => {
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [
                    {
                        id: 'gw',
                        type: 'exclusiveGateway',
                        position: { x: 100, y: 100 },
                        size: { width: 50, height: 50 },
                    },
                    task('a', 400),
                ],
                flows: [flow('f1', 'gw', 'a', { isDefault: true })],
            };
            const back = roundTrip(m);
            expect(back.flows[0]?.isDefault).toBe(true);
        });

        it('flow with manual waypoints survives', () => {
            const wps = [
                { x: 200, y: 140 },
                { x: 300, y: 140 },
                { x: 400, y: 140 },
            ];
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a'), task('b', 400)],
                flows: [flow('f1', 'a', 'b', { waypoints: wps })],
            };
            const back = roundTrip(m);
            expect(back.flows[0]?.waypoints).toEqual(wps);
        });

        it('processExtras survives + carries arbitrary fields', () => {
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [],
                flows: [],
                processExtras: { version: 1, custom: 'value' },
            };
            const back = roundTrip(m);
            expect(back.processExtras).toEqual({ version: 1, custom: 'value' });
        });

        it('element extras survive + don’t collide with managed keys', () => {
            // variant/implementation/formKey are now promoted slots,
            // not extras. Use non-promoted keys to exercise the extras
            // round-trip while letting the promoted-slot round-trip live
            // in the dedicated M3.3.i section below.
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [
                    {
                        id: 't1',
                        type: 'task',
                        position: { x: 100, y: 100 },
                        size: { width: 100, height: 80 },
                        label: 'X',
                        extras: {
                            documentation: 'docs',
                            inputs: { a: 1 },
                        },
                    },
                ],
                flows: [],
            };
            const back = roundTrip(m);
            expect(back.elements[0]?.label).toBe('X');
            expect(back.elements[0]?.extras).toEqual({
                documentation: 'docs',
                inputs: { a: 1 },
            });
        });

        it('mixed-kind model with multiple elements + flows survives', () => {
            const m: BpmnLiteModel = {
                processId: 'process.demo',
                elements: [
                    {
                        id: 'start',
                        type: 'startEvent',
                        position: { x: 50, y: 100 },
                        size: { width: 36, height: 36 },
                    },
                    task('approve', 200, 'Approve'),
                    {
                        id: 'gw',
                        type: 'exclusiveGateway',
                        position: { x: 400, y: 110 },
                        size: { width: 50, height: 50 },
                    },
                    {
                        id: 'end',
                        type: 'endEvent',
                        position: { x: 600, y: 100 },
                        size: { width: 36, height: 36 },
                    },
                ],
                flows: [
                    flow('f1', 'start', 'approve'),
                    flow('f2', 'approve', 'gw'),
                    flow('f3', 'gw', 'end', {
                        condition: 'approved == true',
                    }),
                ],
            };
            const back = roundTrip(m);
            expect(back.processId).toBe('process.demo');
            expect(back.elements.length).toBe(4);
            expect(back.flows.length).toBe(3);
            expect(back.flows[2]?.condition).toBe('approved == true');
        });

        it('unsupported elements survive a round-trip via processExtras', () => {
            const json = `{
                "process":{"id":"p"},
                "elements":[
                    {"id":"a","type":"task"},
                    {"id":"msg","type":"messageEvent","name":"Foo"}
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            const back = bpmnLiteJsonToModel(bpmnLiteModelToJson(model));
            const unsupported = (back.processExtras ?? {})[
                'unsupportedElements'
            ] as Array<Record<string, unknown>>;
            expect(unsupported).toEqual([
                { id: 'msg', type: 'messageEvent', name: 'Foo' },
            ]);
        });
    });

    /* ────────────────────────── M3.3.i variant / impl / formKey ─────────────────── */

    describe('M3.3.i — variant, implementation, formKey promotion', () => {
        it('reads variant/implementation/formKey out of element extras into top-level slots', () => {
            const json = `{
                "process": {"id": "p1"},
                "elements": [
                    {
                        "id": "t1",
                        "type": "task",
                        "variant": "serviceTask",
                        "implementation": "email.send",
                        "label": "Send"
                    },
                    {
                        "id": "t2",
                        "type": "task",
                        "variant": "userTask",
                        "formKey": "identity.verify_email_otp",
                        "label": "Verify"
                    }
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            const svc = model.elements[0]!;
            expect(svc.variant).toBe('serviceTask');
            expect(svc.implementation).toBe('email.send');
            expect(svc.extras).toBeUndefined();
            const usr = model.elements[1]!;
            expect(usr.variant).toBe('userTask');
            expect(usr.formKey).toBe('identity.verify_email_otp');
            expect(usr.extras).toBeUndefined();
        });

        it('emits promoted slots at top level on toJson + leaves extras clean', () => {
            // **M3.3.l-followup**: editor `{type: 'task', variant: 'serviceTask'}`
            // emits wire `type: 'serviceTask'` (NOT `type: 'task' + variant: '…'`)
            // because the M2.c parser dispatches the task family on the wire
            // `type` field, not on `variant`. The `variant` field is reserved
            // for event sub-flavours (`message`, `timer`); emitting it on a
            // task would be redundant + ignored by M2.c. See
            // `WIRE_TASK_TYPE_TO_VARIANT` in `fromJson.ts`.
            const svcTask: BpmnElement = {
                id: 't1',
                type: 'task',
                position: { x: 0, y: 0 },
                size: { width: 100, height: 80 },
                variant: 'serviceTask',
                implementation: 'email.send',
                label: 'Send',
            };
            const wire = bpmnLiteModelToWire({
                processId: 'p1',
                elements: [svcTask],
                flows: [],
            });
            const elements = wire['elements'] as Array<Record<string, unknown>>;
            expect(elements[0]).toMatchObject({
                id: 't1',
                type: 'serviceTask',
                label: 'Send',
                implementation: 'email.send',
            });
            // `variant` MUST NOT appear on the wire for task subtypes --
            // the wire `type` field carries that signal.
            expect(elements[0]).not.toHaveProperty('variant');
        });

        it('round-trips variant/implementation/formKey losslessly', () => {
            const model: BpmnLiteModel = {
                processId: 'p1',
                elements: [
                    {
                        id: 't1',
                        type: 'task',
                        position: { x: 100, y: 100 },
                        size: { width: 100, height: 80 },
                        variant: 'serviceTask',
                        implementation: 'identity.otp.send_code',
                        label: 'Send OTP',
                    },
                    {
                        id: 't2',
                        type: 'task',
                        position: { x: 250, y: 100 },
                        size: { width: 100, height: 80 },
                        variant: 'userTask',
                        formKey: 'identity.verify_email_otp',
                        label: 'Verify',
                    },
                ],
                flows: [],
            };
            const back = roundTrip(model);
            expect(back.elements[0]?.variant).toBe('serviceTask');
            expect(back.elements[0]?.implementation).toBe('identity.otp.send_code');
            expect(back.elements[1]?.variant).toBe('userTask');
            expect(back.elements[1]?.formKey).toBe('identity.verify_email_otp');
        });

        it('strips promoted-slot keys from extras even when they come back via the wire', () => {
            // Hand-authored JSON puts the slot inside extras (e.g. via a
            // tenant tool that didn't know they were promoted in M3.3.i).
            // fromJson promotes them; toJson re-emits at top level only.
            const json = `{
                "process": {"id": "p1"},
                "elements": [
                    {
                        "id": "t1",
                        "type": "task",
                        "variant": "serviceTask",
                        "implementation": "email.send",
                        "custom_extra": "kept"
                    }
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            const t = model.elements[0]!;
            expect(t.variant).toBe('serviceTask');
            expect(t.implementation).toBe('email.send');
            expect(t.extras).toEqual({ custom_extra: 'kept' });
            // Custom extras still survive the round-trip.
            const back = roundTrip(model);
            expect(back.elements[0]?.extras).toEqual({ custom_extra: 'kept' });
        });
    });

    /* ───────────────── M3.3.l-followup: wire task-type translation ──────────────── */

    describe('M3.3.l-followup — wire-task-type ⇄ editor-variant translation', () => {
        it('reads wire `type: "userTask"` as editor `{type: "task", variant: "userTask"}`', () => {
            // **The M2.c wire shape** -- the parser emits the full type name
            // (`userTask` / `serviceTask`) on the wire, NOT a plain `task`
            // with a `variant` sidecar. The editor model collapses the task
            // family into the closed 5-kind `BpmnElementKind` set + carries
            // the subtype on `variant`. The serializer translates at the seam.
            const json = `{
                "process": {"id": "p1"},
                "elements": [
                    {
                        "id": "t1",
                        "type": "userTask",
                        "formKey": "identity.verify_email_otp",
                        "label": "Enter OTP"
                    },
                    {
                        "id": "t2",
                        "type": "serviceTask",
                        "implementation": "identity.otp.send_code",
                        "label": "Send OTP"
                    }
                ]
            }`;
            const model = bpmnLiteJsonToModel(json);
            const usr = model.elements[0]!;
            const svc = model.elements[1]!;
            // Both collapse to the `task` kind in the editor model...
            expect(usr.type).toBe('task');
            expect(svc.type).toBe('task');
            // ...with the variant carrying the wire-type signal.
            expect(usr.variant).toBe('userTask');
            expect(svc.variant).toBe('serviceTask');
            // Promoted slots survive the translation.
            expect(usr.formKey).toBe('identity.verify_email_otp');
            expect(svc.implementation).toBe('identity.otp.send_code');
            expect(usr.label).toBe('Enter OTP');
            expect(svc.label).toBe('Send OTP');
            // No extras leakage from the recognised wire fields.
            expect(usr.extras).toBeUndefined();
            expect(svc.extras).toBeUndefined();
        });

        it('emits editor `{type: "task", variant: "userTask"}` as wire `type: "userTask"`', () => {
            // **The inverse** -- a clean wire body that M2.c will read with
            // full `UserTaskAst` / `ServiceTaskAst` runtime semantics. The
            // pre-fix shape `type: "task" + variant: "userTask"` made M2.c
            // build a plain `TaskAst` (no Inbox creation on park, no handler
            // dispatch), silently losing the runtime behaviour.
            const usrTask: BpmnElement = {
                id: 't1',
                type: 'task',
                position: { x: 0, y: 0 },
                size: { width: 100, height: 80 },
                variant: 'userTask',
                formKey: 'identity.verify_email_otp',
            };
            const wire = bpmnLiteModelToWire({
                processId: 'p1',
                elements: [usrTask],
                flows: [],
            });
            const els = wire['elements'] as Array<Record<string, unknown>>;
            expect(els[0]?.['type']).toBe('userTask');
            // No `variant` field on the wire -- the wire `type` is the signal.
            expect(els[0]).not.toHaveProperty('variant');
            // Promoted slot survives.
            expect(els[0]?.['formKey']).toBe('identity.verify_email_otp');
        });

        it('round-trips wire task subtypes losslessly through the editor model', () => {
            const original = `{
                "process": {"id": "identity.verify_new_user_spine"},
                "elements": [
                    {"id": "t1", "type": "userTask", "formKey": "f1"},
                    {"id": "t2", "type": "serviceTask", "implementation": "h1"},
                    {"id": "t3", "type": "task"}
                ]
            }`;
            const model = bpmnLiteJsonToModel(original);
            // All three land as `task` in the editor with the right variants.
            expect(model.elements.map((e) => e.type)).toEqual([
                'task',
                'task',
                'task',
            ]);
            expect(model.elements.map((e) => e.variant)).toEqual([
                'userTask',
                'serviceTask',
                undefined,
            ]);
            // Round-trip back to the wire reproduces the M2.c shape.
            const wire = bpmnLiteModelToWire(model);
            const els = wire['elements'] as Array<Record<string, unknown>>;
            expect(els.map((e) => e['type'])).toEqual([
                'userTask',
                'serviceTask',
                'task',
            ]);
        });

        it('honours legacy M3.3.i pre-fix shape: `type: "task" + variant: "userTask"` still parses + upgrades on save', () => {
            // **Forward-compat**: drafts that the broken pre-fix `toJson`
            // emitted (or hand-authored bodies that used the schema
            // verbatim) carry `type: "task"` + an explicit `variant` slot.
            // The variant slot is honoured at parse time so existing drafts
            // don't lose their subtype. On save, `toJson` emits the
            // M2.c-correct wire shape -- effectively an in-place upgrade.
            const legacy = `{
                "process": {"id": "p1"},
                "elements": [
                    {
                        "id": "t1",
                        "type": "task",
                        "variant": "userTask",
                        "formKey": "f1"
                    }
                ]
            }`;
            const model = bpmnLiteJsonToModel(legacy);
            expect(model.elements[0]?.type).toBe('task');
            expect(model.elements[0]?.variant).toBe('userTask');
            expect(model.elements[0]?.formKey).toBe('f1');
            // Re-saving emits the new shape -- the upgrade is automatic.
            const wire = bpmnLiteModelToWire(model);
            const els = wire['elements'] as Array<Record<string, unknown>>;
            expect(els[0]?.['type']).toBe('userTask');
            expect(els[0]).not.toHaveProperty('variant');
        });

        it('M2.n verify-spine regression: 6 elements + 5 flows survive, start has outgoing', () => {
            // Mirror of the deployed `identity.verify_new_user_spine` body --
            // the shape that triggered the M3.3.l-followup investigation.
            // Pre-fix, fromJson silently dropped the 2 serviceTasks + the
            // userTask + 4 of the 5 flows; only `start.registered`,
            // `gw.email_result`, `end.verified`, + `flow.email_ok` survived.
            // Post-fix all 6 elements + 5 flows survive.
            const spine = JSON.stringify({
                process: { id: 'identity.verify_new_user_spine' },
                elements: [
                    { id: 'start.registered', type: 'startEvent' },
                    { id: 'svc.email.sendCode', type: 'serviceTask', implementation: 'identity.otp.send_code' },
                    { id: 'task.email.enter_otp', type: 'userTask', formKey: 'identity.verify_email_otp' },
                    { id: 'svc.email.verify', type: 'serviceTask', implementation: 'identity.otp.verify' },
                    { id: 'gw.email_result', type: 'exclusiveGateway' },
                    { id: 'end.verified', type: 'endEvent' },
                    { id: 'flow.start_to_send', type: 'sequenceFlow', source: 'start.registered', target: 'svc.email.sendCode' },
                    { id: 'flow.send_to_user_task', type: 'sequenceFlow', source: 'svc.email.sendCode', target: 'task.email.enter_otp' },
                    { id: 'flow.user_task_to_verify', type: 'sequenceFlow', source: 'task.email.enter_otp', target: 'svc.email.verify' },
                    { id: 'flow.verify_to_result', type: 'sequenceFlow', source: 'svc.email.verify', target: 'gw.email_result' },
                    { id: 'flow.email_ok', type: 'sequenceFlow', source: 'gw.email_result', target: 'end.verified' },
                    { id: 'flow.email_retry', type: 'sequenceFlow', source: 'gw.email_result', target: 'task.email.enter_otp' },
                ],
            });
            const model = bpmnLiteJsonToModel(spine);
            expect(model.elements).toHaveLength(6);
            expect(model.flows).toHaveLength(6);
            // The start event has at least one outgoing flow -- no orphan.
            const start = model.elements.find((e) => e.id === 'start.registered')!;
            const outgoing = model.flows.filter((f) => f.source === start.id);
            expect(outgoing.length).toBeGreaterThanOrEqual(1);
            // The two serviceTasks + the userTask all survive as `task`
            // with the right variants.
            const byId = new Map(model.elements.map((e) => [e.id, e]));
            expect(byId.get('svc.email.sendCode')?.type).toBe('task');
            expect(byId.get('svc.email.sendCode')?.variant).toBe('serviceTask');
            expect(byId.get('svc.email.verify')?.variant).toBe('serviceTask');
            expect(byId.get('task.email.enter_otp')?.variant).toBe('userTask');
        });
    });

    /* ────────────────────── bpmnLiteWireToModel direct ────────────────────── */

    describe('bpmnLiteWireToModel + bpmnLiteModelToWire (object entry points)', () => {
        it('round-trip through the object form', () => {
            const m: BpmnLiteModel = {
                processId: 'p',
                elements: [task('a', 100, 'A')],
                flows: [],
            };
            const wire = bpmnLiteModelToWire(m);
            const back = bpmnLiteWireToModel(wire);
            expect(back.elements[0]?.label).toBe('A');
        });

        it('throws BpmnLiteParseError when handed a non-object', () => {
            expect(() => bpmnLiteWireToModel('nope')).toThrow(
                BpmnLiteParseError,
            );
        });
    });
});
