import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    DmnDrdEditor,
    AddElementCommand,
    RemoveElementCommand,
    MoveElementCommand,
    AddRequirementCommand,
    RemoveRequirementCommand,
    defaultSizeForKind,
    SVG_NS,
} from '../../../../src/dmn/drd/index.js';
import type {
    DmnDrdElement,
    DmnDrdModel,
    DmnInformationRequirement,
} from '../../../../src/dmn/drd/index.js';

/**
 * Structural-editing tests — the add/remove/move element +
 * add/remove requirement mutators, their commands with undo (incl. the
 * cascade-restore on element removal), the deterministic id suggesters,
 * and the selection-clear-on-delete behaviour. These back the future
 * palette / connect-mode / drag / delete-key affordances.
 */
describe('DmnDrdEditor structural editing', () => {
    let host: HTMLElement;
    let svgGroup: SVGGElement;
    let editor: DmnDrdEditor;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    function element(id: string, kind: 'decision' | 'inputData', x = 40): DmnDrdElement {
        return { id, kind, name: id, position: { x, y: 40 }, size: defaultSizeForKind(kind) };
    }

    function req(id: string, from: string, to: string): DmnInformationRequirement {
        return { id, from, to };
    }

    function model(): DmnDrdModel {
        return {
            name: 'pricing',
            elements: [element('age', 'inputData', 40), element('eligible', 'decision', 320)],
            requirements: [req('ir1', 'age', 'eligible')],
        };
    }

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svgGroup = makeSvgGroup();
        editor = new DmnDrdEditor({ host, svgGroup, initialModel: model() });
    });

    afterEach(() => {
        editor.dispose();
        document.body.innerHTML = '';
    });

    // ─── add / remove element ─────────────────────────────────────────────

    it('adds an element via command + paints it, and undoes', () => {
        editor.commandStack.execute(new AddElementCommand(editor, element('income', 'inputData', 40)));
        expect(editor.findElement('income')).not.toBeNull();
        expect(
            editor.paintedElementsElement!.querySelectorAll('g[data-element-id]').length,
        ).toBe(3);

        editor.commandStack.undo();
        expect(editor.findElement('income')).toBeNull();
        expect(
            editor.paintedElementsElement!.querySelectorAll('g[data-element-id]').length,
        ).toBe(2);
    });

    it('rejects a duplicate element id', () => {
        editor.addElement(element('age', 'inputData', 999)); // id already taken
        expect(editor.state.elements.length).toBe(2);
        expect(editor.findElement('age')!.position.x).toBe(40); // original untouched
    });

    it('removing a node cascade-removes its requirements, and undo restores the sub-graph', () => {
        editor.commandStack.execute(new RemoveElementCommand(editor, 'eligible'));
        expect(editor.findElement('eligible')).toBeNull();
        // The incident requirement is gone too (no dangling edge).
        expect(editor.findRequirement('ir1')).toBeNull();
        expect(editor.state.requirements.length).toBe(0);

        editor.commandStack.undo();
        expect(editor.findElement('eligible')).not.toBeNull();
        expect(editor.findRequirement('ir1')).not.toBeNull();
        expect(editor.findRequirement('ir1')!.to).toBe('eligible');
    });

    it('clears the selection when the selected node is removed', () => {
        editor.selection.select({ kind: 'element', id: 'eligible' });
        editor.commandStack.execute(new RemoveElementCommand(editor, 'eligible'));
        expect(editor.selection.target).toBeNull();
    });

    // ─── move element ─────────────────────────────────────────────────────

    it('moves an element via command, and undo snaps it back', () => {
        editor.commandStack.execute(new MoveElementCommand(editor, 'age', { x: 500, y: 200 }));
        expect(editor.findElement('age')!.position).toEqual({ x: 500, y: 200 });
        editor.commandStack.undo();
        expect(editor.findElement('age')!.position).toEqual({ x: 40, y: 40 });
    });

    // ─── add / remove requirement ─────────────────────────────────────────

    it('adds + removes a requirement edge via commands, with undo', () => {
        editor.commandStack.execute(new AddElementCommand(editor, element('income', 'inputData', 40)));
        editor.commandStack.execute(new AddRequirementCommand(editor, req('ir2', 'income', 'eligible')));
        expect(editor.findRequirement('ir2')).not.toBeNull();
        expect(
            editor.paintedRequirementsElement!.querySelectorAll('g[data-requirement-id]').length,
        ).toBe(2);

        editor.commandStack.execute(new RemoveRequirementCommand(editor, 'ir1'));
        expect(editor.findRequirement('ir1')).toBeNull();

        editor.commandStack.undo(); // un-remove ir1
        expect(editor.findRequirement('ir1')).not.toBeNull();
        editor.commandStack.undo(); // un-add ir2
        expect(editor.findRequirement('ir2')).toBeNull();
    });

    it('clears the selection when the selected requirement is removed', () => {
        editor.selection.select({ kind: 'requirement', id: 'ir1' });
        editor.commandStack.execute(new RemoveRequirementCommand(editor, 'ir1'));
        expect(editor.selection.target).toBeNull();
    });

    // ─── id suggesters ────────────────────────────────────────────────────

    it('suggests unique, kind-prefixed element ids and unique requirement ids', () => {
        // Base model has 2 elements (age, eligible) + 1 requirement (ir1).
        const decId = editor.suggestElementId('decision');
        expect(decId).toMatch(/^decision_\d+$/);
        expect(editor.findElement(decId)).toBeNull();

        const reqId = editor.suggestRequirementId();
        expect(reqId).toMatch(/^ir_\d+$/);
        expect(editor.findRequirement(reqId)).toBeNull();

        // Collision path: a single node already occupies the count-based seed
        // slot `input_2`, so the suggester must bump past it to `input_3`.
        editor.load({
            name: 'x',
            elements: [
                { id: 'input_2', kind: 'inputData', name: 'a', position: { x: 0, y: 0 }, size: defaultSizeForKind('inputData') },
            ],
            requirements: [],
        });
        expect(editor.suggestElementId('inputData')).toBe('input_3');
    });
});
