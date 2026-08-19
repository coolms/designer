/**
 * State Machine Designer — internal module.
 *
 * NOT re-exported from the package root: the public surface is
 * `createEditor({surface: 'state-machine'})`, parallel to the other
 * surfaces. Consumers that develop against the sources import this
 * module through a build-time path mapping.
 *
 * Exports the editor, the render layer, the model shapes, the
 * commands, the property panel and the config serializer.
 */

// Editor + lifecycle.
export { StateMachineEditor } from './StateMachineEditor.js';
export type { StateMachineEditorOptions } from './StateMachineEditor.js';

// auto-layout (topological, cycle-aware).
export { autoLayoutStateMachine } from './autoLayout.js';

// selection + property-panel editing surface.
export { SmSelection } from './SmSelection.js';
export type { SmSelectionTarget } from './SmSelection.js';
export { SmSchemaProvider } from './SmSchemaProvider.js';
export { StateMachinePropertyPanel } from './StateMachinePropertyPanel.js';
export type { StateMachinePropertyPanelOptions } from './StateMachinePropertyPanel.js';
export {
    AddPlaceCommand,
    AddTransitionCommand,
    RenamePlaceCommand,
    SetInitialPlaceCommand,
    UpdateTransitionPropertyCommand,
    UpdateWorkflowPropertyCommand,
    RemovePlaceCommand,
    RemoveTransitionCommand,
} from './commands.js';
export type {
    EditableTransitionPropertyKey,
    EditableWorkflowPropertyKey,
} from './commands.js';

// Symfony Workflow serializer -- round-trips the framework config shape.
export {
    stateMachineModelToConfig,
    stateMachineModelToFrameworkConfig,
    stateMachineConfigToModel,
    frameworkConfigToStateMachineModel,
    stateMachineModelToYaml,
} from './serializer.js';
export type {
    StateMachineWorkflowConfig,
    FrameworkWorkflowsConfig,
    WorkflowTransitionConfig,
    WorkflowMarkingStore,
} from './serializer.js';

// Model shapes.
export { emptyStateMachineModel, DEFAULT_PLACE_SIZE } from './types.js';
export type {
    StateMachineModel,
    SmPlace,
    SmTransition,
    SmPosition,
    SmSize,
} from './types.js';

// render surface.
export { renderPlace } from './renderers/placeRenderer.js';
export type { PlaceRenderer } from './renderers/placeRenderer.js';
export {
    renderTransition,
    smArrowheadMarkerId,
    buildSmArrowheadMarker,
} from './renderers/transitionRenderer.js';
export type { TransitionRenderer } from './renderers/transitionRenderer.js';
export {
    placeCenter,
    borderPointToward,
    transitionSegment,
} from './renderers/geometry.js';
export type { TransitionSegment } from './renderers/geometry.js';
export { SVG_NS } from './renderers/svg.js';
