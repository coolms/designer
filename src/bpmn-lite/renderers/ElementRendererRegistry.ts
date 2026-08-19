import type { BpmnElement, BpmnElementKind } from '../types.js';

/**
 * The renderer signature -- a pure function that takes an element +
 * the document the SVG nodes must be created in, returns the root
 * `<g>` group element to append to the canvas viewport.
 *
 * **Why a pure function not a class**: the renderer has no state. Element id, position, size, label all flow in through
 * the `element` argument; the renderer returns fresh SVG nodes per
 * call. Stateful renderers land if/when a surface needs per-element
 * memoization (e.g. cached layout boxes for connector routing);
 * the type can grow to a {render, layout} object then without
 * breaking existing call sites.
 *
 * **Why pass `doc` explicitly instead of using `globalThis.document`**:
 * the vitest + jsdom tests run with their own document; the
 * Playwright visual fixtures run in the real browser; a framework
 * wrapper runs in the browser too. Passing `doc` keeps
 * the renderer pure + lets tests use a fresh document per case.
 */
export type ElementRenderer<E extends BpmnElement = BpmnElement> = (
    element: E,
    doc: Document,
) => SVGGElement;

/**
 * Thrown by {@link ElementRendererRegistry.resolve} when asked for
 * an element kind that nothing registered for. Surfaces as a hard
 * failure rather than a silent skip because a missing renderer
 * almost always means the model carries an element type the editor
 * was never told about -- a data-vs-code mismatch the author needs
 * to see.
 */
export class UnknownElementKindError extends Error {
    constructor(public readonly kind: string) {
        super(
            `[@coolms/designer] No renderer registered for BPMN element kind "${kind}". ` +
                `Did you forget to register a custom renderer, or is the model carrying ` +
                `an unknown type tag?`,
        );
        this.name = 'UnknownElementKindError';
    }
}

/**
 * Lookup table from {@link BpmnElementKind} → {@link ElementRenderer}.
 * Used by {@link BpmnLiteEditor} to paint each model element via the
 * appropriate shape function. The registry is lazy in the usual
 * way: it holds plain references and only instantiates if needed.
 *
 * The registry is mutable -- consumers can register custom renderers
 * (the package ships defaults, and a consumer might swap
 * the task renderer for a multi-status-bar variant). Each `register`
 * call wins; there's no priority system. Adopt one if a real use
 * case appears.
 */
export class ElementRendererRegistry {
    private readonly map = new Map<BpmnElementKind, ElementRenderer>();

    /**
     * Register a renderer for an element kind. Returns `this` so
     * registrations can chain (the default-registry factory uses
     * this).
     */
    register<K extends BpmnElementKind>(
        kind: K,
        renderer: ElementRenderer,
    ): this {
        this.map.set(kind, renderer);
        return this;
    }

    /**
     * Resolve the renderer for an element kind. Throws
     * {@link UnknownElementKindError} on a miss -- the editor
     * surfaces this as a visible mount failure rather than silently
     * dropping the element.
     */
    resolve(kind: BpmnElementKind): ElementRenderer {
        const r = this.map.get(kind);
        if (r === undefined) {
            throw new UnknownElementKindError(kind);
        }
        return r;
    }

    /** Whether a renderer is registered for `kind`. */
    has(kind: BpmnElementKind): boolean {
        return this.map.has(kind);
    }

    /** Enumerate all registered kinds (test affordance + tooling). */
    kinds(): BpmnElementKind[] {
        return Array.from(this.map.keys());
    }
}
