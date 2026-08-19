/**
 * SVG namespace constant + the one micro-helper the DRD renderers
 * use. A self-contained copy of the state-machine svg helper so the
 * `dmn/drd` editor module stays decoupled from the other surfaces (each
 * editor owns its renderer layer; only the canvas/model/shell substrate
 * is shared). The renderers always use `createElementNS(SVG_NS, …)`
 * rather than `createElement` so the nodes carry the SVG namespace.
 */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element via the SVG namespace + apply the given string
 * attributes. Numeric inputs are stringified at the call site (SVG
 * attribute formatting is context-dependent).
 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
    doc: Document,
    tag: K,
    attrs?: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
    const el = doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
    if (attrs !== undefined) {
        for (const [name, value] of Object.entries(attrs)) {
            el.setAttribute(name, value);
        }
    }
    return el;
}
