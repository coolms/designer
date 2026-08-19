import type { CommandStack } from '../../canvas/CommandStack.js';
import {
    AddInputClauseCommand,
    AddOutputClauseCommand,
    AddRuleCommand,
    DeleteInputClauseCommand,
    DeleteOutputClauseCommand,
    DeleteRuleCommand,
    RenameDecisionCommand,
    SetAggregatorCommand,
    SetHitPolicyCommand,
    SetInputEntryCommand,
    SetInputExpressionCommand,
    SetInputNameCommand,
    SetOutputEntryCommand,
    SetOutputNameCommand,
} from './commands.js';
import type { DmnTableModel } from './DmnTableModel.js';
import type { Aggregator, DecisionTableModel, HitPolicy } from './types.js';

const HIT_POLICIES: ReadonlyArray<HitPolicy> = [
    'UNIQUE',
    'FIRST',
    'PRIORITY',
    'ANY',
    'COLLECT',
];

const AGGREGATORS: ReadonlyArray<Aggregator> = ['SUM', 'MIN', 'MAX', 'COUNT'];

/**
 * Renders the {@link DmnTableModel} as an editable HTML table + handles
 * user input by dispatching {@link Command}s onto the
 * {@link CommandStack}. Re-renders on every model change -- the table
 * is small enough (10s of rules) that wholesale re-render is faster
 * than diffing, and the renderer code stays simple.
 */
export class DmnTableView {
    private readonly host: HTMLElement;
    private readonly model: DmnTableModel;
    private readonly commands: CommandStack;
    private readonly subscriptions: Array<() => void> = [];
    private root: HTMLElement;
    private disposed = false;

    constructor(host: HTMLElement, model: DmnTableModel, commands: CommandStack) {
        this.host = host;
        this.model = model;
        this.commands = commands;

        const doc = host.ownerDocument;
        this.root = doc.createElement('div');
        this.root.classList.add('coolms-designer__dmn-table');
        host.appendChild(this.root);

        this.subscriptions.push(this.model.onChange((state) => this.render(state)));
        this.render(this.model.state);
    }

    /** Test affordance. */
    get element(): HTMLElement {
        return this.root;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const off of this.subscriptions) off();
        this.subscriptions.length = 0;
        this.root.remove();
    }

    private render(state: DecisionTableModel): void {
        if (this.disposed) return;
        const doc = this.root.ownerDocument;
        this.root.replaceChildren();

        // Header bar
        const header = doc.createElement('div');
        header.classList.add('coolms-designer__dmn-table-header');
        header.appendChild(this.renderLabeledInput('Name', state.name, (next) => {
            this.commands.execute(new RenameDecisionCommand(this.model, next));
        }));
        header.appendChild(this.renderLabeledSelect(
            'Hit policy',
            state.hitPolicy,
            HIT_POLICIES.map((p) => ({ value: p, label: p })),
            (next) => {
                this.commands.execute(new SetHitPolicyCommand(this.model, next as HitPolicy));
            },
        ));
        if (state.hitPolicy === 'COLLECT') {
            header.appendChild(this.renderLabeledSelect(
                'Aggregator',
                state.aggregator ?? '',
                [{ value: '', label: '— none —' }, ...AGGREGATORS.map((a) => ({ value: a, label: a }))],
                (next) => {
                    const aggregator = next === '' ? null : (next as Aggregator);
                    this.commands.execute(new SetAggregatorCommand(this.model, aggregator));
                },
            ));
        }
        this.root.appendChild(header);

        // Table
        const table = doc.createElement('table');
        table.classList.add('coolms-designer__dmn-table-grid');
        this.root.appendChild(table);

        // Header row
        const thead = doc.createElement('thead');
        const headerRow = doc.createElement('tr');
        const cornerHeader = doc.createElement('th');
        cornerHeader.classList.add('coolms-designer__dmn-table-corner');
        cornerHeader.textContent = '#';
        headerRow.appendChild(cornerHeader);

        state.inputs.forEach((input, idx) => {
            const th = doc.createElement('th');
            th.classList.add('coolms-designer__dmn-table-input-header');
            th.setAttribute('data-input-index', String(idx));

            const nameInput = doc.createElement('input');
            nameInput.type = 'text';
            nameInput.classList.add('coolms-designer__dmn-table-input-name');
            nameInput.value = input.name;
            nameInput.setAttribute('aria-label', `Input ${idx + 1} name`);
            nameInput.addEventListener('change', () => {
                if (nameInput.value !== input.name) {
                    this.commands.execute(new SetInputNameCommand(this.model, idx, nameInput.value));
                }
            });
            th.appendChild(nameInput);

            const exprInput = doc.createElement('input');
            exprInput.type = 'text';
            exprInput.classList.add('coolms-designer__dmn-table-input-expr');
            exprInput.value = input.expression;
            exprInput.placeholder = 'expression';
            exprInput.setAttribute('aria-label', `Input ${idx + 1} expression`);
            exprInput.addEventListener('change', () => {
                if (exprInput.value !== input.expression) {
                    this.commands.execute(new SetInputExpressionCommand(this.model, idx, exprInput.value));
                }
            });
            th.appendChild(exprInput);

            if (state.inputs.length > 1) {
                const delBtn = doc.createElement('button');
                delBtn.type = 'button';
                delBtn.classList.add('coolms-designer__dmn-table-col-delete');
                delBtn.setAttribute('aria-label', `Delete input ${idx + 1}`);
                delBtn.textContent = '×';
                delBtn.addEventListener('click', () => {
                    this.commands.execute(new DeleteInputClauseCommand(this.model, idx));
                });
                th.appendChild(delBtn);
            }
            headerRow.appendChild(th);
        });

        const addInputTh = doc.createElement('th');
        addInputTh.classList.add('coolms-designer__dmn-table-add-input');
        const addInputBtn = doc.createElement('button');
        addInputBtn.type = 'button';
        addInputBtn.textContent = '+ input';
        addInputBtn.setAttribute('aria-label', 'Add input column');
        addInputBtn.addEventListener('click', () => {
            this.commands.execute(new AddInputClauseCommand(this.model));
        });
        addInputTh.appendChild(addInputBtn);
        headerRow.appendChild(addInputTh);

        state.outputs.forEach((output, idx) => {
            const th = doc.createElement('th');
            th.classList.add('coolms-designer__dmn-table-output-header');
            th.setAttribute('data-output-index', String(idx));

            const nameInput = doc.createElement('input');
            nameInput.type = 'text';
            nameInput.classList.add('coolms-designer__dmn-table-output-name');
            nameInput.value = output.name;
            nameInput.setAttribute('aria-label', `Output ${idx + 1} name`);
            nameInput.addEventListener('change', () => {
                if (nameInput.value !== output.name) {
                    this.commands.execute(new SetOutputNameCommand(this.model, idx, nameInput.value));
                }
            });
            th.appendChild(nameInput);

            if (state.outputs.length > 1) {
                const delBtn = doc.createElement('button');
                delBtn.type = 'button';
                delBtn.classList.add('coolms-designer__dmn-table-col-delete');
                delBtn.setAttribute('aria-label', `Delete output ${idx + 1}`);
                delBtn.textContent = '×';
                delBtn.addEventListener('click', () => {
                    this.commands.execute(new DeleteOutputClauseCommand(this.model, idx));
                });
                th.appendChild(delBtn);
            }
            headerRow.appendChild(th);
        });

        const addOutputTh = doc.createElement('th');
        addOutputTh.classList.add('coolms-designer__dmn-table-add-output');
        const addOutputBtn = doc.createElement('button');
        addOutputBtn.type = 'button';
        addOutputBtn.textContent = '+ output';
        addOutputBtn.setAttribute('aria-label', 'Add output column');
        addOutputBtn.addEventListener('click', () => {
            this.commands.execute(new AddOutputClauseCommand(this.model));
        });
        addOutputTh.appendChild(addOutputBtn);
        headerRow.appendChild(addOutputTh);

        const trailingTh = doc.createElement('th');
        trailingTh.classList.add('coolms-designer__dmn-table-row-actions-header');
        headerRow.appendChild(trailingTh);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body rows
        const tbody = doc.createElement('tbody');
        state.rules.forEach((rule, ruleIdx) => {
            const tr = doc.createElement('tr');
            tr.setAttribute('data-rule-id', rule.id);
            tr.setAttribute('data-rule-index', String(ruleIdx));

            const indexTh = doc.createElement('th');
            indexTh.classList.add('coolms-designer__dmn-table-rule-index');
            indexTh.textContent = String(ruleIdx + 1);
            tr.appendChild(indexTh);

            state.inputs.forEach((_, colIdx) => {
                const td = doc.createElement('td');
                td.classList.add('coolms-designer__dmn-table-entry', 'coolms-designer__dmn-table-input-entry');
                td.setAttribute('data-rule-index', String(ruleIdx));
                td.setAttribute('data-column-index', String(colIdx));
                const input = doc.createElement('input');
                input.type = 'text';
                input.classList.add('coolms-designer__dmn-table-entry-input');
                input.value = rule.inputEntries[colIdx] ?? '';
                input.placeholder = '—';
                input.setAttribute('aria-label', `Rule ${ruleIdx + 1}, input ${colIdx + 1}`);
                input.addEventListener('change', () => {
                    const prev = rule.inputEntries[colIdx] ?? '';
                    if (input.value !== prev) {
                        this.commands.execute(new SetInputEntryCommand(this.model, ruleIdx, colIdx, input.value));
                    }
                });
                td.appendChild(input);
                tr.appendChild(td);
            });

            const inputSpacer = doc.createElement('td');
            inputSpacer.classList.add('coolms-designer__dmn-table-spacer');
            tr.appendChild(inputSpacer);

            state.outputs.forEach((_, colIdx) => {
                const td = doc.createElement('td');
                td.classList.add('coolms-designer__dmn-table-entry', 'coolms-designer__dmn-table-output-entry');
                td.setAttribute('data-rule-index', String(ruleIdx));
                td.setAttribute('data-column-index', String(colIdx));
                const input = doc.createElement('input');
                input.type = 'text';
                input.classList.add('coolms-designer__dmn-table-entry-input');
                input.value = rule.outputEntries[colIdx] ?? '';
                input.placeholder = '—';
                input.setAttribute('aria-label', `Rule ${ruleIdx + 1}, output ${colIdx + 1}`);
                input.addEventListener('change', () => {
                    const prev = rule.outputEntries[colIdx] ?? '';
                    if (input.value !== prev) {
                        this.commands.execute(new SetOutputEntryCommand(this.model, ruleIdx, colIdx, input.value));
                    }
                });
                td.appendChild(input);
                tr.appendChild(td);
            });

            const outputSpacer = doc.createElement('td');
            outputSpacer.classList.add('coolms-designer__dmn-table-spacer');
            tr.appendChild(outputSpacer);

            const actionsTd = doc.createElement('td');
            actionsTd.classList.add('coolms-designer__dmn-table-row-actions');
            if (state.rules.length > 1) {
                const delBtn = doc.createElement('button');
                delBtn.type = 'button';
                delBtn.classList.add('coolms-designer__dmn-table-row-delete');
                delBtn.textContent = '×';
                delBtn.setAttribute('aria-label', `Delete rule ${ruleIdx + 1}`);
                delBtn.addEventListener('click', () => {
                    this.commands.execute(new DeleteRuleCommand(this.model, ruleIdx));
                });
                actionsTd.appendChild(delBtn);
            }
            tr.appendChild(actionsTd);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);

        // Footer: add-rule
        const tfoot = doc.createElement('tfoot');
        const addRuleRow = doc.createElement('tr');
        const addRuleCell = doc.createElement('td');
        addRuleCell.setAttribute(
            'colspan',
            String(1 + state.inputs.length + 1 + state.outputs.length + 1 + 1),
        );
        addRuleCell.classList.add('coolms-designer__dmn-table-add-rule-cell');
        const addRuleBtn = doc.createElement('button');
        addRuleBtn.type = 'button';
        addRuleBtn.textContent = '+ rule';
        addRuleBtn.setAttribute('aria-label', 'Add rule');
        addRuleBtn.addEventListener('click', () => {
            this.commands.execute(new AddRuleCommand(this.model));
        });
        addRuleCell.appendChild(addRuleBtn);
        addRuleRow.appendChild(addRuleCell);
        tfoot.appendChild(addRuleRow);
        table.appendChild(tfoot);
    }

    private renderLabeledInput(
        labelText: string,
        value: string,
        onCommit: (next: string) => void,
    ): HTMLElement {
        const doc = this.root.ownerDocument;
        const wrapper = doc.createElement('label');
        wrapper.classList.add('coolms-designer__dmn-table-header-field');
        const label = doc.createElement('span');
        label.textContent = labelText;
        wrapper.appendChild(label);
        const input = doc.createElement('input');
        input.type = 'text';
        input.value = value;
        input.addEventListener('change', () => {
            if (input.value !== value) onCommit(input.value);
        });
        wrapper.appendChild(input);
        return wrapper;
    }

    private renderLabeledSelect(
        labelText: string,
        value: string,
        options: ReadonlyArray<{ value: string; label: string }>,
        onCommit: (next: string) => void,
    ): HTMLElement {
        const doc = this.root.ownerDocument;
        const wrapper = doc.createElement('label');
        wrapper.classList.add('coolms-designer__dmn-table-header-field');
        const label = doc.createElement('span');
        label.textContent = labelText;
        wrapper.appendChild(label);
        const select = doc.createElement('select');
        for (const o of options) {
            const opt = doc.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            select.appendChild(opt);
        }
        select.value = value;
        select.addEventListener('change', () => {
            if (select.value !== value) onCommit(select.value);
        });
        wrapper.appendChild(select);
        return wrapper;
    }
}
