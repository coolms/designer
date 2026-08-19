/**
 * BPMN-Lite JSON round-trip serializer module.
 *
 * Public surface:
 *  - {@link bpmnLiteModelToJson} -- editor model → wire-format JSON
 *    string
 *  - {@link bpmnLiteModelToWire} -- editor model → wire-format
 *    JS-object (test affordance + future direct-fetch consumers)
 *  - {@link bpmnLiteJsonToModel} -- wire-format JSON string → editor
 *    model
 *  - {@link bpmnLiteWireToModel} -- pre-parsed wire object → editor
 *    model (used internally by `bpmnLiteJsonToModel` after JSON.parse;
 *    exposed so M3.3.h+ consumers that already have the parsed
 *    object don't re-parse)
 *  - {@link BpmnLiteParseError} -- thrown by `bpmnLiteJsonToModel`
 *    on shape errors that prevent mounting
 *
 * See `toJson.ts` for the wire-format reference + the three
 * boundary translations.
 */
export {
    bpmnLiteModelToJson,
    bpmnLiteModelToWire,
} from './toJson.js';
export type { ToJsonOptions } from './toJson.js';
export {
    bpmnLiteJsonToModel,
    bpmnLiteWireToModel,
    BpmnLiteParseError,
} from './fromJson.js';
/**
 * auto-layout fallback. Exposed so tests + custom
 * consumers can invoke it directly on a model that came in
 * without a diagram. Called automatically by `bpmnLiteWireToModel`
 * during parse, so the typical M3.3.h.2 page path doesn't need to
 * touch it.
 */
export { autoLayoutBpmnLite } from './autoLayout.js';
