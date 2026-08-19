import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewport } from '../../../src/canvas/Viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('Viewport', () => {
    let group: SVGGElement;
    let viewport: Viewport;

    beforeEach(() => {
        group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        viewport = new Viewport(group);
    });

    describe('initial state', () => {
        it('starts at pan=(0,0) zoom=1', () => {
            expect(viewport.state).toEqual({ panX: 0, panY: 0, zoom: 1 });
        });

        it('applies identity transform on construction', () => {
            expect(group.getAttribute('transform')).toBe('translate(0 0) scale(1)');
        });
    });

    describe('pan', () => {
        it('setPan applies transform + emits change', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);

            viewport.setPan(40, 60);

            expect(viewport.state).toEqual({ panX: 40, panY: 60, zoom: 1 });
            expect(group.getAttribute('transform')).toBe('translate(40 60) scale(1)');
            expect(onChange).toHaveBeenCalledWith({ panX: 40, panY: 60, zoom: 1 });
        });

        it('setPan with unchanged values is a no-op (no event)', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);

            viewport.setPan(0, 0);

            expect(onChange).not.toHaveBeenCalled();
        });

        it('panBy adds delta to current pan', () => {
            viewport.setPan(10, 20);
            viewport.panBy(5, -5);
            expect(viewport.state).toMatchObject({ panX: 15, panY: 15 });
        });

        it('panBy zero is a no-op', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.panBy(0, 0);
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('zoom', () => {
        it('setZoom updates scale + transform + emits change', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);

            viewport.setZoom(2);

            expect(viewport.state.zoom).toBe(2);
            expect(group.getAttribute('transform')).toBe('translate(0 0) scale(2)');
            expect(onChange).toHaveBeenCalled();
        });

        it('clamps to minZoom/maxZoom defaults', () => {
            viewport.setZoom(0.001);
            expect(viewport.state.zoom).toBe(0.1);
            viewport.setZoom(999);
            expect(viewport.state.zoom).toBe(10);
        });

        it('honours custom minZoom/maxZoom', () => {
            const constrained = new Viewport(group, { minZoom: 0.5, maxZoom: 2 });
            constrained.setZoom(5);
            expect(constrained.state.zoom).toBe(2);
            constrained.setZoom(0.1);
            expect(constrained.state.zoom).toBe(0.5);
        });

        it('setZoom with unchanged value is a no-op', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.setZoom(1);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('zoomBy multiplies current zoom', () => {
            viewport.zoomBy(2);
            expect(viewport.state.zoom).toBe(2);
            viewport.zoomBy(2);
            expect(viewport.state.zoom).toBe(4);
            viewport.zoomBy(0.25);
            expect(viewport.state.zoom).toBe(1);
        });

        it('zoomBy(1) is a no-op', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.zoomBy(1);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('zoom around focal point preserves screen-space focal coordinates', () => {
            viewport.setPan(0, 0);
            viewport.setZoom(1);
            const focal = { x: 100, y: 100 };

            // Before zoom: focal is at world (100,100) (since zoom=1, pan=0).
            const worldBefore = viewport.toWorld(focal);

            viewport.setZoom(2, focal);
            const worldAfter = viewport.toWorld(focal);

            // The screen-space focal point should now correspond to the same world point.
            expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
            expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
        });

        it('zoom around focal point preserves focal across multiple zooms', () => {
            viewport.setPan(20, 30);
            const focal = { x: 200, y: 150 };
            const worldStart = viewport.toWorld(focal);

            viewport.setZoom(3, focal);
            viewport.setZoom(0.5, focal);
            viewport.setZoom(2.7, focal);

            const worldEnd = viewport.toWorld(focal);
            expect(worldEnd.x).toBeCloseTo(worldStart.x, 5);
            expect(worldEnd.y).toBeCloseTo(worldStart.y, 5);
        });
    });

    describe('coordinate conversion', () => {
        it('toWorld + toScreen are inverses at identity', () => {
            const p = { x: 42, y: 17 };
            expect(viewport.toScreen(viewport.toWorld(p))).toEqual(p);
        });

        it('toWorld + toScreen are inverses under pan + zoom', () => {
            viewport.setPan(50, -30);
            viewport.setZoom(2.5);
            const p = { x: 200, y: 150 };

            const round = viewport.toScreen(viewport.toWorld(p));
            expect(round.x).toBeCloseTo(p.x, 10);
            expect(round.y).toBeCloseTo(p.y, 10);
        });

        it('toWorld accounts for pan + zoom', () => {
            viewport.setPan(10, 20);
            viewport.setZoom(2);
            // Screen (110, 220) - pan (10, 20) = (100, 200), / zoom = (50, 100)
            expect(viewport.toWorld({ x: 110, y: 220 })).toEqual({ x: 50, y: 100 });
        });

        it('toScreen accounts for pan + zoom', () => {
            viewport.setPan(10, 20);
            viewport.setZoom(2);
            // World (50, 100) * zoom (2) = (100, 200) + pan (10, 20) = (110, 220)
            expect(viewport.toScreen({ x: 50, y: 100 })).toEqual({ x: 110, y: 220 });
        });
    });

    describe('fitToContent (F-7.4)', () => {
        it('centers the bbox in the canvas with padding-driven zoom', () => {
            // Content bbox 200×100 (left 100, top 200, right 300, bottom 300).
            // Canvas 1000×800. Padding 10% → available 800×640.
            // Target zoom = min(800/200, 640/100) = min(4, 6.4) = 4.
            // Bbox center = (200, 250). Canvas center = (500, 400).
            // Pan = (500 - 200*4, 400 - 250*4) = (-300, -600).
            viewport.fitToContent(
                { left: 100, top: 200, right: 300, bottom: 300 },
                { width: 1000, height: 800 },
                { padding: 0.1 },
            );
            const state = viewport.state;
            expect(state.zoom).toBeCloseTo(4, 5);
            expect(state.panX).toBeCloseTo(-300, 5);
            expect(state.panY).toBeCloseTo(-600, 5);
        });

        it('clamps target zoom against maxZoom', () => {
            // Tiny bbox 10×10 in a huge canvas → raw target zoom would be
            // way past the default maxZoom of 10. Should clamp.
            viewport.fitToContent(
                { left: 0, top: 0, right: 10, bottom: 10 },
                { width: 1000, height: 1000 },
            );
            expect(viewport.state.zoom).toBeLessThanOrEqual(10);
        });

        it('clamps target zoom against minZoom for an oversized model', () => {
            // Huge model in tiny canvas → raw target zoom would be way
            // below the default minZoom of 0.1. Should clamp + still
            // center the (partially-clipped) bbox.
            viewport.fitToContent(
                { left: 0, top: 0, right: 100000, bottom: 100000 },
                { width: 100, height: 100 },
            );
            expect(viewport.state.zoom).toBeGreaterThanOrEqual(0.1);
        });

        it('emits a single change event for the atomic zoom+pan write', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.fitToContent(
                { left: 100, top: 200, right: 300, bottom: 300 },
                { width: 1000, height: 800 },
            );
            expect(onChange).toHaveBeenCalledTimes(1);
        });

        it('is a no-op for a degenerate (zero-area) bbox', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.fitToContent(
                { left: 100, top: 100, right: 100, bottom: 100 },
                { width: 1000, height: 800 },
            );
            expect(onChange).not.toHaveBeenCalled();
            expect(viewport.state).toEqual({ panX: 0, panY: 0, zoom: 1 });
        });

        it('is a no-op for a zero-sized canvas', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.fitToContent(
                { left: 0, top: 0, right: 100, bottom: 100 },
                { width: 0, height: 0 },
            );
            expect(onChange).not.toHaveBeenCalled();
        });

        it('is a no-op when the target zoom+pan are already in place', () => {
            // Apply once.
            viewport.fitToContent(
                { left: 100, top: 200, right: 300, bottom: 300 },
                { width: 1000, height: 800 },
            );
            const stateAfterFirst = { ...viewport.state };
            const onChange = vi.fn();
            viewport.onChange(onChange);
            // Apply same args again -- should not emit another change.
            viewport.fitToContent(
                { left: 100, top: 200, right: 300, bottom: 300 },
                { width: 1000, height: 800 },
            );
            expect(onChange).not.toHaveBeenCalled();
            expect(viewport.state).toEqual(stateAfterFirst);
        });
    });

    describe('subscribers', () => {
        it('onChange returns an unsubscribe thunk', () => {
            const onChange = vi.fn();
            const off = viewport.onChange(onChange);
            off();
            viewport.setPan(10, 10);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('dispose drops listeners', () => {
            const onChange = vi.fn();
            viewport.onChange(onChange);
            viewport.dispose();
            viewport.setPan(10, 10);
            // Dispatch did still run (DOM transform still updates) but listener is gone.
            expect(onChange).not.toHaveBeenCalled();
        });
    });
});
