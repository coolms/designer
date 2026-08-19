import { describe, it, expect } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    PALETTE_ITEMS,
    SVG_NS,
    bpmnLiteModelToWire,
    bpmnLiteWireToModel,
    defaultBpmnLiteSchemaProvider,
    defaultElementRendererRegistry,
    paletteItemLabel,
    renderIntermediateCatchEvent,
} from '../../../src/bpmn-lite/index.js';
import type {
    BpmnElement,
    BpmnEventSubtype,
} from '../../../src/bpmn-lite/index.js';

/**
 * Intermediate catch events (timer / message / signal / condition).
 *
 * The load-bearing assertions here are the WIRE ones: the engine
 * parser dispatches an `intermediateCatchEvent` solely on its
 * `subtype`, keys the timer block by kind (`{"duration": "PT15M"}`),
 * and reads the message correlation from `correlation` (NOT
 * `correlationKey`). Every shape asserted below is copied from the
 * engine's own integration corpus, so a regression here means bodies
 * the designer saves stop deploying.
 */

function wireWith(...elements: Array<Record<string, unknown>>): unknown {
    return { process: { id: 'process.test' }, elements };
}

/** Round-trip a wire body through the editor model and back. */
function roundTrip(element: Record<string, unknown>): Record<string, unknown> {
    const model = bpmnLiteWireToModel(wireWith(element));
    const out = bpmnLiteModelToWire(model) as {
        elements: Array<Record<string, unknown>>;
    };
    const match = out.elements.find((e) => e['id'] === element['id']);
    expect(match).toBeDefined();
    return match!;
}

describe('intermediate catch events -- wire round-trip', () => {
    it('promotes a timer catch event out of unsupportedElements', () => {
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'evt.wait',
                type: 'intermediateCatchEvent',
                subtype: 'timer',
                timer: { duration: 'PT15M' },
            }),
        );

        expect(model.elements).toHaveLength(1);
        expect(model.processExtras?.['unsupportedElements']).toBeUndefined();
        const el = model.elements[0]!;
        expect(el.type).toBe('intermediateCatchEvent');
        expect(el.subtype).toBe('timer');
        // Wire keys by kind; the editor normalises to {kind, value}.
        expect(el.timer).toEqual({ kind: 'duration', value: 'PT15M' });
        // Promoted -- must NOT also linger in extras.
        expect(el.extras?.['timer']).toBeUndefined();
        expect(el.extras?.['subtype']).toBeUndefined();
    });

    it.each([
        {
            subtype: 'timer' as const,
            block: { timer: { duration: 'PT15M' } },
        },
        {
            subtype: 'timer' as const,
            block: { timer: { cycle: 'R3/PT10M' } },
        },
        {
            subtype: 'timer' as const,
            block: { timer: { date: '2026-01-01T00:00:00Z' } },
        },
        {
            subtype: 'message' as const,
            block: {
                message: { name: 'EmailReceived', correlation: 'threadId' },
            },
        },
        {
            subtype: 'signal' as const,
            block: { signal: { name: 'ShipmentDelayed' } },
        },
        {
            subtype: 'condition' as const,
            block: {
                condition: { expression: 'order.total > 1000', language: 'EL' },
            },
        },
    ])(
        'round-trips $subtype ($block) byte-for-byte',
        ({ subtype, block }) => {
            const input = {
                id: 'evt.wait',
                type: 'intermediateCatchEvent',
                subtype,
                ...block,
            };
            const out = roundTrip(input);

            expect(out['type']).toBe('intermediateCatchEvent');
            expect(out['subtype']).toBe(subtype);
            for (const [key, value] of Object.entries(block)) {
                expect(out[key]).toEqual(value);
            }
        },
    );

    it('emits `correlation`, never `correlationKey`', () => {
        const out = roundTrip({
            id: 'evt.msg',
            type: 'intermediateCatchEvent',
            subtype: 'message',
            message: { name: 'OrderApproved', correlation: 'orderId' },
        });

        expect(out['message']).toEqual({
            name: 'OrderApproved',
            correlation: 'orderId',
        });
        expect(
            (out['message'] as Record<string, unknown>)['correlationKey'],
        ).toBeUndefined();
    });

    it('omits a blank definition block rather than emitting an empty value', () => {
        // The shape a freshly-dropped, unconfigured timer tile produces.
        const model = bpmnLiteWireToModel(wireWith());
        const dropped: BpmnElement = {
            id: 'evt.new',
            type: 'intermediateCatchEvent',
            position: { x: 0, y: 0 },
            size: { width: 36, height: 36 },
            subtype: 'timer',
            timer: { kind: 'duration', value: '' },
        };
        const out = bpmnLiteModelToWire({
            ...model,
            elements: [dropped],
        }) as { elements: Array<Record<string, unknown>> };

        const el = out.elements[0]!;
        expect(el['subtype']).toBe('timer');
        // No `{"duration": ""}` noise -- the parser treats both the same.
        expect(el['timer']).toBeUndefined();
    });

    it('preserves an unknown subtype verbatim instead of coercing it', () => {
        // `escalation` is deliberately rejected by the engine parser; the
        // editor must not silently rewrite it into a subtype that deploys.
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'evt.esc',
                type: 'intermediateCatchEvent',
                subtype: 'escalation',
                escalation: { code: 'E_LATE' },
            }),
        );

        expect(model.elements).toHaveLength(0);
        const preserved = model.processExtras?.[
            'unsupportedElements'
        ] as Array<Record<string, unknown>>;
        expect(preserved).toHaveLength(1);
        expect(preserved[0]).toMatchObject({
            id: 'evt.esc',
            subtype: 'escalation',
            escalation: { code: 'E_LATE' },
        });
    });

    it('preserves a subtype-less catch event verbatim', () => {
        const model = bpmnLiteWireToModel(
            wireWith({ id: 'evt.bare', type: 'intermediateCatchEvent' }),
        );

        expect(model.elements).toHaveLength(0);
        expect(
            model.processExtras?.['unsupportedElements'],
        ).toHaveLength(1);
    });

    /**
     * REGRESSION GUARD. `message` / `timer` also ride on message/timer
     * START events, where they pair with the wire's `variant` slot and
     * stay in `extras`. If the promotion or the toJson reserved-key set
     * ever widens past `intermediateCatchEvent`, those blocks get
     * stripped from extras with no promoted field to re-emit from --
     * silently dropping the definition of every message start event.
     */
    it('does NOT promote message/timer blocks on start events', () => {
        const input = {
            id: 'start.msg',
            type: 'startEvent',
            variant: 'message',
            message: { name: 'OrderPlaced', correlation: 'orderId' },
        };
        const model = bpmnLiteWireToModel(wireWith(input));

        const el = model.elements[0]!;
        expect(el.type).toBe('startEvent');
        expect(el.subtype).toBeUndefined();
        expect(el.message).toBeUndefined();
        // Still parked in extras, exactly as before typed events landed.
        expect(el.extras?.['message']).toEqual({
            name: 'OrderPlaced',
            correlation: 'orderId',
        });

        // ...and it survives the trip back out.
        const out = roundTrip(input);
        expect(out['message']).toEqual({
            name: 'OrderPlaced',
            correlation: 'orderId',
        });
        expect(out['variant']).toBe('message');
    });
});

describe('intermediate catch events -- renderer', () => {
    function paint(subtype?: BpmnEventSubtype): SVGGElement {
        const element: BpmnElement = {
            id: 'evt_1',
            type: 'intermediateCatchEvent',
            position: { x: 10, y: 20 },
            size: { width: 36, height: 36 },
            ...(subtype !== undefined ? { subtype } : {}),
        };
        return renderIntermediateCatchEvent(element, document);
    }

    it('paints the BPMN double ring', () => {
        const g = paint('timer');
        const circles = g.querySelectorAll('circle');
        expect(circles).toHaveLength(2);
        // Inner ring is inset so the band reads at 36x36.
        const outer = Number(circles[0]!.getAttribute('r'));
        const inner = Number(circles[1]!.getAttribute('r'));
        expect(inner).toBeLessThan(outer);
        expect(inner).toBeGreaterThan(0);
    });

    /**
     * The stylesheet targets these classes to set an explicit `fill`.
     * SVG's initial fill is BLACK, so an unclassed ring/marker paints as a
     * solid blob -- which is exactly how this shipped until a browser
     * check caught it (jsdom asserts structure, never paint). Losing a
     * class here silently reintroduces the blob.
     */
    it('classes both rings + the marker so the stylesheet can un-fill them', () => {
        const g = paint('timer');
        expect(
            g.querySelector('.coolms-designer__bpmn-event-ring-outer'),
        ).not.toBeNull();
        expect(
            g.querySelector('.coolms-designer__bpmn-event-ring-inner'),
        ).not.toBeNull();
        expect(
            g.querySelector('.coolms-designer__bpmn-event-marker'),
        ).not.toBeNull();
    });

    it.each(['timer', 'message', 'signal', 'condition'] as const)(
        'paints a distinct %s marker',
        (subtype) => {
            const g = paint(subtype);
            const marker = g.querySelector('[data-event-marker]');
            expect(marker).not.toBeNull();
            expect(marker!.getAttribute('data-event-marker')).toBe(subtype);
            expect(g.getAttribute('data-element-subtype')).toBe(subtype);
        },
    );

    it('paints a bare double ring for an untyped event', () => {
        const g = paint();
        expect(g.querySelectorAll('circle')).toHaveLength(2);
        expect(g.querySelector('[data-event-marker]')).toBeNull();
    });

    it('titles the element by subtype, not by structural kind', () => {
        const g = paint('timer');
        expect(g.querySelector('title')?.textContent).toBe('Timer Event');
        expect(g.getAttribute('aria-label')).toBe('Timer Event');
    });

    it('is registered in the default renderer registry', () => {
        const registry = defaultElementRendererRegistry();
        expect(registry.has('intermediateCatchEvent')).toBe(true);
    });
});

describe('intermediate catch events -- palette + schema', () => {
    it('ships one tile per subtype', () => {
        const tiles = PALETTE_ITEMS.filter(
            (i) => i.kind === 'intermediateCatchEvent',
        );
        expect(tiles.map((t) => t.subtype)).toEqual([
            'timer',
            'message',
            'signal',
            'condition',
        ]);
    });

    it('labels tiles by subtype', () => {
        expect(paletteItemLabel('intermediateCatchEvent', 'timer')).toBe(
            'Timer Event',
        );
        expect(paletteItemLabel('task')).toBe('Task');
    });

    it.each([
        ['timer', 'timer.value'],
        ['message', 'message.name'],
        ['signal', 'signal.name'],
        ['condition', 'condition.expression'],
    ] as const)('pivots the %s schema onto %s', (subtype, expectedKey) => {
        const provider = defaultBpmnLiteSchemaProvider();
        const schema = provider.getSchemaForElement({
            id: 'evt_1',
            type: 'intermediateCatchEvent',
            position: { x: 0, y: 0 },
            size: { width: 36, height: 36 },
            subtype,
        });

        const keys = schema.map((f) => f.key);
        expect(keys).toContain('label');
        expect(keys).toContain('subtype');
        expect(keys).toContain(expectedKey);
    });

    /**
     * The panel reads a field's current value by schema key. Typed-event
     * keys are DOTTED (`timer.kind`), so a flat `values[key]` lookup
     * returns undefined and paints an empty control over a value that
     * exists -- a blank "Timer type" select on an event already set to
     * `duration`. Caught in-browser; the write path had dotted support
     * but the read path did not.
     */
    it('reads a dotted schema key off the nested definition block', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const svg = document.createElementNS(SVG_NS, 'svg');
        const svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);

        const editor = new BpmnLiteEditor({
            host,
            svgGroup,
            commands: new CommandStack(),
        });
        editor.addElement({
            id: 'evt.t',
            type: 'intermediateCatchEvent',
            position: { x: 0, y: 0 },
            size: { width: 36, height: 36 },
            subtype: 'timer',
            timer: { kind: 'cycle', value: 'R3/PT10M' },
        });

        // Writing a leaf must not clobber its sibling...
        editor.updateElementProperty('evt.t', 'timer.value', 'PT5M');
        const el = editor.findElement('evt.t')!;
        expect(el.timer).toEqual({ kind: 'cycle', value: 'PT5M' });

        // ...and materialise the parent when the block was absent.
        editor.addElement({
            id: 'evt.m',
            type: 'intermediateCatchEvent',
            position: { x: 0, y: 0 },
            size: { width: 36, height: 36 },
            subtype: 'message',
        });
        editor.updateElementProperty('evt.m', 'message.name', 'Ping');
        expect(editor.findElement('evt.m')!.message).toEqual({ name: 'Ping' });

        editor.dispose();
        host.remove();
        svg.remove();
    });

    it('falls back to the bare schema for an unrecognised subtype', () => {
        const provider = defaultBpmnLiteSchemaProvider();
        const schema = provider.getSchemaForElement({
            id: 'evt_1',
            type: 'intermediateCatchEvent',
            position: { x: 0, y: 0 },
            size: { width: 36, height: 36 },
            subtype: 'escalation' as BpmnEventSubtype,
        });

        // Still offers the picker so the author can re-type the element.
        expect(schema.map((f) => f.key)).toEqual(['label', 'subtype']);
    });
});
