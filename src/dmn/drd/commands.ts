import type { Command } from '../../canvas/CommandStack.js';
import type { DmnDrdEditor } from './DmnDrdEditor.js';
import type {
    DmnDrdElement,
    DmnDrdPosition,
    DmnInformationRequirement,
} from './types.js';

/**
 * DMN DRD editing commands. Each is a reversible mutation
 * the property panel dispatches through the editor's {@link CommandStack}
 * so every edit is a single undo step. They call the editor's mutator
 * seam (the editor owns the immutable-model swap + repaint + `change`
 * emit); the commands only capture the inverse value they need.
 *
 * Simpler than the state-machine commands: a DRD element's `id` is
 * stable canvas identity (its `name` is a separate field), so there's no
 * rename-and-cascade command — editing `name` is a plain property update.
 */

/**
 * Editable element property keys the panel surfaces. `id`/`kind` are
 * deliberately absent — `id` is stable canvas identity (referenced by
 * requirement edges) and `kind` is fixed by how the node was created.
 */
export type EditableElementPropertyKey = 'name' | 'decisionLogicRef';

/** Editable requirement endpoint keys. */
export type EditableRequirementPropertyKey = 'from' | 'to';

/** Editable diagram-scope keys (`name` = the DRG / definition key). */
export type EditableDiagramPropertyKey = 'name';

/**
 * Update one editable property on an element (`name` / `decisionLogicRef`).
 * Captures the previous value at construction so revert round-trips
 * exactly — including `decisionLogicRef` going back to `undefined` (the
 * editor drops a blank ref).
 */
export class UpdateElementPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: DmnDrdEditor,
        private readonly elementId: string,
        private readonly propertyKey: EditableElementPropertyKey,
        private readonly nextValue: unknown,
    ) {
        const element = editor.findElement(elementId);
        this.previousValue = element !== null ? element[propertyKey] : undefined;
        this.label = `Edit ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateElementProperty(this.elementId, this.propertyKey, this.nextValue);
    }

    revert(): void {
        this.editor.updateElementProperty(this.elementId, this.propertyKey, this.previousValue);
    }

    /** Test affordance — the element id this command targets. */
    get targetId(): string {
        return this.elementId;
    }
}

/**
 * Update one editable endpoint on a requirement (`from` / `to`). Captures
 * the previous endpoint so revert restores it exactly.
 */
export class UpdateRequirementPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: DmnDrdEditor,
        private readonly requirementId: string,
        private readonly propertyKey: EditableRequirementPropertyKey,
        private readonly nextValue: unknown,
    ) {
        const requirement = editor.findRequirement(requirementId);
        this.previousValue = requirement !== null ? requirement[propertyKey] : undefined;
        this.label = `Edit requirement ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateRequirementProperty(this.requirementId, this.propertyKey, this.nextValue);
    }

    revert(): void {
        this.editor.updateRequirementProperty(this.requirementId, this.propertyKey, this.previousValue);
    }

    /** Test affordance — the requirement id this command targets. */
    get targetId(): string {
        return this.requirementId;
    }
}

/**
 * Update one diagram-scope property (`name`). Captures the previous
 * DISPLAY value (the same shape the field reads) so apply + revert both
 * flow through the editor's mutator symmetrically.
 */
export class UpdateDiagramPropertyCommand implements Command {
    readonly label: string;
    private readonly previousValue: unknown;

    constructor(
        private readonly editor: DmnDrdEditor,
        private readonly propertyKey: EditableDiagramPropertyKey,
        private readonly nextValue: unknown,
    ) {
        this.previousValue = editor.readDiagramDisplayValue(propertyKey);
        this.label = `Edit diagram ${propertyKey}`;
    }

    apply(): void {
        this.editor.updateDiagramProperty(this.propertyKey, this.nextValue);
    }

    revert(): void {
        this.editor.updateDiagramProperty(this.propertyKey, this.previousValue);
    }
}

/**
 * Structural editing commands — add / remove / move a
 * node, add / remove a requirement edge. These back the (future) palette,
 * connect-mode, drag, and delete-key affordances; each is a single undo
 * step. A {@link RemoveElementCommand} snapshots the node's incident
 * requirements so undo restores the whole sub-graph, not just the box.
 */

/** Add a node. Reverts by removing it (which also drops any edges it gained — none on a fresh add). */
export class AddElementCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: DmnDrdEditor,
        private readonly element: DmnDrdElement,
    ) {
        this.label = `Add ${element.kind === 'inputData' ? 'input' : 'decision'} ${element.id}`;
    }

    apply(): void {
        this.editor.addElement(this.element);
    }

    revert(): void {
        this.editor.removeElement(this.element.id);
    }
}

/**
 * Remove a node + cascade-remove its incident requirements. Snapshots the
 * node AND every edge touching it at construction so revert restores the
 * exact sub-graph.
 */
export class RemoveElementCommand implements Command {
    readonly label: string;
    private readonly element: DmnDrdElement | null;
    private readonly requirements: DmnInformationRequirement[];

    constructor(
        private readonly editor: DmnDrdEditor,
        elementId: string,
    ) {
        this.element = editor.findElement(elementId);
        this.requirements = editor.state.requirements.filter(
            (r) => r.from === elementId || r.to === elementId,
        );
        this.label = `Remove ${elementId}`;
    }

    apply(): void {
        if (this.element !== null) this.editor.removeElement(this.element.id);
    }

    revert(): void {
        if (this.element === null) return;
        this.editor.addElement(this.element);
        for (const requirement of this.requirements) {
            this.editor.addRequirement(requirement);
        }
    }
}

/** Move a node. Captures the from-position at construction so revert snaps it back. */
export class MoveElementCommand implements Command {
    readonly label: string;
    private readonly fromPosition: DmnDrdPosition | null;

    constructor(
        private readonly editor: DmnDrdEditor,
        private readonly elementId: string,
        private readonly toPosition: DmnDrdPosition,
    ) {
        const element = editor.findElement(elementId);
        this.fromPosition = element !== null ? element.position : null;
        this.label = `Move ${elementId}`;
    }

    apply(): void {
        this.editor.moveElement(this.elementId, this.toPosition);
    }

    revert(): void {
        if (this.fromPosition !== null) {
            this.editor.moveElement(this.elementId, this.fromPosition);
        }
    }

    /** Test affordance — the element id this command targets. */
    get targetId(): string {
        return this.elementId;
    }
}

/** Add a requirement edge. Reverts by removing it. */
export class AddRequirementCommand implements Command {
    readonly label: string;

    constructor(
        private readonly editor: DmnDrdEditor,
        private readonly requirement: DmnInformationRequirement,
    ) {
        this.label = `Connect ${requirement.from} → ${requirement.to}`;
    }

    apply(): void {
        this.editor.addRequirement(this.requirement);
    }

    revert(): void {
        this.editor.removeRequirement(this.requirement.id);
    }
}

/** Remove a requirement edge. Snapshots it at construction so revert restores it. */
export class RemoveRequirementCommand implements Command {
    readonly label: string;
    private readonly requirement: DmnInformationRequirement | null;

    constructor(
        private readonly editor: DmnDrdEditor,
        requirementId: string,
    ) {
        this.requirement = editor.findRequirement(requirementId);
        this.label = `Remove requirement ${requirementId}`;
    }

    apply(): void {
        if (this.requirement !== null) this.editor.removeRequirement(this.requirement.id);
    }

    revert(): void {
        if (this.requirement !== null) this.editor.addRequirement(this.requirement);
    }
}
