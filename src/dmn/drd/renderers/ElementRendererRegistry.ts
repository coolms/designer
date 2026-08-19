import type { DmnDrdElement, DmnDrdElementKind } from '../types.js';
import { renderDecision, renderInputData } from './nodeRenderers.js';
import type { NodeRenderer } from './nodeRenderers.js';

/**
 * M4.j DRD element-renderer registry — maps a node {@link
 * DmnDrdElementKind} to its pure renderer. The editor dispatches every
 * node through {@link renderElement} rather than branching inline, so
 * widening the DRD to `businessKnowledgeModel` / `knowledgeSource` later
 * is a one-line registry entry + one new renderer, not an editor edit.
 *
 * Mirrors the bpmn-lite element-renderer dispatch. A node carrying an
 * unrecognised kind (a malformed runtime model) falls back to the
 * Decision renderer so the diagram never silently drops a box.
 */
const REGISTRY: Readonly<Record<DmnDrdElementKind, NodeRenderer>> = {
    decision: renderDecision,
    inputData: renderInputData,
};

/** Render a single node via its kind's renderer (Decision fallback for unknown kinds). */
export function renderElement(el: DmnDrdElement, doc: Document): SVGGElement {
    const renderer: NodeRenderer | undefined = REGISTRY[el.kind];
    return (renderer ?? renderDecision)(el, doc);
}

/** The renderer registered for a kind (Decision fallback for unknown kinds). */
export function rendererForKind(kind: DmnDrdElementKind): NodeRenderer {
    const renderer: NodeRenderer | undefined = REGISTRY[kind];
    return renderer ?? renderDecision;
}
