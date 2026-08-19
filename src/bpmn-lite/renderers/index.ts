/**
 * BPMN-Lite renderer module -- internal subpath barrel.
 *
 * Re-exported through the `@coolms/designer/bpmn-lite` subpath
 * so the Angular wrapper + custom consumers can pull in any of
 * the renderer + registry pieces without reaching for deeper paths.
 */

export {
    ElementRendererRegistry,
    UnknownElementKindError,
} from './ElementRendererRegistry.js';
export type { ElementRenderer } from './ElementRendererRegistry.js';

export {
    renderStartEvent,
    renderEndEvent,
    renderTask,
    renderExclusiveGateway,
    renderParallelGateway,
    defaultElementRendererRegistry,
} from './nodeRenderers.js';

// edge renderer + routing + arrowhead marker builder.
export {
    renderSequenceFlow,
    arrowheadMarkerId,
    buildArrowheadMarker,
} from './edgeRenderers.js';
export type { EdgeRenderer } from './edgeRenderers.js';

export { computeOrthogonalRoute, waypointsToPathD } from './routing.js';

export { SVG_NS, svgEl } from './svg.js';
