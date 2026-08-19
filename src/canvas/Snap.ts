/**
 * Snap-to-grid utility. Operates on WORLD coordinates so it composes
 * correctly under viewport zoom -- a 10-unit grid stays 10 units
 * regardless of how zoomed in/out the user is, which is what makes
 * elements line up visually across zoom levels.
 *
 * Pure -- no DOM, no events. Construct once per Canvas, configure as
 * needed via `setGridSize` / `setEnabled`.
 *
 * Element-edge snapping (snap to other elements' bounds) lands in a
 * later phase together with the BPMN element library, which is
 * the first surface that meaningfully needs it.
 */

/** A 2D point. Shared by Viewport + PointerInput + Snap. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface SnapOptions {
    /** Grid spacing in world units. Default 10. Clamped to a minimum of 1 to avoid div-by-zero. */
    readonly gridSize?: number;
    /** Whether snapping is on. Default true. */
    readonly enabled?: boolean;
}

export class Snap {
    private grid: number;
    private on: boolean;

    constructor(options: SnapOptions = {}) {
        this.grid = Math.max(1, options.gridSize ?? 10);
        this.on = options.enabled ?? true;
    }

    /**
     * Snap a point to the grid. When snapping is disabled, returns the
     * input unchanged -- callers can unconditionally pipe through `snap()`
     * regardless of the current setting.
     */
    snap(point: Point): Point {
        if (!this.on) return { x: point.x, y: point.y };
        return {
            x: Math.round(point.x / this.grid) * this.grid,
            y: Math.round(point.y / this.grid) * this.grid,
        };
    }

    get gridSize(): number {
        return this.grid;
    }

    setGridSize(size: number): void {
        this.grid = Math.max(1, size);
    }

    get isEnabled(): boolean {
        return this.on;
    }

    setEnabled(enabled: boolean): void {
        this.on = enabled;
    }
}
