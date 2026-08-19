import { describe, it, expect } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    PALETTE_ITEMS,
    SVG_NS,
    bpmnLiteModelToWire,
    bpmnLiteWireToModel,
    defaultBpmnLiteSchemaProvider,
    defaultDirectionFor,
    defaultElementRendererRegistry,
    gatewayCarriesDirection,
    paletteItemLabel,
    renderEventBasedGateway,
    renderInclusiveGateway,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement, BpmnElementKind } from '../../../src/bpmn-lite/index.js';

/**
 * Inclusive (OR) + event-based gateways, and the `direction` field they
 * share with the parallel gateway.
 *
 * `direction` is the load-bearing bit. The engine parser reads it on
 * parallel + inclusive gateways and DEFAULTS a missing value to
 * `diverging` -- its own comment calls that "a safe lie", leaving
 * `GatewayDegreeRule` to report the real problem at deploy. So a join
 * authored without it parses and then fails validation, which is why the
 * editor authors it explicitly and always emits it.
 */

function wireWith(...elements: Array<Record<string, unknown>>): unknown {
    return { process: { id: 'process.test' }, elements };
}

function gateway(
    type: BpmnElementKind,
    overrides: Partial<BpmnElement> = {},
): BpmnElement {
    return {
        id: 'g1',
        type,
        position: { x: 0, y: 0 },
        size: { width: 50, height: 50 },
        ...overrides,
    };
}

describe('gateways -- direction field', () => {
    it('is carried by parallel + inclusive only', () => {
        expect(gatewayCarriesDirection('parallelGateway')).toBe(true);
        expect(gatewayCarriesDirection('inclusiveGateway')).toBe(true);
        // An exclusive gateway's shape is implied by its degree, and an
        // event gateway is always diverging.
        expect(gatewayCarriesDirection('exclusiveGateway')).toBe(false);
        expect(gatewayCarriesDirection('eventBasedGateway')).toBe(false);
    });

    it('defaults to diverging for the kinds that carry it', () => {
        expect(defaultDirectionFor('inclusiveGateway')).toBe('diverging');
        expect(defaultDirectionFor('parallelGateway')).toBe('diverging');
        expect(defaultDirectionFor('task')).toBeUndefined();
    });

    it.each(['inclusiveGateway', 'parallelGateway'] as const)(
        'round-trips a converging %s',
        (type) => {
            const input = {
                id: 'g.join',
                type,
                direction: 'converging',
                in: ['a', 'b'],
                out: ['c'],
            };
            const model = bpmnLiteWireToModel(wireWith(input));
            expect(model.elements[0]!.direction).toBe('converging');
            // Promoted -- must not ALSO linger in extras.
            expect(model.elements[0]!.extras?.['direction']).toBeUndefined();

            const out = bpmnLiteModelToWire(model) as {
                elements: Array<Record<string, unknown>>;
            };
            expect(
                out.elements.find((e) => e['id'] === 'g.join')!['direction'],
            ).toBe('converging');
        },
    );

    /**
     * REGRESSION GUARD for the pre-existing gap this slice closed: the
     * wire has always carried `direction` on parallel gateways, but the
     * editor never promoted it, so a converging parallel JOIN could be
     * hand-authored yet never created or edited on the canvas.
     */
    it('surfaces direction on the parallel gateway schema, not just inclusive', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        for (const type of ['parallelGateway', 'inclusiveGateway'] as const) {
            const keys = provider
                .getSchemaForElement(gateway(type))
                .map((f) => f.key);
            expect(keys).toContain('direction');
        }
        // ...and NOT on the kinds with no such wire field.
        for (const type of ['exclusiveGateway', 'eventBasedGateway'] as const) {
            const keys = provider
                .getSchemaForElement(gateway(type))
                .map((f) => f.key);
            expect(keys).not.toContain('direction');
        }
    });

    it('emits a plain diverging rather than relying on the parser default', () => {
        // The parser would infer diverging, but `GatewayDegreeRule`
        // reports the consequences of a MISSING declaration, so the
        // editor always writes it.
        const model = bpmnLiteWireToModel(
            wireWith({ id: 'g1', type: 'inclusiveGateway', direction: 'diverging' }),
        );
        const out = bpmnLiteModelToWire(model) as {
            elements: Array<Record<string, unknown>>;
        };
        expect(out.elements[0]!['direction']).toBe('diverging');
    });

    it('ignores a junk direction rather than promoting it', () => {
        const model = bpmnLiteWireToModel(
            wireWith({ id: 'g1', type: 'inclusiveGateway', direction: 'sideways' }),
        );
        // Not promoted (it is not a legal value)...
        expect(model.elements[0]!.direction).toBeUndefined();
        // ...but preserved so the round-trip stays lossless.
        expect(model.elements[0]!.extras?.['direction']).toBe('sideways');
    });
});

/**
 * `SelectField` defaults `allowEmpty` to TRUE, so any picker whose blank
 * option would produce an undeployable body must switch it off
 * EXPLICITLY. Three slices shipped comments claiming "not allowEmpty"
 * while the rendered control still offered a blank option; caught in the
 * browser on the direction select. Clearing any of these is a real
 * failure mode, not a cosmetic one:
 *   - subtype absent  => WF.UNKNOWN_CONSTRUCT_TYPE at parse
 *   - direction absent => parser infers `diverging`, so a JOIN reads as a fork
 *   - timer.kind absent => toJson emits a block keyed "undefined"
 */
describe('schema -- pickers that must not offer a blank option', () => {
    const provider = defaultBpmnLiteSchemaProvider();

    it.each([
        ['intermediateCatchEvent:timer', 'subtype'],
        ['intermediateCatchEvent:timer', 'timer.kind'],
        ['boundaryEvent:timer', 'subtype'],
        ['boundaryEvent:timer', 'timer.kind'],
        ['inclusiveGateway', 'direction'],
        ['parallelGateway', 'direction'],
    ] as const)('%s / %s is not clearable', (schemaKey, fieldKey) => {
        const field = provider
            .getSchema(schemaKey)
            .find((f) => f.key === fieldKey);
        expect(field, `${schemaKey} has no ${fieldKey} field`).toBeDefined();
        expect(
            (field as { allowEmpty?: boolean }).allowEmpty,
            `${schemaKey}/${fieldKey} must set allowEmpty:false explicitly`,
        ).toBe(false);
    });
});

/**
 * The engine's `ElementKind` has **no plain `task` case** -- only
 * `userTask` / `serviceTask`, with no `TaskAst` behind them, and
 * `"type": "task"` appears nowhere in its corpus. So the palette's old
 * generic Task tile emitted a body the parser rejects outright with
 * `WF.UNKNOWN_CONSTRUCT_TYPE`: the most basic element on the palette
 * could not deploy. The tiles are now typed.
 */
describe('activity tiles emit a deployable wire type', () => {
    function dropAndEmit(variant?: string): Record<string, unknown> {
        const hostEl = document.createElement('div');
        document.body.appendChild(hostEl);
        const svg = document.createElementNS(SVG_NS, 'svg');
        const svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);
        svg.getBoundingClientRect = () =>
            ({ left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;

        const editor = new BpmnLiteEditor({
            host: hostEl,
            svgGroup,
            commands: new CommandStack(),
        });
        const dropped = editor.dropElementAt(200, 200, 'task', undefined, variant);
        const wire = bpmnLiteModelToWire(editor.state) as {
            elements: Array<Record<string, unknown>>;
        };
        const emitted = wire.elements.find((e) => e['id'] === dropped!.id)!;
        editor.dispose();
        hostEl.remove();
        svg.remove();
        return emitted;
    }

    it('ships User Task + Service Task tiles instead of one generic Task', () => {
        const taskTiles = PALETTE_ITEMS.filter((i) => i.kind === 'task');
        expect(taskTiles.map((t) => t.variant)).toEqual([
            'userTask',
            'serviceTask',
        ]);
        // No tile may create an untyped activity.
        expect(taskTiles.some((t) => t.variant === undefined)).toBe(false);
    });

    it.each(['userTask', 'serviceTask'] as const)(
        'a dropped %s emits that wire type, never "task"',
        (variant) => {
            const emitted = dropAndEmit(variant);
            expect(emitted['type']).toBe(variant);
            // The variant encodes INTO the wire type; emitting both would
            // be redundant and the parser ignores `variant` on tasks.
            expect(emitted['variant']).toBeUndefined();
        },
    );

    it('labels the tiles by their task flavour', () => {
        expect(paletteItemLabel('task', undefined, 'userTask')).toBe('User Task');
        expect(paletteItemLabel('task', undefined, 'serviceTask')).toBe(
            'Service Task',
        );
    });

    /**
     * Guard for the legacy shape: a body already containing an untyped
     * task must still round-trip verbatim (we do not silently rewrite an
     * author's process), and the panel must show it as UNSET rather than
     * defaulting the picker to "User task" over a model that says
     * otherwise.
     */
    it('preserves a legacy untyped task and shows it as unset', () => {
        const model = bpmnLiteWireToModel({
            process: { id: 'p' },
            elements: [{ id: 't1', type: 'task' }],
        });
        expect(model.elements[0]!.variant).toBeUndefined();
        const wire = bpmnLiteModelToWire(model) as {
            elements: Array<Record<string, unknown>>;
        };
        expect(wire.elements[0]!['type']).toBe('task');

        const variantField = defaultBpmnLiteSchemaProvider()
            .getSchema('task')
            .find((f) => f.key === 'variant') as {
            allowEmpty?: boolean;
            placeholder?: string;
        };
        expect(variantField.allowEmpty).toBe(true);
        expect(variantField.placeholder).toMatch(/not deploy/i);
    });
});

describe('gateways -- drop stamps direction', () => {
    it('stamps diverging on drop so the panel select is not blank', () => {
        const hostEl = document.createElement('div');
        document.body.appendChild(hostEl);
        const svg = document.createElementNS(SVG_NS, 'svg');
        const svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);
        svg.getBoundingClientRect = () =>
            ({ left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;

        const editor = new BpmnLiteEditor({
            host: hostEl,
            svgGroup,
            commands: new CommandStack(),
        });

        // Same class of bug as boundary `interrupting`: an unset
        // select renders blank over a value the engine will infer.
        const dropped = editor.dropElementAt(200, 200, 'inclusiveGateway');
        expect(dropped!.direction).toBe('diverging');

        const plain = editor.dropElementAt(300, 300, 'exclusiveGateway');
        expect(plain!.direction).toBeUndefined();

        editor.dispose();
        hostEl.remove();
        svg.remove();
    });
});

describe('gateways -- renderer + palette', () => {
    it('paints an inclusive gateway as a diamond + ring marker', () => {
        const g = renderInclusiveGateway(gateway('inclusiveGateway'), document);
        expect(g.querySelectorAll('polygon')).toHaveLength(1);
        const marker = g.querySelector('.coolms-designer__bpmn-gateway-marker');
        expect(marker?.tagName.toLowerCase()).toBe('circle');
    });

    it('paints an event gateway as a diamond + double ring + pentagon', () => {
        const g = renderEventBasedGateway(gateway('eventBasedGateway'), document);
        // Diamond body + the pentagon marker.
        expect(g.querySelectorAll('polygon')).toHaveLength(2);
        expect(g.querySelectorAll('circle')).toHaveLength(2);
        // Every marker is classed so the stylesheet can un-fill it --
        // unstyled SVG paints solid black.
        expect(
            g.querySelectorAll('.coolms-designer__bpmn-gateway-marker'),
        ).toHaveLength(3);
    });

    it('keeps the diamond body distinguishable from the pentagon marker', () => {
        // The CSS body rule uses `> polygon:first-of-type`; if the
        // pentagon were emitted first it would be styled as the body.
        const g = renderEventBasedGateway(gateway('eventBasedGateway'), document);
        const first = g.querySelectorAll('polygon')[0]!;
        expect(
            first.classList.contains('coolms-designer__bpmn-gateway-marker'),
        ).toBe(false);
    });

    it('registers both new kinds', () => {
        const registry = defaultElementRendererRegistry();
        expect(registry.has('inclusiveGateway')).toBe(true);
        expect(registry.has('eventBasedGateway')).toBe(true);
    });

    it('ships a palette tile for each', () => {
        const kinds = PALETTE_ITEMS.map((i) => i.kind);
        expect(kinds).toContain('inclusiveGateway');
        expect(kinds).toContain('eventBasedGateway');
    });
});
