import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerInput } from '../../../src/canvas/PointerInput.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * jsdom doesn't lay out elements, so getBoundingClientRect returns
 * zeros by default. Tests stub it to a known rect so the
 * client-coord-to-host-relative math has something to subtract.
 */
function mockHostRect(svg: SVGSVGElement, left = 0, top = 0): void {
    svg.getBoundingClientRect = (): DOMRect => ({
        left,
        top,
        right: left + 800,
        bottom: top + 600,
        width: 800,
        height: 600,
        x: left,
        y: top,
        toJSON: () => ({}),
    });
}

function pointer(type: string, init: Partial<PointerEventInit> = {}): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        button: 0,
        ...init,
    });
}

function wheelEvent(init: Partial<WheelEventInit> = {}): WheelEvent {
    return new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ...init,
    });
}

describe('PointerInput', () => {
    let svg: SVGSVGElement;
    let input: PointerInput;

    beforeEach(() => {
        svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        document.body.appendChild(svg);
        mockHostRect(svg);
        input = new PointerInput(svg);
    });

    afterEach(() => {
        input.dispose();
        svg.remove();
    });

    describe('pointerdown', () => {
        it('emits with host-relative coords + button', () => {
            const onDown = vi.fn();
            input.on('pointerdown', onDown);
            mockHostRect(svg, 100, 50);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 150, clientY: 80, button: 1 }));

            expect(onDown).toHaveBeenCalledWith(
                expect.objectContaining({ button: 1, dom: { x: 50, y: 30 } }),
            );
        });
    });

    describe('drag threshold', () => {
        it('does NOT emit drag for movements smaller than threshold', () => {
            const onDrag = vi.fn();
            input.on('drag', onDrag);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 102, clientY: 102 }));

            expect(onDrag).not.toHaveBeenCalled();
            expect(input.isDragging).toBe(false);
        });

        it('DOES emit drag once movement exceeds threshold', () => {
            const onDrag = vi.fn();
            input.on('drag', onDrag);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 110, clientY: 110 }));

            expect(onDrag).toHaveBeenCalledOnce();
            const event = onDrag.mock.calls[0]![0];
            expect(event.start).toEqual({ x: 100, y: 100 });
            expect(event.current).toEqual({ x: 110, y: 110 });
            expect(event.delta).toEqual({ x: 10, y: 10 });
            expect(input.isDragging).toBe(true);
        });

        it('honours custom dragThreshold', () => {
            input.dispose();
            input = new PointerInput(svg, { dragThreshold: 0 });
            const onDrag = vi.fn();
            input.on('drag', onDrag);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 50, clientY: 50 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 51, clientY: 51 }));

            expect(onDrag).toHaveBeenCalledOnce();
        });
    });

    describe('drag incremental + delta math', () => {
        it('incremental is per-event; delta is from start', () => {
            const drags: { delta: { x: number; y: number }; incremental: { x: number; y: number } }[] = [];
            input.on('drag', (e) => drags.push({ delta: e.delta, incremental: e.incremental }));

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 110, clientY: 100 })); // cross threshold
            svg.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 135, clientY: 105 }));

            expect(drags).toHaveLength(3);
            // First move (threshold crossing): incremental = from downAt
            expect(drags[0]).toEqual({ delta: { x: 10, y: 0 }, incremental: { x: 10, y: 0 } });
            // Second move: incremental = from previous drag
            expect(drags[1]).toEqual({ delta: { x: 30, y: 0 }, incremental: { x: 20, y: 0 } });
            expect(drags[2]).toEqual({ delta: { x: 35, y: 5 }, incremental: { x: 5, y: 5 } });
        });
    });

    describe('pointerup', () => {
        it('emits wasDrag=true when a drag was in progress', () => {
            const onUp = vi.fn();
            input.on('pointerup', onUp);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 120 }));
            svg.dispatchEvent(pointer('pointerup', { clientX: 120, clientY: 120 }));

            expect(onUp).toHaveBeenCalledWith(
                expect.objectContaining({ wasDrag: true, dom: { x: 120, y: 120 } }),
            );
        });

        it('emits wasDrag=false for a click (no drag threshold crossed)', () => {
            const onUp = vi.fn();
            input.on('pointerup', onUp);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
            svg.dispatchEvent(pointer('pointerup', { clientX: 102, clientY: 101, button: 0 }));

            expect(onUp).toHaveBeenCalledWith(
                expect.objectContaining({ wasDrag: false, button: 0 }),
            );
        });

        it('resets isDragging on up', () => {
            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 120 }));
            expect(input.isDragging).toBe(true);

            svg.dispatchEvent(pointer('pointerup', { clientX: 120, clientY: 120 }));
            expect(input.isDragging).toBe(false);
        });

        it('does not emit drag for moves WITHOUT a preceding pointerdown', () => {
            const onDrag = vi.fn();
            input.on('drag', onDrag);
            svg.dispatchEvent(pointer('pointermove', { clientX: 50, clientY: 50 }));
            expect(onDrag).not.toHaveBeenCalled();
        });
    });

    describe('pointercancel', () => {
        it('treats pointercancel like pointerup', () => {
            const onUp = vi.fn();
            input.on('pointerup', onUp);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 120 }));
            svg.dispatchEvent(pointer('pointercancel', { clientX: 120, clientY: 120 }));

            expect(onUp).toHaveBeenCalledOnce();
            expect(input.isDragging).toBe(false);
        });
    });

    describe('wheel', () => {
        it('forwards wheel events with normalised position + deltaY + ctrlKey', () => {
            const onWheel = vi.fn();
            input.on('wheel', onWheel);
            mockHostRect(svg, 50, 25);

            svg.dispatchEvent(
                wheelEvent({ clientX: 150, clientY: 100, deltaY: 120, ctrlKey: true }),
            );

            expect(onWheel).toHaveBeenCalledWith(
                expect.objectContaining({
                    dom: { x: 100, y: 75 },
                    deltaY: 120,
                    ctrlKey: true,
                }),
            );
        });
    });

    describe('dispose', () => {
        it('removes listeners + zeroes internal state', () => {
            const onDown = vi.fn();
            const onDrag = vi.fn();
            input.on('pointerdown', onDown);
            input.on('drag', onDrag);

            input.dispose();

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 120 }));

            expect(onDown).not.toHaveBeenCalled();
            expect(onDrag).not.toHaveBeenCalled();
            expect(input.isDragging).toBe(false);
        });

        it('is idempotent', () => {
            input.dispose();
            expect(() => input.dispose()).not.toThrow();
        });
    });
});
