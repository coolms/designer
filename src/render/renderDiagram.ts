import { createEditor, type Editor } from '../shell/Editor.js';
import type { Translator } from '../i18n.js';

import { BpmnLiteEditor } from '../bpmn-lite/BpmnLiteEditor.js';
import { autoLayoutBpmnLite } from '../bpmn-lite/json/autoLayout.js';
import type { BpmnLiteModel } from '../bpmn-lite/types.js';

import { StateMachineEditor } from '../state-machine/StateMachineEditor.js';
import { autoLayoutStateMachine } from '../state-machine/autoLayout.js';
import type { StateMachineModel } from '../state-machine/types.js';

import { DmnDrdEditor } from '../dmn/drd/DmnDrdEditor.js';
import { autoLayoutDmnDrd } from '../dmn/drd/autoLayout.js';
import type { DmnDrdModel } from '../dmn/drd/types.js';

/**
 * Read-only diagram rendering -- the one public path from a model to pixels.
 *
 * !! **Why this exists.** {@link createEditor} builds the shell and nothing
 * else: it paints chrome for four surfaces it cannot draw. Rendering a diagram
 * meant constructing a surface editor by hand, which needed FOUR things this
 * package declines to stand behind -- a submodule import path the entry point
 * calls unstable, plus `body`, `commands` and `canvasGroup`, each marked
 * "Internal-package API. Not part of the npm-published stability contract."
 * A consumer following the documented public surface could not render a
 * diagram at all. The seam was published at one end only.
 *
 * !! Worse than unstable: the submodule paths are not PUBLISHED. `exports` in
 * `package.json` declares only `.`, `./global` and `./styles`, and the build
 * has a single entry point, so `dist` contains no submodule to resolve. First-
 * party consumers reach them through a source path mapping; an installed
 * consumer gets ERR_PACKAGE_PATH_NOT_EXPORTED. Anything built on those paths
 * works until it is installed rather than linked.
 *
 * So: everything a read-only render needs, behind one function, using only
 * members this package intends to keep.
 *
 * **What it does not do.** It does not edit. Editing means a palette, a
 * property panel, a command stack and a save path, all of which differ per
 * surface and per host; those pages assemble the parts themselves and are
 * unaffected by this. And it does not parse: the three surfaces have three
 * unrelated wire formats (BPMN-Lite is JSON, a state machine is a workflow
 * config of places and transitions, a DRD is DMN XML), so the caller brings
 * a model.
 *
 * `dmn-table` is deliberately absent -- a decision table is HTML, not a
 * drawing, and has no bbox, no viewport and nothing to serialize as SVG.
 * Passing it throws rather than returning a view that cannot answer.
 */

/** The surfaces that draw. `dmn-table` renders HTML and is not one of them. */
export type DiagramSurface = 'bpmn-lite' | 'dmn-drd' | 'state-machine';

/**
 * One model, discriminated by surface, so a caller cannot hand a state machine
 * to the BPMN renderer and find out at paint time.
 */
export type DiagramInput =
    | { readonly surface: 'bpmn-lite'; readonly model: BpmnLiteModel }
    | { readonly surface: 'state-machine'; readonly model: StateMachineModel }
    | { readonly surface: 'dmn-drd'; readonly model: DmnDrdModel };

export type RenderDiagramOptions = DiagramInput & {
    /** Resolves user-visible text. Defaults to the built-in English. */
    readonly t?: Translator;

    /**
     * Fraction of the canvas kept as margin when fitting. Defaults to 0.12,
     * matching the editor pages.
     */
    readonly padding?: number;
};

/** Options for {@link DiagramView.toSvg}. */
export interface ToSvgOptions {
    /**
     * Padding in DIAGRAM units added around the content box. Defaults to 12.
     * This is not the same as `padding` above, which is a fraction of the
     * on-screen canvas -- a serialized diagram has no canvas.
     */
    readonly pad?: number;
}

/**
 * A mounted, read-only diagram.
 *
 * !! `destroy()` is not optional. The view owns a shell, a surface editor, a
 * render loop and pointer listeners; a host that mounts one per opened item and
 * never unwinds degrades over a session rather than failing outright.
 */
export interface DiagramView {
    /** The surface this view was rendered for. */
    readonly surface: DiagramSurface;

    /** Content bounds in diagram units, or null when the diagram is empty. */
    contentBbox(): { left: number; top: number; right: number; bottom: number } | null;

    /**
     * Re-fit the diagram to the current canvas size. Called once on mount;
     * call it again after the host resizes.
     */
    fit(): void;

    /**
     * Serialize what was drawn: a standalone `<svg>` string with a tight
     * viewBox and no editor chrome.
     *
     * !! Serializing the live canvas instead would capture the pan/zoom
     * transform -- storing wherever somebody happened to leave the scrollbar.
     * This works on a CLONE, drops the transform, removes the background hit
     * target (chrome, not diagram), and computes the viewBox from the content
     * box, so the same model gives the same bytes regardless of the viewport.
     *
     * !! It also INLINES the resolved paint. The renderers emit classes and no
     * fill or stroke of their own, so markup taken away from
     * `coolms-designer.css` renders every shape solid black. A snapshot is
     * shown where the designer is not, so the styles are written into it.
     *
     * !! The class names it strips, and the stylesheet whose result it bakes
     * in, are this package's own internals -- which is exactly why the method
     * lives here. A consumer doing this reaches into DOM structure and a
     * cascade that no version promises to keep.
     *
     * Returns null when there is nothing drawn -- an empty diagram is not a
     * failure, but it is not a picture either.
     */
    toSvg(options?: ToSvgOptions): string | null;

    /** Unmount: DOM, listeners, timers. Safe to call twice. */
    destroy(): void;
}

/**
 * Mount `model` into `host`, read-only, laid out and fitted.
 *
 * Auto-layout is applied unconditionally and is safe to apply: all three
 * layout functions return the input unchanged when any element already carries
 * a position, so an authored diagram keeps its author's arrangement and an
 * engine-authored one -- which has no coordinates -- becomes readable instead
 * of stacking every node at the origin.
 *
 * @throws TypeError when `surface` is not one that draws.
 */
export function renderDiagram(host: HTMLElement, options: RenderDiagramOptions): DiagramView {
    const shell = createEditor(host, {
        surface: options.surface,
        readOnly: true,
        hideToolbar: true,
        hideSidebar: true,
        ...(options.t !== undefined ? { t: options.t } : {}),
    });

    const surfaceEditor = mount(shell, options);
    const padding = options.padding ?? 0.12;

    const view: DiagramView = {
        surface: options.surface,

        contentBbox: () => surfaceEditor.contentBbox(),

        fit(): void {
            const bbox = surfaceEditor.contentBbox();
            if (bbox === null) return;
            const svg = shell.canvasGroup.ownerSVGElement;
            if (svg === null) return;
            const rect = svg.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            shell.viewport.fitToContent(bbox, { width: rect.width, height: rect.height }, { padding });
        },

        toSvg(toSvgOptions?: ToSvgOptions): string | null {
            return serialize(shell, toSvgOptions?.pad ?? 12);
        },

        destroy(): void {
            try {
                surfaceEditor.dispose();
            } catch {
                // A surface that already tore itself down must not block the shell.
            }
            shell.destroy();
        },
    };

    view.fit();

    return view;
}

/** The three surface editors agree on exactly the members a view needs. */
interface MountedSurface {
    contentBbox(): { left: number; top: number; right: number; bottom: number } | null;
    dispose(): void;
}

function mount(shell: Editor, options: RenderDiagramOptions): MountedSurface {
    const wiring = {
        t: shell.t,
        host: shell.body,
        commands: shell.commands,
        svgGroup: shell.canvasGroup,
    };

    switch (options.surface) {
        case 'bpmn-lite': {
            const editor = new BpmnLiteEditor(wiring);
            const model = options.model;
            editor.load({ ...model, elements: autoLayoutBpmnLite(model.elements, model.flows) });
            return editor;
        }
        case 'state-machine': {
            const editor = new StateMachineEditor(wiring);
            const model = options.model;
            editor.load({ ...model, places: autoLayoutStateMachine(model.places, model.transitions) });
            return editor;
        }
        case 'dmn-drd': {
            const editor = new DmnDrdEditor(wiring);
            const model = options.model;
            editor.load({ ...model, elements: autoLayoutDmnDrd(model.elements, model.requirements) });
            return editor;
        }
        default: {
            // Unreachable through the typed union; reachable from JavaScript,
            // which is who the message is for. `dmn-table` lands here.
            const surface: string = String((options as { surface: unknown }).surface);
            shell.destroy();
            throw new TypeError(
                '[@coolms/designer] renderDiagram: "' + surface + '" is not a diagram surface. ' +
                'Expected one of: bpmn-lite, dmn-drd, state-machine.',
            );
        }
    }
}

/**
 * Presentational properties copied onto the serialized clone.
 *
 * !! **Without this the capture is BLACK.** Nothing the renderers emit carries
 * a fill or a stroke: every shape is a class, and `coolms-designer.css` paints
 * it. Serialized markup taken anywhere that stylesheet is not loaded -- a
 * public page, an email, a PDF -- falls back to the SVG default of `fill:
 * black` and shows a row of solid blobs. The package's own stylesheet has a
 * comment warning about exactly this for one shape; it is true of all of them.
 *
 * A snapshot has to stand on its own, so the styles that were resolved at
 * capture time are written into it.
 *
 * !! `display` and `visibility` are deliberately NOT copied. Everything inside
 * `<defs>` -- the arrowhead markers -- computes to `display: none`, and writing
 * that inline would remove every arrowhead from the drawing while the elements
 * were still present to look at in the markup.
 */
const PAINTED = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'opacity', 'color',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'letter-spacing',
    'marker-start', 'marker-mid', 'marker-end',
] as const;

/**
 * Clone the canvas, resolve its styles, strip the chrome, give it a tight
 * viewBox.
 *
 * !! `getBBox()` and `getComputedStyle()` are read from the LIVE tree, not the
 * clone: a detached SVG has neither layout nor a cascade, so the clone's box is
 * zero everywhere and its computed styles are empty.
 */
function serialize(shell: Editor, pad: number): string | null {
    const group = shell.canvasGroup;
    const svg = group.ownerSVGElement;
    if (svg === null) return null;

    const box = group.getBBox();
    if (box.width === 0 || box.height === 0) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;

    // Walked in parallel, which holds because a deep clone preserves document
    // order. Anything removed from the clone has to go AFTER this.
    const live = [svg, ...Array.from(svg.querySelectorAll('*'))];
    const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
    const view = svg.ownerDocument.defaultView;
    if (view !== null) {
        for (let i = 0; i < live.length && i < copies.length; i += 1) {
            const computed = view.getComputedStyle(live[i]!);
            const target = copies[i] as SVGElement;
            for (const property of PAINTED) {
                const value = computed.getPropertyValue(property);
                if (value !== '') target.style.setProperty(property, value);
            }
        }
    }

    // The viewport transform is where the diagram happens to be scrolled to.
    clone.querySelector('.coolms-designer__viewport')?.removeAttribute('transform');
    // The background rect is a pointer-event target, not part of the drawing.
    clone.querySelector('.coolms-designer__canvas-bg')?.remove();

    const viewBox = [
        Math.round(box.x - pad),
        Math.round(box.y - pad),
        Math.round(box.width + pad * 2),
        Math.round(box.height + pad * 2),
    ].join(' ');

    clone.setAttribute('viewBox', viewBox);
    clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // Width/height would pin the drawing to the pixel size of the canvas it was
    // captured on. Without them it scales to whatever box it is placed in.
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.setAttribute('role', 'img');

    return new XMLSerializer().serializeToString(clone);
}
