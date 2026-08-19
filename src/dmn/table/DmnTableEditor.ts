import type { CommandStack } from '../../canvas/CommandStack.js';
import { DmnTableModel } from './DmnTableModel.js';
import { DmnTableView } from './DmnTableView.js';
import type { DecisionTableModel } from './types.js';
import { readDmnXml, writeDmnXml } from './xml.js';

export interface DmnTableEditorOptions {
    /** Host element -- typically `editor.body` for full-canvas-replacement DMN editing. */
    readonly host: HTMLElement;
    /** Command stack -- typically `editor.commands` for unified undo/redo with the toolbar. */
    readonly commands: CommandStack;
    /** Initial decision table. Defaults to an empty 1×1 starter. */
    readonly initialModel?: DecisionTableModel;
}

/**
 * The DMN decision-table surface editor -- top-level wiring that
 * instantiates the model + view + manages lifecycle. Consumers
 * (a framework wrapper, the test fixtures) construct this
 * once after `createEditor({surface: 'dmn-table'})` and connect it
 * to the editor's primitives (`editor.body` + `editor.commands`).
 *
 * The canvas remains constructed for table surfaces but
 * stays empty + hidden via CSS (`.coolms-designer--dmn-table
 * .coolms-designer__canvas { display: none }`). The table editor
 * mounts as a sibling of the canvas inside the body, taking the
 * available space.
 *
 * Round-trip: `load(model)` swaps in a new DecisionTableModel,
 * `state` exposes the current snapshot for saving + serialization
 * (the XML serializer reads from `state`).
 */
export class DmnTableEditor {
    private readonly model: DmnTableModel;
    private readonly view: DmnTableView;
    private disposed = false;

    constructor(options: DmnTableEditorOptions) {
        this.model = new DmnTableModel(options.initialModel);
        this.view = new DmnTableView(options.host, this.model, options.commands);
    }

    /** Current model snapshot. */
    get state(): DecisionTableModel {
        return this.model.state;
    }

    /** Replace the model wholesale (load from file). Clears command-stack history at the caller's discretion (the editor doesn't touch the stack). */
    load(model: DecisionTableModel): void {
        this.model.load(model);
    }

    /**
     * Convenience: serialize the current state as DMN 1.3 XML for
     * `POST /decision-definitions/{key}/draft.dmn`. Equivalent to
     * `writeDmnXml(this.state)` -- exposed as a method so the Angular
     * wrapper can call `editor.toXml()` without importing
     * the serializer separately.
     */
    toXml(): string {
        return writeDmnXml(this.model.state);
    }

    /**
     * Convenience: parse a DMN 1.3 XML body + load it as the current
     * model. Equivalent to `this.load(readDmnXml(xml))`. Throws
     * {@link DmnXmlParseError} on malformed input.
     */
    fromXml(xml: string): void {
        this.model.load(readDmnXml(xml));
    }

    /** Subscribe to model changes. Useful for auto-save / dirty indicators. */
    onChange(listener: (state: DecisionTableModel) => void): () => void {
        return this.model.onChange(listener);
    }

    /** The DOM root the view rendered into -- test affordance. */
    get element(): HTMLElement {
        return this.view.element;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.view.dispose();
        this.model.dispose();
    }
}
