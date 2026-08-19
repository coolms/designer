/**
 * SVG namespace constant + microscopic helpers used by the
 * node renderers.
 *
 * The renderers always use `createElementNS(SVG_NS, ...)` rather than
 * `createElement(...)`: even though browsers + jsdom accept both for
 * the SVG-named tags, only the namespaced form produces an actual
 * `SVGElement` interface. `createElement('rect')` returns an
 * `HTMLUnknownElement` which has no SVG geometry APIs -- a subtle
 * mistake that costs hours when downstream code calls `getBBox()`
 * on the result. The helpers below preserve the namespace.
 */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element via the SVG namespace + apply the given
 * string attributes. Numeric inputs are stringified at the call
 * site (we don't infer because SVG attribute formatting is
 * context-dependent -- e.g. `transform="translate(x,y)"` strings
 * are space-tolerant but path `d` strings prefer compact form).
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
