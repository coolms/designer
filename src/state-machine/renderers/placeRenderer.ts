import type { SmPlace } from '../types.js';
import { svgEl, SVG_NS } from './svg.js';

/**
 * place (state) renderer.
 *
 * A pure function — same contract as the bpmn-lite element renderer:
 * takes a place + the document the SVG nodes are created in, returns
 * the root `<g>` the editor appends into the places paint group. No
 * state; geometry + name flow in via the `place` argument.
 *
 * Visual: a rounded rectangle with the place name centered inside.
 * The **initial** place (the one Symfony emits as `initial_marking`)
 * gets a `--initial` modifier class + a small filled entry-dot with a
 * short stub arrow on its left edge (the conventional state-diagram
 * "start" marker). Selection / hover styling lives in CSS keyed off
 * the `data-place-id` + modifier classes.
 */
export type PlaceRenderer = (place: SmPlace, doc: Document) => SVGGElement;

export const renderPlace: PlaceRenderer = (place, doc) => {
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.classList.add('coolms-designer__sm-place');
    if (place.initial === true) {
        g.classList.add('coolms-designer__sm-place--initial');
    }
    g.setAttribute('data-place-id', place.id);
    g.setAttribute(
        'transform',
        `translate(${place.position.x} ${place.position.y})`,
    );

    const { width, height } = place.size;
    const rect = svgEl(doc, 'rect', {
        x: '0',
        y: '0',
        width: `${width}`,
        height: `${height}`,
        rx: '8',
        ry: '8',
    });
    rect.classList.add('coolms-designer__sm-place-box');
    g.appendChild(rect);

    const label = svgEl(doc, 'text', {
        x: `${width / 2}`,
        y: `${height / 2}`,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
    });
    label.classList.add('coolms-designer__sm-place-label');
    label.textContent = place.id;
    g.appendChild(label);

    if (place.initial === true) {
        appendInitialMarker(g, doc, height);
    }

    return g;
};

/**
 * Paint the conventional "initial" marker: a short stub arrow entering
 * the place's left edge from a small filled dot. Positioned in the
 * place's local coordinate frame (the host `<g>` carries the translate),
 * so the dot sits a little left of `x = 0` at vertical center.
 */
function appendInitialMarker(g: SVGGElement, doc: Document, height: number): void {
    const cy = height / 2;
    const dot = svgEl(doc, 'circle', {
        cx: '-18',
        cy: `${cy}`,
        r: '4',
    });
    dot.classList.add('coolms-designer__sm-initial-dot');
    g.appendChild(dot);

    const stub = svgEl(doc, 'path', {
        d: `M -18 ${cy} L -2 ${cy}`,
    });
    stub.classList.add('coolms-designer__sm-initial-stub');
    g.appendChild(stub);
}
