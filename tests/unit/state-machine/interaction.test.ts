import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    StateMachineEditor,
    StateMachinePropertyPanel,
    RenamePlaceCommand,
    SetInitialPlaceCommand,
    UpdateTransitionPropertyCommand,
    UpdateWorkflowPropertyCommand,
    RemovePlaceCommand,
    RemoveTransitionCommand,
    DEFAULT_PLACE_SIZE,
    SVG_NS,
} from '../../../src/state-machine/index.js';
import type { StateMachineModel } from '../../../src/state-machine/index.js';

/**
 * interaction-layer tests — click-to-select, the three property-
 * panel scopes, the editing commands (rename cascade / single-initial /
 * guard / workflow marking + audit) with undo, and the panel→command
 * end-to-end wiring through real field-change events.
 */
describe('StateMachineEditor interaction layer', () => {
    let host: HTMLElement;
    let panelHost: HTMLElement;
    let svgGroup: SVGGElement;
    let editor: StateMachineEditor;

    function makeSvgGroup(): SVGGElement {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return g;
    }

    /** Positioned model so the editor respects the layout (no auto-layout reshuffle). */
    function model(): StateMachineModel {
        return {
            workflowName: 'order_lifecycle',
            supports: ['Acme\\Shop\\Order'],
            markingProperty: 'status',
            places: [
                { id: 'draft', position: { x: 40, y: 40 }, size: DEFAULT_PLACE_SIZE, initial: true },
                { id: 'submitted', position: { x: 280, y: 40 }, size: DEFAULT_PLACE_SIZE },
            ],
            transitions: [{ id: 'submit', name: 'submit', from: 'draft', to: 'submitted' }],
        };
    }

    beforeEach(() => {
        host = document.createElement('div');
        panelHost = document.createElement('div');
        document.body.appendChild(host);
        document.body.appendChild(panelHost);
        svgGroup = makeSvgGroup();
        editor = new StateMachineEditor({ host, svgGroup, initialModel: model() });
    });

    afterEach(() => {
        editor.dispose();
        document.body.innerHTML = '';
    });

    // ─── click-to-select ──────────────────────────────────────────────────

    it('selects a place when a painted place is clicked', () => {
        const label = editor.paintedPlacesElement!.querySelector(
            'g[data-place-id="draft"] .coolms-designer__sm-place-label',
        )!;
        label.dispatchEvent(new Event('click', { bubbles: true }));
        expect(editor.selection.target).toEqual({ kind: 'place', id: 'draft' });
    });

    it('selects a transition when a painted transition is clicked', () => {
        const path = editor.paintedTransitionsElement!.querySelector(
            'g[data-transition-id="submit"] .coolms-designer__sm-transition-path',
        )!;
        path.dispatchEvent(new Event('click', { bubbles: true }));
        expect(editor.selection.target).toEqual({ kind: 'transition', id: 'submit' });
    });

    it('clears the selection when empty canvas is clicked', () => {
        editor.selection.select({ kind: 'place', id: 'draft' });
        svgGroup.dispatchEvent(new Event('click', { bubbles: true }));
        expect(editor.selection.target).toBeNull();
    });

    // ─── property-panel scopes ────────────────────────────────────────────

    it('renders the workflow scope when nothing is selected', () => {
        const panel = new StateMachinePropertyPanel({ host: panelHost, editor });
        expect(panel.scope).toBe('workflow');
        expect(panel.fieldKeys).toEqual([
            'workflowName',
            'markingProperty',
            'supports',
            'auditTrail',
        ]);
        panel.dispose();
    });

    it('swaps to place / transition fields as the selection changes', () => {
        const panel = new StateMachinePropertyPanel({ host: panelHost, editor });

        editor.selection.select({ kind: 'place', id: 'draft' });
        expect(panel.scope).toBe('place');
        expect(panel.fieldKeys).toEqual(['name', 'initial']);

        editor.selection.select({ kind: 'transition', id: 'submit' });
        expect(panel.scope).toBe('transition');
        expect(panel.fieldKeys).toEqual(['name', 'from', 'to', 'guard']);

        editor.selection.clear();
        expect(panel.scope).toBe('workflow');
        panel.dispose();
    });

    // ─── editing commands (direct) + undo ─────────────────────────────────

    it('renames a place + cascades to transitions, and undoes', () => {
        editor.commandStack.execute(new RenamePlaceCommand(editor, 'draft', 'created'));
        expect(editor.findPlace('created')).not.toBeNull();
        expect(editor.findPlace('draft')).toBeNull();
        expect(editor.findTransition('submit')!.from).toBe('created');

        editor.commandStack.undo();
        expect(editor.findPlace('draft')).not.toBeNull();
        expect(editor.findTransition('submit')!.from).toBe('draft');
    });

    it('enforces single-initial when setting initial, and undoes', () => {
        editor.commandStack.execute(new SetInitialPlaceCommand(editor, 'submitted', true));
        expect(editor.findPlace('submitted')!.initial).toBe(true);
        expect(editor.findPlace('draft')!.initial).toBeUndefined();

        editor.commandStack.undo();
        expect(editor.findPlace('draft')!.initial).toBe(true);
        expect(editor.findPlace('submitted')!.initial).toBeUndefined();
    });

    it('sets + drops a transition guard, and undoes', () => {
        editor.commandStack.execute(
            new UpdateTransitionPropertyCommand(editor, 'submit', 'guard', 'subject.total > 0'),
        );
        expect(editor.findTransition('submit')!.guard).toBe('subject.total > 0');
        editor.commandStack.undo();
        expect(editor.findTransition('submit')!.guard).toBeUndefined();

        // A blank guard is dropped, not stored as an empty string.
        editor.commandStack.execute(
            new UpdateTransitionPropertyCommand(editor, 'submit', 'guard', '   '),
        );
        expect(editor.findTransition('submit')!.guard).toBeUndefined();
    });

    it('edits workflow supports + marking, splitting the FQCN list', () => {
        editor.commandStack.execute(
            new UpdateWorkflowPropertyCommand(editor, 'supports', 'Acme\\A\nAcme\\B'),
        );
        expect(editor.state.supports).toEqual(['Acme\\A', 'Acme\\B']);
        editor.commandStack.undo();
        expect(editor.state.supports).toEqual(['Acme\\Shop\\Order']);
    });

    it('toggles the audit trail into workflowExtras, and undoes', () => {
        expect(editor.readWorkflowDisplayValue('auditTrail')).toBe(false);
        editor.commandStack.execute(new UpdateWorkflowPropertyCommand(editor, 'auditTrail', true));
        expect(editor.readWorkflowDisplayValue('auditTrail')).toBe(true);
        expect(editor.state.workflowExtras?.['audit_trail']).toEqual({ enabled: true });

        editor.commandStack.undo();
        expect(editor.readWorkflowDisplayValue('auditTrail')).toBe(false);
        expect(editor.state.workflowExtras).toBeUndefined();
    });

    // ─── remove (delete) + undo ───────────────────────────────────────────

    it('removes a place + cascades its incident transitions, and undoes', () => {
        editor.commandStack.execute(new RemovePlaceCommand(editor, 'draft'));
        expect(editor.findPlace('draft')).toBeNull();
        expect(editor.findPlace('submitted')).not.toBeNull();
        // The 'submit' transition referenced 'draft' on its `from` — cascade-removed.
        expect(editor.findTransition('submit')).toBeNull();
        expect(editor.state.transitions).toHaveLength(0);

        editor.commandStack.undo();
        expect(editor.findPlace('draft')).not.toBeNull();
        expect(editor.findTransition('submit')).not.toBeNull();
        expect(editor.findTransition('submit')!.from).toBe('draft');
    });

    it('removes a single transition (places untouched), and undoes', () => {
        editor.commandStack.execute(new RemoveTransitionCommand(editor, 'submit'));
        expect(editor.findTransition('submit')).toBeNull();
        expect(editor.findPlace('draft')).not.toBeNull();
        expect(editor.findPlace('submitted')).not.toBeNull();

        editor.commandStack.undo();
        expect(editor.findTransition('submit')).not.toBeNull();
        expect(editor.findTransition('submit')!.to).toBe('submitted');
    });

    // ─── panel → command end-to-end (real field events) ───────────────────

    it('marks a place initial when the panel checkbox is toggled', () => {
        const panel = new StateMachinePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'place', id: 'submitted' });

        const checkbox = panelHost.querySelector<HTMLInputElement>(
            '[data-field-key="initial"] input[type="checkbox"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(editor.findPlace('submitted')!.initial).toBe(true);
        expect(editor.findPlace('draft')!.initial).toBeUndefined();
        panel.dispose();
    });

    it('renames a transition when the panel name input commits', () => {
        const panel = new StateMachinePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'transition', id: 'submit' });

        const nameInput = panelHost.querySelector<HTMLInputElement>(
            '[data-field-key="name"] input',
        )!;
        nameInput.value = 'place_order';
        nameInput.dispatchEvent(new Event('change'));

        expect(editor.findTransition('submit')!.name).toBe('place_order');
        panel.dispose();
    });

    it('drops the selection when the selected place vanishes underneath it', () => {
        const panel = new StateMachinePropertyPanel({ host: panelHost, editor });
        editor.selection.select({ kind: 'place', id: 'draft' });
        expect(editor.selection.target).not.toBeNull();

        // Rename NOT via the panel — the editor emits change; onEditorChange
        // sees the selected id is gone and clears the selection.
        editor.renamePlace('draft', 'gone');
        expect(editor.selection.target).toBeNull();
        panel.dispose();
    });
});
