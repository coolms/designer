import type {
    Aggregator,
    DataType,
    DecisionTableModel,
    HitPolicy,
    InputClause,
    OutputClause,
    Rule,
} from './types.js';

/**
 * DMN 1.3 XML round-trip serializer for the {@link DecisionTableModel}.
 *
 * The output target is exactly what the backend `DmnXmlParser`
 * + M3.1.e `DecisionDeployer` consume -- so the Angular wrapper at
 * can `POST writeDmnXml(model)` to `/decision-definitions/
 * {key}/draft.dmn` and the backend round-trips it through evaluate
 * without translation.
 *
 * Namespace policy:
 *  - **Write**: canonical DMN 1.3 namespace
 *    `https://www.omg.org/spec/DMN/20191111/MODEL/`, no prefix
 *    (matches the typical bpmn-io-style export shape minus the
 *    `dmn:` prefix). Wrapping `<definitions>` element carries the
 *    decision body inside.
 *  - **Read**: lenient -- uses `localName` walks rather than
 *    full-qualified-name matching, so bpmn-js-style namespace
 *    prefixes (`dmn:decision`, `omg:decision`, etc.) parse cleanly.
 *
 * Element layout (canonical write):
 *
 *   <definitions name=... namespace=...>
 *     <decision id={model.name} name={model.name}>
 *       <decisionTable id=... hitPolicy=... [aggregation=...]>
 *         <input id=... label={clause.name}>
 *           <inputExpression id=... typeRef={clause.typeRef}>
 *             <text>{clause.expression}</text>
 *           </inputExpression>
 *         </input>
 *         <output id=... name={clause.name} typeRef={clause.typeRef}/>
 *         <rule id=...>
 *           <inputEntry id=...><text>{entry}</text></inputEntry>...
 *           <outputEntry id=...><text>{entry}</text></outputEntry>...
 *         </rule>
 *       </decisionTable>
 *     </decision>
 *   </definitions>
 *
 * Round-trip guarantees:
 *  - `readDmnXml(writeDmnXml(m))` produces a structurally-equal model
 *    (id values are preserved verbatim).
 *  - The single-decision wrapper is the canonical shape; multi-
 *    decision DMN files use the FIRST decision in document order
 *    and ignore the rest at M3.2.g (multi-decision read lands when
 *    DMN DRD ships in M4).
 */

const DMN_NAMESPACE = 'https://www.omg.org/spec/DMN/20191111/MODEL/';

const HIT_POLICY_VALUES: ReadonlySet<HitPolicy> = new Set([
    'UNIQUE',
    'FIRST',
    'PRIORITY',
    'ANY',
    'COLLECT',
]);

const AGGREGATOR_VALUES: ReadonlySet<Aggregator> = new Set(['SUM', 'MIN', 'MAX', 'COUNT']);

const DATA_TYPE_VALUES: ReadonlySet<DataType> = new Set([
    'string',
    'number',
    'boolean',
    'date',
    'dateTime',
]);

/** Thrown when {@link readDmnXml} encounters malformed XML or missing required elements. */
/**
 * Machine-readable reason a DMN body could not be read as a decision
 * TABLE. Consumers need this to tell a RECOVERABLE shape from genuine
 * corruption: a DMN document may legitimately contain a decision with
 * no `<decisionTable>` (a decision node in a requirements diagram that
 * has not been given rules yet). Surfacing that as a hard parse error
 * told authors their definition was broken when it was merely a DRD —
 * so the code lets the UI offer the requirements diagram instead of a
 * red banner.
 */
export type DmnXmlParseErrorCode =
    | 'MALFORMED_XML'
    | 'MISSING_DECISION'
    | 'MISSING_DECISION_TABLE'
    | 'UNKNOWN_HIT_POLICY'
    | 'INVALID_RULE';

export class DmnXmlParseError extends Error {
    readonly code: DmnXmlParseErrorCode;

    constructor(message: string, code: DmnXmlParseErrorCode = 'MALFORMED_XML') {
        super(`[@coolms/designer] DMN XML parse error: ${message}`);
        this.name = 'DmnXmlParseError';
        this.code = code;
    }
}

// ------------------------------------------------------------------
// Write
// ------------------------------------------------------------------

/**
 * Serialise a {@link DecisionTableModel} to DMN 1.3 XML.
 *
 * Output is pretty-printed with 2-space indentation -- not required by
 * the spec but easier to read in the VFS preview + diff cleanly in
 * version control.
 */
export function writeDmnXml(model: DecisionTableModel): string {
    const doc = createDocument();

    const definitions = doc.createElementNS(DMN_NAMESPACE, 'definitions');
    definitions.setAttribute('id', `definitions_${model.name}`);
    definitions.setAttribute('name', model.name);
    definitions.setAttribute('namespace', 'https://coolms/dmn');
    doc.replaceChild(definitions, doc.documentElement);

    const decision = doc.createElementNS(DMN_NAMESPACE, 'decision');
    decision.setAttribute('id', model.name);
    decision.setAttribute('name', model.name);
    definitions.appendChild(decision);

    const decisionTable = doc.createElementNS(DMN_NAMESPACE, 'decisionTable');
    decisionTable.setAttribute('id', `dt_${model.name}`);
    decisionTable.setAttribute('hitPolicy', model.hitPolicy);
    if (model.hitPolicy === 'COLLECT' && model.aggregator !== null) {
        decisionTable.setAttribute('aggregation', model.aggregator);
    }
    decision.appendChild(decisionTable);

    // Inputs
    for (const input of model.inputs) {
        const inputEl = doc.createElementNS(DMN_NAMESPACE, 'input');
        inputEl.setAttribute('id', input.id);
        if (input.name !== '') {
            inputEl.setAttribute('label', input.name);
        }
        const exprEl = doc.createElementNS(DMN_NAMESPACE, 'inputExpression');
        exprEl.setAttribute('id', `${input.id}_expr`);
        exprEl.setAttribute('typeRef', input.typeRef);
        const text = doc.createElementNS(DMN_NAMESPACE, 'text');
        text.appendChild(doc.createTextNode(input.expression));
        exprEl.appendChild(text);
        inputEl.appendChild(exprEl);
        decisionTable.appendChild(inputEl);
    }

    // Outputs
    for (const output of model.outputs) {
        const outputEl = doc.createElementNS(DMN_NAMESPACE, 'output');
        outputEl.setAttribute('id', output.id);
        if (output.name !== '') {
            outputEl.setAttribute('name', output.name);
        }
        outputEl.setAttribute('typeRef', output.typeRef);
        decisionTable.appendChild(outputEl);
    }

    // Rules
    for (const rule of model.rules) {
        const ruleEl = doc.createElementNS(DMN_NAMESPACE, 'rule');
        ruleEl.setAttribute('id', rule.id);

        rule.inputEntries.forEach((entry, idx) => {
            const entryEl = doc.createElementNS(DMN_NAMESPACE, 'inputEntry');
            entryEl.setAttribute('id', `${rule.id}_in_${idx + 1}`);
            const text = doc.createElementNS(DMN_NAMESPACE, 'text');
            text.appendChild(doc.createTextNode(entry));
            entryEl.appendChild(text);
            ruleEl.appendChild(entryEl);
        });

        rule.outputEntries.forEach((entry, idx) => {
            const entryEl = doc.createElementNS(DMN_NAMESPACE, 'outputEntry');
            entryEl.setAttribute('id', `${rule.id}_out_${idx + 1}`);
            const text = doc.createElementNS(DMN_NAMESPACE, 'text');
            text.appendChild(doc.createTextNode(entry));
            entryEl.appendChild(text);
            ruleEl.appendChild(entryEl);
        });

        decisionTable.appendChild(ruleEl);
    }

    return formatXml(doc);
}

// ------------------------------------------------------------------
// Read
// ------------------------------------------------------------------

/**
 * Parse a DMN 1.3 XML string into a {@link DecisionTableModel}.
 *
 * Tolerant of:
 *  - Namespace prefixes (`dmn:`, `omg:`, default-namespace, anything --
 *    we walk by `localName`).
 *  - Whitespace in `<text>` content (leading/trailing trimmed).
 *  - Optional attributes (typeRef defaults to 'string'; missing label
 *    falls back to empty string).
 *  - Multi-decision files (FIRST decision wins at M3.2.g; full DRD
 *    reads land in M4).
 *
 * Throws {@link DmnXmlParseError} on:
 *  - Malformed XML (DOMParser failure).
 *  - Missing `<decision>` / `<decisionTable>` / `<rule>` elements.
 *  - Unrecognized hitPolicy / aggregation values.
 *  - Rule entry count not matching input/output arity.
 */
export function readDmnXml(xml: string): DecisionTableModel {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // DOMParser surfaces malformed XML as a <parsererror> element
    // (browser convention; jsdom preserves this). Detect + throw.
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
        throw new DmnXmlParseError(
            `malformed XML: ${parserError.textContent ?? ''}`.trim(),
            'MALFORMED_XML',
        );
    }

    const decision = findByLocalName(doc.documentElement, 'decision', { recurse: true });
    if (!decision) {
        throw new DmnXmlParseError('missing <decision> element.', 'MISSING_DECISION');
    }
    const name = decision.getAttribute('id') ?? decision.getAttribute('name') ?? '';

    const decisionTable = findByLocalName(decision, 'decisionTable', { recurse: true });
    if (!decisionTable) {
        // NOT corruption: a decision in a requirements diagram may have
        // no rules yet. See {@link DmnXmlParseErrorCode}.
        throw new DmnXmlParseError(
            'missing <decisionTable> element.',
            'MISSING_DECISION_TABLE',
        );
    }

    const hitPolicyRaw = decisionTable.getAttribute('hitPolicy') ?? 'UNIQUE';
    if (!HIT_POLICY_VALUES.has(hitPolicyRaw as HitPolicy)) {
        throw new DmnXmlParseError(
            `unknown hitPolicy "${hitPolicyRaw}". Expected one of: ${[...HIT_POLICY_VALUES].join(', ')}.`,
            'UNKNOWN_HIT_POLICY',
        );
    }
    const hitPolicy = hitPolicyRaw as HitPolicy;

    let aggregator: Aggregator | null = null;
    const aggregationRaw = decisionTable.getAttribute('aggregation');
    if (aggregationRaw !== null && aggregationRaw !== '') {
        if (!AGGREGATOR_VALUES.has(aggregationRaw as Aggregator)) {
            throw new DmnXmlParseError(
                `unknown aggregation "${aggregationRaw}". Expected one of: ${[...AGGREGATOR_VALUES].join(', ')}.`,
            );
        }
        aggregator = aggregationRaw as Aggregator;
    }

    const inputs: InputClause[] = [];
    const inputEls = findAllByLocalName(decisionTable, 'input', { directOnly: true });
    inputEls.forEach((inputEl, idx) => {
        const inputId = inputEl.getAttribute('id') ?? `in_${idx + 1}`;
        const label = inputEl.getAttribute('label') ?? '';
        const exprEl = findByLocalName(inputEl, 'inputExpression', { recurse: true });
        const typeRefRaw = exprEl?.getAttribute('typeRef') ?? 'string';
        const typeRef = DATA_TYPE_VALUES.has(typeRefRaw as DataType)
            ? (typeRefRaw as DataType)
            : 'string';
        const expressionTextEl = exprEl ? findByLocalName(exprEl, 'text', { recurse: true }) : null;
        const expression = (expressionTextEl?.textContent ?? '').trim();
        inputs.push({ id: inputId, name: label, expression, typeRef });
    });

    const outputs: OutputClause[] = [];
    const outputEls = findAllByLocalName(decisionTable, 'output', { directOnly: true });
    outputEls.forEach((outputEl, idx) => {
        const outputId = outputEl.getAttribute('id') ?? `out_${idx + 1}`;
        const outputName = outputEl.getAttribute('name') ?? '';
        const typeRefRaw = outputEl.getAttribute('typeRef') ?? 'string';
        const typeRef = DATA_TYPE_VALUES.has(typeRefRaw as DataType)
            ? (typeRefRaw as DataType)
            : 'string';
        outputs.push({ id: outputId, name: outputName, typeRef });
    });

    const rules: Rule[] = [];
    const ruleEls = findAllByLocalName(decisionTable, 'rule', { directOnly: true });
    ruleEls.forEach((ruleEl, idx) => {
        const ruleId = ruleEl.getAttribute('id') ?? `r_${idx + 1}`;
        const inputEntryEls = findAllByLocalName(ruleEl, 'inputEntry', { directOnly: true });
        const outputEntryEls = findAllByLocalName(ruleEl, 'outputEntry', { directOnly: true });

        if (inputEntryEls.length !== inputs.length) {
            throw new DmnXmlParseError(
                `rule "${ruleId}" has ${inputEntryEls.length} inputEntry elements but the table declares ${inputs.length} inputs.`,
                'INVALID_RULE',
            );
        }
        if (outputEntryEls.length !== outputs.length) {
            throw new DmnXmlParseError(
                `rule "${ruleId}" has ${outputEntryEls.length} outputEntry elements but the table declares ${outputs.length} outputs.`,
                'INVALID_RULE',
            );
        }

        const inputEntries = inputEntryEls.map((el) => {
            const textEl = findByLocalName(el, 'text', { recurse: true });
            return (textEl?.textContent ?? '').trim();
        });
        const outputEntries = outputEntryEls.map((el) => {
            const textEl = findByLocalName(el, 'text', { recurse: true });
            return (textEl?.textContent ?? '').trim();
        });

        rules.push({ id: ruleId, inputEntries, outputEntries });
    });

    return { name, hitPolicy, aggregator, inputs, outputs, rules };
}

// ------------------------------------------------------------------
// Internals
// ------------------------------------------------------------------

function createDocument(): Document {
    return new DOMParser().parseFromString(
        '<?xml version="1.0" encoding="UTF-8"?><placeholder/>',
        'application/xml',
    );
}

/**
 * Find the first descendant (or direct child when `recurse=false`)
 * whose localName matches, regardless of namespace prefix.
 */
function findByLocalName(
    root: Element,
    name: string,
    options: { recurse: boolean },
): Element | null {
    if (options.recurse) {
        const stack: Element[] = [root];
        while (stack.length > 0) {
            const el = stack.pop()!;
            for (const child of Array.from(el.children)) {
                if (child.localName === name) return child;
                stack.push(child);
            }
        }
        return null;
    }
    for (const child of Array.from(root.children)) {
        if (child.localName === name) return child;
    }
    return null;
}

/**
 * Find all matching descendants. `directOnly` restricts to immediate
 * children -- useful when iterating siblings without recursing into
 * nested decision tables (M4 DRD scope).
 */
function findAllByLocalName(
    root: Element,
    name: string,
    options: { directOnly: boolean },
): Element[] {
    const found: Element[] = [];
    if (options.directOnly) {
        for (const child of Array.from(root.children)) {
            if (child.localName === name) found.push(child);
        }
        return found;
    }
    const stack: Element[] = [root];
    while (stack.length > 0) {
        const el = stack.pop()!;
        for (const child of Array.from(el.children)) {
            if (child.localName === name) found.push(child);
            stack.push(child);
        }
    }
    return found;
}

/**
 * Pretty-print the serialized XML with 2-space indentation. The XML
 * declaration is prepended (XMLSerializer omits it).
 */
function formatXml(doc: Document): string {
    const raw = new XMLSerializer().serializeToString(doc);
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
    // XMLSerializer in jsdom emits the document element without a
    // declaration; some browsers include one. Strip + prepend uniformly.
    const body = raw.replace(/^<\?xml[^?]*\?>\s*/, '');
    return `${declaration}\n${prettyPrint(body)}\n`;
}

/**
 * Tiny pretty-printer: indents elements based on nesting depth.
 * Operates on a single-line XML string; assumes no embedded newlines
 * in text content (decision tables don't have multi-line cells).
 */
function prettyPrint(xml: string): string {
    const indent = '  ';
    let depth = 0;
    let out = '';
    let i = 0;
    while (i < xml.length) {
        if (xml[i] === '<') {
            const end = xml.indexOf('>', i);
            if (end === -1) {
                out += xml.slice(i);
                break;
            }
            const tag = xml.slice(i, end + 1);
            const isClosing = tag.startsWith('</');
            const isSelfClosing = tag.endsWith('/>');
            const isComment = tag.startsWith('<!') || tag.startsWith('<?');

            if (isClosing) depth = Math.max(0, depth - 1);
            const needsNewline = out.length > 0 && !out.endsWith('\n');
            if (needsNewline) out += '\n';
            out += indent.repeat(depth) + tag;
            if (!isClosing && !isSelfClosing && !isComment) depth++;

            // Peek text content (non-tag) following this tag.
            let j = end + 1;
            let text = '';
            while (j < xml.length && xml[j] !== '<') {
                text += xml[j];
                j++;
            }
            if (text.trim().length > 0) {
                out += text;
                // The next iteration may be a closing tag; if so, keep
                // it on the same line for compactness (single-text-content
                // element pattern: <text>foo</text>).
                if (xml[j] === '<' && xml[j + 1] === '/') {
                    const closeEnd = xml.indexOf('>', j);
                    out += xml.slice(j, closeEnd + 1);
                    depth = Math.max(0, depth - 1);
                    i = closeEnd + 1;
                    continue;
                }
            }
            i = j;
        } else {
            // Whitespace between tags -- skip.
            i++;
        }
    }
    return out;
}
