import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../../src/canvas/Canvas.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function mockBoundingRect(svg: SVGSVGElement, left = 0, top = 0): void {
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
    return new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', ...init });
}

function wheelEvent(init: Partial<WheelEventInit> = {}): WheelEvent {
    return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
}

describe('Canvas', () => {
    let parent: HTMLDivElement;
    let canvas: Canvas;

    beforeEach(() => {
        parent = document.createElement('div');
        document.body.appendChild(parent);
    });

    afterEach(() => {
        canvas?.destroy();
        parent.remove();
    });

    describe('DOM structure', () => {
        it('mounts svg + background rect + viewport group', () => {
            canvas = new Canvas(parent, 'bpmn-lite');

            const svg = parent.querySelector('.coolms-designer__canvas');
            expect(svg?.namespaceURI).toBe(SVG_NS);
            expect(svg?.getAttribute('data-coolms-designer-canvas')).toBe('bpmn-lite');

            const bg = svg?.querySelector('.coolms-designer__canvas-bg');
            expect(bg?.namespaceURI).toBe(SVG_NS);
            expect(bg?.tagName.toLowerCase()).toBe('rect');
            expect(bg?.getAttribute('width')).toBe('100%');

            const group = svg?.querySelector('.coolms-designer__viewport');
            expect(group?.namespaceURI).toBe(SVG_NS);
            expect(group?.tagName.toLowerCase()).toBe('g');
            // Identity transform applied by Viewport on construction.
            expect(group?.getAttribute('transform')).toBe('translate(0 0) scale(1)');
        });

        it('exposes the SVG root + viewport group via getters', () => {
            canvas = new Canvas(parent, 'dmn-table');
            expect(canvas.element.tagName.toLowerCase()).toBe('svg');
            expect(canvas.group.tagName.toLowerCase()).toBe('g');
            expect(canvas.group.parentElement).toBe(canvas.element);
        });
    });

    describe('subsystem exposure', () => {
        it('provides viewport, pointer, snap, commands, render', () => {
            canvas = new Canvas(parent, 'bpmn-lite');

            expect(canvas.viewport.state).toEqual({ panX: 0, panY: 0, zoom: 1 });
            expect(canvas.snap.gridSize).toBe(10);
            expect(canvas.commands.canUndo).toBe(false);
            expect(canvas.render.isPending).toBe(false);
            expect(typeof canvas.pointer.on).toBe('function');
        });

        it('threads options through to subsystems', () => {
            canvas = new Canvas(parent, 'bpmn-lite', {
                viewport: { minZoom: 0.5, maxZoom: 4 },
                snap: { gridSize: 25, enabled: false },
                commandStackLimit: 50,
            });

            // minZoom enforced
            canvas.viewport.setZoom(0.1);
            expect(canvas.viewport.state.zoom).toBe(0.5);

            expect(canvas.snap.gridSize).toBe(25);
            expect(canvas.snap.isEnabled).toBe(false);
        });
    });

    describe('built-in middle-click pan', () => {
        beforeEach(() => {
            canvas = new Canvas(parent, 'bpmn-lite');
            mockBoundingRect(canvas.element);
        });

        it('drags pan the viewport when middle button held', () => {
            const svg = canvas.element;
            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, button: 1 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 130, button: 1 }));

            // After threshold-crossing first drag event, pan = incremental(20, 30)
            expect(canvas.viewport.state).toMatchObject({ panX: 20, panY: 30 });

            svg.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 150, button: 1 }));
            // Subsequent drag: incremental(10, 20), pan accumulates to (30, 50)
            expect(canvas.viewport.state).toMatchObject({ panX: 30, panY: 50 });
        });

        it('does NOT pan on left-button drag (button=0)', () => {
            const svg = canvas.element;
            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 130, button: 0 }));

            expect(canvas.viewport.state).toMatchObject({ panX: 0, panY: 0 });
        });

        it('disabled via enableMiddleClickPan=false', () => {
            canvas.destroy();
            canvas = new Canvas(parent, 'bpmn-lite', { enableMiddleClickPan: false });
            mockBoundingRect(canvas.element);

            canvas.element.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, button: 1 }));
            canvas.element.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 130, button: 1 }));

            expect(canvas.viewport.state).toMatchObject({ panX: 0, panY: 0 });
        });
    });

    describe('built-in wheel zoom + pan (M3.3.m F-5)', () => {
        // F-5 split the wheel handler: Ctrl/Cmd + wheel = zoom (matches
        // Figma / Miro / draw.io convention + the trackpad pinch-as-
        // ctrl-wheel browser behaviour); plain wheel = pan. The
        // earlier tests asserted the pre-F-5 behaviour (plain wheel
        // zoomed); they're updated below to pass `ctrlKey: true` for
        // the zoom assertions + a new pan assertion was added.
        beforeEach(() => {
            canvas = new Canvas(parent, 'bpmn-lite', { wheelZoomStep: 2 });
            mockBoundingRect(canvas.element);
        });

        it('Ctrl + wheel (deltaY < 0) zooms in around the cursor', () => {
            canvas.element.dispatchEvent(
                wheelEvent({ clientX: 200, clientY: 200, deltaY: -100, ctrlKey: true }),
            );
            expect(canvas.viewport.state.zoom).toBe(2);
        });

        it('Ctrl + wheel (deltaY > 0) zooms out', () => {
            // Step in twice, step out once -- net should be one step in.
            canvas.element.dispatchEvent(wheelEvent({ clientX: 0, clientY: 0, deltaY: -100, ctrlKey: true }));
            canvas.element.dispatchEvent(wheelEvent({ clientX: 0, clientY: 0, deltaY: -100, ctrlKey: true }));
            canvas.element.dispatchEvent(wheelEvent({ clientX: 0, clientY: 0, deltaY: 100, ctrlKey: true }));
            expect(canvas.viewport.state.zoom).toBe(2);
        });

        it('plain wheel pans the viewport (no zoom)', () => {
            canvas.element.dispatchEvent(
                wheelEvent({ clientX: 100, clientY: 100, deltaY: 50, deltaX: 30 }),
            );
            // Zoom should be unchanged...
            expect(canvas.viewport.state.zoom).toBe(1);
            // ...but pan shifted by (-deltaX, -deltaY) so the camera
            // moves the same direction as the wheel scroll.
            expect(canvas.viewport.state.panX).toBe(-30);
            expect(canvas.viewport.state.panY).toBe(-50);
        });

        it('preventDefault is called on the wheel event', () => {
            const event = wheelEvent({ clientX: 100, clientY: 100, deltaY: -100 });
            const spy = vi.spyOn(event, 'preventDefault');
            canvas.element.dispatchEvent(event);
            expect(spy).toHaveBeenCalled();
        });

        it('disabled via enableWheelZoom=false', () => {
            canvas.destroy();
            canvas = new Canvas(parent, 'bpmn-lite', { enableWheelZoom: false });
            mockBoundingRect(canvas.element);

            canvas.element.dispatchEvent(
                wheelEvent({ clientX: 100, clientY: 100, deltaY: -100, ctrlKey: true }),
            );
            expect(canvas.viewport.state.zoom).toBe(1);
        });
    });

    describe('render loop integration', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('viewport changes schedule a render', () => {
            const onRender = vi.fn();
            canvas = new Canvas(parent, 'bpmn-lite', { onRender });

            canvas.viewport.setPan(10, 20);
            expect(canvas.render.isPending).toBe(true);

            vi.advanceTimersByTime(20);
            expect(onRender).toHaveBeenCalledOnce();
        });

        it('multiple viewport changes coalesce into one render', () => {
            const onRender = vi.fn();
            canvas = new Canvas(parent, 'bpmn-lite', { onRender });

            canvas.viewport.setPan(10, 0);
            canvas.viewport.setPan(20, 0);
            canvas.viewport.setZoom(2);

            vi.advanceTimersByTime(20);
            expect(onRender).toHaveBeenCalledOnce();
        });
    });

    describe('destroy', () => {
        it('removes the SVG + tears down subsystems', () => {
            canvas = new Canvas(parent, 'bpmn-lite');
            const svg = canvas.element;

            canvas.destroy();

            expect(canvas.isDestroyed).toBe(true);
            expect(parent.contains(svg)).toBe(false);
        });

        it('detaches pointer listeners (no pan after destroy)', () => {
            canvas = new Canvas(parent, 'bpmn-lite');
            mockBoundingRect(canvas.element);
            const svg = canvas.element;

            canvas.destroy();
            // Re-attach the svg to the document so events can flow.
            parent.appendChild(svg);
            mockBoundingRect(svg);

            svg.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, button: 1 }));
            svg.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200, button: 1 }));

            // Pan would have been (100,100) if listeners were still attached.
            expect(canvas.viewport.state.panX).toBe(0);
        });

        it('is idempotent', () => {
            canvas = new Canvas(parent, 'bpmn-lite');
            canvas.destroy();
            expect(() => canvas.destroy()).not.toThrow();
        });
    });
});
