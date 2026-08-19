import { FieldRegistry } from '../property-panel/FieldRegistry.js';
import type { Translator } from '../i18n.js';
import { registerBuiltinFields } from '../property-panel/PropertyPanel.js';
import { XRefs } from '../shell/XRefs.js';
import type { FieldDescriptor } from '../property-panel/FieldDescriptor.js';
import type {
    FieldContext,
    FieldInstance,
} from '../property-panel/FieldRenderer.js';
import {
    RenamePlaceCommand,
    SetInitialPlaceCommand,
    UpdateTransitionPropertyCommand,
    UpdateWorkflowPropertyCommand,
    type EditableTransitionPropertyKey,
    type EditableWorkflowPropertyKey,
} from './commands.js';
import { SmSchemaProvider } from './SmSchemaProvider.js';
import type { SmSelectionTarget } from './SmSelection.js';
import type { StateMachineEditor } from './StateMachineEditor.js';

/** Construction options for {@link StateMachinePropertyPanel}. */
export interface StateMachinePropertyPanelOptions {
    /**
     * Resolves the field text of the DEFAULT schema provider. Ignored when
     * `schemas` is supplied -- that provider brings its own.
     */
    readonly t?: Translator;

    /** Host element to mount field controls into (typically the shell sidebar's property host). */
    readonly host: HTMLElement;
    readonly editor: StateMachineEditor;
    /** Override the schema provider (defaults to the built-in). */
    readonly schemas?: SmSchemaProvider;
    /** Override the field registry (defaults to a fresh one with the built-in field renderers). */
    readonly registry?: FieldRegistry;
    /** Cross-reference registry handed to each field's context (defaults to a fresh empty one). */
    readonly xrefs?: XRefs;
}

/** The three property scopes the panel renders, derived from the selection. */
type PanelScope = 'place' | 'transition' | 'workflow';

interface MountedField {
    readonly descriptor: FieldDescriptor;
    readonly wrapper: HTMLElement;
    readonly instance: FieldInstance;
}

/**
 * State Machine property panel — the editing surface. Mounts field
 * renderers based on the current {@link SmSelection} and dispatches single-
 * property commands through the editor's {@link CommandStack} on every
 * field change. Three scopes:
 *
 *  - **place** selected → name + initial fields.
 *  - **transition** selected → name + from/to + guard fields.
 *  - **nothing** selected → the workflow scope (name / marking property /
 *    supports / audit).
 *
 * Parallels {@link BpmnLitePropertyPanel}: reuses the field
 * renderers + descriptor types verbatim; only the model-binding seam is
 * State-Machine-specific. The editor holds the {@link StateMachineModel}
 * directly (not a generic Graph), so this is a parallel panel rather than
 * the generic substrate PropertyPanel.
 *
 * **Echo guard.** When the panel itself dispatches a command, the
 * resulting editor `change` event would otherwise prompt a `setValue` on
 * every mounted field — including the one the user just edited (cursor
 * jump). A boolean `inFlight` flag short-circuits the refresh while a
 * panel-sourced command is executing. A place rename is the exception: it
 * re-points the selection (the old id no longer exists), which fires a
 * clean rebuild on the new id.
 */
export class StateMachinePropertyPanel {
    private readonly host: HTMLElement;
    private readonly editor: StateMachineEditor;
    private readonly schemas: SmSchemaProvider;
    private readonly registry: FieldRegistry;
    private readonly xrefs: XRefs;
    private readonly mountedFields: MountedField[] = [];
    private readonly offSelection: () => void;
    private readonly offEditor: () => void;
    private inFlight = false;
    private disposed = false;

    constructor(options: StateMachinePropertyPanelOptions) {
        this.host = options.host;
        this.editor = options.editor;
        this.schemas = options.schemas ?? new SmSchemaProvider(options.t);
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

    private scopeOf(target: SmSelectionTarget | null): PanelScope {
        if (target === null) return 'workflow';
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
        const schema = this.lookupSchema(scope);
        const values = this.lookupValues(scope, target);
        if (values === null) return; // target was removed mid-flight
        if (schema.length === 0) return;
        for (const descriptor of schema) {
            this.mountField(descriptor, scope, values);
        }
    }

    private lookupSchema(scope: PanelScope): ReadonlyArray<FieldDescriptor> {
        switch (scope) {
            case 'place':
                return this.schemas.placeSchema();
            case 'transition':
                return this.schemas.transitionSchema(
                    this.editor.state.places.map((p) => p.id),
                );
            case 'workflow':
                return this.schemas.workflowSchema();
        }
    }

    private lookupValues(
        scope: PanelScope,
        target: SmSelectionTarget | null,
    ): Record<string, unknown> | null {
        if (scope === 'workflow') {
            return {
                workflowName: this.editor.readWorkflowDisplayValue('workflowName'),
                markingProperty: this.editor.readWorkflowDisplayValue('markingProperty'),
                supports: this.editor.readWorkflowDisplayValue('supports'),
                auditTrail: this.editor.readWorkflowDisplayValue('auditTrail'),
            };
        }
        if (target === null) return null;
        if (scope === 'place') {
            const place = this.editor.findPlace(target.id);
            if (place === null) return null;
            return { name: place.id, initial: place.initial ?? false };
        }
        const transition = this.editor.findTransition(target.id);
        if (transition === null) return null;
        return {
            name: transition.name,
            from: transition.from,
            to: transition.to,
            guard: transition.guard ?? '',
        };
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
                `[@coolms/designer] StateMachinePropertyPanel: no renderer for type "${descriptor.type}" (field "${descriptor.key}"). Skipping.`,
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
            if (scope === 'workflow') {
                this.editor.commandStack.execute(
                    new UpdateWorkflowPropertyCommand(
                        this.editor,
                        key as EditableWorkflowPropertyKey,
                        next,
                    ),
                );
            } else if (scope === 'place') {
                this.handlePlaceChange(key, next);
            } else {
                const target = this.editor.selection.target;
                if (target === null) return;
                this.editor.commandStack.execute(
                    new UpdateTransitionPropertyCommand(
                        this.editor,
                        target.id,
                        key as EditableTransitionPropertyKey,
                        next,
                    ),
                );
            }
        } finally {
            this.inFlight = false;
        }
    }

    private handlePlaceChange(key: string, next: unknown): void {
        const target = this.editor.selection.target;
        if (target === null || target.kind !== 'place') return;
        const currentId = target.id;

        if (key === 'name') {
            const newId = String(next ?? '').trim();
            // Reject empty / unchanged / colliding ids — restore the field
            // to the live id via a rebuild rather than minting a bad rename.
            if (newId === '' || newId === currentId || this.editor.findPlace(newId) !== null) {
                this.rebuild();
                return;
            }
            this.editor.commandStack.execute(
                new RenamePlaceCommand(this.editor, currentId, newId),
            );
            // The old id is gone — re-point the selection so the panel
            // rebuilds on the renamed place (and stays focused on it).
            this.editor.selection.select({ kind: 'place', id: newId });
            return;
        }

        if (key === 'initial') {
            this.editor.commandStack.execute(
                new SetInitialPlaceCommand(this.editor, currentId, Boolean(next)),
            );
        }
    }

    private onEditorChange(): void {
        if (this.disposed) return;
        // Echo: the panel sourced this change — leave the user's field alone
        // (a place rename re-selects, which rebuilds cleanly on its own).
        if (this.inFlight) return;

        const target = this.editor.selection.target;
        const scope = this.scopeOf(target);
        const values = this.lookupValues(scope, target);
        if (values === null) {
            // The selected place/transition was deleted — drop to workflow scope.
            this.editor.selection.clear();
            return;
        }
        for (const field of this.mountedFields) {
            field.instance.setValue(values[field.descriptor.key]);
        }
    }
}
