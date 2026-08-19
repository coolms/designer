import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    DeleteElementCommand,
    PALETTE_ITEMS,
    SVG_NS,
    bpmnLiteModelToWire,
    bpmnLiteWireToModel,
    defaultBpmnLiteSchemaProvider,
    defaultElementRendererRegistry,
    dockPositionOnHost,
    paletteItemLabel,
    renderBoundaryEvent,
} from '../../../src/bpmn-lite/index.js';
import type { BpmnElement } from '../../../src/bpmn-lite/index.js';

/**
 * Boundary events -- the catch family's structurally-different sibling.
 *
 * Wire contract (verified against the engine parser's boundary-event
 * builder):
 *   {type:"boundaryEvent", subtype:"timer|message|signal|error|compensation",
 *    attachedTo:"<hostId>", interrupting:bool | nonInterrupting:bool,
 *    errorCode:"...", out:["flowId"]}
 * plus the DUAL SPELLING where an `intermediateCatchEvent` carrying
 * `attachedTo` is normalised to a boundary event.
 */

function wireWith(...elements: Array<Record<string, unknown>>): unknown {
    return { process: { id: 'process.test' }, elements };
}

function boundary(overrides: Partial<BpmnElement> = {}): BpmnElement {
    return {
        id: 'b1',
        type: 'boundaryEvent',
        position: { x: 0, y: 0 },
        size: { width: 36, height: 36 },
        subtype: 'timer',
        attachedTo: 'host',
        ...overrides,
    };
}

describe('boundary events -- wire round-trip', () => {
    it('promotes attachedTo + subtype out of unsupportedElements', () => {
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'b.timeout',
                type: 'boundaryEvent',
                subtype: 'timer',
                attachedTo: 'task.review',
                timer: { duration: 'PT1H' },
            }),
        );

        expect(model.processExtras?.['unsupportedElements']).toBeUndefined();
        const el = model.elements[0]!;
        expect(el.type).toBe('boundaryEvent');
        expect(el.attachedTo).toBe('task.review');
        expect(el.timer).toEqual({ kind: 'duration', value: 'PT1H' });
        // Absent flags default to interrupting.
        expect(el.interrupting).toBe(true);
    });

    it('normalises the §2.4 dual spelling (catch event + attachedTo)', () => {
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'b.dual',
                type: 'intermediateCatchEvent',
                subtype: 'message',
                attachedTo: 'task.review',
                nonInterrupting: true,
                message: { name: 'Cancelled', correlation: 'orderId' },
            }),
        );

        const el = model.elements[0]!;
        // Same wire shape the engine treats as a boundary => same model.
        expect(el.type).toBe('boundaryEvent');
        expect(el.attachedTo).toBe('task.review');
        expect(el.interrupting).toBe(false);

        // ...and it re-emits in the CANONICAL spelling.
        const out = bpmnLiteModelToWire(model) as {
            elements: Array<Record<string, unknown>>;
        };
        const wire = out.elements.find((e) => e['id'] === 'b.dual')!;
        expect(wire['type']).toBe('boundaryEvent');
        expect(wire['interrupting']).toBe(false);
        // Only ONE spelling goes out -- emitting both risks the
        // contradictory-flags parse error.
        expect(wire['nonInterrupting']).toBeUndefined();
    });

    it.each([
        [{ interrupting: true }, true],
        [{ interrupting: false }, false],
        [{ nonInterrupting: true }, false],
        [{ nonInterrupting: false }, true],
        [{ interrupting: false, nonInterrupting: true }, false],
        [{ interrupting: true, nonInterrupting: false }, true],
        [{}, true],
    ])('reconciles flags %j -> interrupting=%s', (flags, expected) => {
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'b1',
                type: 'boundaryEvent',
                subtype: 'signal',
                attachedTo: 'h',
                signal: { name: 'S' },
                ...flags,
            }),
        );
        expect(model.elements[0]!.interrupting).toBe(expected);
    });

    it('preserves CONTRADICTORY flags verbatim instead of picking a winner', () => {
        // interrupting === nonInterrupting is WF.BOUNDARY_CONTRADICTORY_FLAGS.
        // The body does not deploy; silently repairing it would hide that.
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'b.bad',
                type: 'boundaryEvent',
                subtype: 'timer',
                attachedTo: 'h',
                interrupting: true,
                nonInterrupting: true,
            }),
        );

        expect(model.elements).toHaveLength(0);
        expect(model.processExtras?.['unsupportedElements']).toHaveLength(1);
    });

    it('preserves a conditional boundary verbatim (engine has no such subtype)', () => {
        const model = bpmnLiteWireToModel(
            wireWith({
                id: 'b.cond',
                type: 'boundaryEvent',
                subtype: 'condition',
                attachedTo: 'h',
            }),
        );
        expect(model.elements).toHaveLength(0);
        expect(model.processExtras?.['unsupportedElements']).toHaveLength(1);
    });

    it('round-trips an error boundary with its flat errorCode', () => {
        const input = {
            id: 'b.err',
            type: 'boundaryEvent',
            subtype: 'error',
            attachedTo: 'svc.charge',
            errorCode: 'PAYMENT_DECLINED',
        };
        const model = bpmnLiteWireToModel(wireWith(input));
        expect(model.elements[0]!.errorCode).toBe('PAYMENT_DECLINED');

        const out = bpmnLiteModelToWire(model) as {
            elements: Array<Record<string, unknown>>;
        };
        const wire = out.elements.find((e) => e['id'] === 'b.err')!;
        expect(wire).toMatchObject(input);
        // Interrupting is the default -- not written as noise.
        expect(wire['interrupting']).toBeUndefined();
    });
});

describe('boundary events -- docking', () => {
    const host: BpmnElement = {
        id: 'host',
        type: 'task',
        position: { x: 100, y: 100 },
        size: { width: 100, height: 80 },
    };
    const size = { width: 36, height: 36 };

    it.each([
        ['bottom', { x: 150, y: 175 }, { x: 132, y: 162 }],
        ['top', { x: 150, y: 105 }, { x: 132, y: 82 }],
        ['left', { x: 105, y: 140 }, { x: 82, y: 122 }],
        ['right', { x: 195, y: 140 }, { x: 182, y: 122 }],
    ])('snaps to the nearest edge (%s)', (_edge, drop, expected) => {
        expect(dockPositionOnHost(host, drop, size)).toEqual(expected);
    });

    it('clamps along the edge so it cannot slide off a corner', () => {
        // Far beyond the host's right end, but nearest the bottom edge.
        const docked = dockPositionOnHost(host, { x: 900, y: 178 }, size);
        // Centre clamped to the host's right extent (200), not 900.
        expect(docked.x + size.width / 2).toBe(200);
    });
});

describe('boundary events -- editor integration', () => {
    let host: HTMLDivElement;
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let editor: BpmnLiteEditor;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svg = document.createElementNS(SVG_NS, 'svg');
        svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);
        editor = new BpmnLiteEditor({
            host,
            svgGroup,
            commands: new CommandStack(),
            initialModel: {
                processId: 'p',
                elements: [
                    {
                        id: 'task1',
                        type: 'task',
                        position: { x: 100, y: 100 },
                        size: { width: 100, height: 80 },
                    },
                ],
                flows: [],
            },
        });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        svg.remove();
    });

    it('carries attached boundaries when the host moves', () => {
        editor.addElement(boundary({ id: 'b1', attachedTo: 'task1', position: { x: 132, y: 162 } }));

        editor.updateElementPosition('task1', { x: 300, y: 250 });

        // Host delta was (+200, +150); the boundary rides it exactly, so
        // it stays docked on the same point of the border.
        expect(editor.findElement('b1')!.position).toEqual({ x: 332, y: 312 });
    });

    it('moves boundaries back when the host move is undone', () => {
        editor.addElement(boundary({ id: 'b1', attachedTo: 'task1', position: { x: 132, y: 162 } }));

        editor.updateElementPosition('task1', { x: 300, y: 250 });
        // Assert the INTERMEDIATE state too -- without this test
        // passes vacuously if boundaries never move at all.
        expect(editor.findElement('b1')!.position).toEqual({ x: 332, y: 312 });

        editor.updateElementPosition('task1', { x: 100, y: 100 });
        expect(editor.findElement('b1')!.position).toEqual({ x: 132, y: 162 });
    });

    it('leaves unattached elements alone when a host moves', () => {
        editor.addElement({
            id: 'other',
            type: 'task',
            position: { x: 500, y: 500 },
            size: { width: 100, height: 80 },
        });
        editor.updateElementPosition('task1', { x: 300, y: 250 });
        expect(editor.findElement('other')!.position).toEqual({ x: 500, y: 500 });
    });

    it('cascade-deletes attached boundaries with their host, and restores on undo', () => {
        const b = boundary({ id: 'b1', attachedTo: 'task1' });
        editor.addElement(b);
        editor.addFlow({ id: 'f1', source: 'b1', target: 'task1' });

        const hostEl = editor.findElement('task1')!;
        const cmd = new DeleteElementCommand(editor, hostEl);
        cmd.apply();

        // A boundary cannot outlive its host -- an orphan attachedTo
        // fails deploy with WF.BOUNDARY_UNKNOWN_HOST.
        expect(editor.findElement('task1')).toBeNull();
        expect(editor.findElement('b1')).toBeNull();
        expect(editor.state.flows).toHaveLength(0);

        cmd.revert();
        expect(editor.findElement('task1')).not.toBeNull();
        expect(editor.findElement('b1')).not.toBeNull();
        expect(editor.state.flows).toHaveLength(1);
    });

    /**
     * The panel's boolean field renders `undefined` as UNCHECKED, so a
     * dropped boundary with no `interrupting` slot showed an unchecked
     * "Interrupting" box beside a SOLID (interrupting) ring -- the panel
     * contradicting the canvas. Caught in-browser. The model therefore
     * carries the semantic default explicitly; `toJson` still omits a
     * `true` so the saved body stays clean.
     */
    it('stamps interrupting=true on drop so the panel matches the canvas', () => {
        const svgEl = svgGroup.ownerSVGElement!;
        svgEl.getBoundingClientRect = () =>
            ({ left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;

        const dropped = editor.dropElementAt(150, 178, 'boundaryEvent', 'timer');
        expect(dropped).not.toBeNull();
        expect(dropped!.attachedTo).toBe('task1');
        expect(dropped!.interrupting).toBe(true);

        // ...but a plain `true` is never written to the wire.
        const wire = bpmnLiteModelToWire(editor.state) as {
            elements: Array<Record<string, unknown>>;
        };
        const emitted = wire.elements.find((e) => e['id'] === dropped!.id)!;
        expect(emitted['attachedTo']).toBe('task1');
        expect(emitted['interrupting']).toBeUndefined();
    });

    it('rejects a boundary dropped on empty canvas', () => {
        const svgEl = svgGroup.ownerSVGElement!;
        svgEl.getBoundingClientRect = () =>
            ({ left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;

        // Far from the only element -- a boundary with no host cannot
        // deploy, so no orphan is created and no command is pushed.
        const before = editor.state.elements.length;
        expect(editor.dropElementAt(600, 500, 'boundaryEvent', 'timer')).toBeNull();
        expect(editor.state.elements).toHaveLength(before);
    });

    it('never offers a boundary event as a host for another boundary', () => {
        editor.addElement(
            boundary({ id: 'b1', attachedTo: 'task1', position: { x: 132, y: 162 } }),
        );
        // A point inside the boundary's own box also overlaps the task.
        const hit = editor.elementAtWorldPoint({ x: 145, y: 175 });
        expect(hit?.id).toBe('task1');
    });
});

describe('boundary events -- renderer + palette + schema', () => {
    function paint(overrides: Partial<BpmnElement> = {}): SVGGElement {
        return renderBoundaryEvent(boundary(overrides), document);
    }

    it('paints a solid double ring when interrupting', () => {
        const g = paint({ interrupting: true });
        expect(g.querySelectorAll('circle')).toHaveLength(2);
        expect(g.getAttribute('data-non-interrupting')).toBeNull();
    });

    it('marks the element non-interrupting so the stylesheet can dash it', () => {
        const g = paint({ interrupting: false });
        expect(g.getAttribute('data-non-interrupting')).toBe('true');
        expect(
            g.classList.contains(
                'coolms-designer__bpmn-event--non-interrupting',
            ),
        ).toBe(true);
    });

    it('treats an absent interrupting flag as interrupting', () => {
        const g = paint();
        expect(g.getAttribute('data-non-interrupting')).toBeNull();
    });

    it.each(['timer', 'message', 'signal', 'error', 'compensation'] as const)(
        'paints a distinct %s marker',
        (subtype) => {
            const g = paint({ subtype });
            expect(
                g.querySelector('[data-event-marker]')?.getAttribute(
                    'data-event-marker',
                ),
            ).toBe(subtype);
        },
    );

    it('classes both rings so the stylesheet can un-fill them', () => {
        // Same trap as the catch events: unstyled SVG paints solid black.
        const g = paint();
        expect(
            g.querySelector('.coolms-designer__bpmn-event-ring-outer'),
        ).not.toBeNull();
        expect(
            g.querySelector('.coolms-designer__bpmn-event-ring-inner'),
        ).not.toBeNull();
    });

    it('is registered in the default renderer registry', () => {
        expect(defaultElementRendererRegistry().has('boundaryEvent')).toBe(true);
    });

    it('ships one tile per boundary subtype', () => {
        const tiles = PALETTE_ITEMS.filter((i) => i.kind === 'boundaryEvent');
        expect(tiles.map((t) => t.subtype)).toEqual([
            'timer',
            'message',
            'signal',
            'error',
            'compensation',
        ]);
    });

    it('labels boundary tiles distinctly from catch tiles', () => {
        expect(paletteItemLabel('boundaryEvent', 'timer')).toBe('Timer Boundary');
        expect(paletteItemLabel('intermediateCatchEvent', 'timer')).toBe(
            'Timer Event',
        );
    });

    it.each([
        ['timer', 'timer.value'],
        ['message', 'message.name'],
        ['signal', 'signal.name'],
        ['error', 'errorCode'],
    ] as const)('pivots the %s boundary schema onto %s', (subtype, key) => {
        const schema = defaultBpmnLiteSchemaProvider().getSchemaForElement(
            boundary({ subtype }),
        );
        const keys = schema.map((f) => f.key);
        expect(keys).toContain('interrupting');
        expect(keys).toContain(key);
    });

    it('does not offer attachedTo as an editable field', () => {
        // Attachment is a canvas gesture; a free-text host id could point
        // at an element that does not exist.
        const schema = defaultBpmnLiteSchemaProvider().getSchemaForElement(
            boundary(),
        );
        expect(schema.map((f) => f.key)).not.toContain('attachedTo');
    });
});
