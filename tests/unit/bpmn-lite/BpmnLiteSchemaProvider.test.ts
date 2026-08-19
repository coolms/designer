import { describe, it, expect } from 'vitest';

import {
    BpmnLiteSchemaProvider,
    defaultBpmnLiteSchemaProvider,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';
import type { FieldDescriptor } from '../../../src/property-panel/FieldDescriptor.js';

/**
 * BpmnLiteSchemaProvider pins.
 */
describe('BpmnLiteSchemaProvider', () => {
    it('defaults expose a label field for every element kind', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        for (const kind of [
            'startEvent',
            'endEvent',
            'task',
            'exclusiveGateway',
            'parallelGateway',
        ] as const) {
            const schema = provider.getSchema(kind);
            expect(schema.length).toBeGreaterThan(0);
            expect(schema[0]?.key).toBe('label');
            expect(schema[0]?.type).toBe('text');
        }
    });

    it('flow schema has condition + isDefault in that order', () => {
        const schema = defaultBpmnLiteSchemaProvider().getSchema('flow');
        expect(schema.map((f) => f.key)).toEqual(['condition', 'isDefault']);
        expect(schema[0]?.type).toBe('el-expression');
        expect(schema[1]?.type).toBe('boolean');
    });

    it('returns empty array for unknown keys', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        // Cast through unknown so we can probe the runtime fallback.
        const result = provider.getSchema(
            'unknownKind' as unknown as 'task',
        );
        expect(result).toEqual([]);
    });

    it('keys() returns all registered keys', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        const keys = provider.keys();
        expect(keys).toContain('startEvent');
        expect(keys).toContain('flow');
        // 6 keys (5 kinds + flow); + userTask + serviceTask = 8;
        // catch events: + intermediateCatchEvent + its 4 `:subtype` keys = 13;
        // boundary events: + boundaryEvent + its 5 `:subtype` keys = 19;
        // gateways: + inclusiveGateway + eventBasedGateway = 21.
        expect(keys).toContain('userTask');
        expect(keys).toContain('serviceTask');
        expect(keys).toContain('intermediateCatchEvent');
        expect(keys).toContain('intermediateCatchEvent:timer');
        expect(keys).toContain('boundaryEvent');
        expect(keys).toContain('boundaryEvent:error');
        expect(keys).toContain('inclusiveGateway');
        expect(keys).toContain('eventBasedGateway');
        expect(keys).toContain('subProcess');
        expect(keys).toContain('callActivity');
        expect(keys.length).toBe(23);
    });

    it('caller overrides replace the default schema for that key', () => {
        const custom: FieldDescriptor[] = [
            {
                type: 'text',
                key: 'name',
                label: 'Custom name',
            },
        ];
        const provider = new BpmnLiteSchemaProvider({ task: custom });
        expect(provider.getSchema('task')).toBe(custom);
        // Other kinds still use defaults.
        expect(provider.getSchema('startEvent').length).toBeGreaterThan(0);
    });

    it('partial overrides leave un-overridden kinds at defaults', () => {
        const provider = new BpmnLiteSchemaProvider({
            flow: [
                {
                    type: 'boolean',
                    key: 'isDefault',
                    label: 'Default only',
                },
            ],
        });
        expect(provider.getSchema('flow').map((f) => f.key)).toEqual([
            'isDefault',
        ]);
        // task default carries.
        expect(provider.getSchema('task')[0]?.key).toBe('label');
    });

    it('task label field has descriptive placeholder + maxLength', () => {
        const schema = defaultBpmnLiteSchemaProvider().getSchema('task');
        const labelField = schema[0]!;
        expect(labelField.type).toBe('text');
        if (labelField.type === 'text') {
            expect(labelField.placeholder).toBe('Task');
            expect(labelField.maxLength).toBe(80);
        }
    });

    it('flow condition field uses workflow EL flavour hint', () => {
        const schema = defaultBpmnLiteSchemaProvider().getSchema('flow');
        const condition = schema[0]!;
        expect(condition.type).toBe('el-expression');
        if (condition.type === 'el-expression') {
            expect(condition.elFlavour).toBe('workflow');
        }
    });

    /* ──────────────────── variant additions ─────────────────── */

    it('task schema exposes a variant SELECT after the label', () => {
        const schema = defaultBpmnLiteSchemaProvider().getSchema('task');
        expect(schema.map((f) => f.key)).toEqual(['label', 'variant']);
        const variant = schema[1]!;
        expect(variant.type).toBe('select');
        if (variant.type === 'select') {
            expect(variant.allowEmpty).toBe(true);
            expect(variant.options?.map((o) => o.value)).toEqual([
                'userTask',
                'serviceTask',
            ]);
        }
    });

    it('userTask schema surfaces a formKey field with workflow.forms xref scope', () => {
        const schema = defaultBpmnLiteSchemaProvider().getSchema('userTask');
        expect(schema.map((f) => f.key)).toEqual([
            'label',
            'variant',
            'formKey',
            // Multi-instance is offered on every activity that can carry it.
            'loopCollection',
            'loopElementVariable',
            'loopCompletionCondition',
        ]);
        const formKey = schema[2]!;
        expect(formKey.type).toBe('select');
        if (formKey.type === 'select') {
            expect(formKey.xrefScope).toBe('workflow.forms');
            expect(formKey.options).toBeUndefined();
        }
    });

    it('serviceTask schema surfaces an implementation field with workflow.handlers xref scope', () => {
        const schema =
            defaultBpmnLiteSchemaProvider().getSchema('serviceTask');
        expect(schema.map((f) => f.key)).toEqual([
            'label',
            'variant',
            'implementation',
            'loopCollection',
            'loopElementVariable',
            'loopCompletionCondition',
        ]);
        const impl = schema[2]!;
        expect(impl.type).toBe('select');
        if (impl.type === 'select') {
            expect(impl.xrefScope).toBe('workflow.handlers');
            expect(impl.options).toBeUndefined();
        }
    });

    it('getSchemaForElement falls back to kind schema for plain tasks', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        const plainTask: BpmnElement = {
            id: 't1',
            type: 'task',
            position: { x: 0, y: 0 },
            size: { width: 100, height: 80 },
        };
        expect(provider.getSchemaForElement(plainTask)).toBe(
            provider.getSchema('task'),
        );
    });

    it('getSchemaForElement pivots on variant for user-tasks', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        const userTask: BpmnElement = {
            id: 't1',
            type: 'task',
            position: { x: 0, y: 0 },
            size: { width: 100, height: 80 },
            variant: 'userTask',
        };
        expect(provider.getSchemaForElement(userTask)).toBe(
            provider.getSchema('userTask'),
        );
    });

    it('getSchemaForElement pivots on variant for service-tasks', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        const serviceTask: BpmnElement = {
            id: 't1',
            type: 'task',
            position: { x: 0, y: 0 },
            size: { width: 100, height: 80 },
            variant: 'serviceTask',
        };
        expect(provider.getSchemaForElement(serviceTask)).toBe(
            provider.getSchema('serviceTask'),
        );
    });

    it('getSchemaForElement is permissive: unknown variant falls back to plain task schema', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        const oddTask: BpmnElement = {
            id: 't1',
            type: 'task',
            position: { x: 0, y: 0 },
            size: { width: 100, height: 80 },
            variant: 'workflowTask',
        };
        expect(provider.getSchemaForElement(oddTask)).toBe(
            provider.getSchema('task'),
        );
    });

    it('getSchemaForElement ignores variant on non-task kinds', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        // Even if a startEvent somehow had a `variant` tag (forward-
        // compat for timer / message variants), the schema
        // table only declares variants for `task`, so this falls
        // through to the kind schema.
        const startWithVariant: BpmnElement = {
            id: 's1',
            type: 'startEvent',
            position: { x: 0, y: 0 },
            size: { width: 36, height: 36 },
            variant: 'timerStart',
        };
        expect(provider.getSchemaForElement(startWithVariant)).toBe(
            provider.getSchema('startEvent'),
        );
    });
});
