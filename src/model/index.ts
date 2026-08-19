/**
 * Model module -- the generic graph layer (Element + Graph + change
 * events). Surface-specific renderers (BPMN-Lite in M3.3, DMN DRD in
 * M4, State Machine in M3.5) build on this. The DMN table editor
 * uses a different shape and lives in its own module.
 *
 * Public package surface: nothing here is re-exported from
 * `@coolms/designer` (the root `src/index.ts`). External consumers
 * interact via {@link Editor} only.
 */

export { Graph, GraphInvariantError } from './Graph.js';
export type {
    Bounds,
    EdgeElement,
    Element,
    ElementKind,
    ElementPatch,
    NodeElement,
    Position,
    Size,
} from './Element.js';
export type { ChangeEvent, ChangeRecord } from './ChangeRecord.js';
