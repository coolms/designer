import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandStack } from '../../../../src/canvas/CommandStack.js';
import { DmnTableEditor } from '../../../../src/dmn/table/DmnTableEditor.js';
import { emptyDecisionTable } from '../../../../src/dmn/table/types.js';

describe('DmnTableEditor — integration', () => {
    let host: HTMLDivElement;
    let commands: CommandStack;
    let editor: DmnTableEditor | null;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        commands = new CommandStack();
        editor = null;
    });

    afterEach(() => {
        editor?.dispose();
        commands.dispose();
        host.remove();
    });

    function make() {
        editor = new DmnTableEditor({ host, commands });
        return editor;
    }

    function input(selector: string): HTMLInputElement {
        const el = host.querySelector(selector);
        if (!(el instanceof HTMLInputElement)) {
            throw new Error(`No input element matched "${selector}"`);
        }
        return el;
    }

    function select(selector: string): HTMLSelectElement {
        const el = host.querySelector(selector);
        if (!(el instanceof HTMLSelectElement)) {
            throw new Error(`No select element matched "${selector}"`);
        }
        return el;
    }

    function button(label: string): HTMLButtonElement {
        const buttons = [...host.querySelectorAll('button')];
        const found = buttons.find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
        if (!(found instanceof HTMLButtonElement)) {
            throw new Error(`No button with label "${label}". Available: ${buttons.map((b) => b.textContent).join(', ')}`);
        }
        return found;
    }

    function fireChange(el: HTMLInputElement | HTMLSelectElement, value: string): void {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ------------------------------------------------------------------
    // Mount + initial render
    // ------------------------------------------------------------------

    describe('mount', () => {
        it('renders an empty starter table by default', () => {
            const e = make();
            expect(e.state.inputs).toHaveLength(1);
            expect(e.state.outputs).toHaveLength(1);
            expect(e.state.rules).toHaveLength(1);
            expect(host.querySelector('.coolms-designer__dmn-table')).not.toBeNull();
            expect(host.querySelector('.coolms-designer__dmn-table-grid')).not.toBeNull();
        });

        it('renders the provided initial model', () => {
            const initial = emptyDecisionTable('pricing.discount');
            editor = new DmnTableEditor({ host, commands, initialModel: initial });
            expect(input('.coolms-designer__dmn-table-header-field input').value).toBe('pricing.discount');
        });

        it('shows the aggregator dropdown only when hit policy is COLLECT', () => {
            const e = make();
            const policySelect = host.querySelector(
                '.coolms-designer__dmn-table-header-field:nth-child(2) select',
            ) as HTMLSelectElement;

            // initially UNIQUE -> no aggregator
            expect(host.querySelectorAll('.coolms-designer__dmn-table-header-field')).toHaveLength(2);

            fireChange(policySelect, 'COLLECT');
            expect(host.querySelectorAll('.coolms-designer__dmn-table-header-field')).toHaveLength(3);
            expect(e.state.hitPolicy).toBe('COLLECT');

            fireChange(policySelect, 'FIRST');
            expect(host.querySelectorAll('.coolms-designer__dmn-table-header-field')).toHaveLength(2);
            expect(e.state.hitPolicy).toBe('FIRST');
        });
    });

    // ------------------------------------------------------------------
    // User interactions wire through commands
    // ------------------------------------------------------------------

    describe('user interactions', () => {
        it('renaming the decision dispatches RenameDecisionCommand', () => {
            const e = make();
            const nameInput = input('.coolms-designer__dmn-table-header-field input');
            fireChange(nameInput, 'pricing.discount');
            expect(e.state.name).toBe('pricing.discount');
            expect(commands.canUndo).toBe(true);
        });

        it('changing hit policy dispatches SetHitPolicyCommand', () => {
            const e = make();
            const policy = select('.coolms-designer__dmn-table-header-field:nth-child(2) select');
            fireChange(policy, 'FIRST');
            expect(e.state.hitPolicy).toBe('FIRST');
        });

        it('adding a rule dispatches AddRuleCommand', () => {
            const e = make();
            button('+ rule').click();
            expect(e.state.rules).toHaveLength(2);
        });

        it('adding an input column dispatches AddInputClauseCommand + grows entries', () => {
            const e = make();
            button('+ input').click();
            expect(e.state.inputs).toHaveLength(2);
            expect(e.state.rules[0]?.inputEntries).toHaveLength(2);
        });

        it('editing an input entry dispatches SetInputEntryCommand', () => {
            const e = make();
            const cell = input('[data-rule-index="0"][data-column-index="0"].coolms-designer__dmn-table-input-entry input');
            fireChange(cell, '> 100');
            expect(e.state.rules[0]?.inputEntries[0]).toBe('> 100');
        });

        it('editing an output entry dispatches SetOutputEntryCommand', () => {
            const e = make();
            const cell = input('[data-rule-index="0"][data-column-index="0"].coolms-designer__dmn-table-output-entry input');
            fireChange(cell, "'high'");
            expect(e.state.rules[0]?.outputEntries[0]).toBe("'high'");
        });

        it('editing an input clause name dispatches SetInputNameCommand', () => {
            const e = make();
            const nameInput = input('.coolms-designer__dmn-table-input-name');
            fireChange(nameInput, 'amount');
            expect(e.state.inputs[0]?.name).toBe('amount');
        });

        it('editing an input clause expression dispatches SetInputExpressionCommand', () => {
            const e = make();
            const exprInput = input('.coolms-designer__dmn-table-input-expr');
            fireChange(exprInput, 'variables.amount');
            expect(e.state.inputs[0]?.expression).toBe('variables.amount');
        });

        it('row delete button hidden when only 1 rule exists', () => {
            make();
            const deleteButtons = host.querySelectorAll('.coolms-designer__dmn-table-row-delete');
            expect(deleteButtons).toHaveLength(0);
        });

        it('row delete button appears once there are 2+ rules', () => {
            const e = make();
            button('+ rule').click();
            const deleteButtons = host.querySelectorAll('.coolms-designer__dmn-table-row-delete');
            expect(deleteButtons).toHaveLength(2);

            (deleteButtons[1] as HTMLButtonElement).click();
            expect(e.state.rules).toHaveLength(1);
        });

        it('input column delete button hidden when only 1 input exists', () => {
            make();
            expect(host.querySelectorAll('.coolms-designer__dmn-table-input-header .coolms-designer__dmn-table-col-delete')).toHaveLength(0);
        });
    });

    // ------------------------------------------------------------------
    // Undo/Redo
    // ------------------------------------------------------------------

    describe('undo/redo through CommandStack', () => {
        it('rename → undo restores name', () => {
            const e = make();
            const nameInput = input('.coolms-designer__dmn-table-header-field input');
            fireChange(nameInput, 'pricing.discount');

            commands.undo();
            expect(e.state.name).toBe('decision.unnamed');

            commands.redo();
            expect(e.state.name).toBe('pricing.discount');
        });

        it('add row → undo removes it', () => {
            const e = make();
            button('+ rule').click();
            expect(e.state.rules).toHaveLength(2);

            commands.undo();
            expect(e.state.rules).toHaveLength(1);
        });

        it('add then delete then undo restores the rule with same id', () => {
            const e = make();
            button('+ rule').click();
            const addedId = e.state.rules[1]?.id;
            expect(addedId).toBeDefined();

            const deleteButtons = host.querySelectorAll('.coolms-designer__dmn-table-row-delete');
            (deleteButtons[1] as HTMLButtonElement).click();
            expect(e.state.rules).toHaveLength(1);

            commands.undo();
            expect(e.state.rules).toHaveLength(2);
            expect(e.state.rules[1]?.id).toBe(addedId);
        });

        it('column delete then undo restores entries to all rules', () => {
            const e = make();
            button('+ input').click();
            const cell = input(
                '[data-rule-index="0"][data-column-index="1"].coolms-designer__dmn-table-input-entry input',
            );
            fireChange(cell, '> 100');
            expect(e.state.rules[0]?.inputEntries[1]).toBe('> 100');

            const colDeleteButtons = host.querySelectorAll('.coolms-designer__dmn-table-input-header .coolms-designer__dmn-table-col-delete');
            (colDeleteButtons[1] as HTMLButtonElement).click();
            expect(e.state.inputs).toHaveLength(1);

            commands.undo();
            expect(e.state.inputs).toHaveLength(2);
            expect(e.state.rules[0]?.inputEntries[1]).toBe('> 100');
        });
    });

    // ------------------------------------------------------------------
    // Round-trip load
    // ------------------------------------------------------------------

    describe('load + state', () => {
        it('load() replaces the model + re-renders', () => {
            const e = make();
            e.load({
                name: 'risk.score',
                hitPolicy: 'PRIORITY',
                aggregator: null,
                inputs: [{ id: 'in_a', name: 'age', expression: 'v.age', typeRef: 'number' }],
                outputs: [{ id: 'out_a', name: 'tier', typeRef: 'string' }],
                rules: [
                    { id: 'r_a', inputEntries: ['>= 18'], outputEntries: ["'adult'"] },
                ],
            });
            expect(e.state.name).toBe('risk.score');
            expect(input('.coolms-designer__dmn-table-input-name').value).toBe('age');
            expect(e.state.rules[0]?.inputEntries[0]).toBe('>= 18');
        });

        it('onChange fires on every model mutation', () => {
            const e = make();
            const listener = vi.fn();
            e.onChange(listener);
            fireChange(input('.coolms-designer__dmn-table-header-field input'), 'p');
            fireChange(input('.coolms-designer__dmn-table-header-field input'), 'pr');
            // Each commit dispatches a command which mutates the model + fires change.
            expect(listener).toHaveBeenCalledTimes(2);
        });
    });

    describe('dispose', () => {
        it('removes the rendered DOM + tears down model', () => {
            const e = make();
            expect(host.querySelector('.coolms-designer__dmn-table')).not.toBeNull();
            e.dispose();
            expect(host.querySelector('.coolms-designer__dmn-table')).toBeNull();
        });

        it('is idempotent', () => {
            const e = make();
            e.dispose();
            expect(() => e.dispose()).not.toThrow();
        });
    });
});
