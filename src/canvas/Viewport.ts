import { Emitter } from '../internal/Emitter.js';
import type { Point } from './Snap.js';

/** Immutable snapshot of viewport state. */
export interface ViewportState {
    /** Pan offset in DOM pixels. (0,0) means world origin coincides with the canvas top-left. */
    readonly panX: number;
    readonly panY: number;
    /** Zoom scale, where 1.0 = identity (1 world unit = 1 DOM pixel). */
    readonly zoom: number;
}

interface ViewportEvents extends Record<string, unknown> {
    change: ViewportState;
}

export interface ViewportOptions {
    /** Lower zoom bound. Default 0.1 (10×). Floors at 0.01 to avoid div-by-zero in `toWorld`. */
    readonly minZoom?: number;
    /** Upper zoom bound. Default 10. Floored at the effective minZoom. */
    readonly maxZoom?: number;
}

/**
 * Pan + zoom state for the canvas. Applies its transform to an SVG
 * `<g>` group via `transform="translate(panX panY) scale(zoom)"` --
 * the group's children are drawn in world coordinates and rendered to
 * screen via the transform pipeline.
 *
 * Coordinate model:
 *  - World coordinates: what model elements (BPMN nodes, DMN rows, etc.)
 *    use to declare their positions. Zoom-independent.
 *  - DOM/screen coordinates: pointer events arrive in this space. The
 *    `<svg>` host's bounding rect defines the origin.
 *  - Transform: `screen = world * zoom + pan`, so
 *               `world  = (screen - pan) / zoom`.
 *
 * Zoom-around-a-focal-point math:
 *    To preserve the screen-space position of a focal point during a
 *    zoom change, we shift pan by the same factor:
 *      new_pan = focal - (focal - old_pan) * (new_zoom / old_zoom)
 *    Falls out of solving `focal_screen` = `world_focal * z + p`
 *    pre/post-zoom with `world_focal` held constant.
 */
export class Viewport {
    private readonly group: SVGGElement;
    private readonly emitter = new Emitter<ViewportEvents>();
    private readonly minZoom: number;
    private readonly maxZoom: number;
    private panX = 0;
    private panY = 0;
    private zoomLevel = 1;

    constructor(group: SVGGElement, options: ViewportOptions = {}) {
        this.group = group;
        this.minZoom = Math.max(0.01, options.minZoom ?? 0.1);
        this.maxZoom = Math.max(this.minZoom, options.maxZoom ?? 10);
        this.applyTransform();
    }

    /** Current state snapshot. New object on each read (immutable). */
    get state(): ViewportState {
        return { panX: this.panX, panY: this.panY, zoom: this.zoomLevel };
    }

    /** Set absolute pan. No-op if values are unchanged (avoids redundant change events). */
    setPan(x: number, y: number): void {
        if (x === this.panX && y === this.panY) return;
        this.panX = x;
        this.panY = y;
        this.applyTransform();
        this.fireChange();
    }

    /** Delta pan. Useful for middle-click-drag handlers. */
    panBy(dx: number, dy: number): void {
        if (dx === 0 && dy === 0) return;
        this.setPan(this.panX + dx, this.panY + dy);
    }

    /**
     * Set absolute zoom, optionally pivoting around a focal point in DOM
     * coordinates. When focal is omitted, zoom anchors at the world origin
     * (which usually moves visible content -- callers wanting "zoom to
     * canvas center" must compute the canvas center themselves and pass it
     * as the focal point).
     */
    setZoom(zoom: number, focal?: Point): void {
        const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        if (clamped === this.zoomLevel) return;
        if (focal) {
            const ratio = clamped / this.zoomLevel;
            this.panX = focal.x - (focal.x - this.panX) * ratio;
            this.panY = focal.y - (focal.y - this.panY) * ratio;
        }
        this.zoomLevel = clamped;
        this.applyTransform();
        this.fireChange();
    }

    /** Multiplicative zoom. `zoomBy(1.1)` = zoom in 10%; `zoomBy(1/1.1)` = zoom out. */
    zoomBy(delta: number, focal?: Point): void {
        if (delta === 1) return;
        this.setZoom(this.zoomLevel * delta, focal);
    }

    /**
     * F-7.4 -- fit the given world-space bounding box into the given
     * DOM-space canvas size, centering the content + leaving an
     * optional padding margin on all sides.
     *
     * **Math**:
     *  - `availableWidth = canvasSize.width * (1 - 2 * padding)`
     *  - `targetZoom = min(availableWidth / bboxWidth, availableHeight / bboxHeight)`
     *  - Clamped to `[minZoom, maxZoom]` so a tiny one-element model
     *    doesn't blow up past maxZoom and a giant 100-node model still
     *    fits even if it has to drop below minZoom (in which case the
     *    user gets the closest legal zoom that fits as much as
     *    possible).
     *  - `targetPan = canvasCenter - bboxCenter * targetZoom`
     *    (centers the bbox's centroid in the canvas).
     *
     * **Why a single method, not setZoom + setPan in sequence**:
     * the `setZoom` focal-pivot math would shift the pan based on the
     * OLD zoom + then we'd overwrite it again with `setPan`. Two
     * separate operations also fire two `change` events instead of one
     * -- subscribers (the Toolbar's zoom-percent display, the
     * canvas-extent computer) re-paint twice. Single atomic write,
     * single change event.
     *
     * **Padding semantics**: a fraction of the canvas's smaller
     * dimension, applied to all four sides. Default 0.1 = 10%
     * margin gives the diagram visual breathing room without wasting
     * too much screen real estate.
     *
     * **Empty / zero-size bbox guard**: if `bboxWidth <= 0` OR
     * `bboxHeight <= 0`, the method is a no-op (no sensible target
     * zoom exists for a degenerate bbox; the caller should have
     * filtered this case).
     */
    fitToContent(
        contentBbox: {
            readonly left: number;
            readonly top: number;
            readonly right: number;
            readonly bottom: number;
        },
        canvasSize: { readonly width: number; readonly height: number },
        options: { readonly padding?: number } = {},
    ): void {
        const bboxWidth = contentBbox.right - contentBbox.left;
        const bboxHeight = contentBbox.bottom - contentBbox.top;
        if (bboxWidth <= 0 || bboxHeight <= 0) return;
        if (canvasSize.width <= 0 || canvasSize.height <= 0) return;

        const padding = Math.max(0, Math.min(0.45, options.padding ?? 0.1));
        const availableWidth = canvasSize.width * (1 - 2 * padding);
        const availableHeight = canvasSize.height * (1 - 2 * padding);

        const targetZoomRaw = Math.min(
            availableWidth / bboxWidth,
            availableHeight / bboxHeight,
        );
        const targetZoom = Math.max(
            this.minZoom,
            Math.min(this.maxZoom, targetZoomRaw),
        );

        const bboxCenterX = (contentBbox.left + contentBbox.right) / 2;
        const bboxCenterY = (contentBbox.top + contentBbox.bottom) / 2;
        const canvasCenterX = canvasSize.width / 2;
        const canvasCenterY = canvasSize.height / 2;
        const targetPanX = canvasCenterX - bboxCenterX * targetZoom;
        const targetPanY = canvasCenterY - bboxCenterY * targetZoom;

        // Skip the no-op case to avoid spurious change events. The
        // tolerance is 0.5 of a DOM pixel + 0.0001 of zoom: tighter
        // would defeat the change-event suppression on real diffs
        // (subpixel rounding); looser would suppress real user-visible
        // diffs.
        const samePan =
            Math.abs(targetPanX - this.panX) < 0.5 &&
            Math.abs(targetPanY - this.panY) < 0.5;
        const sameZoom = Math.abs(targetZoom - this.zoomLevel) < 0.0001;
        if (samePan && sameZoom) return;

        this.panX = targetPanX;
        this.panY = targetPanY;
        this.zoomLevel = targetZoom;
        this.applyTransform();
        this.fireChange();
    }

    /** Convert a DOM-space point (e.g. from a pointer event relative to the canvas) to world coords. */
    toWorld(domPoint: Point): Point {
        return {
            x: (domPoint.x - this.panX) / this.zoomLevel,
            y: (domPoint.y - this.panY) / this.zoomLevel,
        };
    }

    /** Convert a world-space point to DOM coords. Inverse of {@link toWorld}. */
    toScreen(worldPoint: Point): Point {
        return {
            x: worldPoint.x * this.zoomLevel + this.panX,
            y: worldPoint.y * this.zoomLevel + this.panY,
        };
    }

    /** Subscribe to viewport changes. Returns unsubscribe thunk. */
    onChange(listener: (state: ViewportState) => void): () => void {
        return this.emitter.on('change', listener);
    }

    dispose(): void {
        this.emitter.dispose();
    }

    private applyTransform(): void {
        // Format keeps numbers compact -- SVG accepts decimals; we don't need integer truncation.
        this.group.setAttribute(
            'transform',
            `translate(${this.panX} ${this.panY}) scale(${this.zoomLevel})`,
        );
    }

    private fireChange(): void {
        this.emitter.emit('change', this.state);
    }
}
