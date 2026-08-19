import { FieldRegistry } from '../../property-panel/FieldRegistry.js';
import { registerBuiltinFields } from '../../property-panel/PropertyPanel.js';
import { XRefs } from '../../shell/XRefs.js';
import type { FieldDescriptor } from '../../property-panel/FieldDescriptor.js';
import type {
    FieldContext,
    FieldInstance,
} from '../../property-panel/FieldRenderer.js';
import {
    UpdateDiagramPropertyCommand,
    UpdateElementPropertyCommand,
    UpdateRequirementPropertyCommand,
    type EditableElementPropertyKey,
    type EditableRequirementPropertyKey,
} from './commands.js';
import type { DmnDrdEditor } from './DmnDrdEditor.js';
import { DrdSchemaProvider } from './DrdSchemaProvider.js';
import type { DrdSelectionTarget } from './DrdSelection.js';

/** Construction options for {@link DmnDrdPropertyPanel}. */
export interface DmnDrdPropertyPanelOptions {
    /** Host element to mount field controls into (typically the shell sidebar's property host). */
    readonly host: HTMLElement;
    readonly editor: DmnDrdEditor;
    /** Override the schema provider (defaults to the M4.j built-in). */
    readonly schemas?: DrdSchemaProvider;
    /** Override the field registry (defaults to a fresh one with the built-in field renderers). */
    readonly registry?: FieldRegistry;
    /** Cross-reference registry handed to each field's context (defaults to a fresh empty one). */
    readonly xrefs?: XRefs;
}

/** The three property scopes the panel renders, derived from the selection. */
type PanelScope = 'element' | 'requirement' | 'diagram';

interface MountedField {
    readonly descriptor: FieldDescriptor;
    readonly wrapper: HTMLElement;
    readonly instance: FieldInstance;
}

/**
 * M4.j (slice 2) DMN DRD property panel — the editing surface. Mounts
 * field renderers based on the current {@link DrdSelection} and dispatches
 * single-property commands through the editor's {@link CommandStack} on
 * every field change. Three scopes:
 *
 *  - **element** selected → name (+ decision-logic ref for a Decision).
 *  - **requirement** selected → from / to endpoint selects.
 *  - **nothing** selected → the diagram scope (the definition key).
 *
 * Parallels {@link StateMachinePropertyPanel}: reuses the field
 * renderers + descriptor types verbatim; only the model-binding seam is
 * DRD-specific. Simpler than the state-machine panel — a DRD element's
 * `id` is stable canvas identity (its `name` is a separate field), so an
 * element rename is a plain property update with no cascade or
 * re-selection.
 *
 * **Echo guard.** When the panel itself dispatches a command, the
 * resulting editor `change` event would otherwise prompt a `setValue` on
 * every mounted field — including the one the user just edited (cursor
 * jump). A boolean `inFlight` flag short-circuits the refresh while a
 * panel-sourced command is executing.
 */
export class DmnDrdPropertyPanel {
    private readonly host: HTMLElement;
    private readonly editor: DmnDrdEditor;
    private readonly schemas: DrdSchemaProvider;
    private readonly registry: FieldRegistry;
    private readonly xrefs: XRefs;
    private readonly mountedFields: MountedField[] = [];
    private readonly offSelection: () => void;
    private readonly offEditor: () => void;
    private inFlight = false;
    private disposed = false;

    constructor(options: DmnDrdPropertyPanelOptions) {
        this.host = options.host;
        this.editor = options.editor;
        this.schemas = options.schemas ?? new DrdSchemaProvider();
        this.registry = options.registry ?? this.defaultRegistry();
        this.xrefs = options.xrefs ?? new XRefs();

        this.offSelection = this.editor.selection.onChange(() => this.rebuild());
        this.offEditor = this.editor.onChange(() => this.onEditorChange());

        this.rebuild();
    }

    /** Test affordance — the keys of the currently mounted fields, in mount order. */
    get fieldKeys(): ReadonlyArray<string> {
        return this.mountedFields.map((f) => f.descriptor.key);
    }

    /** Test affordance — the current panel scope. */
    get scope(): PanelScope {
        return this.scopeOf(this.editor.selection.target);
    }

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

    private scopeOf(target: DrdSelectionTarget | null): PanelScope {
        if (target === null) return 'diagram';
        return target.kind;
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
        const target = this.editor.selection.target;
        const scope = this.scopeOf(target);
        const schema = this.lookupSchema(scope, target);
        const values = this.lookupValues(scope, target);
        if (values === null) return; // target was removed mid-flight
        if (schema.length === 0) return;
        for (const descriptor of schema) {
            this.mountField(descriptor, scope, values);
        }
    }

    private lookupSchema(
        scope: PanelScope,
        target: DrdSelectionTarget | null,
    ): ReadonlyArray<FieldDescriptor> {
        switch (scope) {
            case 'element': {
                if (target === null) return [];
                const element = this.editor.findElement(target.id);
                if (element === null) return [];
                return this.schemas.elementSchema(element.kind);
            }
            case 'requirement':
                return this.schemas.requirementSchema(
                    this.editor.state.elements.map((e) => e.id),
                );
            case 'diagram':
                return this.schemas.diagramSchema();
        }
    }

    private lookupValues(
        scope: PanelScope,
        target: DrdSelectionTarget | null,
    ): Record<string, unknown> | null {
        if (scope === 'diagram') {
            return { name: this.editor.readDiagramDisplayValue('name') };
        }
        if (target === null) return null;
        if (scope === 'element') {
            const element = this.editor.findElement(target.id);
            if (element === null) return null;
            return { name: element.name, decisionLogicRef: element.decisionLogicRef ?? '' };
        }
        const requirement = this.editor.findRequirement(target.id);
        if (requirement === null) return null;
        return { from: requirement.from, to: requirement.to };
    }

    private mountField(
        descriptor: FieldDescriptor,
        scope: PanelScope,
        values: Record<string, unknown>,
    ): void {
        const renderer = this.registry.get(descriptor.type);
        if (renderer === undefined) {
            // eslint-disable-next-line no-console
            console.warn(
                `[@coolms/designer] DmnDrdPropertyPanel: no renderer for type "${descriptor.type}" (field "${descriptor.key}"). Skipping.`,
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

        const context: FieldContext = {
            initialValue: values[descriptor.key],
            onChange: (next: unknown): void =>
                this.handleFieldChange(scope, descriptor.key, next),
            xrefs: this.xrefs,
            readOnly: descriptor.readOnly ?? false,
        };

        const instance = renderer.create(control, descriptor, context);
        this.host.appendChild(wrapper);
        this.mountedFields.push({ descriptor, wrapper, instance });
    }

    private handleFieldChange(
        scope: PanelScope,
        key: string,
        next: unknown,
    ): void {
        if (this.disposed) return;
        this.inFlight = true;
        try {
            if (scope === 'diagram') {
                this.editor.commandStack.execute(
                    new UpdateDiagramPropertyCommand(this.editor, 'name', next),
                );
                return;
            }
            const target = this.editor.selection.target;
            if (target === null) return;
            if (scope === 'element') {
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
                    new UpdateRequirementPropertyCommand(
                        this.editor,
                        target.id,
                        key as EditableRequirementPropertyKey,
                        next,
                    ),
                );
            }
        } finally {
            this.inFlight = false;
        }
    }

    private onEditorChange(): void {
        if (this.disposed) return;
        // Echo: the panel sourced this change — leave the user's field alone.
        if (this.inFlight) return;

        const target = this.editor.selection.target;
        const scope = this.scopeOf(target);
        const values = this.lookupValues(scope, target);
        if (values === null) {
            // The selected element/requirement was deleted — drop to diagram scope.
            this.editor.selection.clear();
            return;
        }
        for (const field of this.mountedFields) {
            field.instance.setValue(values[field.descriptor.key]);
        }
    }
}
