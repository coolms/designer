import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '../../../src/model/Graph.js';
import { XRefs } from '../../../src/shell/XRefs.js';
import { FieldRegistry } from '../../../src/property-panel/FieldRegistry.js';
import {
    PropertyPanel,
    registerBuiltinFields,
} from '../../../src/property-panel/PropertyPanel.js';
import { Selection } from '../../../src/property-panel/Selection.js';
import type { Element } from '../../../src/model/index.js';
import type {
    FieldDescriptor,
} from '../../../src/property-panel/FieldDescriptor.js';
import type { SchemaProvider } from '../../../src/property-panel/SchemaProvider.js';

function userTask(id: string, properties: Record<string, unknown> = {}): Element {
    return {
        id,
        kind: 'node',
        type: 'userTask',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 60 },
        properties,
    };
}

class StubSchemaProvider implements SchemaProvider {
    constructor(public schemas: Map<string, ReadonlyArray<FieldDescriptor>> = new Map()) {}
    getSchema(element: Element): ReadonlyArray<FieldDescriptor> | null {
        return this.schemas.get(element.type) ?? null;
    }
}

const USER_TASK_SCHEMA: ReadonlyArray<FieldDescriptor> = [
    { key: 'name', type: 'text', label: 'Name', placeholder: 'Task name' },
    { key: 'assignee', type: 'text', label: 'Assignee' },
    { key: 'priority', type: 'select', label: 'Priority', options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
    ] },
    { key: 'active', type: 'boolean', label: 'Active', checkboxLabel: 'Enabled' },
];

describe('PropertyPanel', () => {
    let host: HTMLDivElement;
    let graph: Graph;
    let selection: Selection;
    let xrefs: XRefs;
    let registry: FieldRegistry;
    let schemas: StubSchemaProvider;
    let panel: PropertyPanel | null;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        graph = new Graph();
        selection = new Selection();
        xrefs = new XRefs();
        registry = new FieldRegistry();
        registerBuiltinFields(registry);
        schemas = new StubSchemaProvider(new Map([['userTask', USER_TASK_SCHEMA]]));
        panel = null;
    });

    afterEach(() => {
        panel?.dispose();
        graph.dispose();
        selection.dispose();
        xrefs.dispose();
        registry.dispose();
        host.remove();
    });

    function makePanel(opts: { readOnly?: boolean } = {}): PropertyPanel {
        panel = new PropertyPanel({
            host,
            graph,
            selection,
            schemas,
            registry,
            xrefs,
            ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
        });
        return panel;
    }

    describe('selection-driven rendering', () => {
        it('renders nothing when no selection', () => {
            makePanel();
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);
        });

        it('mounts fields when an element is selected', () => {
            graph.addElement(userTask('n1', { name: 'Approve', priority: 'high' }));
            const p = makePanel();
            selection.select('n1');

            const fields = host.querySelectorAll('.coolms-designer__property-field');
            expect(fields).toHaveLength(4);
            expect(p.fieldKeys).toEqual(['name', 'assignee', 'priority', 'active']);

            const nameInput = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            expect(nameInput.value).toBe('Approve');
            const prioritySelect = host.querySelector('[data-field-key="priority"] select') as HTMLSelectElement;
            expect(prioritySelect.value).toBe('high');
        });

        it('re-mounts fields on selection change', () => {
            graph.addElement(userTask('n1', { name: 'A' }));
            graph.addElement(userTask('n2', { name: 'B' }));
            const p = makePanel();

            selection.select('n1');
            expect((host.querySelector('[data-field-key="name"] input') as HTMLInputElement).value).toBe('A');

            selection.select('n2');
            expect((host.querySelector('[data-field-key="name"] input') as HTMLInputElement).value).toBe('B');
            expect(p.fieldKeys).toEqual(['name', 'assignee', 'priority', 'active']);
        });

        it('clears fields when selection is cleared', () => {
            graph.addElement(userTask('n1'));
            makePanel();
            selection.select('n1');
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(4);

            selection.clear();
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);
        });

        it('renders nothing when schema returns null (unknown element type)', () => {
            graph.addElement({
                id: 'e1',
                kind: 'node',
                type: 'unknownType',
                position: { x: 0, y: 0 },
                size: { width: 1, height: 1 },
                properties: {},
            });
            makePanel();
            selection.select('e1');
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);
        });

        it('clears panel when selected element is removed from graph', () => {
            graph.addElement(userTask('n1'));
            makePanel();
            selection.select('n1');
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(4);

            graph.removeElement('n1');
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);
        });
    });

    describe('field-driven graph mutation', () => {
        it('writing a field value updates the graph properties (shallow-merged)', () => {
            graph.addElement(userTask('n1', { name: 'Old', assignee: 'alice' }));
            makePanel();
            selection.select('n1');

            const nameInput = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            nameInput.value = 'New';
            nameInput.dispatchEvent(new Event('change', { bubbles: true }));

            const updated = graph.getElement('n1')!;
            expect(updated.properties).toEqual({ name: 'New', assignee: 'alice' });
        });

        it('writing fires a single graph change event', () => {
            graph.addElement(userTask('n1', { name: 'Old' }));
            makePanel();
            selection.select('n1');

            const onChange = vi.fn();
            graph.onChange(onChange);

            const nameInput = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            nameInput.value = 'New';
            nameInput.dispatchEvent(new Event('change', { bubbles: true }));

            expect(onChange).toHaveBeenCalledTimes(1);
        });

        it('field write does NOT cause the panel to re-build (echo suppression)', () => {
            graph.addElement(userTask('n1', { name: 'Old' }));
            makePanel();
            selection.select('n1');
            const nameInput = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            nameInput.value = 'New';

            // Capture a reference to a field's input element before the change.
            const inputBefore = nameInput;
            inputBefore.dispatchEvent(new Event('change', { bubbles: true }));

            // Same DOM node should still be there -- panel did NOT tear down + remount.
            expect(host.querySelector('[data-field-key="name"] input')).toBe(inputBefore);
        });
    });

    describe('external graph mutation sync', () => {
        it('external updateElement pushes new value into the field via setValue', () => {
            graph.addElement(userTask('n1', { name: 'Old' }));
            makePanel();
            selection.select('n1');

            const nameInput = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            const inputRef = nameInput;
            expect(inputRef.value).toBe('Old');

            // Simulate undo/redo or collaboration -- mutation NOT from the panel.
            graph.updateElement('n1', { properties: { name: 'Externally Set' } });

            expect(inputRef.value).toBe('Externally Set');
            // Field DOM node is the same -- only its value was updated.
            expect(host.querySelector('[data-field-key="name"] input')).toBe(inputRef);
        });

        it('clears panel on graph reset (clear)', () => {
            graph.addElement(userTask('n1'));
            makePanel();
            selection.select('n1');
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(4);

            graph.clear();
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);
        });
    });

    describe('read-only mode', () => {
        it('mounts fields with disabled inputs when readOnly is on', () => {
            graph.addElement(userTask('n1', { name: 'X' }));
            makePanel({ readOnly: true });
            selection.select('n1');

            const input = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            expect(input.disabled).toBe(true);
        });

        it('setReadOnly flips disabled state on already-mounted fields without re-mounting', () => {
            graph.addElement(userTask('n1'));
            const p = makePanel();
            selection.select('n1');

            const inputRef = host.querySelector('[data-field-key="name"] input') as HTMLInputElement;
            expect(inputRef.disabled).toBe(false);

            p.setReadOnly(true);
            expect(inputRef.disabled).toBe(true);
            expect(host.querySelector('[data-field-key="name"] input')).toBe(inputRef);

            p.setReadOnly(false);
            expect(inputRef.disabled).toBe(false);
        });

        it('honors per-field readOnly even when panel is read-write', () => {
            schemas.schemas.set('userTask', [
                { key: 'name', type: 'text', label: 'Name', readOnly: true },
            ]);
            graph.addElement(userTask('n1', { name: 'X' }));
            makePanel();
            selection.select('n1');
            expect((host.querySelector('[data-field-key="name"] input') as HTMLInputElement).disabled).toBe(true);
        });
    });

    describe('unknown field types', () => {
        it('logs a warning + skips a field with no registered renderer', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            schemas.schemas.set('userTask', [
                { key: 'name', type: 'text', label: 'Name' },
                { key: 'mystery', type: 'custom-type', label: 'Mystery' },
            ] as FieldDescriptor[]);
            graph.addElement(userTask('n1'));
            const p = makePanel();
            selection.select('n1');

            expect(warn).toHaveBeenCalledOnce();
            expect(p.fieldKeys).toEqual(['name']);
            warn.mockRestore();
        });
    });

    describe('dispose', () => {
        it('tears down fields + drops subscriptions', () => {
            graph.addElement(userTask('n1'));
            const p = makePanel();
            selection.select('n1');
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(4);

            p.dispose();
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);

            // After dispose, selection changes shouldn't re-mount.
            selection.select(null);
            expect(host.querySelectorAll('.coolms-designer__property-field')).toHaveLength(0);
        });

        it('is idempotent', () => {
            graph.addElement(userTask('n1'));
            const p = makePanel();
            p.dispose();
            expect(() => p.dispose()).not.toThrow();
        });
    });

    describe('registerBuiltinFields', () => {
        it('registers all 5 built-in types', () => {
            const r = new FieldRegistry();
            registerBuiltinFields(r);
            expect([...r.types].sort()).toEqual(
                ['boolean', 'el-expression', 'select', 'text', 'textarea'],
            );
        });
    });
});
