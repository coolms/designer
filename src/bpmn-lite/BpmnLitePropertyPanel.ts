import { FieldRegistry } from '../property-panel/FieldRegistry.js';
import { registerBuiltinFields } from '../property-panel/PropertyPanel.js';
import { XRefs } from '../shell/XRefs.js';
import type { FieldDescriptor } from '../property-panel/FieldDescriptor.js';
import type {
    FieldContext,
    FieldInstance,
} from '../property-panel/FieldRenderer.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import {
    BpmnLiteSchemaProvider,
    defaultBpmnLiteSchemaProvider,
} from './BpmnLiteSchemaProvider.js';
import type {
    BpmnLiteSelection,
    BpmnLiteSelectionTarget,
} from './BpmnLiteSelection.js';
import {
    UpdateElementPropertyCommand,
    type EditableElementPropertyKey,
} from './UpdateElementPropertyCommand.js';
import {
    UpdateFlowPropertyCommand,
    type EditableFlowPropertyKey,
} from './UpdateFlowPropertyCommand.js';
import { WaypointDragController } from './WaypointDragController.js';
import type { BpmnElement, BpmnSequenceFlow } from './types.js';

/**
 * Options for constructing a {@link BpmnLitePropertyPanel}.
 */
export interface BpmnLitePropertyPanelOptions {
    /**
     * Host element to mount field controls into. Typically the
     * sidebar's `propertyHost`. The panel takes ownership of
     * the host's children: it tears down + rebuilds on every
     * selection change.
     */
    readonly host: HTMLElement;
    readonly editor: BpmnLiteEditor;
    /**
     * Override the schema provider. Defaults to the built-in
     * (label per kind, condition + isDefault for flows).
     */
    readonly schemas?: BpmnLiteSchemaProvider;
    /**
     * Override the field registry. Defaults to a fresh registry
     * pre-populated with the built-in field renderers via
     * {@link registerBuiltinFields}. Surface authors that want
     * additional field types (e.g. a decisionKey picker) pass
     * a custom registry with the extras registered.
     */
    readonly registry?: FieldRegistry;
    /**
     * Render every field read-only. Default false. Set by a VIEWER
     * (read-only version, or a module-shipped body) so the panel agrees
     * with the canvas, which has already suppressed every edit gesture.
     */
    readonly readOnly?: boolean;
    /**
     * Cross-reference registry handed to each field renderer's
     * context. Defaults to a fresh empty XRefs -- the decisionKey
     * and handler-key autocompletes are the fields that consult it.
     */
    readonly xrefs?: XRefs;
}

interface MountedField {
    readonly descriptor: FieldDescriptor;
    readonly wrapper: HTMLElement;
    readonly instance: FieldInstance;
}

/**
 * BPMN-Lite property panel -- the third authoring surface
 * after the palette + the connect mode. Mounts field
 * renderers based on the current {@link BpmnLiteSelection} target +
 * dispatches single-property commands through the editor's command
 * stack on every field change.
 *
 * **Why a BPMN-Lite-specific panel, not the generic
 * PropertyPanel**: the generic panel drives a {@link Graph} model
 * via {@link Graph.updateElement}. The BPMN-Lite editor holds
 * its own {@link BpmnLiteModel} directly, NOT a Graph. Building a
 * Graph adapter would require mirroring `BpmnElement`/`BpmnSequenceFlow`
 * onto Graph's `Element` shape both ways -- a lot of bridge code
 * for no behaviour benefit. The parallel panel reuses the field
 * renderers + descriptor types verbatim; only the Graph-binding
 * seam is rewritten. Bridging to Graph makes sense if the surfaces
 * converge; until then, parallel is cleaner.
 *
 * **Lifecycle**:
 *  1. On construction: subscribes to `selection.onChange` +
 *     `editor.onChange`. Calls `rebuild()` once for the current
 *     selection (which is probably null at construction).
 *  2. On selection change: tears down current fields + any
 *     {@link WaypointDragController}; looks up the new target's
 *     schema; mounts fresh fields; if the new target is a flow,
 *     constructs a WaypointDragController for it.
 *  3. On editor change: if the selected target is still alive,
 *     refreshes field values via setValue. If the target is GONE
 *     (deleted), clears selection.
 *  4. On a field's onChange: dispatches the appropriate command
 *     through the editor's command stack. The resulting editor
 *     `change` event is the "echo" -- the panel doesn't refresh
 *     the field that sourced the change (would cause cursor jumps
 *     mid-edit).
 *
 * **Empty / no-schema render**: the panel leaves the host empty
 * when no target is selected OR when the schema is empty. A host
 * can overlay its own "Select something to edit" hint above it.
 *
 * **Dispose contract**: tears down fields + WaypointDragController
 * + unsubscribes from selection + editor. Idempotent. The panel
 * does NOT dispose the editor's selection or the editor itself.
 */
export class BpmnLitePropertyPanel {
    private readonly host: HTMLElement;
    private readonly editor: BpmnLiteEditor;
    private readonly schemas: BpmnLiteSchemaProvider;
    private readonly registry: FieldRegistry;
    private readonly xrefs: XRefs;
    private readonly mountedFields: MountedField[] = [];
    private waypointController: WaypointDragController | null = null;
    private readonly offSelection: () => void;
    private readonly offEditor: () => void;
    /**
     * Echo guard -- when the panel itself dispatches a property
     * command, the resulting `change` event would otherwise prompt
     * a setValue on every field including the one the user just
     * typed into. The guard short-circuits the refresh until the
     * echo has flowed through.
     */
    private inFlightCommandTargetId: string | null = null;
    private disposed = false;

    /**
     * Panel-level read-only. A viewer (`?version=N`, or a module-shipped
     * body opened read-only) disables every canvas interaction, so
     * leaving the property fields typable told the author they could
     * edit something the surface would never save.
     */
    private readOnly: boolean;

    constructor(options: BpmnLitePropertyPanelOptions) {
        this.host = options.host;
        this.editor = options.editor;
        this.schemas = options.schemas ?? defaultBpmnLiteSchemaProvider();
        this.registry = options.registry ?? this.defaultRegistry();
        this.xrefs = options.xrefs ?? new XRefs();
        this.readOnly = options.readOnly ?? false;

        this.offSelection = this.editor.selection.onChange(() => this.rebuild());
        this.offEditor = this.editor.onChange(() => this.onEditorChange());

        this.rebuild();
    }

    /** Test affordance -- the keys of the currently mounted fields, in mount order. */
    get fieldKeys(): ReadonlyArray<string> {
        return this.mountedFields.map((f) => f.descriptor.key);
    }

    /** Test affordance -- the WaypointDragController, if a flow is selected. */
    get waypointDragController(): WaypointDragController | null {
        return this.waypointController;
    }

    /**
     * Tear down all fields + the waypoint controller (if any) +
     * unsubscribe. Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.offSelection();
        this.offEditor();
        this.tearDown();
    }

    private defaultRegistry(): FieldRegistry {
        const registry = new FieldRegistry();
        registerBuiltinFields(registry);
        return registry;
    }

    private tearDown(): void {
        for (const field of this.mountedFields) {
            field.instance.destroy();
            field.wrapper.remove();
        }
        this.mountedFields.length = 0;
        if (this.waypointController !== null) {
            this.waypointController.dispose();
            this.waypointController = null;
        }
    }

    private rebuild(): void {
        if (this.disposed) return;
        this.tearDown();
        const target = this.editor.selection.target;
        if (target === null) return;
        const schema = this.lookupSchema(target);
        const values = this.lookupValues(target);
        if (values === null) return; // target was removed mid-flight
        if (schema.length === 0) return;
        for (const descriptor of schema) {
            this.mountField(descriptor, target, values);
        }
        if (target.kind === 'flow') {
            this.waypointController = new WaypointDragController({
                editor: this.editor,
                flowId: target.id,
            });
        }
    }

    private lookupSchema(
        target: BpmnLiteSelectionTarget,
    ): ReadonlyArray<FieldDescriptor> {
        if (target.kind === 'flow') {
            return this.schemas.getSchema('flow');
        }
        const element = this.editor.findElement(target.id);
        if (element === null) return [];
        /**
         * delegate to the variant-aware lookup so a task
         * carrying `variant: 'userTask'` / `'serviceTask'` resolves
         * to the variant schema instead of the plain task schema.
         * Other kinds fall through to their kind schema.
         */
        return this.schemas.getSchemaForElement(element);
    }

    private lookupValues(
        target: BpmnLiteSelectionTarget,
    ): BpmnElement | BpmnSequenceFlow | null {
        if (target.kind === 'flow') {
            return this.editor.findFlow(target.id);
        }
        return this.editor.findElement(target.id);
    }

    private mountField(
        descriptor: FieldDescriptor,
        target: BpmnLiteSelectionTarget,
        values: BpmnElement | BpmnSequenceFlow,
    ): void {
        const renderer = this.registry.get(descriptor.type);
        if (renderer === undefined) {
            // Loud signal at the panel layer; the missing field
            // simply doesn't render so a broken schema entry doesn't
            // take down the whole panel.
            // eslint-disable-next-line no-console
            console.warn(
                `[@coolms/designer] BpmnLitePropertyPanel: no renderer for type "${descriptor.type}" (field "${descriptor.key}"). Skipping.`,
            );
            return;
        }

        const doc = this.host.ownerDocument;
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

        const initialValue = readFieldValue(values, descriptor.key);
        const context: FieldContext = {
            initialValue,
            onChange: (next: unknown): void =>
                this.handleFieldChange(target, descriptor.key, next),
            xrefs: this.xrefs,
            // Panel-level read-only ORs with the per-field flag: a
            // viewer must not be able to type into ANY field, and a
            // field marked read-only stays so in an editor.
            readOnly: this.readOnly || (descriptor.readOnly ?? false),
        };

        const instance = renderer.create(control, descriptor, context);
        this.host.appendChild(wrapper);
        this.mountedFields.push({ descriptor, wrapper, instance });
    }

    private handleFieldChange(
        target: BpmnLiteSelectionTarget,
        key: string,
        next: unknown,
    ): void {
        if (this.disposed) return;
        this.inFlightCommandTargetId = target.id;
        try {
            if (target.kind === 'element') {
                this.editor.commandStack.execute(
                    new UpdateElementPropertyCommand(
                        this.editor,
                        target.id,
                        key as EditableElementPropertyKey,
                        next,
                    ),
                );
            } else {
                this.editor.commandStack.execute(
                    new UpdateFlowPropertyCommand(
                        this.editor,
                        target.id,
                        key as EditableFlowPropertyKey,
                        next,
                    ),
                );
            }
        } finally {
            this.inFlightCommandTargetId = null;
        }
        /**
         * variant changes pivot the schema (plain task
         * fields vs user-task fields vs service-task fields). The
         * default echo-guard short-circuits {@link onEditorChange}
         * when this same panel sourced the change; that's the right
         * call for `label` (text input would lose its cursor on
         * rebuild) but the WRONG call for `variant` (the rest of the
         * field list needs to swap shape). Force a rebuild here for
         * variant changes; other property edits stay echo-guarded.
         */
        if (key === 'variant') {
            this.rebuild();
        }
    }

    private onEditorChange(): void {
        if (this.disposed) return;
        const target = this.editor.selection.target;
        if (target === null) return;
        const values = this.lookupValues(target);
        if (values === null) {
            // The selected target was deleted (or its id changed).
            // Clear the selection -- which triggers our own rebuild
            // via the selection.onChange subscription, leaving the
            // panel empty.
            this.editor.selection.clear();
            return;
        }
        // If THIS panel sourced the change (echo), don't reset the
        // field the user is mid-edit on. Other panels in a
        // multi-panel future may still want the refresh; the
        // single-panel model lets us skip it entirely.
        if (this.inFlightCommandTargetId === target.id) return;
        for (const field of this.mountedFields) {
            const v = readFieldValue(values, field.descriptor.key);
            field.instance.setValue(v);
        }
    }
}

/**
 * Read a field's current value off the selected element/flow.
 *
 * Mirrors the DOTTED-KEY write path in
 * `BpmnLiteEditor.elementWithProperty`: typed events keep their
 * definitions as nested objects (that IS the wire shape), so a schema
 * key like `timer.kind` addresses one leaf. A flat `values[key]` lookup
 * returns `undefined` for those, which renders an empty control over a
 * value that actually exists -- the author sees a blank "Timer type"
 * select on an event whose kind is already `duration`, and re-picking it
 * looks like a no-op.
 *
 * One level of nesting is all the wire shape has, matching the writer.
 */
function readFieldValue(
    values: BpmnElement | BpmnSequenceFlow,
    key: string,
): unknown {
    const bag = values as unknown as Record<string, unknown>;
    const dot = key.indexOf('.');
    if (dot <= 0) return bag[key];
    const parent = bag[key.slice(0, dot)];
    if (typeof parent !== 'object' || parent === null) return undefined;
    return (parent as Record<string, unknown>)[key.slice(dot + 1)];
}
