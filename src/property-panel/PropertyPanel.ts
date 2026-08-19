import type { Graph, Element } from '../model/index.js';
import type { XRefs } from '../shell/XRefs.js';
import type { FieldDescriptor } from './FieldDescriptor.js';
import type { FieldContext, FieldInstance } from './FieldRenderer.js';
import type { FieldRegistry } from './FieldRegistry.js';
import type { SchemaProvider } from './SchemaProvider.js';
import type { Selection } from './Selection.js';

import { BooleanField } from './fields/BooleanField.js';
import { ElExpressionField } from './fields/ElExpressionField.js';
import { SelectField } from './fields/SelectField.js';
import { TextField } from './fields/TextField.js';
import { TextareaField } from './fields/TextareaField.js';

export interface PropertyPanelOptions {
    /** Host element -- typically `sidebar.propertyHost`. */
    readonly host: HTMLElement;
    readonly graph: Graph;
    readonly selection: Selection;
    readonly schemas: SchemaProvider;
    readonly registry: FieldRegistry;
    readonly xrefs: XRefs;
    /** Panel-level read-only mode. Default false. Can be flipped via {@link PropertyPanel.setReadOnly}. */
    readonly readOnly?: boolean;
}

interface MountedField {
    readonly descriptor: FieldDescriptor;
    readonly wrapper: HTMLElement;
    readonly instance: FieldInstance;
}

/**
 * Mounts field renderers based on the current selection's schema +
 * keeps them in sync with graph mutations. The "framework" half of
 * the {@link FieldRegistry} + {@link FieldRenderer} contracts
 * + the 5 built-in field types are the other half.
 *
 * Lifecycle:
 *  1. On construction: subscribes to {@link Selection.onChange} and
 *     {@link Graph.onChange}, calls {@link rebuild} once for the
 *     current selection (which may be null at startup).
 *  2. On selection change: tears down current fields, looks up the new
 *     element + schema, mounts a fresh set of fields, populates them
 *     with the element's properties.
 *  3. On graph change: if the selected element was in the change set,
 *     pushes the new property values into each field via setValue --
 *     keeps undo/redo + collaborative edits + multi-source updates
 *     reflected. Field instances handle the same-value-no-op themselves.
 *  4. On a field's onChange: writes back to the graph via
 *     {@link Graph.updateElement} with a shallow-merged properties map.
 *     The resulting graph change event is recognized in step 3 and
 *     skipped (the value already matches what the field shows).
 *
 * The PropertyPanel does NOT auto-instantiate from the Editor --
 * surface code (BPMN-Lite, DMN table) constructs its own
 * PropertyPanel with the surface-specific {@link SchemaProvider}.
 * Editor exposes the dependencies
 * (graph, selection, xrefs) via its handle.
 *
 * DOM layout per field:
 *
 *   <div class="coolms-designer__property-field" data-field-key="...">
 *     <label class="coolms-designer__property-label">...</label>
 *     <div class="coolms-designer__property-control">{renderer output}</div>
 *     <p class="coolms-designer__property-description">...</p>   (when set)
 *   </div>
 *
 * Empty selection / no-schema render: the panel host is left empty.
 * Surface code can overlay its own "Select an element to edit" hint if
 * desired -- the framework stays out of the way.
 */
export class PropertyPanel {
    private readonly options: PropertyPanelOptions;
    private readonly mountedFields: MountedField[] = [];
    private readonly subscriptions: Array<() => void> = [];
    private readOnly: boolean;
    private disposed = false;
    /**
     * Tracks the property values we WROTE -- used to short-circuit graph
     * change events that originated here (and would otherwise cause
     * field flickers if a renderer's setValue races user input).
     */
    private inFlightUpdateForId: string | null = null;

    constructor(options: PropertyPanelOptions) {
        this.options = options;
        this.readOnly = options.readOnly ?? false;

        this.subscriptions.push(options.selection.onChange(() => this.rebuild()));
        this.subscriptions.push(
            options.graph.onChange((event) => {
                const selectedId = options.selection.id;
                if (!selectedId) return;
                // Reset on full graph wipes.
                if (event.changes.some((c) => c.type === 'reset')) {
                    this.rebuild();
                    return;
                }
                // Drop into incremental-value update mode if our selected element was updated.
                const updated = event.changes.find(
                    (c) => c.type === 'updated' && c.elementId === selectedId,
                );
                if (!updated) {
                    // If the selected element was REMOVED (cascade or direct), clear the panel.
                    const removed = event.changes.find(
                        (c) => c.type === 'removed' && c.elementId === selectedId,
                    );
                    if (removed) this.rebuild();
                    return;
                }
                // Skip the echo of our own write -- the field already shows the latest value.
                if (this.inFlightUpdateForId === selectedId) return;
                this.refreshValues();
            }),
        );

        this.rebuild();
    }

    /** Flip read-only at runtime. Propagates `setDisabled` to every mounted field. */
    setReadOnly(readOnly: boolean): void {
        if (this.disposed) return;
        if (this.readOnly === readOnly) return;
        this.readOnly = readOnly;
        for (const field of this.mountedFields) {
            const fieldReadOnly = readOnly || (field.descriptor.readOnly ?? false);
            field.instance.setDisabled(fieldReadOnly);
        }
    }

    get isReadOnly(): boolean {
        return this.readOnly;
    }

    /** Currently mounted field keys -- test affordance. */
    get fieldKeys(): ReadonlyArray<string> {
        return this.mountedFields.map((f) => f.descriptor.key);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const off of this.subscriptions) off();
        this.subscriptions.length = 0;
        this.tearDown();
    }

    private tearDown(): void {
        for (const field of this.mountedFields) {
            field.instance.destroy();
            field.wrapper.remove();
        }
        this.mountedFields.length = 0;
    }

    private rebuild(): void {
        if (this.disposed) return;
        this.tearDown();
        const id = this.options.selection.id;
        if (!id) return;
        const element = this.options.graph.getElement(id);
        if (!element) return;
        const schema = this.options.schemas.getSchema(element);
        if (!schema || schema.length === 0) return;

        for (const descriptor of schema) {
            this.mountField(descriptor, element);
        }
    }

    private mountField(descriptor: FieldDescriptor, element: Element): void {
        const renderer = this.options.registry.get(descriptor.type);
        if (!renderer) {
            // Surface authors get a console.warn rather than a thrown error so a
            // single broken descriptor doesn't take down the whole panel. The
            // missing field still doesn't render -- that's the loud signal.
            // eslint-disable-next-line no-console
            console.warn(
                `[@coolms/designer] PropertyPanel: no renderer registered for type "${descriptor.type}" (field "${descriptor.key}"). Skipping field.`,
            );
            return;
        }

        const doc = this.options.host.ownerDocument;
        const wrapper = doc.createElement('div');
        wrapper.classList.add('coolms-designer__property-field');
        wrapper.setAttribute('data-field-key', descriptor.key);
        wrapper.setAttribute('data-field-type', descriptor.type);

        const label = doc.createElement('label');
        label.classList.add('coolms-designer__property-label');
        label.textContent = descriptor.label;
        wrapper.appendChild(label);

        const control = doc.createElement('div');
        control.classList.add('coolms-designer__property-control');
        wrapper.appendChild(control);

        if (descriptor.description !== undefined) {
            const desc = doc.createElement('p');
            desc.classList.add('coolms-designer__property-description');
            desc.textContent = descriptor.description;
            wrapper.appendChild(desc);
        }

        const fieldReadOnly = this.readOnly || (descriptor.readOnly ?? false);
        const context: FieldContext = {
            initialValue: element.properties[descriptor.key],
            onChange: (next) => this.handleFieldChange(descriptor.key, next),
            xrefs: this.options.xrefs,
            readOnly: fieldReadOnly,
        };

        const instance = renderer.create(control, descriptor, context);
        this.options.host.appendChild(wrapper);
        this.mountedFields.push({ descriptor, wrapper, instance });
    }

    private handleFieldChange(key: string, next: unknown): void {
        if (this.disposed) return;
        const id = this.options.selection.id;
        if (!id) return;
        const element = this.options.graph.getElement(id);
        if (!element) return;

        // Shallow-merged properties write -- per Graph contract, properties
        // are REPLACED, not deep-merged, so we hand the full new map.
        const properties = { ...element.properties, [key]: next };

        this.inFlightUpdateForId = id;
        try {
            this.options.graph.updateElement(id, { properties });
        } finally {
            this.inFlightUpdateForId = null;
        }
    }

    private refreshValues(): void {
        const id = this.options.selection.id;
        if (!id) return;
        const element = this.options.graph.getElement(id);
        if (!element) return;
        for (const field of this.mountedFields) {
            field.instance.setValue(element.properties[field.descriptor.key]);
        }
    }
}

/**
 * Convenience helper -- registers the 5 M3.2.e built-in field renderers
 * (text / textarea / select / el-expression / boolean) onto an empty
 * {@link FieldRegistry}. Surface code typically calls this once at
 * editor-construction time before registering its own custom field
 * types.
 */
export function registerBuiltinFields(registry: FieldRegistry): void {
    registry.register(new TextField());
    registry.register(new TextareaField());
    registry.register(new SelectField());
    registry.register(new ElExpressionField());
    registry.register(new BooleanField());
}
