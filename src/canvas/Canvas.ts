import type { EditorSurface } from '../shell/Editor.js';
import { CommandStack } from './CommandStack.js';
import { PointerInput, type PointerInputOptions } from './PointerInput.js';
import { RenderLoop } from './RenderLoop.js';
import { Snap, type SnapOptions } from './Snap.js';
import { Viewport, type ViewportOptions } from './Viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface CanvasOptions {
    readonly viewport?: ViewportOptions;
    readonly pointer?: PointerInputOptions;
    readonly snap?: SnapOptions;
    readonly commandStackLimit?: number;
    /**
     * Enable built-in middle-click drag-to-pan. Default true. Disable when
     * a surface (e.g. DMN table) doesn't want canvas-style interactions.
     */
    readonly enableMiddleClickPan?: boolean;
    /**
     * Enable built-in wheel-zoom. Default true. Wheel zooms multiply the
     * current zoom by `wheelZoomStep` per notch (delta < 0 = zoom in,
     * delta > 0 = zoom out). Ctrl+wheel always counts as zoom regardless
     * of this flag, matching trackpad pinch convention.
     */
    readonly enableWheelZoom?: boolean;
    /**
     * Enable plain (un-modified) wheel-drag-to-pan. Default true. When false,
     * a plain wheel event is NOT consumed (no preventDefault) so it scrolls
     * the surrounding page — Ctrl/Cmd + wheel still zooms. Disable for
     * read-only diagrams embedded in a scrollable page (e.g. the M4 cockpit
     * instance view) so hovering the diagram doesn't trap page scroll.
     */
    readonly enableWheelPan?: boolean;
    /** Multiplicative zoom factor per wheel notch. Default 1.1. Floored at 1.001. */
    readonly wheelZoomStep?: number;
    /**
     * Callback fired once per animation frame via the {@link RenderLoop}.
     * Surface renderers wire their diff-render here. At M3.2.b the canvas
     * has no rendered content of its own; this is the seam M3.2.c lands
     * graph diff-rendering against.
     */
    readonly onRender?: () => void;
}

/**
 * The SVG canvas substrate -- the rendering + interaction surface that
 * BPMN-Lite, DMN DRD, and State Machine editors all sit on.
 *
 * Owns five sub-systems:
 *  - {@link Viewport} -- pan/zoom transforms on the inner `<g>` group
 *  - {@link PointerInput} -- pointer + wheel event capture, drag intents
 *  - {@link Snap} -- grid snapping in world coords
 *  - {@link CommandStack} -- undo/redo for model mutations
 *  - {@link RenderLoop} -- rAF batching so coalesced changes paint once
 *
 * DOM structure mounted under `parent`:
 *
 *   <svg class="coolms-designer__canvas">          ← pointer events captured here
 *     <rect class="coolms-designer__canvas-bg"/>   ← transparent hit target
 *     <g class="coolms-designer__viewport"/>       ← Viewport transforms apply here
 *   </svg>
 *
 * Surface renderers (M3.3 BPMN, M4 DMN DRD, M3.5 StateMachine) APPEND
 * their element trees to {@link Canvas.group} -- never to the SVG root
 * directly -- so pan/zoom flows through naturally.
 *
 * The DMN decision-table editor constructs a Canvas via the
 * shell but does NOT render into it (tables aren't graphs). Centralising
 * lifecycle in one Canvas keeps `Editor.destroy()` uniform across
 * surface kinds at the cost of one tiny SVG element on table surfaces.
 */
export class Canvas {
    private readonly svg: SVGSVGElement;
    private readonly background: SVGRectElement;
    private readonly viewportGroup: SVGGElement;

    /** Pan/zoom state + transform application. */
    readonly viewport: Viewport;
    /** Pointer + wheel event capture. */
    readonly pointer: PointerInput;
    /** Grid snapping (in world coords). */
    readonly snap: Snap;
    /** Undo/redo command stack. */
    readonly commands: CommandStack;
    /** rAF batcher for diff-rendering. */
    readonly render: RenderLoop;

    private readonly subscriptions: Array<() => void> = [];
    private disposed = false;

    constructor(parent: Element, surface: EditorSurface, options: CanvasOptions = {}) {
        const doc = parent.ownerDocument;

        const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svg.classList.add('coolms-designer__canvas');
        svg.setAttribute('data-coolms-designer-canvas', surface);
        svg.setAttribute('xmlns', SVG_NS);
        parent.appendChild(svg);

        // Transparent background rect makes the entire SVG bounds a pointer-event
        // target. Without it, SVG only captures events on rendered content, which
        // means pan/zoom would only work after the first element lands on canvas.
        const background = doc.createElementNS(SVG_NS, 'rect') as SVGRectElement;
        background.classList.add('coolms-designer__canvas-bg');
        background.setAttribute('width', '100%');
        background.setAttribute('height', '100%');
        svg.appendChild(background);

        const group = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        group.classList.add('coolms-designer__viewport');
        svg.appendChild(group);

        this.svg = svg;
        this.background = background;
        this.viewportGroup = group;

        this.viewport = new Viewport(group, options.viewport);
        this.pointer = new PointerInput(svg, options.pointer);
        this.snap = new Snap(options.snap);
        // exactOptionalPropertyTypes: undefined cannot pass through an optional prop.
        // Spread the limit conditionally so the CommandStack default applies otherwise.
        this.commands = new CommandStack(
            options.commandStackLimit !== undefined ? { limit: options.commandStackLimit } : {},
        );
        // We invoke onRender lazily so the loop can fire without it being set --
        // tests + the DMN table surface use a no-op render.
        const onRender = options.onRender;
        this.render = new RenderLoop(() => onRender?.());

        this.wireBuiltinInteractions({
            middleClickPan: options.enableMiddleClickPan ?? true,
            wheelZoom: options.enableWheelZoom ?? true,
            wheelPan: options.enableWheelPan ?? true,
            wheelStep: Math.max(1.001, options.wheelZoomStep ?? 1.1),
        });
    }

    /** The owned SVG root. Public so surface code can attach overlays at the screen-space layer. */
    get element(): SVGSVGElement {
        return this.svg;
    }

    /** The inner `<g>` that the viewport transform applies to. Surface renderers' content lives here. */
    get group(): SVGGElement {
        return this.viewportGroup;
    }

    get isDestroyed(): boolean {
        return this.disposed;
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        // Unwind subscription closures first so no late events fire on the
        // now-disposing subsystems.
        for (const off of this.subscriptions) off();
        this.subscriptions.length = 0;
        this.pointer.dispose();
        this.viewport.dispose();
        this.commands.dispose();
        this.render.dispose();
        this.svg.remove();
    }

    /**
     * Suppress the unused-private warning for the background reference --
     * the rect needs to exist as a DOM child but the Canvas doesn't mutate
     * it after creation. Future phases may layer a grid pattern fill here.
     */
    /* istanbul ignore next -- pure getter, trivial */
    get backgroundElement(): SVGRectElement {
        return this.background;
    }

    private wireBuiltinInteractions(opts: {
        middleClickPan: boolean;
        wheelZoom: boolean;
        wheelPan: boolean;
        wheelStep: number;
    }): void {
        if (opts.middleClickPan) {
            this.subscriptions.push(
                this.pointer.on('drag', (e) => {
                    if (e.button === 1) {
                        this.viewport.panBy(e.incremental.x, e.incremental.y);
                    }
                }),
            );
        }
        if (opts.wheelZoom) {
            this.subscriptions.push(
                this.pointer.on('wheel', (e) => {
                    // polish-bundle (F-5) -- standard editor
                    // convention (Figma / Miro / draw.io / BPMN.io):
                    //  - Ctrl/Cmd + wheel = zoom (also trackpad pinch,
                    //    which browsers report as Ctrl + wheel).
                    //  - Plain wheel = pan. deltaY > 0 means the user
                    //    scrolled down, so the camera should move down
                    //    (panY decreases). deltaX honors Mac trackpad
                    //    horizontal scroll + Shift+wheel on a mouse
                    //    (the browser already converts Shift+wheel into
                    //    deltaX for us, so we don't need to special-case
                    //    the modifier here).
                    const isZoom = e.ctrlKey || e.raw.metaKey;
                    // When wheel-pan is disabled (read-only embedded diagram),
                    // let a plain wheel scroll the surrounding page — do NOT
                    // preventDefault. Ctrl/Cmd + wheel still zooms.
                    if (!isZoom && !opts.wheelPan) {
                        return;
                    }
                    e.raw.preventDefault();
                    if (isZoom) {
                        const factor = e.deltaY > 0 ? 1 / opts.wheelStep : opts.wheelStep;
                        this.viewport.zoomBy(factor, e.dom);
                    } else {
                        this.viewport.panBy(-e.raw.deltaX, -e.deltaY);
                    }
                }),
            );
        }
        // Viewport changes always trigger a render -- the inner group transform
        // updated, so any element tree under it needs a paint pass to settle.
        this.subscriptions.push(this.viewport.onChange(() => this.render.request()));
    }
}
