/**
 * BPMN-Lite editor -- internal module.
 *
 * NOT re-exported from the package root (`src/index.ts`): the public
 * surface is `createEditor({surface: 'bpmn-lite'})`. Consumers that
 * develop against the sources (the Angular wrapper, the visual
 * fixtures) import this module directly through a build-time path
 * mapping.
 */

// Editor + lifecycle types.
export { BpmnLiteEditor, dockPositionOnHost } from './BpmnLiteEditor.js';
export type { BpmnLiteEditorOptions } from './BpmnLiteEditor.js';

// palette + drop-to-create + command surface.
export { AddElementCommand } from './AddElementCommand.js';
export { Palette, iconSvgForKind } from './Palette.js';
export type { PaletteOptions } from './Palette.js';
export {
    PALETTE_KINDS,
    PALETTE_ITEMS,
    PALETTE_LABELS,
    EVENT_SUBTYPE_LABELS,
    defaultGeometryFor,
    defaultDirectionFor,
    gatewayCarriesDirection,
    blankEventDefinitionFor,
    paletteItemLabel,
    paletteItemKey,
} from './defaults.js';
export type { PaletteItem } from './defaults.js';

// connect mode + edge creation + waypoint reroute.
export { AddFlowCommand } from './AddFlowCommand.js';
export { UpdateFlowWaypointsCommand } from './UpdateFlowWaypointsCommand.js';
export { ConnectMode } from './ConnectMode.js';
export type { ConnectModeOptions } from './ConnectMode.js';
export { ConnectHandleController } from './ConnectHandleController.js';
export type { ConnectHandleControllerOptions } from './ConnectHandleController.js';
export { WaypointDragController } from './WaypointDragController.js';
export type { WaypointDragControllerOptions } from './WaypointDragController.js';

// polish-bundle (F-4) -- delete commands + keyboard controller
// + explicit hand-tool pan mode.
export { DeleteElementCommand } from './DeleteElementCommand.js';
export { DeleteFlowCommand } from './DeleteFlowCommand.js';
export {
    BpmnLiteKeyboardController,
    isEditableTarget,
} from './BpmnLiteKeyboardController.js';
export type { BpmnLiteKeyboardControllerOptions } from './BpmnLiteKeyboardController.js';
export { PanMode } from './PanMode.js';
export type { PanModeOptions } from './PanMode.js';

// polish-bundle (F-7.1) -- drag-to-move on existing elements.
export { MoveElementCommand } from './MoveElementCommand.js';
export { MoveElementController } from './MoveElementController.js';
export type { MoveElementControllerOptions } from './MoveElementController.js';

// selection, property panel, per-element property commands.
export { BpmnLiteSelection } from './BpmnLiteSelection.js';
export type { BpmnLiteSelectionTarget } from './BpmnLiteSelection.js';
export { BpmnLiteSelectionController } from './BpmnLiteSelectionController.js';
export type { BpmnLiteSelectionControllerOptions } from './BpmnLiteSelectionController.js';
export {
    BpmnLiteSchemaProvider,
    defaultBpmnLiteSchemaProvider,
} from './BpmnLiteSchemaProvider.js';
export type { BpmnLiteSchemaKey } from './BpmnLiteSchemaProvider.js';
export { BpmnLitePropertyPanel } from './BpmnLitePropertyPanel.js';
export type { BpmnLitePropertyPanelOptions } from './BpmnLitePropertyPanel.js';
export { UpdateElementPropertyCommand } from './UpdateElementPropertyCommand.js';
export type { EditableElementPropertyKey } from './UpdateElementPropertyCommand.js';
export { UpdateFlowPropertyCommand } from './UpdateFlowPropertyCommand.js';
export type { EditableFlowPropertyKey } from './UpdateFlowPropertyCommand.js';

// JSON round-trip serializer (toJson / fromJson) against
// the M2.c BPMN-Lite parser wire shape.
export {
    bpmnLiteModelToJson,
    bpmnLiteModelToWire,
    bpmnLiteJsonToModel,
    bpmnLiteWireToModel,
    BpmnLiteParseError,
    autoLayoutBpmnLite,
} from './json/index.js';
export type { ToJsonOptions } from './json/index.js';

// Model shapes.
export { emptyBpmnLiteModel } from './types.js';
export type {
    BpmnLiteModel,
    BpmnElement,
    BpmnElementKind,
    BpmnEventSubtype,
    BpmnGatewayDirection,
    BpmnTimerDefinition,
    BpmnMessageDefinition,
    BpmnSignalDefinition,
    BpmnConditionDefinition,
    BpmnPosition,
    BpmnSequenceFlow,
    BpmnSize,
} from './types.js';

// renderer surface.
export {
    ElementRendererRegistry,
    UnknownElementKindError,
} from './renderers/ElementRendererRegistry.js';
export type { ElementRenderer } from './renderers/ElementRendererRegistry.js';

export {
    renderStartEvent,
    renderEndEvent,
    renderTask,
    renderExclusiveGateway,
    renderParallelGateway,
    renderInclusiveGateway,
    renderEventBasedGateway,
    renderIntermediateCatchEvent,
    renderBoundaryEvent,
    renderSubProcess,
    renderCallActivity,
    defaultElementRendererRegistry,
} from './renderers/nodeRenderers.js';

// edge renderer + routing + arrowhead marker.
export {
    renderSequenceFlow,
    arrowheadMarkerId,
    buildArrowheadMarker,
} from './renderers/edgeRenderers.js';
export type { EdgeRenderer } from './renderers/edgeRenderers.js';

export {
    computeOrthogonalRoute,
    waypointsToPathD,
} from './renderers/routing.js';

export { SVG_NS } from './renderers/svg.js';
