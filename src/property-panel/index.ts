/**
 * Property-panel module -- the framework + 5 built-in field types
 * the surface renderers (BPMN-Lite, State Machine) compose against.
 * Not re-exported from the package root; surface code imports
 * directly from `'../property-panel/...'`.
 */

export { Selection } from './Selection.js';
export { FieldRegistry } from './FieldRegistry.js';
export { PropertyPanel, registerBuiltinFields } from './PropertyPanel.js';
export type { PropertyPanelOptions } from './PropertyPanel.js';
export type { SchemaProvider } from './SchemaProvider.js';
export type {
    FieldContext,
    FieldInstance,
    FieldRenderer,
} from './FieldRenderer.js';
export type {
    FieldDescriptor,
    FieldDescriptorBase,
    TextFieldDescriptor,
    TextareaFieldDescriptor,
    SelectFieldDescriptor,
    ElExpressionFieldDescriptor,
    BooleanFieldDescriptor,
} from './FieldDescriptor.js';

export { TextField } from './fields/TextField.js';
export { TextareaField } from './fields/TextareaField.js';
export { SelectField } from './fields/SelectField.js';
export { ElExpressionField } from './fields/ElExpressionField.js';
export { BooleanField } from './fields/BooleanField.js';
