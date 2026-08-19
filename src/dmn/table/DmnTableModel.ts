import { Emitter } from '../../internal/Emitter.js';
import type {
    Aggregator,
    DataType,
    DecisionTableModel,
    HitPolicy,
    InputClause,
    OutputClause,
    Rule,
} from './types.js';
import { emptyDecisionTable } from './types.js';

interface ModelEvents extends Record<string, unknown> {
    /** Fired after any mutation. Subscribers re-render against the current snapshot. */
    change: DecisionTableModel;
}

/**
 * In-memory state holder for the DMN decision-table editor.
 *
 * Holds the current {@link DecisionTableModel} + emits change events on
 * mutation. Mutations come from {@link Command} instances on the
 * {@link CommandStack} (each user action wraps a model mutation in a
 * Command for undo/redo). The model itself exposes the low-level
 * mutators; commands implement `apply` + `revert` against them.
 *
 * Immutable snapshots: every mutation produces a fresh model object
 * (shallow-rebuild of the affected sub-tree). Subscribers can rely on
 * referential equality for "did this change since I last looked"
 * comparisons.
 */
export class DmnTableModel {
    private readonly emitter = new Emitter<ModelEvents>();
    private current: DecisionTableModel;
    private idCounter = 0;
    private disposed = false;

    constructor(initial?: DecisionTableModel) {
        this.current = initial ?? emptyDecisionTable();
        // Seed the id counter past any in-use ids so generateId() doesn't collide.
        this.bumpIdCounterFromState();
    }

    /** Current state snapshot. */
    get state(): DecisionTableModel {
        return this.current;
    }

    /** Replace the model state wholesale (load from file). Fires one change event. */
    load(next: DecisionTableModel): void {
        this.assertNotDisposed();
        this.current = next;
        this.bumpIdCounterFromState();
        this.fire();
    }

    /** Subscribe to mutations. Returns unsubscribe thunk. */
    onChange(listener: (state: DecisionTableModel) => void): () => void {
        return this.emitter.on('change', listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.emitter.dispose();
    }

    /** Generate an id with the given prefix that doesn't collide with any current element. */
    generateId(prefix: string): string {
        let id: string;
        do {
            this.idCounter++;
            id = `${prefix}_${this.idCounter}`;
        } while (this.idInUse(id));
        return id;
    }

    // ------------------------------------------------------------------
    // Mutators -- all return the previous state on the mutated branch
    // so commands can capture-and-revert without an extra getState call.
    // ------------------------------------------------------------------

    setName(name: string): string {
        const prev = this.current.name;
        this.current = { ...this.current, name };
        this.fire();
        return prev;
    }

    setHitPolicy(policy: HitPolicy): HitPolicy {
        const prev = this.current.hitPolicy;
        this.current = { ...this.current, hitPolicy: policy };
        this.fire();
        return prev;
    }

    setAggregator(aggregator: Aggregator | null): Aggregator | null {
        const prev = this.current.aggregator;
        this.current = { ...this.current, aggregator };
        this.fire();
        return prev;
    }

    addInputClause(clause: InputClause, atIndex?: number): void {
        const inputs = [...this.current.inputs];
        const idx = atIndex ?? inputs.length;
        inputs.splice(idx, 0, clause);
        // Every rule grows its inputEntries by a blank string at the same index.
        const rules = this.current.rules.map((r) => {
            const entries = [...r.inputEntries];
            entries.splice(idx, 0, '');
            return { ...r, inputEntries: entries };
        });
        this.current = { ...this.current, inputs, rules };
        this.fire();
    }

    removeInputClauseAt(index: number): { clause: InputClause; ruleEntries: string[] } {
        const removedClause = this.current.inputs[index];
        if (!removedClause) {
            throw new Error(`[@coolms/designer] DmnTableModel.removeInputClauseAt: no input at index ${index}.`);
        }
        const inputs = this.current.inputs.filter((_, i) => i !== index);
        const removedEntries: string[] = [];
        const rules = this.current.rules.map((r) => {
            removedEntries.push(r.inputEntries[index] ?? '');
            const entries = r.inputEntries.filter((_, i) => i !== index);
            return { ...r, inputEntries: entries };
        });
        this.current = { ...this.current, inputs, rules };
        this.fire();
        return { clause: removedClause, ruleEntries: removedEntries };
    }

    addOutputClause(clause: OutputClause, atIndex?: number): void {
        const outputs = [...this.current.outputs];
        const idx = atIndex ?? outputs.length;
        outputs.splice(idx, 0, clause);
        const rules = this.current.rules.map((r) => {
            const entries = [...r.outputEntries];
            entries.splice(idx, 0, '');
            return { ...r, outputEntries: entries };
        });
        this.current = { ...this.current, outputs, rules };
        this.fire();
    }

    removeOutputClauseAt(index: number): { clause: OutputClause; ruleEntries: string[] } {
        const removedClause = this.current.outputs[index];
        if (!removedClause) {
            throw new Error(`[@coolms/designer] DmnTableModel.removeOutputClauseAt: no output at index ${index}.`);
        }
        const outputs = this.current.outputs.filter((_, i) => i !== index);
        const removedEntries: string[] = [];
        const rules = this.current.rules.map((r) => {
            removedEntries.push(r.outputEntries[index] ?? '');
            const entries = r.outputEntries.filter((_, i) => i !== index);
            return { ...r, outputEntries: entries };
        });
        this.current = { ...this.current, outputs, rules };
        this.fire();
        return { clause: removedClause, ruleEntries: removedEntries };
    }

    setInputClauseName(index: number, name: string): string {
        const inputs = [...this.current.inputs];
        const existing = inputs[index];
        if (!existing) throw new Error(`No input at index ${index}.`);
        const prev = existing.name;
        inputs[index] = { ...existing, name };
        this.current = { ...this.current, inputs };
        this.fire();
        return prev;
    }

    setInputClauseExpression(index: number, expression: string): string {
        const inputs = [...this.current.inputs];
        const existing = inputs[index];
        if (!existing) throw new Error(`No input at index ${index}.`);
        const prev = existing.expression;
        inputs[index] = { ...existing, expression };
        this.current = { ...this.current, inputs };
        this.fire();
        return prev;
    }

    setInputClauseType(index: number, typeRef: DataType): DataType {
        const inputs = [...this.current.inputs];
        const existing = inputs[index];
        if (!existing) throw new Error(`No input at index ${index}.`);
        const prev = existing.typeRef;
        inputs[index] = { ...existing, typeRef };
        this.current = { ...this.current, inputs };
        this.fire();
        return prev;
    }

    setOutputClauseName(index: number, name: string): string {
        const outputs = [...this.current.outputs];
        const existing = outputs[index];
        if (!existing) throw new Error(`No output at index ${index}.`);
        const prev = existing.name;
        outputs[index] = { ...existing, name };
        this.current = { ...this.current, outputs };
        this.fire();
        return prev;
    }

    setOutputClauseType(index: number, typeRef: DataType): DataType {
        const outputs = [...this.current.outputs];
        const existing = outputs[index];
        if (!existing) throw new Error(`No output at index ${index}.`);
        const prev = existing.typeRef;
        outputs[index] = { ...existing, typeRef };
        this.current = { ...this.current, outputs };
        this.fire();
        return prev;
    }

    addRule(rule: Rule, atIndex?: number): void {
        const rules = [...this.current.rules];
        const idx = atIndex ?? rules.length;
        rules.splice(idx, 0, rule);
        this.current = { ...this.current, rules };
        this.fire();
    }

    removeRuleAt(index: number): Rule {
        const removed = this.current.rules[index];
        if (!removed) throw new Error(`No rule at index ${index}.`);
        const rules = this.current.rules.filter((_, i) => i !== index);
        this.current = { ...this.current, rules };
        this.fire();
        return removed;
    }

    setInputEntry(ruleIndex: number, columnIndex: number, value: string): string {
        const rules = [...this.current.rules];
        const rule = rules[ruleIndex];
        if (!rule) throw new Error(`No rule at index ${ruleIndex}.`);
        const entries = [...rule.inputEntries];
        const prev = entries[columnIndex] ?? '';
        entries[columnIndex] = value;
        rules[ruleIndex] = { ...rule, inputEntries: entries };
        this.current = { ...this.current, rules };
        this.fire();
        return prev;
    }

    setOutputEntry(ruleIndex: number, columnIndex: number, value: string): string {
        const rules = [...this.current.rules];
        const rule = rules[ruleIndex];
        if (!rule) throw new Error(`No rule at index ${ruleIndex}.`);
        const entries = [...rule.outputEntries];
        const prev = entries[columnIndex] ?? '';
        entries[columnIndex] = value;
        rules[ruleIndex] = { ...rule, outputEntries: entries };
        this.current = { ...this.current, rules };
        this.fire();
        return prev;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('[@coolms/designer] DmnTableModel has been disposed.');
        }
    }

    private fire(): void {
        this.emitter.emit('change', this.current);
    }

    private idInUse(id: string): boolean {
        const m = this.current;
        return (
            m.inputs.some((c) => c.id === id) ||
            m.outputs.some((c) => c.id === id) ||
            m.rules.some((r) => r.id === id)
        );
    }

    private bumpIdCounterFromState(): void {
        // Pick the largest trailing number across all current ids so our
        // generator never collides without an O(n) check per generation.
        const ids = [
            ...this.current.inputs.map((c) => c.id),
            ...this.current.outputs.map((c) => c.id),
            ...this.current.rules.map((r) => r.id),
        ];
        let max = 0;
        for (const id of ids) {
            const match = /_(\d+)$/.exec(id);
            if (match?.[1] !== undefined) {
                const n = Number.parseInt(match[1], 10);
                if (Number.isFinite(n) && n > max) max = n;
            }
        }
        this.idCounter = max;
    }
}
