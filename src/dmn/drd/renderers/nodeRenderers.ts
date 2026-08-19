import type { DmnDrdElement } from '../types.js';
import { svgEl, SVG_NS } from './svg.js';

/**
 * M4.j DRD node renderers — one pure function per {@link
 * DmnDrdElement} kind. Same contract as the place renderer: take a
 * node + the document the SVG is created in, return the root `<g>` the
 * editor appends into the elements paint group. No state; geometry +
 * name flow in via the `el` argument. Selection / hover styling lives in
 * CSS keyed off the `data-element-id` + `--{kind}` modifier classes.
 *
 * Visuals follow the DMN notation: a **Decision** is a plain rectangle
 * (sharp corners); an **InputData** is a stadium (a rectangle with
 * fully rounded ends). Both center their name; an empty name falls back
 * to the id so a freshly-added node is never a blank box.
 */
export type NodeRenderer = (el: DmnDrdElement, doc: Document) => SVGGElement;

/** The shared `<g>` wrapper every node renderer starts from. */
function baseGroup(el: DmnDrdElement, doc: Document): SVGGElement {
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.classList.add('coolms-designer__drd-element');
    g.classList.add(`coolms-designer__drd-element--${el.kind}`);
    g.setAttribute('data-element-id', el.id);
    g.setAttribute('data-element-kind', el.kind);
    g.setAttribute('transform', `translate(${el.position.x} ${el.position.y})`);
    return g;
}

/** Center the node's name (or id fallback) inside its box. */
function appendLabel(g: SVGGElement, doc: Document, el: DmnDrdElement): void {
    const { width, height } = el.size;
    const label = svgEl(doc, 'text', {
        x: `${width / 2}`,
        y: `${height / 2}`,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
    });
    label.classList.add('coolms-designer__drd-element-label');
    label.textContent = el.name.length > 0 ? el.name : el.id;
    g.appendChild(label);
}

/** Decision — a sharp-cornered rectangle. */
export const renderDecision: NodeRenderer = (el, doc) => {
    const g = baseGroup(el, doc);
    const { width, height } = el.size;
    const rect = svgEl(doc, 'rect', {
        x: '0',
        y: '0',
        width: `${width}`,
        height: `${height}`,
    });
    rect.classList.add('coolms-designer__drd-decision-box');
    g.appendChild(rect);
    appendLabel(g, doc, el);
    return g;
};

/** InputData — a stadium (rectangle with fully rounded ends). */
export const renderInputData: NodeRenderer = (el, doc) => {
    const g = baseGroup(el, doc);
    const { width, height } = el.size;
    const r = height / 2;
    const rect = svgEl(doc, 'rect', {
        x: '0',
        y: '0',
        width: `${width}`,
        height: `${height}`,
        rx: `${r}`,
        ry: `${r}`,
    });
    rect.classList.add('coolms-designer__drd-input-box');
    g.appendChild(rect);
    appendLabel(g, doc, el);
    return g;
};
