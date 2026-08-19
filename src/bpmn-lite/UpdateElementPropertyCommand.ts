import type { Command } from '../canvas/CommandStack.js';
import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import type { BpmnElement } from './types.js';

/**
 * The set of element properties the property panel surfaces
 * for editing. Locked at compile time so descriptors that reach for
 * a non-property key get a TypeScript error rather than producing
 * a "silently writes to a junk key" runtime experience.
 *
 * **Why a constrained union instead of `keyof BpmnElement`**: the
 * panel must NEVER write to `id`, `type`, `position`, or `size`.
 * - `id` mutations break command + selection + cross-references.
 * - `type` mutations require re-rendering through a different
 *   {@link ElementRenderer}; not a property edit.
 * - `position` + `size` are owned by drag-to-move (M3.3.h+) and the
 *   palette drop / future auto-layout passes -- not text inputs.
 *
 * If a future ship adds a new editable property (e.g.
 * `assigneeExpression` on tasks, `documentationUrl` on any kind),
 * extend this union + the schema provider.
 */
/**
 * widened to cover the variant + variant-specific fields
 * the property panel's variant-aware schema now surfaces:
 *
 *  - `'variant'` — picks the task subkind (`undefined` /
 *    `'task'` / `'userTask'` / `'serviceTask'`). Changing it pivots
 *    the schema so the panel re-mounts with the variant's fields.
 *  - `'implementation'` — service-task dispatch key (M3.3.i XRefs
 *    scope `'workflow.handlers'`).
 *  - `'formKey'` — user-task form id (M3.3.i XRefs scope
 *    `'workflow.forms'`).
 */
export type EditableElementPropertyKey =
    | 'label'
    | 'variant'
    | 'implementation'
    | 'formKey'
    // Typed events. `subtype` re-types the event in place (the palette
    // drops a subtype, but the author can pivot without re-creating);
    // the dotted keys address one leaf of a nested definition block.
    | 'subtype'
    | 'timer.kind'
    | 'timer.value'
    | 'message.name'
    | 'message.correlation'
    | 'signal.name'
    | 'condition.expression'
    | 'condition.language'
    // Boundary events. `attachedTo` is absent by design -- attachment is
    // a canvas gesture, not a typed-in host id.
    | 'interrupting'
    | 'errorCode'
    // Gateway fork/join declaration (parallel + inclusive).
    | 'direction';

/**
 * the element property update command. Replaces a single
 * editable property on an element + ports the previous value so
 * `revert()` round-trips exactly.
 *
 * **Symmetry with M3.3.e's {@link UpdateFlowWaypointsCommand}**:
 * same construction-time snapshot pattern. The
 * {@link BpmnLitePropertyPanel} builds one of these per field
 * change + dispatches through {@link CommandStack} so the editor
 * mutator runs + emits `change` once per atomic edit.
 *
 * **Why a single property per command, not a batch**: the panel
 * commits on `change` events (e.g. blur + Enter for text inputs).
 * Each input event corresponds to a discrete user intent; batching
 * across inputs would conflate "I changed the label" with "I
 * toggled isDefault" -- the user expects undo to reverse one at a
 * time. A future ship can add a batch command for "Reset all"
 * style operations.
 *
 * **Label format**: `Edit <kind> <propertyKey>` -- the field's key
 * is more meaningful here than its display label (the panel could
 * surface "Name" / "Label" / "Title" for the same `label` property
 * depending on tenant config; the underlying property key is the
 * stable identity). The M3.3.f tooltip surface ("Undo: Edit task
 * label") is good enough; M3.3.h can layer richer labels on top.
 */
export class UpdateElementPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: BpmnLiteEditor,
        private readonly elementId: string,
        private readonly propertyKey: EditableElementPropertyKey,
        private readonly nextValue: unknown,
    ) {
        const element = editor.findElement(elementId);
        this.previousValue = element !== null
            ? this.readProperty(element, propertyKey)
            : undefined;
        this.label = element !== null
            ? `Edit ${element.type} ${propertyKey}`
            : `Edit ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateElementProperty(
            this.elementId,
            this.propertyKey,
            this.nextValue,
        );
    }

    revert(): void {
        this.editor.updateElementProperty(
            this.elementId,
            this.propertyKey,
            this.previousValue,
        );
    }

    /** Test affordance -- the element id this command targets. */
    get targetId(): string {
        return this.elementId;
    }

    private readProperty(
        element: BpmnElement,
        key: EditableElementPropertyKey,
    ): unknown {
        // Mirror of the dotted-key write path in
        // `BpmnLiteEditor.elementWithProperty` -- undo must restore the
        // same leaf the edit replaced. Reading the whole parent block
        // here would make revert() overwrite sibling leaves edited in
        // between.
        const dot = key.indexOf('.');
        if (dot > 0) {
            const parent = (element as unknown as Record<string, unknown>)[
                key.slice(0, dot)
            ];
            if (typeof parent !== 'object' || parent === null) {
                return undefined;
            }
            return (parent as Record<string, unknown>)[key.slice(dot + 1)];
        }
        return element[key as keyof BpmnElement];
    }
}
