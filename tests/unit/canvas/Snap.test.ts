import { describe, expect, it } from 'vitest';
import { Snap } from '../../../src/canvas/Snap.js';

describe('Snap', () => {
    it('defaults to 10-unit grid, enabled', () => {
        const snap = new Snap();
        expect(snap.gridSize).toBe(10);
        expect(snap.isEnabled).toBe(true);
    });

    it('rounds to nearest grid intersection', () => {
        const snap = new Snap({ gridSize: 10 });
        expect(snap.snap({ x: 12, y: 17 })).toEqual({ x: 10, y: 20 });
        expect(snap.snap({ x: -3, y: -8 })).toEqual({ x: -0, y: -10 });
    });

    it('passes through unchanged when disabled', () => {
        const snap = new Snap({ gridSize: 10, enabled: false });
        expect(snap.snap({ x: 12.3, y: 17.7 })).toEqual({ x: 12.3, y: 17.7 });
    });

    it('clamps gridSize to a minimum of 1', () => {
        const snap = new Snap({ gridSize: 0 });
        expect(snap.gridSize).toBe(1);
        expect(snap.snap({ x: 0.4, y: 0.6 })).toEqual({ x: 0, y: 1 });
    });

    it('clamps negative gridSize', () => {
        const snap = new Snap({ gridSize: -50 });
        expect(snap.gridSize).toBe(1);
    });

    it('setGridSize re-clamps', () => {
        const snap = new Snap();
        snap.setGridSize(25);
        expect(snap.gridSize).toBe(25);
        expect(snap.snap({ x: 60, y: 13 })).toEqual({ x: 50, y: 25 });

        snap.setGridSize(0);
        expect(snap.gridSize).toBe(1);
    });

    it('setEnabled toggles snapping live', () => {
        const snap = new Snap({ gridSize: 10 });
        snap.setEnabled(false);
        expect(snap.snap({ x: 13, y: 17 })).toEqual({ x: 13, y: 17 });
        snap.setEnabled(true);
        expect(snap.snap({ x: 13, y: 17 })).toEqual({ x: 10, y: 20 });
    });
});
