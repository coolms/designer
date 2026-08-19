import { describe, expect, it, vi } from 'vitest';
import { DmnTableModel } from '../../../../src/dmn/table/DmnTableModel.js';
import type { DecisionTableModel } from '../../../../src/dmn/table/types.js';
import { emptyDecisionTable } from '../../../../src/dmn/table/types.js';

describe('DmnTableModel', () => {
    it('defaults to a 1-input/1-output/1-rule empty table', () => {
        const m = new DmnTableModel();
        expect(m.state.name).toBe('decision.unnamed');
        expect(m.state.hitPolicy).toBe('UNIQUE');
        expect(m.state.aggregator).toBeNull();
        expect(m.state.inputs).toHaveLength(1);
        expect(m.state.outputs).toHaveLength(1);
        expect(m.state.rules).toHaveLength(1);
    });

    it('accepts an initial model', () => {
        const initial = emptyDecisionTable('pricing.discount');
        const m = new DmnTableModel(initial);
        expect(m.state.name).toBe('pricing.discount');
    });

    it('load() replaces state + fires change', () => {
        const m = new DmnTableModel();
        const onChange = vi.fn();
        m.onChange(onChange);

        const next: DecisionTableModel = {
            name: 'risk.score',
            hitPolicy: 'COLLECT',
            aggregator: 'SUM',
            inputs: [{ id: 'in_99', name: 'age', expression: 'variables.age', typeRef: 'number' }],
            outputs: [{ id: 'out_99', name: 'score', typeRef: 'number' }],
            rules: [{ id: 'r_99', inputEntries: ['> 18'], outputEntries: ['10'] }],
        };
        m.load(next);

        expect(m.state).toBe(next);
        expect(onChange).toHaveBeenCalledOnce();
    });

    describe('mutators', () => {
        it('setName returns previous value', () => {
            const m = new DmnTableModel();
            const prev = m.setName('new');
            expect(prev).toBe('decision.unnamed');
            expect(m.state.name).toBe('new');
        });

        it('setHitPolicy returns previous value', () => {
            const m = new DmnTableModel();
            const prev = m.setHitPolicy('COLLECT');
            expect(prev).toBe('UNIQUE');
            expect(m.state.hitPolicy).toBe('COLLECT');
        });

        it('addInputClause adds + grows every rule by an empty entry', () => {
            const m = new DmnTableModel();
            m.addInputClause({ id: 'in_x', name: 'amount', expression: 'v.amount', typeRef: 'number' });
            expect(m.state.inputs).toHaveLength(2);
            expect(m.state.rules[0]?.inputEntries).toEqual(['', '']);
        });

        it('addInputClause at specific index inserts in the middle', () => {
            const m = new DmnTableModel();
            m.addInputClause({ id: 'in_a', name: 'a', expression: '', typeRef: 'string' }, 0);
            m.addInputClause({ id: 'in_b', name: 'b', expression: '', typeRef: 'string' }, 0);
            expect(m.state.inputs.map((c) => c.id)).toEqual(['in_b', 'in_a', 'in_1']);
            expect(m.state.rules[0]?.inputEntries).toHaveLength(3);
        });

        it('removeInputClauseAt removes column + shrinks every rule', () => {
            const m = new DmnTableModel();
            m.addInputClause({ id: 'in_x', name: 'amount', expression: '', typeRef: 'string' });
            // Rule now has 2 input entries; set one so cascade carries content.
            m.setInputEntry(0, 1, '> 100');

            const { clause, ruleEntries } = m.removeInputClauseAt(1);

            expect(clause.id).toBe('in_x');
            expect(ruleEntries).toEqual(['> 100']);
            expect(m.state.inputs).toHaveLength(1);
            expect(m.state.rules[0]?.inputEntries).toHaveLength(1);
        });

        it('removeInputClauseAt throws on out-of-range index', () => {
            const m = new DmnTableModel();
            expect(() => m.removeInputClauseAt(5)).toThrow(/no input at index/);
        });

        it('addRule adds with correct entry arity', () => {
            const m = new DmnTableModel();
            m.addInputClause({ id: 'in_x', name: 'amount', expression: '', typeRef: 'string' });
            m.addOutputClause({ id: 'out_x', name: 'score', typeRef: 'string' });
            m.addRule({ id: 'r_x', inputEntries: ['a', 'b'], outputEntries: ['c', 'd'] });

            const rule = m.state.rules[m.state.rules.length - 1]!;
            expect(rule.inputEntries).toEqual(['a', 'b']);
            expect(rule.outputEntries).toEqual(['c', 'd']);
        });

        it('removeRuleAt removes + returns the rule', () => {
            const m = new DmnTableModel();
            m.addRule({ id: 'r_x', inputEntries: [''], outputEntries: [''] });
            expect(m.state.rules).toHaveLength(2);
            const removed = m.removeRuleAt(1);
            expect(removed.id).toBe('r_x');
            expect(m.state.rules).toHaveLength(1);
        });

        it('setInputEntry returns the previous value', () => {
            const m = new DmnTableModel();
            const prev = m.setInputEntry(0, 0, '> 100');
            expect(prev).toBe('');
            expect(m.state.rules[0]?.inputEntries[0]).toBe('> 100');
        });

        it('setOutputEntry returns the previous value', () => {
            const m = new DmnTableModel();
            const prev = m.setOutputEntry(0, 0, "'high'");
            expect(prev).toBe('');
            expect(m.state.rules[0]?.outputEntries[0]).toBe("'high'");
        });

        it('setInputClauseName returns previous', () => {
            const m = new DmnTableModel();
            const prev = m.setInputClauseName(0, 'amount');
            expect(prev).toBe('input1');
            expect(m.state.inputs[0]?.name).toBe('amount');
        });

        it('setInputClauseExpression returns previous', () => {
            const m = new DmnTableModel();
            const prev = m.setInputClauseExpression(0, 'variables.amount');
            expect(prev).toBe('');
            expect(m.state.inputs[0]?.expression).toBe('variables.amount');
        });
    });

    describe('generateId', () => {
        it('skips ids already in use', () => {
            const m = new DmnTableModel();
            // empty starter uses in_1, out_1, r_1 -> idCounter=1
            expect(m.generateId('r')).toBe('r_2');
            expect(m.generateId('r')).toBe('r_3');
        });

        it('seeds counter from loaded state to avoid collisions', () => {
            const m = new DmnTableModel({
                name: 'x',
                hitPolicy: 'UNIQUE',
                aggregator: null,
                inputs: [{ id: 'in_42', name: 'a', expression: '', typeRef: 'string' }],
                outputs: [{ id: 'out_5', name: 'b', typeRef: 'string' }],
                rules: [{ id: 'r_3', inputEntries: [''], outputEntries: [''] }],
            });
            // Highest trailing number is 42; next generateId('r') must be r_43.
            expect(m.generateId('r')).toBe('r_43');
        });
    });

    it('immutability: every mutation produces a new top-level object', () => {
        const m = new DmnTableModel();
        const before = m.state;
        m.setName('new');
        const after = m.state;
        expect(after).not.toBe(before);
    });

    it('dispose drops listeners + throws on subsequent load', () => {
        const m = new DmnTableModel();
        const onChange = vi.fn();
        m.onChange(onChange);
        m.dispose();
        expect(() => m.load(emptyDecisionTable())).toThrow(/disposed/);
        expect(onChange).not.toHaveBeenCalled();
    });
});
