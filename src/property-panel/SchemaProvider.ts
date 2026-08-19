import type { Element } from '../model/index.js';
import type { FieldDescriptor } from './FieldDescriptor.js';

/**
 * Per-surface schema source. Implementers return an ordered list of
 * field descriptors for a given element, or `null` when the element
 * type has no editable properties (the {@link PropertyPanel} renders
 * an empty panel in that case).
 *
 * Surfaces typically dispatch on `element.type`:
 *
 *   class BpmnLiteSchemaProvider implements SchemaProvider {
 *       getSchema(element: Element): readonly FieldDescriptor[] | null {
 *           switch (element.type) {
 *               case 'userTask':       return USER_TASK_SCHEMA;
 *               case 'serviceTask':    return SERVICE_TASK_SCHEMA;
 *               case 'sequenceFlow':   return SEQUENCE_FLOW_SCHEMA;
 *               default:               return null;
 *           }
 *       }
 *   }
 *
 * Schemas can be static (module-level constants) or computed per
 * element (e.g. an XOR gateway's schema might depend on the number
 * of outgoing flows).
 */
export interface SchemaProvider {
    /**
     * Return the field schema for `element`, or `null` to suppress
     * the property panel for this element. Implementations should
     * NOT throw -- unknown types should return `null` rather than
     * surfacing as errors at panel-mount time.
     */
    getSchema(element: Element): ReadonlyArray<FieldDescriptor> | null;
}
