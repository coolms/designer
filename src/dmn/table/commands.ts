import type { Command } from '../../canvas/CommandStack.js';
import type { DmnTableModel } from './DmnTableModel.js';
import type {
    Aggregator,
    DataType,
    HitPolicy,
    InputClause,
    OutputClause,
    Rule,
} from './types.js';

/**
 * Each DMN editor user action wraps in one of these Commands so undo/
 * redo works via the {@link CommandStack} from M3.2.b. Commands hold
 * onto whatever previous state they need for `revert()` to restore --
 * the model's mutators conveniently return the prior value where
 * applicable so apply() can capture it for revert without an extra
 * read.
 *
 * Naming convention: `<Verb><Noun>Command`. All command labels are
 * surface-readable strings used by the {@link Toolbar}'s undo/redo
 * tooltips.
 */

export class RenameDecisionCommand implements Command {
    readonly label = 'Rename decision';
    private previous = '';
    constructor(private readonly model: DmnTableModel, private readonly next: string) {}
    apply(): void {
        this.previous = this.model.setName(this.next);
    }
    revert(): void {
        this.model.setName(this.previous);
    }
}

export class SetHitPolicyCommand implements Command {
    readonly label = 'Change hit policy';
    private previous: HitPolicy = 'UNIQUE';
    constructor(private readonly model: DmnTableModel, private readonly next: HitPolicy) {}
    apply(): void {
        this.previous = this.model.setHitPolicy(this.next);
    }
    revert(): void {
        this.model.setHitPolicy(this.previous);
    }
}

export class SetAggregatorCommand implements Command {
    readonly label = 'Change aggregator';
    private previous: Aggregator | null = null;
    constructor(private readonly model: DmnTableModel, private readonly next: Aggregator | null) {}
    apply(): void {
        this.previous = this.model.setAggregator(this.next);
    }
    revert(): void {
        this.model.setAggregator(this.previous);
    }
}

export class AddRuleCommand implements Command {
    readonly label = 'Add rule';
    private addedRule: Rule | null = null;
    private addedIndex = 0;
    constructor(private readonly model: DmnTableModel, private readonly atIndex?: number) {}
    apply(): void {
        const state = this.model.state;
        const ruleIndex = this.atIndex ?? state.rules.length;
        const rule: Rule = {
            id: this.addedRule?.id ?? this.model.generateId('r'),
            inputEntries: state.inputs.map(() => ''),
            outputEntries: state.outputs.map(() => ''),
        };
        this.addedRule = rule;
        this.addedIndex = ruleIndex;
        this.model.addRule(rule, ruleIndex);
    }
    revert(): void {
        this.model.removeRuleAt(this.addedIndex);
    }
}

export class DeleteRuleCommand implements Command {
    readonly label = 'Delete rule';
    private removedRule: Rule | null = null;
    constructor(private readonly model: DmnTableModel, private readonly atIndex: number) {}
    apply(): void {
        this.removedRule = this.model.removeRuleAt(this.atIndex);
    }
    revert(): void {
        if (this.removedRule) this.model.addRule(this.removedRule, this.atIndex);
    }
}

export class AddInputClauseCommand implements Command {
    readonly label = 'Add input column';
    private addedClause: InputClause | null = null;
    private addedIndex = 0;
    constructor(private readonly model: DmnTableModel, private readonly atIndex?: number) {}
    apply(): void {
        const state = this.model.state;
        const idx = this.atIndex ?? state.inputs.length;
        const clause: InputClause = this.addedClause ?? {
            id: this.model.generateId('in'),
            name: `input${state.inputs.length + 1}`,
            expression: '',
            typeRef: 'string',
        };
        this.addedClause = clause;
        this.addedIndex = idx;
        this.model.addInputClause(clause, idx);
    }
    revert(): void {
        this.model.removeInputClauseAt(this.addedIndex);
    }
}

export class DeleteInputClauseCommand implements Command {
    readonly label = 'Delete input column';
    private removed: { clause: InputClause; ruleEntries: string[] } | null = null;
    constructor(private readonly model: DmnTableModel, private readonly atIndex: number) {}
    apply(): void {
        this.removed = this.model.removeInputClauseAt(this.atIndex);
    }
    revert(): void {
        if (!this.removed) return;
        this.model.addInputClause(this.removed.clause, this.atIndex);
        // Restore each rule's entry at the same column index.
        const entries = this.removed.ruleEntries;
        const rules = this.model.state.rules;
        for (let i = 0; i < rules.length; i++) {
            this.model.setInputEntry(i, this.atIndex, entries[i] ?? '');
        }
    }
}

export class AddOutputClauseCommand implements Command {
    readonly label = 'Add output column';
    private addedClause: OutputClause | null = null;
    private addedIndex = 0;
    constructor(private readonly model: DmnTableModel, private readonly atIndex?: number) {}
    apply(): void {
        const state = this.model.state;
        const idx = this.atIndex ?? state.outputs.length;
        const clause: OutputClause = this.addedClause ?? {
            id: this.model.generateId('out'),
            name: `output${state.outputs.length + 1}`,
            typeRef: 'string',
        };
        this.addedClause = clause;
        this.addedIndex = idx;
        this.model.addOutputClause(clause, idx);
    }
    revert(): void {
        this.model.removeOutputClauseAt(this.addedIndex);
    }
}

export class DeleteOutputClauseCommand implements Command {
    readonly label = 'Delete output column';
    private removed: { clause: OutputClause; ruleEntries: string[] } | null = null;
    constructor(private readonly model: DmnTableModel, private readonly atIndex: number) {}
    apply(): void {
        this.removed = this.model.removeOutputClauseAt(this.atIndex);
    }
    revert(): void {
        if (!this.removed) return;
        this.model.addOutputClause(this.removed.clause, this.atIndex);
        const entries = this.removed.ruleEntries;
        const rules = this.model.state.rules;
        for (let i = 0; i < rules.length; i++) {
            this.model.setOutputEntry(i, this.atIndex, entries[i] ?? '');
        }
    }
}

export class SetInputNameCommand implements Command {
    readonly label = 'Rename input column';
    private previous = '';
    constructor(
        private readonly model: DmnTableModel,
        private readonly index: number,
        private readonly next: string,
    ) {}
    apply(): void {
        this.previous = this.model.setInputClauseName(this.index, this.next);
    }
    revert(): void {
        this.model.setInputClauseName(this.index, this.previous);
    }
}

export class SetInputExpressionCommand implements Command {
    readonly label = 'Edit input expression';
    private previous = '';
    constructor(
        private readonly model: DmnTableModel,
        private readonly index: number,
        private readonly next: string,
    ) {}
    apply(): void {
        this.previous = this.model.setInputClauseExpression(this.index, this.next);
    }
    revert(): void {
        this.model.setInputClauseExpression(this.index, this.previous);
    }
}

export class SetInputTypeCommand implements Command {
    readonly label = 'Change input type';
    private previous: DataType = 'string';
    constructor(
        private readonly model: DmnTableModel,
        private readonly index: number,
        private readonly next: DataType,
    ) {}
    apply(): void {
        this.previous = this.model.setInputClauseType(this.index, this.next);
    }
    revert(): void {
        this.model.setInputClauseType(this.index, this.previous);
    }
}

export class SetOutputNameCommand implements Command {
    readonly label = 'Rename output column';
    private previous = '';
    constructor(
        private readonly model: DmnTableModel,
        private readonly index: number,
        private readonly next: string,
    ) {}
    apply(): void {
        this.previous = this.model.setOutputClauseName(this.index, this.next);
    }
    revert(): void {
        this.model.setOutputClauseName(this.index, this.previous);
    }
}

export class SetOutputTypeCommand implements Command {
    readonly label = 'Change output type';
    private previous: DataType = 'string';
    constructor(
        private readonly model: DmnTableModel,
        private readonly index: number,
        private readonly next: DataType,
    ) {}
    apply(): void {
        this.previous = this.model.setOutputClauseType(this.index, this.next);
    }
    revert(): void {
        this.model.setOutputClauseType(this.index, this.previous);
    }
}

export class SetInputEntryCommand implements Command {
    readonly label = 'Edit input entry';
    private previous = '';
    constructor(
        private readonly model: DmnTableModel,
        private readonly ruleIndex: number,
        private readonly columnIndex: number,
        private readonly next: string,
    ) {}
    apply(): void {
        this.previous = this.model.setInputEntry(this.ruleIndex, this.columnIndex, this.next);
    }
    revert(): void {
        this.model.setInputEntry(this.ruleIndex, this.columnIndex, this.previous);
    }
}

export class SetOutputEntryCommand implements Command {
    readonly label = 'Edit output entry';
    private previous = '';
    constructor(
        private readonly model: DmnTableModel,
        private readonly ruleIndex: number,
        private readonly columnIndex: number,
        private readonly next: string,
    ) {}
    apply(): void {
        this.previous = this.model.setOutputEntry(this.ruleIndex, this.columnIndex, this.next);
    }
    revert(): void {
        this.model.setOutputEntry(this.ruleIndex, this.columnIndex, this.previous);
    }
}
