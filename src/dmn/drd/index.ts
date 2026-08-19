/**
 * DMN DRD (Decision Requirements Diagram) editor — internal module.
 *
 * NOT re-exported from the package root: the public surface is
 * `createEditor({surface: 'dmn-drd'})`, parallel to the other three
 * surfaces. Consumers that develop against the sources import this
 * module through a build-time path mapping.
 *
 * **The DRD surface foundation:** the editor render-half +
 * the render layer + auto-layout + selection + the model shapes.
 * Palette / connect-mode / property panel / the DMN-XML serializer
 * export from here as later slices land.
 */

// Editor + lifecycle.
export { DmnDrdEditor } from './DmnDrdEditor.js';
export type { DmnDrdEditorOptions } from './DmnDrdEditor.js';

// Auto-layout (topological, cycle-aware).
export { autoLayoutDmnDrd } from './autoLayout.js';

// Selection surface (the property panel binds to this).
export { DrdSelection } from './DrdSelection.js';
export type { DrdSelectionTarget } from './DrdSelection.js';

// Slice-2 property-panel editing surface (commands + schema + panel).
export { DrdSchemaProvider } from './DrdSchemaProvider.js';
export { DmnDrdPropertyPanel } from './DmnDrdPropertyPanel.js';
export type { DmnDrdPropertyPanelOptions } from './DmnDrdPropertyPanel.js';
export {
    UpdateElementPropertyCommand,
    UpdateRequirementPropertyCommand,
    UpdateDiagramPropertyCommand,
} from './commands.js';
export type {
    EditableElementPropertyKey,
    EditableRequirementPropertyKey,
    EditableDiagramPropertyKey,
} from './commands.js';

// Slice-3 structural editing commands (palette / connect / drag / delete).
export {
    AddElementCommand,
    RemoveElementCommand,
    MoveElementCommand,
    AddRequirementCommand,
    RemoveRequirementCommand,
} from './commands.js';

// Slice-4 DMN 1.3 DRD XML round-trip serializer (round-trips with the backend on deploy).
export { writeDrdXml, readDrdXml, DmnDrdXmlParseError } from './xml.js';

// Model shapes.
export {
    emptyDmnDrdModel,
    defaultSizeForKind,
    DEFAULT_DECISION_SIZE,
    DEFAULT_INPUT_DATA_SIZE,
} from './types.js';
export type {
    DmnDrdModel,
    DmnDrdElement,
    DmnDrdElementKind,
    DmnInformationRequirement,
    DmnDrdPosition,
    DmnDrdSize,
} from './types.js';

// Render surface.
export { renderElement, rendererForKind } from './renderers/ElementRendererRegistry.js';
export { renderDecision, renderInputData } from './renderers/nodeRenderers.js';
export type { NodeRenderer } from './renderers/nodeRenderers.js';
export {
    renderRequirement,
    drdArrowheadMarkerId,
    buildDrdArrowheadMarker,
} from './renderers/edgeRenderers.js';
export type { RequirementRenderer } from './renderers/edgeRenderers.js';
export {
    elementCenter,
    borderPointToward,
    requirementSegment,
} from './renderers/geometry.js';
export type { RequirementSegment } from './renderers/geometry.js';
export { SVG_NS } from './renderers/svg.js';
