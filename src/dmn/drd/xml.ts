import { defaultSizeForKind } from './types.js';
import type {
    DmnDrdElement,
    DmnDrdElementKind,
    DmnDrdModel,
    DmnInformationRequirement,
} from './types.js';

/**
 * DMN 1.3 DRD XML round-trip serializer for the
 * {@link DmnDrdModel}.
 *
 * Parallels the state-machine config serializer + the
 * decision-table {@link writeDmnXml} — but for the *graph* (Decision +
 * InputData nodes joined by InformationRequirement edges) rather than a
 * single table body.
 *
 * **The target shape (canonical write):**
 *
 *   <definitions id="definitions_{name}" name="{name}" namespace=...>
 *     <inputData id="age" name="Applicant age"/>
 *     <decision id="eligible" name="Eligibility" logicRef="pricing.eligibility">
 *       <informationRequirement id="ir1">
 *         <requiredInput href="#age"/>          <!-- source is InputData -->
 *       </informationRequirement>
 *     </decision>
 *     <dmndi:DMNDI>
 *       <dmndi:DMNDiagram id="DMNDiagram_1">
 *         <dmndi:DMNShape id="DMNShape_age" dmnElementRef="age">
 *           <dc:Bounds x="40" y="40" width="144" height="52"/>
 *         </dmndi:DMNShape>
 *         ...
 *       </dmndi:DMNDiagram>
 *     </dmndi:DMNDI>
 *   </definitions>
 *
 * **DMN semantics encoded here:**
 *  - An `<informationRequirement>` lives INSIDE the requiring `<decision>`
 *    (the edge's `to`); its child is `<requiredInput href="#src"/>` when
 *    the source is an InputData, `<requiredDecision href="#src"/>` when
 *    the source is a Decision. So `{from, to}` ⇒ an IR nested under the
 *    `to` decision pointing at `#from`.
 *  - Node positions + sizes round-trip via the standard **DMNDI** diagram
 *    interchange (`<DMNShape>`/`<dc:Bounds>`). Edge waypoints are NOT
 *    emitted — the editor recomputes them from node geometry.
 *  - `decisionLogicRef` (the CoolMS link from a Decision to its
 *    decision-table key) rides as a plain `logicRef` attribute — a vendor
 *    extension standard DMN parsers ignore, lossless on our round-trip.
 *
 * **Read is lenient** (mirrors {@link readDmnXml}): walks by `localName`
 * so any namespace prefix (`dmn:`, `omg:`, default) parses; node geometry
 * absent ⇒ the element lands at the origin with a default size and the
 * editor auto-lays-it-out on load.
 *
 * **Round-trip guarantee:** `readDrdXml(writeDrdXml(m))` yields a model
 * structurally equal to `m` (ids, names, kinds, positions, sizes,
 * requirements, decisionLogicRef preserved). Requirements that don't
 * target an existing decision (dangling / self / to-an-input) are dropped
 * — they aren't valid DMN.
 */

const MODEL_NS = 'https://www.omg.org/spec/DMN/20191111/MODEL/';
const DMNDI_NS = 'https://www.omg.org/spec/DMN/20191111/DMNDI/';
const DC_NS = 'http://www.omg.org/spec/DMN/20180521/DC/';
const COOLMS_NS = 'https://coolms/dmn';

/** Thrown when {@link readDrdXml} encounters malformed XML. */
export class DmnDrdXmlParseError extends Error {
    constructor(message: string) {
        super(`[@coolms/designer] DMN DRD XML parse error: ${message}`);
        this.name = 'DmnDrdXmlParseError';
    }
}

// ------------------------------------------------------------------
// Write
// ------------------------------------------------------------------

/** Serialise a {@link DmnDrdModel} to DMN 1.3 DRD XML (pretty-printed). */
export function writeDrdXml(model: DmnDrdModel): string {
    const doc = createDocument();

    const definitions = doc.createElementNS(MODEL_NS, 'definitions');
    definitions.setAttribute('id', `definitions_${model.name}`);
    definitions.setAttribute('name', model.name);
    definitions.setAttribute('namespace', COOLMS_NS);
    doc.replaceChild(definitions, doc.documentElement);

    const byId = new Map(model.elements.map((e) => [e.id, e]));
    const reqsByTo = new Map<string, DmnInformationRequirement[]>();
    for (const r of model.requirements) {
        const list = reqsByTo.get(r.to) ?? [];
        list.push(r);
        reqsByTo.set(r.to, list);
    }

    for (const el of model.elements) {
        if (el.kind === 'inputData') {
            const inputEl = doc.createElementNS(MODEL_NS, 'inputData');
            inputEl.setAttribute('id', el.id);
            if (el.name !== '') inputEl.setAttribute('name', el.name);
            definitions.appendChild(inputEl);
            continue;
        }

        const decEl = doc.createElementNS(MODEL_NS, 'decision');
        decEl.setAttribute('id', el.id);
        if (el.name !== '') decEl.setAttribute('name', el.name);
        if (el.decisionLogicRef !== undefined && el.decisionLogicRef !== '') {
            decEl.setAttribute('logicRef', el.decisionLogicRef);
        }

        for (const r of reqsByTo.get(el.id) ?? []) {
            const source = byId.get(r.from);
            if (source === undefined || r.from === r.to) continue; // dangling / self
            const irEl = doc.createElementNS(MODEL_NS, 'informationRequirement');
            irEl.setAttribute('id', r.id);
            const refTag = source.kind === 'inputData' ? 'requiredInput' : 'requiredDecision';
            const refEl = doc.createElementNS(MODEL_NS, refTag);
            refEl.setAttribute('href', `#${r.from}`);
            irEl.appendChild(refEl);
            decEl.appendChild(irEl);
        }
        definitions.appendChild(decEl);
    }

    appendDmndi(doc, definitions, model);

    return formatXml(doc);
}

/** Append the DMNDI diagram-interchange block carrying every node's bounds. */
function appendDmndi(doc: Document, definitions: Element, model: DmnDrdModel): void {
    const dmndi = doc.createElementNS(DMNDI_NS, 'dmndi:DMNDI');
    const diagram = doc.createElementNS(DMNDI_NS, 'dmndi:DMNDiagram');
    diagram.setAttribute('id', 'DMNDiagram_1');
    dmndi.appendChild(diagram);

    for (const el of model.elements) {
        const shape = doc.createElementNS(DMNDI_NS, 'dmndi:DMNShape');
        shape.setAttribute('id', `DMNShape_${el.id}`);
        shape.setAttribute('dmnElementRef', el.id);
        const bounds = doc.createElementNS(DC_NS, 'dc:Bounds');
        bounds.setAttribute('x', String(el.position.x));
        bounds.setAttribute('y', String(el.position.y));
        bounds.setAttribute('width', String(el.size.width));
        bounds.setAttribute('height', String(el.size.height));
        shape.appendChild(bounds);
        diagram.appendChild(shape);
    }

    definitions.appendChild(dmndi);
}

// ------------------------------------------------------------------
// Read
// ------------------------------------------------------------------

interface ParsedBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Parse a DMN 1.3 DRD XML string into a {@link DmnDrdModel}. */
export function readDrdXml(xml: string): DmnDrdModel {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const parserError = doc.querySelector('parsererror');
    if (parserError) {
        throw new DmnDrdXmlParseError(`malformed XML: ${parserError.textContent ?? ''}`.trim());
    }

    const root = doc.documentElement;
    const name = root.getAttribute('name') ?? root.getAttribute('id') ?? 'decision.unnamed';

    // DMNDI geometry — keyed by dmnElementRef so nodes pick up their bounds.
    const boundsByRef = new Map<string, ParsedBounds>();
    for (const shape of findAllByLocalName(root, 'DMNShape', { directOnly: false })) {
        const ref = shape.getAttribute('dmnElementRef');
        if (ref === null) continue;
        const b = findByLocalName(shape, 'Bounds', { recurse: true });
        if (b === null) continue;
        boundsByRef.set(ref, {
            x: num(b.getAttribute('x')),
            y: num(b.getAttribute('y')),
            width: num(b.getAttribute('width')),
            height: num(b.getAttribute('height')),
        });
    }

    const elements: DmnDrdElement[] = [];
    const requirements: DmnInformationRequirement[] = [];

    // Walk the definitions' children in DOCUMENT order so element order
    // round-trips (an interleaved input/decision sequence is preserved).
    for (const child of Array.from(root.children)) {
        if (child.localName === 'inputData') {
            const id = child.getAttribute('id');
            if (id === null) continue;
            elements.push(
                makeElement(id, 'inputData', child.getAttribute('name') ?? '', null, boundsByRef.get(id)),
            );
        } else if (child.localName === 'decision') {
            const id = child.getAttribute('id');
            if (id === null) continue;
            elements.push(
                makeElement(
                    id,
                    'decision',
                    child.getAttribute('name') ?? '',
                    child.getAttribute('logicRef'),
                    boundsByRef.get(id),
                ),
            );

            let irIdx = 0;
            for (const irEl of findAllByLocalName(child, 'informationRequirement', { directOnly: true })) {
                irIdx++;
                const irId = irEl.getAttribute('id') ?? `ir_${id}_${irIdx}`;
                const refEl =
                    findByLocalName(irEl, 'requiredDecision', { recurse: true }) ??
                    findByLocalName(irEl, 'requiredInput', { recurse: true });
                if (refEl === null) continue;
                const from = (refEl.getAttribute('href') ?? '').replace(/^#/, '');
                if (from === '') continue;
                requirements.push({ id: irId, from, to: id });
            }
        }
    }

    return { name, elements, requirements };
}

/** Build a {@link DmnDrdElement} from parsed pieces — geometry-or-default. */
function makeElement(
    id: string,
    kind: DmnDrdElementKind,
    name: string,
    logicRef: string | null,
    bounds: ParsedBounds | undefined,
): DmnDrdElement {
    const position = bounds !== undefined ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 };
    const size =
        bounds !== undefined
            ? { width: bounds.width, height: bounds.height }
            : defaultSizeForKind(kind);
    return logicRef !== null && logicRef !== ''
        ? { id, kind, name, position, size, decisionLogicRef: logicRef }
        : { id, kind, name, position, size };
}

function num(value: string | null): number {
    const n = value === null ? NaN : Number(value);
    return Number.isFinite(n) ? n : 0;
}

// ------------------------------------------------------------------
// Internals (mirror the decision-table xml helpers; each surface
// owns its own small XML layer, like the renderers)
// ------------------------------------------------------------------

function createDocument(): Document {
    return new DOMParser().parseFromString(
        '<?xml version="1.0" encoding="UTF-8"?><placeholder/>',
        'application/xml',
    );
}

/** First descendant (or direct child when `recurse=false`) whose localName matches, namespace-agnostic. */
function findByLocalName(root: Element, name: string, options: { recurse: boolean }): Element | null {
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

/** All matching descendants. `directOnly` restricts to immediate children. */
function findAllByLocalName(root: Element, name: string, options: { directOnly: boolean }): Element[] {
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

/** Pretty-print the serialized XML with 2-space indentation + an XML declaration. */
function formatXml(doc: Document): string {
    const raw = new XMLSerializer().serializeToString(doc);
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
    const body = raw.replace(/^<\?xml[^?]*\?>\s*/, '');
    return `${declaration}\n${prettyPrint(body)}\n`;
}

/** Tiny depth-based pretty-printer (single-line input; no multi-line text content). */
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

            let j = end + 1;
            let text = '';
            while (j < xml.length && xml[j] !== '<') {
                text += xml[j];
                j++;
            }
            if (text.trim().length > 0) {
                out += text;
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
            i++;
        }
    }
    return out;
}
