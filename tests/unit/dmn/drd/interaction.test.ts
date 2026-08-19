import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    DmnDrdEditor,
    DmnDrdPropertyPanel,
    UpdateElementPropertyCommand,
    UpdateRequirementPropertyCommand,
    UpdateDiagramPropertyCommand,
    defaultSizeForKind,
    SVG_NS,
} from '../../../../src/dmn/drd/index.js';
import type { DmnDrdModel } from '../../../../src/dmn/drd/index.js';

/**
 * Interaction-layer tests — the three property-panel scopes
 * (element / requirement / diagram), the kind-dependent element schema,
 * the editing commands (element name + decision-logic ref, requirement
 * endpoints, diagram key) with undo, and the panel→command end-to-end
 * wiring through real field-change events. Mirrors the
 * state-machine interaction coverage.
 */
describe('DmnDrdEditor interaction layer', () => {
    let host: HTMLElement;
    let panelHost: HTMLElement;
    let svgGroup: SVGGElement;
    let editor: DmnDrdEditor;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    /** Positioned model so the editor respects the layout (no auto-layout reshuffle). */
    function model(): DmnDrdModel {
        return {
            name: 'pricing',
            elements: [
                { id: 'age', kind: 'inputData', name: 'Applicant age', position: { x: 40, y: 40 }, size: defaultSizeForKind('inputData') },
                { id: 'eligible', kind: 'decision', name: 'Eligibility', position: { x: 320, y: 40 }, size: defaultSizeForKind('decision') },
            ],
            requirements: [{ id: 'ir1', from: 'age', to: 'eligible' }],
        };
    }

    beforeEach(() => {
        host = document.createElement('div');
        panelHost = document.createElement('div');
        document.body.appendChild(host);
        document.body.appendChild(panelHost);
        svgGroup = makeSvgGroup();
        editor = new DmnDrdEditor({ host, svgGroup, initialModel: model() });
    });

    afterEach(() => {
        editor.dispose();
        document.body.innerHTML = '';
    });

    // ─── property-panel scopes ────────────────────────────────────────────

    it('renders the diagram scope when nothing is selected', () => {
        const panel = new DmnDrdPropertyPanel({ host: panelHost, editor });
        expect(panel.scope).toBe('diagram');
        expect(panel.fieldKeys).toEqual(['name']);
        panel.dispose();
    });

    it('swaps to element / requirement fields as the selection changes', () => {
        const panel = new DmnDrdPropertyPanel({ host: panelHost, editor });

        // A Decision exposes name + decisionLogicRef.
        editor.selection.select({ kind: 'element', id: 'eligible' });
        expect(panel.scope).toBe('element');
        expect(panel.fieldKeys).toEqual(['name', 'decisionLogicRef']);

        // An InputData exposes only name (no logic).
        editor.selection.select({ kind: 'element', id: 'age' });
        expect(panel.fieldKeys).toEqual(['name']);

        editor.selection.select({ kind: 'requirement', id: 'ir1' });
        expect(panel.scope).toBe('requirement');
        expect(panel.fieldKeys).toEqual(['from', 'to']);

        editor.selection.clear();
        expect(panel.scope).toBe('diagram');
        panel.dispose();
    });

    // ─── editing commands (direct) + undo ─────────────────────────────────

    it('renames an element by name without touching its id or requirements', () => {
        editor.commandStack.execute(
            new UpdateElementPropertyCommand(editor, 'eligible', 'name', 'Loan eligibility'),
        );
        expect(editor.findElement('eligible')!.name).toBe('Loan eligibility');
        // id is stable → the requirement endpoint still resolves.
        expect(editor.findRequirement('ir1')!.to).toBe('eligible');

        editor.commandStack.undo();
        expect(editor.findElement('eligible')!.name).toBe('Eligibility');
    });

    it('sets + drops a decision-logic ref, and undoes', () => {
        editor.commandStack.execute(
            new UpdateElementPropertyCommand(editor, 'eligible', 'decisionLogicRef', 'pricing.eligibility'),
        );
        expect(editor.findElement('eligible')!.decisionLogicRef).toBe('pricing.eligibility');
        editor.commandStack.undo();
        expect(editor.findElement('eligible')!.decisionLogicRef).toBeUndefined();

        // A blank ref is dropped, not stored as an empty string.
        editor.commandStack.execute(
            new UpdateElementPropertyCommand(editor, 'eligible', 'decisionLogicRef', '   '),
        );
        expect(editor.findElement('eligible')!.decisionLogicRef).toBeUndefined();
    });

    it('re-points a requirement endpoint, and undoes', () => {
        editor.commandStack.execute(
            new UpdateRequirementPropertyCommand(editor, 'ir1', 'from', 'eligible'),
        );
        expect(editor.findRequirement('ir1')!.from).toBe('eligible');
        editor.commandStack.undo();
        expect(editor.findRequirement('ir1')!.from).toBe('age');
    });

    it('edits the diagram definition key, and undoes', () => {
        editor.commandStack.execute(new UpdateDiagramPropertyCommand(editor, 'name', 'lending'));
        expect(editor.state.name).toBe('lending');
        editor.commandStack.undo();
        expect(editor.state.name).toBe('pricing');
    });

    // ─── panel → command end-to-end (real field events) ───────────────────

    it('renames an element when the panel name input commits', () => {
        const panel = new DmnDrdPropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'element', id: 'age' });

        const nameInput = panelHost.querySelector<HTMLInputElement>(
            '[data-field-key="name"] input',
        )!;
        nameInput.value = 'Birth date';
        nameInput.dispatchEvent(new Event('change'));

        expect(editor.findElement('age')!.name).toBe('Birth date');
        panel.dispose();
    });

    it('re-points a requirement when the panel select commits', () => {
        const panel = new DmnDrdPropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'requirement', id: 'ir1' });

        const fromSelect = panelHost.querySelector<HTMLSelectElement>(
            '[data-field-key="from"] select',
        )!;
        fromSelect.value = 'eligible';
        fromSelect.dispatchEvent(new Event('change'));

        expect(editor.findRequirement('ir1')!.from).toBe('eligible');
        panel.dispose();
    });

    it('rebuilds cleanly to the diagram scope when the model is reloaded under a live selection', () => {
        const panel = new DmnDrdPropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'element', id: 'age' });
        expect(panel.scope).toBe('element');

        // Replace the model without `age`. load() clears the selection, so the
        // panel rebuilds to the diagram scope; the follow-up change emit must
        // not throw on the now-stale selection.
        editor.load({
            name: 'pricing',
            elements: [
                { id: 'eligible', kind: 'decision', name: 'Eligibility', position: { x: 40, y: 40 }, size: defaultSizeForKind('decision') },
            ],
            requirements: [],
        });
        expect(editor.selection.target).toBeNull();
        expect(panel.scope).toBe('diagram');
        expect(panel.fieldKeys).toEqual(['name']);
        panel.dispose();
    });
});
