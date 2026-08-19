import { Emitter } from '../internal/Emitter.js';
import type { Point } from './Snap.js';

/** Emitted on raw pointerdown (BEFORE drag-threshold logic kicks in). Use for selection clicks. */
export interface PointerDownEvent {
    /** Mouse button: 0 left, 1 middle, 2 right (matches DOM PointerEvent.button). */
    readonly button: number;
    /** Pointer position relative to the host SVG's top-left, in DOM pixels. */
    readonly dom: Point;
    readonly raw: PointerEvent;
}

/**
 * Emitted on every pointermove after the drag threshold has been crossed.
 * Both `delta` (vs start) and `incremental` (vs last drag event) are provided
 * because different consumers want different framings:
 *   - Pan handlers want incremental deltas to add to current pan.
 *   - Selection-box handlers want absolute delta from start to redraw the box.
 */
export interface DragEvent {
    /** Pointer position at pointerdown. */
    readonly start: Point;
    /** Current pointer position. */
    readonly current: Point;
    /** current - start. */
    readonly delta: Point;
    /** current - previous drag event (or start, for the first move). */
    readonly incremental: Point;
    /** Mouse button that initiated the drag. */
    readonly button: number;
    readonly raw: PointerEvent;
}

export interface PointerUpEvent {
    readonly button: number;
    readonly dom: Point;
    /**
     * Whether the pointer moved enough between down and up to qualify as a
     * drag. False = click semantics (treat as selection / toggle / dispatch).
     */
    readonly wasDrag: boolean;
    readonly raw: PointerEvent;
}

export interface WheelInputEvent {
    /** Pointer position at the wheel event, relative to the host SVG's top-left. */
    readonly dom: Point;
    /** Vertical scroll delta. Positive = scroll down (zoom out by convention). */
    readonly deltaY: number;
    /** ctrl held — trackpad pinch-zoom convention. Canvas uses this to escalate to zoom even when wheelZoom is off. */
    readonly ctrlKey: boolean;
    readonly raw: WheelEvent;
}

interface PointerEvents extends Record<string, unknown> {
    pointerdown: PointerDownEvent;
    drag: DragEvent;
    pointerup: PointerUpEvent;
    wheel: WheelInputEvent;
}

export interface PointerInputOptions {
    /**
     * Movement threshold in DOM pixels — pointer travel smaller than this
     * between down and up is treated as a click, not a drag. Default 4.
     * Set to 0 to fire drag events immediately on any movement.
     */
    readonly dragThreshold?: number;
}

/**
 * Wraps raw DOM pointer + wheel events on the host SVG into typed
 * intents. Responsibilities:
 *  - Track per-pointer down state (only one active pointer tracked at
 *    multi-touch lands when we need it).
 *  - Apply a movement deadband so jittery hands on pointerdown don't
 *    drag-start by accident.
 *  - Compute pointer positions in DOM-local coordinates (relative to
 *    the host's bounding rect) -- consumers feed these straight to
 *    Viewport.toWorld() to get world coords for hit-testing or model
 *    placement.
 *  - Forward wheel events unchanged for surface code to interpret.
 *
 * What this DOES NOT do: pointer capture, gesture recognition,
 * multi-touch. setPointerCapture is the natural escalation when drags
 * commonly leave the canvas bounds (avoiding mid-drag drops when the
 * pointer crosses the host border); deferred until a real renderer
 * surfaces the need.
 */
export class PointerInput {
    private readonly host: SVGSVGElement;
    private readonly emitter = new Emitter<PointerEvents>();
    private readonly threshold: number;
    private downAt: Point | null = null;
    private downButton: number | null = null;
    private lastDragAt: Point | null = null;
    private dragging = false;
    private disposed = false;

    private readonly onPointerDown: (e: PointerEvent) => void;
    private readonly onPointerMove: (e: PointerEvent) => void;
    private readonly onPointerUp: (e: PointerEvent) => void;
    private readonly onWheel: (e: WheelEvent) => void;

    constructor(host: SVGSVGElement, options: PointerInputOptions = {}) {
        this.host = host;
        this.threshold = Math.max(0, options.dragThreshold ?? 4);

        this.onPointerDown = (e) => this.handleDown(e);
        this.onPointerMove = (e) => this.handleMove(e);
        this.onPointerUp = (e) => this.handleUp(e);
        this.onWheel = (e) => this.handleWheel(e);

        host.addEventListener('pointerdown', this.onPointerDown);
        host.addEventListener('pointermove', this.onPointerMove);
        host.addEventListener('pointerup', this.onPointerUp);
        host.addEventListener('pointercancel', this.onPointerUp);
        // passive:false because wheel-zoom handlers call preventDefault to stop page scroll.
        host.addEventListener('wheel', this.onWheel, { passive: false });
    }

    on<K extends keyof PointerEvents>(
        event: K,
        listener: (payload: PointerEvents[K]) => void,
    ): () => void {
        return this.emitter.on(event, listener);
    }

    /** Test affordance: is a drag currently in progress? */
    get isDragging(): boolean {
        return this.dragging;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.host.removeEventListener('pointerdown', this.onPointerDown);
        this.host.removeEventListener('pointermove', this.onPointerMove);
        this.host.removeEventListener('pointerup', this.onPointerUp);
        this.host.removeEventListener('pointercancel', this.onPointerUp);
        this.host.removeEventListener('wheel', this.onWheel);
        this.emitter.dispose();
        this.downAt = null;
        this.downButton = null;
        this.lastDragAt = null;
        this.dragging = false;
    }

    private toDomPoint(e: PointerEvent | WheelEvent): Point {
        const rect = this.host.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private handleDown(e: PointerEvent): void {
        const dom = this.toDomPoint(e);
        this.downAt = dom;
        this.downButton = e.button;
        this.lastDragAt = null;
        this.dragging = false;
        this.emitter.emit('pointerdown', { button: e.button, dom, raw: e });
    }

    private handleMove(e: PointerEvent): void {
        if (this.downAt === null || this.downButton === null) return;
        const dom = this.toDomPoint(e);
        const delta = { x: dom.x - this.downAt.x, y: dom.y - this.downAt.y };
        if (!this.dragging) {
            const dist = Math.hypot(delta.x, delta.y);
            if (dist < this.threshold) return;
            this.dragging = true;
            this.lastDragAt = this.downAt;
        }
        const previous = this.lastDragAt ?? this.downAt;
        const incremental = { x: dom.x - previous.x, y: dom.y - previous.y };
        this.lastDragAt = dom;
        this.emitter.emit('drag', {
            start: this.downAt,
            current: dom,
            delta,
            incremental,
            button: this.downButton,
            raw: e,
        });
    }

    private handleUp(e: PointerEvent): void {
        const dom = this.toDomPoint(e);
        const wasDrag = this.dragging;
        const button = this.downButton ?? e.button;
        this.downAt = null;
        this.downButton = null;
        this.lastDragAt = null;
        this.dragging = false;
        this.emitter.emit('pointerup', { button, dom, wasDrag, raw: e });
    }

    private handleWheel(e: WheelEvent): void {
        this.emitter.emit('wheel', {
            dom: this.toDomPoint(e),
            deltaY: e.deltaY,
            ctrlKey: e.ctrlKey,
            raw: e,
        });
    }
}
