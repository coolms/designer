/**
 * Canvas module -- the SVG rendering + interaction substrate that
 * BPMN-Lite, DMN DRD, and State Machine surfaces sit on. The
 * substrate is in-house rather than diagram-js, for license
 * independence + tuning freedom across surface kinds.
 *
 * Public package surface: nothing here is re-exported from
 * `@coolms/designer` (the root `src/index.ts`). The canvas API is
 * internal to renderers that ship within the package. External consumers
 * interact via {@link Editor} only.
 *
 * That separation is deliberate: it lets us evolve the canvas API
 * aggressively through M3.2.b-j without breaking npm consumers.
 */

export { Canvas, type CanvasOptions } from './Canvas.js';
export { CommandStack, type Command } from './CommandStack.js';
export { PointerInput } from './PointerInput.js';
export type {
    PointerDownEvent,
    PointerUpEvent,
    PointerInputOptions,
    DragEvent,
    WheelInputEvent,
} from './PointerInput.js';
export { RenderLoop } from './RenderLoop.js';
export { Snap, type Point, type SnapOptions } from './Snap.js';
export { Viewport, type ViewportOptions, type ViewportState } from './Viewport.js';
