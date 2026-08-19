/**
 * visual-regression fixture entry.
 *
 * This file gets bundled by `esbuild.visual.config.mjs` into
 * `tests/visual/.compiled/main.js` and loaded by the fixture HTML
 * shell. It picks a scenario from the URL hash (defaulting to
 * `empty`), mounts the editor, and signals readiness by setting
 * `window.__designerReady = true` once two `requestAnimationFrame`
 * frames have elapsed -- long enough for the canvas substrate's
 * render loop to flush its rAF batch and the table view to land
 * its full DOM update.
 *
 * **Why a custom fixture bundle, not the public package bundle**:
 * the public `dist/coolms-designer.global.js` deliberately omits
 * `DmnTableEditor` -- it is an internal module, reached through
 * `createEditor`. The visual-regression bundle includes both because
 * the test scenarios mount it directly. Symmetric to the Angular
 * wrapper's path mappings: same composition, different consumer.
 *
 * **Why a hash-driven scenario registry, not separate entrypoints**:
 * one bundle + one HTML shell + per-test URL navigation is cheaper
 * than per-test esbuild output and keeps the Playwright spec's
 * `page.goto('/#name')` calls one-liners.
 */

import { createEditor, XRefs } from '../../../src/index.js';
import { DmnTableEditor } from '../../../src/dmn/table/index.js';
import type { DecisionTableModel } from '../../../src/dmn/table/index.js';
import {
    BpmnLiteEditor,
    BpmnLitePropertyPanel,
    Palette,
    bpmnLiteJsonToModel,
} from '../../../src/bpmn-lite/index.js';

type ScenarioFn = (host: HTMLElement) => void;

/**
 * Each scenario sets up a different editor state for screenshot
 * comparison. Keep the model definitions inline + deterministic --
 * no `Date.now()`, no `Math.random()`, no async data -- so the
 * resulting DOM is byte-identical across runs.
 */
const SCENARIOS: Record<string, ScenarioFn> = {
    /**
     * Bare-mount: empty 1×1 decision table starter from the
     * package's `emptyDecisionTable()` factory. Pins the visual
     * baseline for fresh-mount geometry (toolbar position, table
     * header heights, default cell widths, scrollbar gutter).
     */
    empty: (host) => {
        const editor = createEditor(host, { surface: 'dmn-table' });
        new DmnTableEditor({
            host: editor.body,
            commands: editor.commands,
        });
    },

    /**
     * Populated 2-input × 1-output table with three rules. Pins
     * cell rendering, value alignment, header label widths,
     * type-ref badge placement, and rule-numbering column.
     */
    populated: (host) => {
        const editor = createEditor(host, { surface: 'dmn-table' });
        const tableEditor = new DmnTableEditor({
            host: editor.body,
            commands: editor.commands,
        });
        const model: DecisionTableModel = {
            name: 'customer_discount',
            hitPolicy: 'UNIQUE',
            aggregator: null,
            inputs: [
                { id: 'i1', name: 'Age', expression: 'customer.age', typeRef: 'number' },
                { id: 'i2', name: 'Region', expression: 'customer.region', typeRef: 'string' },
            ],
            outputs: [
                { id: 'o1', name: 'Discount', typeRef: 'number' },
            ],
            rules: [
                { id: 'r1', inputEntries: ['< 18',  '"EU"'], outputEntries: ['0']    },
                { id: 'r2', inputEntries: ['>= 65', '"EU"'], outputEntries: ['0.15'] },
                { id: 'r3', inputEntries: ['>= 18', '"US"'], outputEntries: ['0.10'] },
            ],
        };
        tableEditor.load(model);
    },

    /* ───────────────────── BPMN-Lite scenarios ──────────────────────── */

    /**
     * bare-mount BPMN-Lite editor: shell + canvas + palette
     * + property panel sidebar slots, empty process. Pins the
     * fresh-mount geometry of the canvas + the palette tiles
     * + the panel's "no selection" empty state.
     */
    'bpmn-empty': (host) => {
        const editor = createEditor(host, {
            surface: 'bpmn-lite',
            onSave: () => Promise.resolve(),
            onDeploy: () => Promise.resolve(),
        });
        const bpmnEditor = new BpmnLiteEditor({
            host: editor.body,
            commands: editor.commands,
            svgGroup: editor.canvasGroup,
        });
        if (editor.toolbar !== undefined) {
            new Palette({
                host: editor.toolbar.paletteHost,
                editor: bpmnEditor,
            });
        }
        if (editor.sidebar !== undefined) {
            new BpmnLitePropertyPanel({
                host: editor.sidebar.propertyHost,
                editor: bpmnEditor,
            });
        }
    },

    /**
     * populated BPMN-Lite editor: 5-element + 4-flow
     * "approve request" process (Start -> User Task -> Gateway -> [Yes/No
     * paths] -> End) loaded via the JSON round-trip. Pins the
     * node paint (events / tasks / gateways), the flow
     * paint (auto-routed waypoints + arrowheads + gateway crosshatch),
     * + the default-flow "/" marker.
     */
    'bpmn-populated': (host) => {
        const editor = createEditor(host, {
            surface: 'bpmn-lite',
            onSave: () => Promise.resolve(),
            onDeploy: () => Promise.resolve(),
        });
        const bpmnEditor = new BpmnLiteEditor({
            host: editor.body,
            commands: editor.commands,
            svgGroup: editor.canvasGroup,
        });
        if (editor.toolbar !== undefined) {
            new Palette({
                host: editor.toolbar.paletteHost,
                editor: bpmnEditor,
            });
        }
        if (editor.sidebar !== undefined) {
            new BpmnLitePropertyPanel({
                host: editor.sidebar.propertyHost,
                editor: bpmnEditor,
            });
        }
        // JSON round-trip exercises both the parser + the
        // serialiser geometry sidecar; loading from the wire format
        // pins the same bytes the deployer would persist.
        const body = JSON.stringify({
            process: { id: 'process.approve_request' },
            elements: [
                { id: 'start', type: 'startEvent', label: 'Request received' },
                { id: 'review', type: 'task', label: 'Review request', variant: 'userTask', formKey: 'request.review' },
                { id: 'decision', type: 'exclusiveGateway', label: 'Approved?' },
                { id: 'approve', type: 'task', label: 'Send approval', variant: 'serviceTask', implementation: 'email.send' },
                { id: 'reject', type: 'task', label: 'Send rejection', variant: 'serviceTask', implementation: 'email.send' },
                { id: 'end_ok', type: 'endEvent', label: 'Approved' },
                { id: 'end_no', type: 'endEvent', label: 'Rejected' },
                { id: 'f1', type: 'sequenceFlow', source: 'start',    target: 'review' },
                { id: 'f2', type: 'sequenceFlow', source: 'review',   target: 'decision' },
                { id: 'f3', type: 'sequenceFlow', source: 'decision', target: 'approve', condition: { language: 'EL', expression: 'variables.approved == true' } },
                { id: 'f4', type: 'sequenceFlow', source: 'decision', target: 'reject' },
                { id: 'f5', type: 'sequenceFlow', source: 'approve',  target: 'end_ok' },
                { id: 'f6', type: 'sequenceFlow', source: 'reject',   target: 'end_no' },
            ],
            diagram: {
                elements: {
                    start:    { bounds: { x:  60, y: 200, width: 36,  height: 36 } },
                    review:   { bounds: { x: 140, y: 178, width: 120, height: 80 } },
                    decision: { bounds: { x: 300, y: 192, width: 50,  height: 50 } },
                    approve:  { bounds: { x: 400, y: 100, width: 120, height: 80 } },
                    reject:   { bounds: { x: 400, y: 280, width: 120, height: 80 } },
                    end_ok:   { bounds: { x: 560, y: 122, width: 36,  height: 36 } },
                    end_no:   { bounds: { x: 560, y: 302, width: 36,  height: 36 } },
                },
                flows: {},
            },
        });
        bpmnEditor.load(bpmnLiteJsonToModel(body));
        // Set the gateway's first outgoing flow as the default so the
        // "/" marker paints.
        bpmnEditor.updateFlowProperty('f3', 'isDefault', true);
    },

    /**
     * populated BPMN-Lite editor with the property
     * panel actively driven (service-task variant + a populated
     * `workflow.handlers` XRef scope). Pins the variant-specific
     * field rendering (label + variant select + implementation
     * autocomplete).
     */
    'bpmn-property-panel': (host) => {
        const editor = createEditor(host, {
            surface: 'bpmn-lite',
            onSave: () => Promise.resolve(),
            onDeploy: () => Promise.resolve(),
        });
        const bpmnEditor = new BpmnLiteEditor({
            host: editor.body,
            commands: editor.commands,
            svgGroup: editor.canvasGroup,
        });
        const xrefs = new XRefs();
        xrefs.registerLookup('workflow.handlers', [
            { id: 'document.generate', label: 'document.generate' },
            { id: 'email.send',        label: 'email.send' },
            { id: 'identity.otp.send_code', label: 'identity.otp.send_code' },
        ]);
        xrefs.registerLookup('workflow.forms', [
            { id: 'identity.verify_email_otp', label: 'identity.verify_email_otp' },
            { id: 'request.review',            label: 'request.review' },
        ]);
        if (editor.toolbar !== undefined) {
            new Palette({
                host: editor.toolbar.paletteHost,
                editor: bpmnEditor,
            });
        }
        if (editor.sidebar !== undefined) {
            new BpmnLitePropertyPanel({
                host: editor.sidebar.propertyHost,
                editor: bpmnEditor,
                xrefs,
            });
        }
        const body = JSON.stringify({
            process: { id: 'process.demo' },
            elements: [
                { id: 'start',  type: 'startEvent', label: 'Start' },
                { id: 'send',   type: 'task', label: 'Send code',
                  variant: 'serviceTask', implementation: 'identity.otp.send_code' },
                { id: 'end',    type: 'endEvent', label: 'End' },
                { id: 'f1', type: 'sequenceFlow', source: 'start', target: 'send' },
                { id: 'f2', type: 'sequenceFlow', source: 'send',  target: 'end'  },
            ],
            diagram: {
                elements: {
                    start: { bounds: { x:  60, y: 180, width: 36,  height: 36 } },
                    send:  { bounds: { x: 140, y: 158, width: 140, height: 80 } },
                    end:   { bounds: { x: 320, y: 180, width: 36,  height: 36 } },
                },
                flows: {},
            },
        });
        bpmnEditor.load(bpmnLiteJsonToModel(body));
        // Programmatically select the service task so the panel
        // renders the variant-specific schema (label + variant SELECT
        // + implementation autocomplete sourced from the populated
        // XRef scope).
        bpmnEditor.selection.select({ kind: 'element', id: 'send' });
    },
};

declare global {
    interface Window {
        /** Set to `true` once the editor has mounted + the render loop has flushed. */
        __designerReady?: boolean;
        /** Last-error trap so Playwright can surface mount failures. */
        __designerError?: string;
    }
}

function selectedScenario(): string {
    const hash = window.location.hash.slice(1);
    return hash === '' ? 'empty' : hash;
}

function mount(): void {
    const host = document.getElementById('app');
    if (host === null) {
        window.__designerError = 'No #app host element found.';
        return;
    }
    const name = selectedScenario();
    const fn = SCENARIOS[name];
    if (fn === undefined) {
        const list = Object.keys(SCENARIOS).join(', ');
        host.textContent = `Unknown scenario: "${name}". Known: ${list}.`;
        window.__designerError = `unknown-scenario:${name}`;
        return;
    }
    try {
        fn(host);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        host.textContent = `Mount failed: ${msg}`;
        window.__designerError = msg;
        return;
    }
    // Two rAF tics: the first lets the canvas render loop flush
    // its scheduled rAF batch, the second guarantees the resulting
    // DOM mutations have painted.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.__designerReady = true;
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
} else {
    mount();
}
