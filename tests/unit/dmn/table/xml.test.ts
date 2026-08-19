import { describe, expect, it } from 'vitest';
import {
    DmnXmlParseError,
    readDmnXml,
    writeDmnXml,
} from '../../../../src/dmn/table/xml.js';
import type { DecisionTableModel } from '../../../../src/dmn/table/types.js';

const SIMPLE_MODEL: DecisionTableModel = {
    name: 'pricing.discount',
    hitPolicy: 'UNIQUE',
    aggregator: null,
    inputs: [
        { id: 'in_1', name: 'amount', expression: 'variables.amount', typeRef: 'number' },
    ],
    outputs: [{ id: 'out_1', name: 'discount', typeRef: 'number' }],
    rules: [
        { id: 'r_1', inputEntries: ['> 100'], outputEntries: ['0.1'] },
        { id: 'r_2', inputEntries: ['<= 100'], outputEntries: ['0'] },
    ],
};

describe('DMN XML serializer', () => {
    // ------------------------------------------------------------------
    // Write
    // ------------------------------------------------------------------

    describe('writeDmnXml', () => {
        it('produces a parseable XML string with the canonical DMN namespace', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            expect(xml).toContain('<?xml');
            expect(xml).toContain('xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"');
            expect(xml).toContain('<definitions');
            expect(xml).toContain('<decision');
            expect(xml).toContain('<decisionTable');
        });

        it('emits decision id + name from model.name', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            expect(xml).toMatch(/<decision[^>]*id="pricing\.discount"/);
            expect(xml).toMatch(/<decision[^>]*name="pricing\.discount"/);
        });

        it('emits hitPolicy attribute', () => {
            expect(writeDmnXml({ ...SIMPLE_MODEL, hitPolicy: 'FIRST' })).toMatch(
                /<decisionTable[^>]*hitPolicy="FIRST"/,
            );
        });

        it('emits aggregation attribute only for COLLECT with aggregator set', () => {
            const collectWith: DecisionTableModel = {
                ...SIMPLE_MODEL,
                hitPolicy: 'COLLECT',
                aggregator: 'SUM',
            };
            expect(writeDmnXml(collectWith)).toMatch(
                /<decisionTable[^>]*aggregation="SUM"/,
            );

            const collectWithout: DecisionTableModel = {
                ...SIMPLE_MODEL,
                hitPolicy: 'COLLECT',
                aggregator: null,
            };
            expect(writeDmnXml(collectWithout)).not.toContain('aggregation=');

            // Non-COLLECT policy never emits aggregation, even if aggregator is set in model.
            const aggregatorIgnored: DecisionTableModel = {
                ...SIMPLE_MODEL,
                hitPolicy: 'UNIQUE',
                aggregator: 'SUM',
            };
            expect(writeDmnXml(aggregatorIgnored)).not.toContain('aggregation=');
        });

        it('writes input clauses with label + inputExpression + typeRef + text', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            expect(xml).toContain('label="amount"');
            expect(xml).toContain('<inputExpression');
            expect(xml).toContain('typeRef="number"');
            expect(xml).toContain('<text>variables.amount</text>');
        });

        it('writes output clauses with name + typeRef', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            expect(xml).toMatch(/<output[^>]*name="discount"/);
            expect(xml).toMatch(/<output[^>]*typeRef="number"/);
        });

        it('writes rule entries in document order', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            const r1Index = xml.indexOf('id="r_1"');
            const r2Index = xml.indexOf('id="r_2"');
            expect(r1Index).toBeGreaterThan(-1);
            expect(r2Index).toBeGreaterThan(r1Index);
        });

        it('XML-escapes special characters in entry text', () => {
            const model: DecisionTableModel = {
                ...SIMPLE_MODEL,
                rules: [
                    {
                        id: 'r_1',
                        inputEntries: ['a < b & "c"'],
                        outputEntries: ["'>x<'"],
                    },
                ],
            };
            const xml = writeDmnXml(model);
            // The actual raw string should not appear verbatim -- < should be escaped.
            expect(xml).toContain('a &lt; b &amp; "c"');
            expect(xml).toContain('&gt;x&lt;');
        });

        it('omits label attribute when input.name is empty', () => {
            const model: DecisionTableModel = {
                ...SIMPLE_MODEL,
                inputs: [{ id: 'in_1', name: '', expression: '1', typeRef: 'string' }],
                rules: [{ id: 'r_1', inputEntries: ['-'], outputEntries: ['x'] }],
            };
            const xml = writeDmnXml(model);
            expect(xml).not.toContain('label=');
        });

        it('handles 0-rule tables (deploys empty)', () => {
            const empty: DecisionTableModel = { ...SIMPLE_MODEL, rules: [] };
            const xml = writeDmnXml(empty);
            expect(xml).not.toContain('<rule');
        });
    });

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    describe('readDmnXml', () => {
        it('parses a canonical DMN 1.3 body', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            const parsed = readDmnXml(xml);
            expect(parsed.name).toBe('pricing.discount');
            expect(parsed.hitPolicy).toBe('UNIQUE');
            expect(parsed.aggregator).toBeNull();
            expect(parsed.inputs).toHaveLength(1);
            expect(parsed.outputs).toHaveLength(1);
            expect(parsed.rules).toHaveLength(2);
        });

        it('tolerates namespace prefixes (dmn:, omg:, etc.)', () => {
            const prefixed = `<?xml version="1.0" encoding="UTF-8"?>
<dmn:definitions xmlns:dmn="https://www.omg.org/spec/DMN/20191111/MODEL/" name="x">
  <dmn:decision id="risk.score" name="risk.score">
    <dmn:decisionTable id="dt" hitPolicy="FIRST">
      <dmn:input id="in_1" label="age">
        <dmn:inputExpression id="in_1_expr" typeRef="number"><dmn:text>v.age</dmn:text></dmn:inputExpression>
      </dmn:input>
      <dmn:output id="out_1" name="tier" typeRef="string"/>
      <dmn:rule id="r_1">
        <dmn:inputEntry id="r_1_in_1"><dmn:text>&gt;= 18</dmn:text></dmn:inputEntry>
        <dmn:outputEntry id="r_1_out_1"><dmn:text>'adult'</dmn:text></dmn:outputEntry>
      </dmn:rule>
    </dmn:decisionTable>
  </dmn:decision>
</dmn:definitions>`;
            const parsed = readDmnXml(prefixed);
            expect(parsed.name).toBe('risk.score');
            expect(parsed.hitPolicy).toBe('FIRST');
            expect(parsed.inputs[0]?.name).toBe('age');
            expect(parsed.inputs[0]?.expression).toBe('v.age');
            expect(parsed.rules[0]?.inputEntries[0]).toBe('>= 18');
            expect(parsed.rules[0]?.outputEntries[0]).toBe("'adult'");
        });

        it('reads aggregation attribute on COLLECT tables', () => {
            const collectModel: DecisionTableModel = {
                ...SIMPLE_MODEL,
                hitPolicy: 'COLLECT',
                aggregator: 'MAX',
            };
            const xml = writeDmnXml(collectModel);
            const parsed = readDmnXml(xml);
            expect(parsed.hitPolicy).toBe('COLLECT');
            expect(parsed.aggregator).toBe('MAX');
        });

        it('defaults typeRef to "string" when missing', () => {
            const noTypeRef = `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" name="x">
  <decision id="x" name="x">
    <decisionTable id="dt" hitPolicy="UNIQUE">
      <input id="in_1"><inputExpression id="ie"><text>v.x</text></inputExpression></input>
      <output id="out_1" name="result"/>
      <rule id="r_1"><inputEntry><text>-</text></inputEntry><outputEntry><text>'ok'</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;
            const parsed = readDmnXml(noTypeRef);
            expect(parsed.inputs[0]?.typeRef).toBe('string');
            expect(parsed.outputs[0]?.typeRef).toBe('string');
        });

        it('throws DmnXmlParseError on malformed XML', () => {
            expect(() => readDmnXml('<not-closed')).toThrow(DmnXmlParseError);
        });

        it('throws when <decision> is missing', () => {
            const missing = '<?xml version="1.0"?><definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"/>';
            expect(() => readDmnXml(missing)).toThrow(/missing <decision>/);
        });

        it('throws when <decisionTable> is missing', () => {
            const missing = `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
  <decision id="x" name="x"/>
</definitions>`;
            expect(() => readDmnXml(missing)).toThrow(/missing <decisionTable>/);
        });

        /**
         * The UI must distinguish a RECOVERABLE shape (a decision in a
         * requirements diagram that has no rules yet) from genuine
         * corruption, and it must do so WITHOUT string-matching the
         * message — the wording is a UI detail. Before this code
         * existed, a DRD opened in the table surface showed a red
         * "parse error" banner and the author had no way forward.
         */
        it('tags each failure with a machine-readable code', () => {
            const cases: Array<[string, string]> = [
                ['<not-closed', 'MALFORMED_XML'],
                [
                    '<?xml version="1.0"?><definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"/>',
                    'MISSING_DECISION',
                ],
                [
                    `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
  <decision id="x" name="x"/>
</definitions>`,
                    'MISSING_DECISION_TABLE',
                ],
            ];

            for (const [xml, expected] of cases) {
                let caught: unknown;
                try {
                    readDmnXml(xml);
                } catch (e) {
                    caught = e;
                }
                expect(caught).toBeInstanceOf(DmnXmlParseError);
                expect((caught as DmnXmlParseError).code).toBe(expected);
            }
        });

        it('throws on unknown hitPolicy', () => {
            const bad = `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
  <decision id="x" name="x">
    <decisionTable id="dt" hitPolicy="NONSENSE">
      <input id="in_1"><inputExpression id="ie"><text>x</text></inputExpression></input>
      <output id="out_1" name="o"/>
    </decisionTable>
  </decision>
</definitions>`;
            expect(() => readDmnXml(bad)).toThrow(/unknown hitPolicy/);
        });

        it('throws on unknown aggregation', () => {
            const bad = `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
  <decision id="x" name="x">
    <decisionTable id="dt" hitPolicy="COLLECT" aggregation="NONSENSE">
      <input id="in_1"><inputExpression id="ie"><text>x</text></inputExpression></input>
      <output id="out_1" name="o"/>
    </decisionTable>
  </decision>
</definitions>`;
            expect(() => readDmnXml(bad)).toThrow(/unknown aggregation/);
        });

        it('throws when rule entry arity mismatches table arity', () => {
            const bad = `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
  <decision id="x" name="x">
    <decisionTable id="dt" hitPolicy="UNIQUE">
      <input id="in_1"><inputExpression id="ie"><text>x</text></inputExpression></input>
      <input id="in_2"><inputExpression id="ie2"><text>y</text></inputExpression></input>
      <output id="out_1" name="o"/>
      <rule id="r_1">
        <inputEntry id="e1"><text>a</text></inputEntry>
        <outputEntry id="o1"><text>x</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>`;
            expect(() => readDmnXml(bad)).toThrow(/1 inputEntry elements but the table declares 2 inputs/);
        });
    });

    // ------------------------------------------------------------------
    // Round-trip
    // ------------------------------------------------------------------

    describe('round-trip equivalence', () => {
        it('preserves the simple model identically', () => {
            const xml = writeDmnXml(SIMPLE_MODEL);
            const back = readDmnXml(xml);
            expect(back).toEqual(SIMPLE_MODEL);
        });

        it('preserves a multi-input/multi-output table', () => {
            const complex: DecisionTableModel = {
                name: 'risk.score',
                hitPolicy: 'PRIORITY',
                aggregator: null,
                inputs: [
                    { id: 'in_1', name: 'age', expression: 'v.age', typeRef: 'number' },
                    { id: 'in_2', name: 'income', expression: 'v.income', typeRef: 'number' },
                ],
                outputs: [
                    { id: 'out_1', name: 'tier', typeRef: 'string' },
                    { id: 'out_2', name: 'limit', typeRef: 'number' },
                ],
                rules: [
                    {
                        id: 'r_1',
                        inputEntries: ['>= 65', '> 50000'],
                        outputEntries: ["'gold'", '10000'],
                    },
                    {
                        id: 'r_2',
                        inputEntries: ['>= 18', '> 30000'],
                        outputEntries: ["'silver'", '5000'],
                    },
                    {
                        id: 'r_3',
                        inputEntries: ['-', '-'],
                        outputEntries: ["'bronze'", '1000'],
                    },
                ],
            };
            const xml = writeDmnXml(complex);
            expect(readDmnXml(xml)).toEqual(complex);
        });

        it('preserves COLLECT + aggregator', () => {
            const m: DecisionTableModel = {
                ...SIMPLE_MODEL,
                hitPolicy: 'COLLECT',
                aggregator: 'SUM',
            };
            expect(readDmnXml(writeDmnXml(m))).toEqual(m);
        });

        it('preserves special characters via XML escaping', () => {
            const m: DecisionTableModel = {
                ...SIMPLE_MODEL,
                rules: [
                    {
                        id: 'r_1',
                        inputEntries: ['a < b & "c" \'d\''],
                        outputEntries: ['<<>>&amp;'],
                    },
                    {
                        id: 'r_2',
                        inputEntries: ['-'],
                        outputEntries: [''],
                    },
                ],
            };
            const back = readDmnXml(writeDmnXml(m));
            expect(back.rules[0]?.inputEntries[0]).toBe('a < b & "c" \'d\'');
            expect(back.rules[0]?.outputEntries[0]).toBe('<<>>&amp;');
            expect(back.rules[1]?.outputEntries[0]).toBe('');
        });

        it('preserves ids verbatim across round-trip', () => {
            const m: DecisionTableModel = {
                ...SIMPLE_MODEL,
                inputs: [{ id: 'custom_input_id', name: 'x', expression: 'v.x', typeRef: 'string' }],
                outputs: [{ id: 'custom_output_id', name: 'y', typeRef: 'string' }],
                rules: [
                    {
                        id: 'custom_rule_id',
                        inputEntries: ['"a"'],
                        outputEntries: ['"b"'],
                    },
                ],
            };
            const back = readDmnXml(writeDmnXml(m));
            expect(back.inputs[0]?.id).toBe('custom_input_id');
            expect(back.outputs[0]?.id).toBe('custom_output_id');
            expect(back.rules[0]?.id).toBe('custom_rule_id');
        });
    });
});
