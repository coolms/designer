/**
 * Types for the DMN decision-table editor. Mirrors the M3.1
 * backend AST shape (DecisionTableAst, RuleAst, InputClauseAst,
 * OutputClauseAst) so the XML serializer can round-trip cleanly
 * with no impedance mismatch between FE state and BE parse.
 *
 * Not part of the public package API; consumed by `DmnTableModel` +
 * `DmnTableView` + the eventual serializer.
 */

/**
 * DMN hit policies -- match the strategies (UNIQUE / FIRST /
 * PRIORITY / ANY / COLLECT). PRIORITY at M3.2.f degrades to FIRST per
 * the backend's M3.1.f-level scope; the full priority-list editor
 * lands in M3.2 polish if a tenant needs it.
 */
export type HitPolicy = 'UNIQUE' | 'FIRST' | 'PRIORITY' | 'ANY' | 'COLLECT';

/**
 * COLLECT aggregator -- only meaningful when hit policy is COLLECT.
 * The model carries it as a regular field; the view hides the
 * aggregator dropdown when policy isn't COLLECT.
 */
export type Aggregator = 'SUM' | 'MIN' | 'MAX' | 'COUNT';

/**
 * DMN 1.3 typeRef values. M3.2.f uses 'string' for every clause
 * (typeRef editor is deferred); the field is carried in the model
 * for round-trip stability with the XML serializer.
 */
export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'dateTime';

/**
 * One input column. `id` is owner-assigned + stable across mutations;
 * `name` is the column header (human-readable label, e.g. "amount");
 * `expression` is the EL string the engine evaluates per rule against
 * the input scope (e.g. "variables.orderTotal").
 */
export interface InputClause {
    readonly id: string;
    readonly name: string;
    readonly expression: string;
    readonly typeRef: DataType;
}

/**
 * One output column. `name` is the key under which the rule's output
 * value lands in the {@link EvaluationResult.value} map for multi-
 * output tables; for single-output tables the value is the result
 * directly.
 */
export interface OutputClause {
    readonly id: string;
    readonly name: string;
    readonly typeRef: DataType;
}

/**
 * One rule. `inputEntries` aligned positionally with the table's
 * `inputs`, `outputEntries` aligned with `outputs`. Entries are
 * verbatim strings -- input entries are unary tests (`> 100`,
 * `[1..10]`, `'high'`, `-`), output entries are EL expressions
 * (`'discount-eligible'`, `variables.tier * 0.1`).
 *
 * Empty entry string is a wildcard for inputs (matches anything),
 * `null`/missing for outputs (the output isn't set, evaluator emits
 * undefined for that key).
 */
export interface Rule {
    readonly id: string;
    readonly inputEntries: ReadonlyArray<string>;
    readonly outputEntries: ReadonlyArray<string>;
}

/** The decision table model -- the full editable surface state. */
export interface DecisionTableModel {
    /** definitionKey -- matches the deployed DecisionDefinition.definitionKey. */
    readonly name: string;
    readonly hitPolicy: HitPolicy;
    /** Only meaningful when hitPolicy === 'COLLECT'. Carries through even when ignored. */
    readonly aggregator: Aggregator | null;
    readonly inputs: ReadonlyArray<InputClause>;
    readonly outputs: ReadonlyArray<OutputClause>;
    readonly rules: ReadonlyArray<Rule>;
}

/** Minimal default starting model -- 1 input, 1 output, 1 empty rule. */
export function emptyDecisionTable(name = 'decision.unnamed'): DecisionTableModel {
    return {
        name,
        hitPolicy: 'UNIQUE',
        aggregator: null,
        inputs: [{ id: 'in_1', name: 'input1', expression: '', typeRef: 'string' }],
        outputs: [{ id: 'out_1', name: 'output1', typeRef: 'string' }],
        rules: [{ id: 'r_1', inputEntries: [''], outputEntries: [''] }],
    };
}
