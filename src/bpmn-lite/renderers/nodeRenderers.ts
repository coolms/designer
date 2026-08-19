import { paletteItemLabel } from '../defaults.js';
import type { BpmnElement } from '../types.js';
import {
    ElementRendererRegistry,
    type ElementRenderer,
} from './ElementRendererRegistry.js';
import { SVG_NS, svgEl } from './svg.js';

/**
 * SVG node renderers for the 5 core BPMN-Lite element kinds:
 * Start Event (circle), End Event (thick circle), Task (rounded
 * rectangle), Exclusive Gateway (diamond with X marker), Parallel
 * Gateway (diamond with + marker).
 *
 * **Geometry conventions** (matching BPMN modeler convention):
 *  - `position` is the top-left of the element's bounding box
 *  - `size` is the bounding-box width × height
 *  - Events are positioned in a 36×36 bbox by default (BPMN spec
 *    "small icon" sizing); tasks use 100×80; gateways use 50×50.
 *    Defaults aren't enforced here -- the model carries explicit
 *    sizes + the renderers paint whatever's in the element. The
 *    palette will set conventional defaults at create time.
 *
 * **Label placement**:
 *  - Events + gateways: label sits BELOW the shape (BPMN convention)
 *  - Tasks: label sits INSIDE the shape, centered (BPMN convention)
 *  - Empty / undefined labels: no `<text>` element appended
 *
 * **Why no per-variant fields yet** (timer / message events,
 * user / service tasks, sub-processes): these renderers ship the
 * geometry + generic shapes. Variant decorations (clock icon for
 * timer events, envelope for message events, user-stick-figure for
 * user tasks) land when the property panel surfaces the variant
 * picker. The shape underneath stays the same; renderers grow to
 * read the variant tag + paint the inner decoration.
 *
 * **Why no event handlers wired here**: the renderers are
 * paint-only. Click, hover and drag-to-move belong to the palette
 * and connect mode. The renderers DO add the CSS classes those
 * controllers hook listeners onto, so the wiring stays localised.
 */

/**
 * Label metrics. These MUST track `.coolms-designer__bpmn-label` in
 * `coolms-designer.css` (`font: 500 12px/1.2 system-ui`).
 *
 * **Why an estimated glyph width instead of measuring**:
 * `getComputedTextLength()` needs a laid-out SVG, so it returns 0 under
 * jsdom — wrapping would then behave differently in tests than in the
 * browser, which is precisely the class of bug this epic kept hitting.
 * A fixed average keeps wrapping deterministic and unit-testable; being
 * a glyph or two out just shifts a break point.
 */
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = LABEL_FONT_SIZE * 1.2;
/** ≈0.54em — measured average for this UI font at 500 weight. */
const LABEL_CHAR_WIDTH = 6.5;
/** Breathing room so glyphs never touch the shape's stroke. */
const LABEL_PADDING = 6;

/**
 * Greedy word-wrap to a character budget, hard-breaking any single word
 * that cannot fit (a long id like `order_total_threshold` would
 * otherwise overflow on its own).
 */
function wrapLabel(label: string, maxChars: number): string[] {
    if (maxChars < 1) return [label];
    const lines: string[] = [];
    let current = '';

    for (const word of label.split(/\s+/).filter((w) => w !== '')) {
        const candidate = current === '' ? word : `${current} ${word}`;
        if (candidate.length <= maxChars) {
            current = candidate;
            continue;
        }
        if (current !== '') {
            lines.push(current);
            current = '';
        }
        // The word alone is still too wide -- chop it.
        let rest = word;
        while (rest.length > maxChars) {
            lines.push(rest.slice(0, maxChars));
            rest = rest.slice(maxChars);
        }
        current = rest;
    }
    if (current !== '') lines.push(current);

    return lines.length > 0 ? lines : [label];
}

/**
 * Mount a label if the model element carries one, WRAPPED to the shape.
 *
 * Labels used to be a single `<text>` run, so anything longer than the
 * box spilled out both sides ("Apply triage decision" on a 100-wide
 * task). SVG has no auto-wrap, so the lines are computed here and
 * emitted as `<tspan>`s.
 *
 * `inside` (tasks) wraps to the element's own width — the label must
 * stay within the box. `below` (events / gateways) wraps to a generous
 * floor instead, because a 36 px event legitimately carries a wider
 * caption underneath it; clamping those to 36 px would stack every
 * label one word per line.
 */
function appendLabel(
    g: SVGGElement,
    doc: Document,
    element: BpmnElement,
    placement: 'below' | 'inside' | 'topLeft',
): void {
    if (element.label === undefined || element.label === '') return;
    // `topLeft` (subprocess containers) anchors at the padding inset
    // instead of the centre so the caption never overlaps the children
    // painted inside the scope.
    const cx =
        placement === 'topLeft' ? LABEL_PADDING : element.size.width / 2;

    const available =
        placement === 'below'
            ? Math.max(element.size.width, 96)
            : element.size.width - LABEL_PADDING * 2;
    let lines = wrapLabel(
        element.label,
        Math.floor(available / LABEL_CHAR_WIDTH),
    );

    if (placement === 'inside') {
        // Never spill vertically either: cap the line count to what the
        // box can hold and mark the truncation so the author can see the
        // label is longer than what is shown (the full text is always on
        // the hover <title>).
        const maxLines = Math.max(
            1,
            Math.floor(
                (element.size.height - LABEL_PADDING * 2) / LABEL_LINE_HEIGHT,
            ),
        );
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            const last = lines.length - 1;
            lines[last] = `${lines[last]!.replace(/\s+\S*$/, '')}…`;
        }
    }

    let y: number;
    if (placement === 'below') {
        y = element.size.height + 14;
    } else if (placement === 'topLeft') {
        y = LABEL_PADDING;
    } else {
        y = element.size.height / 2;
    }

    const text = svgEl(doc, 'text', {
        x: String(cx),
        y: String(y),
        'text-anchor': placement === 'topLeft' ? 'start' : 'middle',
        // A wrapped block is positioned by its FIRST line, so the
        // per-line `dy` below does the centring; `middle` on a
        // multi-line run would centre only the first line.
        'dominant-baseline': placement === 'inside' ? 'middle' : 'hanging',
    });
    text.classList.add('coolms-designer__bpmn-label');

    lines.forEach((line, i) => {
        const tspan = svgEl(doc, 'tspan', { x: String(cx) });
        if (i === 0) {
            // Lift the block so it is vertically centred on `y`.
            tspan.setAttribute(
                'dy',
                String(
                    placement === 'inside'
                        ? (-(lines.length - 1) * LABEL_LINE_HEIGHT) / 2
                        : 0,
                ),
            );
        } else {
            tspan.setAttribute('dy', String(LABEL_LINE_HEIGHT));
        }
        tspan.textContent = line;
        text.appendChild(tspan);
    });

    g.appendChild(text);
}

/**
 * Human-readable hover title for an element: its label when it has one,
 * otherwise a humanised element kind (`startEvent` -> `Start Event`). Used
 * for the SVG `<title>` (native browser tooltip) + `aria-label` so EVERY
 * element -- including unlabeled events/gateways, whose on-canvas `<text>`
 * label is empty by default -- shows a title on mouse-over.
 */
export function elementHoverTitle(element: BpmnElement): string {
    if (element.label !== undefined && element.label !== '') {
        return element.label;
    }
    // A typed event reads by its subtype ("Timer Event"), not its kind --
    // "Intermediate Catch Event" is the structural name and tells the
    // author nothing about which of the four they are looking at.
    if (element.subtype !== undefined) {
        return paletteItemLabel(element.type, element.subtype);
    }
    // `startEvent` -> `Start Event`, `exclusiveGateway` -> `Exclusive Gateway`.
    const humanised = element.type
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase());
    return humanised;
}

/**
 * Build the outer `<g>` wrapper that every renderer returns -- carries
 * the position transform + the element id data attribute + the
 * shape-specific CSS class. The renderer-specific code only adds the
 * shape primitives (circle / rect / polygon) + the label.
 *
 * The wrapper's FIRST child is an SVG `<title>` (browsers show the first
 * `<title>` child as a native tooltip on hover); the same text is mirrored
 * onto `aria-label` for assistive tech. Because it lives on the `<g>` (not
 * the `pointer-events: none` label `<text>`), hover works over the whole
 * element -- not just where a visible label happens to be painted.
 */
function makeWrapper(
    doc: Document,
    element: BpmnElement,
    extraClass: string,
): SVGGElement {
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.classList.add('coolms-designer__bpmn-element', extraClass);
    g.setAttribute('data-element-id', element.id);
    g.setAttribute('data-element-kind', element.type);
    g.setAttribute(
        'transform',
        `translate(${element.position.x}, ${element.position.y})`,
    );

    const title = elementHoverTitle(element);
    const titleEl = doc.createElementNS(SVG_NS, 'title');
    titleEl.textContent = title;
    g.appendChild(titleEl);
    g.setAttribute('aria-label', title);

    return g;
}

/** Start Event -- thin-stroked circle. */
export const renderStartEvent: ElementRenderer = (element, doc) => {
    const g = makeWrapper(doc, element, 'coolms-designer__bpmn-start-event');
    const cx = element.size.width / 2;
    const cy = element.size.height / 2;
    const r = Math.min(element.size.width, element.size.height) / 2;
    g.appendChild(
        svgEl(doc, 'circle', { cx: String(cx), cy: String(cy), r: String(r) }),
    );
    appendLabel(g, doc, element, 'below');
    return g;
};

/** End Event -- thick-stroked circle (BPMN convention). */
export const renderEndEvent: ElementRenderer = (element, doc) => {
    const g = makeWrapper(doc, element, 'coolms-designer__bpmn-end-event');
    const cx = element.size.width / 2;
    const cy = element.size.height / 2;
    const r = Math.min(element.size.width, element.size.height) / 2;
    g.appendChild(
        svgEl(doc, 'circle', { cx: String(cx), cy: String(cy), r: String(r) }),
    );
    appendLabel(g, doc, element, 'below');
    return g;
};

/** Task -- rounded rectangle (BPMN convention, ~6 px corner radius). */
export const renderTask: ElementRenderer = (element, doc) => {
    const g = makeWrapper(doc, element, 'coolms-designer__bpmn-task');
    g.appendChild(
        svgEl(doc, 'rect', {
            x: '0',
            y: '0',
            width: String(element.size.width),
            height: String(element.size.height),
            rx: '6',
            ry: '6',
        }),
    );
    appendLabel(g, doc, element, 'inside');
    return g;
};

/**
 * Embedded subprocess -- an EXPANDED container: a rounded rect whose
 * body is empty because the children paint on top of it as ordinary
 * elements (see `BpmnLiteEditor.paintElementsGroup`, which paints
 * containers first).
 *
 * **No `⊞` marker.** In BPMN that marker means COLLAPSED, and this
 * canvas always shows the scope's contents; drawing it would tell the
 * author the opposite of what they are looking at. What distinguishes
 * the shape instead is the thin double-stroke border and the top-left
 * label, both of which stay out of the area the children occupy.
 *
 * **The label is top-left, not centred.** A centred label would sit
 * underneath whatever the author drops in the middle of the scope —
 * which is exactly where a start event lands.
 */
export const renderSubProcess: ElementRenderer = (element, doc) => {
    const g = makeWrapper(doc, element, 'coolms-designer__bpmn-subprocess');
    g.appendChild(
        svgEl(doc, 'rect', {
            x: '0',
            y: '0',
            width: String(element.size.width),
            height: String(element.size.height),
            rx: '8',
            ry: '8',
        }),
    );
    appendLabel(g, doc, element, 'topLeft');
    return g;
};

/**
 * Call activity -- a task-shaped box with the BPMN THICK border, which
 * is the spec's marker for "this activity is another process".
 *
 * Task-sized rather than container-sized on purpose: unlike a
 * subprocess, the called definition's body lives in a DIFFERENT
 * diagram, so there is nothing to draw inside and a big empty box would
 * invite the author to drop elements into a scope that does not exist
 * here.
 */
export const renderCallActivity: ElementRenderer = (element, doc) => {
    const g = makeWrapper(doc, element, 'coolms-designer__bpmn-call-activity');
    g.appendChild(
        svgEl(doc, 'rect', {
            x: '0',
            y: '0',
            width: String(element.size.width),
            height: String(element.size.height),
            rx: '6',
            ry: '6',
        }),
    );
    appendLabel(g, doc, element, 'inside');
    return g;
};

/** Exclusive Gateway -- diamond with an X marker (BPMN convention). */
export const renderExclusiveGateway: ElementRenderer = (element, doc) => {
    const g = makeWrapper(
        doc,
        element,
        'coolms-designer__bpmn-exclusive-gateway',
    );
    const w = element.size.width;
    const h = element.size.height;
    g.appendChild(
        svgEl(doc, 'polygon', {
            points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
        }),
    );
    // The X marker -- two crossing lines, ~1/3 of the bbox.
    const cx = w / 2;
    const cy = h / 2;
    const mr = Math.min(w, h) / 6;
    const marker = svgEl(doc, 'path', {
        d: `M ${cx - mr} ${cy - mr} L ${cx + mr} ${cy + mr} M ${cx + mr} ${cy - mr} L ${cx - mr} ${cy + mr}`,
    });
    marker.classList.add('coolms-designer__bpmn-gateway-marker');
    g.appendChild(marker);
    appendLabel(g, doc, element, 'below');
    return g;
};

/** Parallel Gateway -- diamond with a + marker (BPMN convention). */
export const renderParallelGateway: ElementRenderer = (element, doc) => {
    const g = makeWrapper(
        doc,
        element,
        'coolms-designer__bpmn-parallel-gateway',
    );
    const w = element.size.width;
    const h = element.size.height;
    g.appendChild(
        svgEl(doc, 'polygon', {
            points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
        }),
    );
    const cx = w / 2;
    const cy = h / 2;
    const mr = Math.min(w, h) / 5;
    const marker = svgEl(doc, 'path', {
        d: `M ${cx - mr} ${cy} L ${cx + mr} ${cy} M ${cx} ${cy - mr} L ${cx} ${cy + mr}`,
    });
    marker.classList.add('coolms-designer__bpmn-gateway-marker');
    g.appendChild(marker);
    appendLabel(g, doc, element, 'below');
    return g;
};

/**
 * Inclusive (OR) Gateway -- diamond with a bold ring marker.
 *
 * Engine semantics worth knowing when reading the canvas: the split
 * forks one token per TRUTHY branch, and the join syncs only the
 * branches that were actually ACTIVATED (its expected count is the
 * number of forked children, not the number of incoming flows).
 */
export const renderInclusiveGateway: ElementRenderer = (element, doc) => {
    const g = makeWrapper(
        doc,
        element,
        'coolms-designer__bpmn-inclusive-gateway',
    );
    const w = element.size.width;
    const h = element.size.height;
    g.appendChild(
        svgEl(doc, 'polygon', {
            points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
        }),
    );
    const marker = svgEl(doc, 'circle', {
        cx: String(w / 2),
        cy: String(h / 2),
        r: String(Math.min(w, h) / 5),
    });
    marker.classList.add('coolms-designer__bpmn-gateway-marker');
    g.appendChild(marker);
    appendLabel(g, doc, element, 'below');
    return g;
};

/**
 * Event-Based Gateway -- diamond with a double ring + pentagon.
 *
 * A race gate: each outgoing branch MUST target an intermediate catch
 * event (timer / message / signal per `EventGatewayTargetsRule`), and
 * the first to fire cancels its siblings.
 */
export const renderEventBasedGateway: ElementRenderer = (element, doc) => {
    const g = makeWrapper(
        doc,
        element,
        'coolms-designer__bpmn-event-based-gateway',
    );
    const w = element.size.width;
    const h = element.size.height;
    g.appendChild(
        svgEl(doc, 'polygon', {
            points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
        }),
    );
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 4;
    for (const ringR of [r, r * 0.75]) {
        const ring = svgEl(doc, 'circle', {
            cx: String(cx),
            cy: String(cy),
            r: String(ringR),
        });
        ring.classList.add('coolms-designer__bpmn-gateway-marker');
        g.appendChild(ring);
    }
    // Regular pentagon inscribed in the inner ring.
    const pr = r * 0.5;
    const pts: string[] = [];
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        pts.push(`${cx + pr * Math.cos(a)},${cy + pr * Math.sin(a)}`);
    }
    const pentagon = svgEl(doc, 'polygon', { points: pts.join(' ') });
    pentagon.classList.add('coolms-designer__bpmn-gateway-marker');
    g.appendChild(pentagon);
    appendLabel(g, doc, element, 'below');
    return g;
};

/**
 * Paint the inner marker that types an event, scaled to the element's
 * bbox + centred. Mirrors the palette tile's glyph vocabulary
 * (`eventGlyphSvg` in `Palette.ts`) so the tile, the drag ghost + the
 * painted node all read the same: clock = timer, envelope = message,
 * triangle = signal, lined page = conditional.
 *
 * Coordinates are expressed as fractions of the 36×36 default event box
 * then scaled, so a resized event keeps its marker proportional.
 * Returns nothing for an untyped event -- a bare double ring is the
 * BPMN 2.0 untyped intermediate event, not an error state.
 */
function appendEventMarker(
    g: SVGGElement,
    doc: Document,
    element: BpmnElement,
): void {
    const subtype = element.subtype;
    if (subtype === undefined) return;

    const w = element.size.width;
    const h = element.size.height;
    const cx = w / 2;
    const cy = h / 2;
    // Marker half-extent: the inner ring is at 0.39·min, so 0.22 keeps
    // the glyph clear of it at every size.
    const m = Math.min(w, h) * 0.22;

    const marker = ((): SVGElement => {
        switch (subtype) {
            case 'timer':
                // Clock: face circle + hour/minute hands.
                return svgEl(doc, 'path', {
                    d:
                        `M ${cx} ${cy - m} A ${m} ${m} 0 1 1 ${cx - 0.01} ${cy - m} Z ` +
                        `M ${cx} ${cy - m * 0.6} L ${cx} ${cy} L ${cx + m * 0.5} ${cy + m * 0.3}`,
                });
            case 'message':
                // Envelope: body rect + flap polyline.
                return svgEl(doc, 'path', {
                    d:
                        `M ${cx - m} ${cy - m * 0.7} L ${cx + m} ${cy - m * 0.7} ` +
                        `L ${cx + m} ${cy + m * 0.7} L ${cx - m} ${cy + m * 0.7} Z ` +
                        `M ${cx - m} ${cy - m * 0.7} L ${cx} ${cy + m * 0.05} L ${cx + m} ${cy - m * 0.7}`,
                });
            case 'signal':
                // Upward triangle.
                return svgEl(doc, 'path', {
                    d: `M ${cx} ${cy - m} L ${cx + m} ${cy + m * 0.75} L ${cx - m} ${cy + m * 0.75} Z`,
                });
            case 'condition':
                // Lined page.
                return svgEl(doc, 'path', {
                    d:
                        `M ${cx - m * 0.8} ${cy - m} L ${cx + m * 0.8} ${cy - m} ` +
                        `L ${cx + m * 0.8} ${cy + m} L ${cx - m * 0.8} ${cy + m} Z ` +
                        `M ${cx - m * 0.45} ${cy - m * 0.4} L ${cx + m * 0.45} ${cy - m * 0.4} ` +
                        `M ${cx - m * 0.45} ${cy} L ${cx + m * 0.45} ${cy} ` +
                        `M ${cx - m * 0.45} ${cy + m * 0.4} L ${cx + m * 0.45} ${cy + m * 0.4}`,
                });
            case 'error':
                // Lightning bolt (BPMN error marker).
                return svgEl(doc, 'path', {
                    d:
                        `M ${cx - m * 0.8} ${cy + m} L ${cx - m * 0.1} ${cy - m * 0.15} ` +
                        `L ${cx + m * 0.15} ${cy + m * 0.25} L ${cx + m * 0.8} ${cy - m}`,
                });
            case 'compensation':
                // Rewind: two left-pointing triangles (BPMN compensation).
                return svgEl(doc, 'path', {
                    d:
                        `M ${cx - m * 0.05} ${cy - m * 0.75} L ${cx - m * 0.05} ${cy + m * 0.75} ` +
                        `L ${cx - m * 0.95} ${cy} Z ` +
                        `M ${cx + m * 0.9} ${cy - m * 0.75} L ${cx + m * 0.9} ${cy + m * 0.75} ` +
                        `L ${cx} ${cy} Z`,
                });
        }
    })();

    marker.classList.add('coolms-designer__bpmn-event-marker');
    marker.setAttribute('data-event-marker', subtype);
    g.appendChild(marker);
}

/**
 * Intermediate Catch Event -- DOUBLE ring + a subtype marker.
 *
 * The double ring is the BPMN 2.0 "intermediate" band: a start event is
 * one thin ring, an end event one thick ring, an intermediate event two
 * thin rings. The inner ring sits at 0.78·r so the band reads clearly
 * at the default 36×36 without the two circles merging.
 */
export const renderIntermediateCatchEvent: ElementRenderer = (element, doc) =>
    renderDoubleRingEvent(
        element,
        doc,
        'coolms-designer__bpmn-intermediate-catch-event',
    );

/**
 * Boundary Event -- the same double ring + marker, DASHED when the
 * event is non-interrupting.
 *
 * BPMN 2.0 distinguishes the two purely by line style: a solid double
 * ring cancels its host when it fires, a dashed one lets the host keep
 * running. That is the single most consequential property of a boundary
 * event, so it has to be readable at a glance rather than hidden in the
 * property panel. `interrupting` absent means interrupting (the
 * parser's default), so only an explicit `false` dashes.
 *
 * Docking (which host, and where on its border) is geometry the EDITOR
 * owns -- see `dockPositionOnHost`; by paint time the boundary already
 * carries an absolute position like any other element.
 */
export const renderBoundaryEvent: ElementRenderer = (element, doc) =>
    renderDoubleRingEvent(
        element,
        doc,
        'coolms-designer__bpmn-boundary-event',
        element.interrupting === false,
    );

/** Shared double-ring event body used by the catch + boundary families. */
function renderDoubleRingEvent(
    element: BpmnElement,
    doc: Document,
    extraClass: string,
    dashed = false,
): SVGGElement {
    const g = makeWrapper(doc, element, extraClass);
    if (element.subtype !== undefined) {
        // Lets consumer CSS theme per subtype + gives tests a stable hook.
        g.setAttribute('data-element-subtype', element.subtype);
    }
    if (dashed) {
        g.classList.add('coolms-designer__bpmn-event--non-interrupting');
        g.setAttribute('data-non-interrupting', 'true');
    }
    const cx = element.size.width / 2;
    const cy = element.size.height / 2;
    const r = Math.min(element.size.width, element.size.height) / 2;
    // Both rings carry an explicit class: the outer one is filled (it's the
    // element's body + hit area), the inner one is stroke-only so the pair
    // reads as the BPMN "intermediate" band. Without these the stylesheet
    // would have to lean on `circle:nth-of-type`, which silently breaks the
    // moment a renderer appends another circle.
    const outer = svgEl(doc, 'circle', {
        cx: String(cx),
        cy: String(cy),
        r: String(r),
    });
    outer.classList.add('coolms-designer__bpmn-event-ring-outer');
    g.appendChild(outer);
    const inner = svgEl(doc, 'circle', {
        cx: String(cx),
        cy: String(cy),
        r: String(r * 0.78),
    });
    inner.classList.add('coolms-designer__bpmn-event-ring-inner');
    g.appendChild(inner);
    appendEventMarker(g, doc, element);
    appendLabel(g, doc, element, 'below');
    return g;
}

/**
 * Build a registry pre-populated with the defaults + the typed
 * intermediate catch event. Consumers that need a different renderer
 * (e.g. swap `task` for a multi-progress-bar variant) call
 * `.register('task', customRenderer)` on the result.
 *
 * Each call returns a fresh registry so two consumers can't
 * accidentally share state by reaching for `defaultRegistry`.
 */
export function defaultElementRendererRegistry(): ElementRendererRegistry {
    return new ElementRendererRegistry()
        .register('startEvent', renderStartEvent)
        .register('endEvent', renderEndEvent)
        .register('task', renderTask)
        .register('exclusiveGateway', renderExclusiveGateway)
        .register('parallelGateway', renderParallelGateway)
        .register('inclusiveGateway', renderInclusiveGateway)
        .register('eventBasedGateway', renderEventBasedGateway)
        .register('intermediateCatchEvent', renderIntermediateCatchEvent)
        .register('boundaryEvent', renderBoundaryEvent)
        .register('subProcess', renderSubProcess)
        .register('callActivity', renderCallActivity);
}
