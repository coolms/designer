/**
 * Vitest setup — polyfill DOM globals jsdom 25 doesn't expose.
 *
 * **PointerEvent.** jsdom ships the prototype but doesn't surface it as a
 * window/global, so `new PointerEvent('pointerdown', {...})` throws
 * `ReferenceError`. We polyfill it as a MouseEvent subclass carrying the
 * pointer-specific fields PointerInput reads (`button`, `clientX`,
 * `clientY` come from MouseEvent; `pointerType`, `pointerId`, etc.
 * default to mouse-like values).
 *
 * Without this, every pointer-driven test would have to fall back to
 * MouseEvent + custom type checking. Cleaner to fix it once at boot.
 */

interface PointerEventInitLike extends MouseEventInit {
    pointerId?: number;
    pointerType?: string;
    width?: number;
    height?: number;
    pressure?: number;
    tangentialPressure?: number;
    tiltX?: number;
    tiltY?: number;
    twist?: number;
    isPrimary?: boolean;
}

if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        readonly width: number;
        readonly height: number;
        readonly pressure: number;
        readonly tangentialPressure: number;
        readonly tiltX: number;
        readonly tiltY: number;
        readonly twist: number;
        readonly isPrimary: boolean;

        constructor(type: string, init: PointerEventInitLike = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? 'mouse';
            this.width = init.width ?? 1;
            this.height = init.height ?? 1;
            this.pressure = init.pressure ?? 0;
            this.tangentialPressure = init.tangentialPressure ?? 0;
            this.tiltX = init.tiltX ?? 0;
            this.tiltY = init.tiltY ?? 0;
            this.twist = init.twist ?? 0;
            this.isPrimary = init.isPrimary ?? true;
        }
    }

    (globalThis as { PointerEvent?: typeof PointerEventPolyfill }).PointerEvent =
        PointerEventPolyfill;
}
