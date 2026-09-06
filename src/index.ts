/**
 * @coolms/designer -- public entry point.
 *
 * The public API surface is intentionally narrow. Consumers should import
 * from this module only; submodule paths (e.g. `@coolms/designer/canvas`)
 * are NOT part of the stability contract and may move between minor
 * versions until the package leaves alpha.
 *
 * The package is organised by responsibility:
 *
 *  - {@link createEditor} -- the single public factory; everything flows
 *    from here. Returns an {@link Editor} handle with a `destroy()` method
 *    that fully unwinds DOM, listeners, and timers.
 *  - {@link EditorOptions}, {@link EditorSurface} -- configuration types.
 *  - {@link DESIGNER_VERSION} -- semver string baked at build time so
 *    consumers can sanity-check what they loaded (handy with the IIFE
 *    bundle dropped via a CDN).
 *
 * Later releases may add element registries, model subscription
 * APIs, and serializer factories. Those exports land here
 * deliberately, NOT by default re-exporting every internal -- the
 * narrower the public surface, the cheaper future refactors stay.
 */

export { createEditor } from './shell/Editor.js';
export type { Editor, EditorOptions, EditorSurface, SurfaceChangeEvent } from './shell/Editor.js';

/**
 * Read-only rendering. `createEditor` builds the shell and stops there, so
 * drawing a diagram used to require a submodule import plus three members of
 * the {@link Editor} handle that carry an internal-API caveat -- a seam
 * published at one end only. {@link renderDiagram} is the other end: model in,
 * mounted diagram out, and {@link DiagramView.toSvg} to serialize it, using
 * nothing a consumer is told not to depend on.
 *
 * Editing is unchanged and still assembled by the host: it needs a palette, a
 * property panel and a save path, all of which differ per surface.
 */
export { renderDiagram } from './render/renderDiagram.js';
export type {
    DiagramInput,
    DiagramSurface,
    DiagramView,
    RenderDiagramOptions,
    ToSvgOptions,
} from './render/renderDiagram.js';

/**
 * Deserializers for the three drawing surfaces -- the other half of the render
 * path. {@link renderDiagram} takes a model, and a consumer holds a wire
 * format: without these, "model in" is a requirement no public API could meet,
 * and the seam would be closed at one end again one step earlier.
 *
 * The three formats are unrelated by design, because the systems they come
 * from are: a BPMN-Lite body is JSON, a state machine is a workflow config of
 * places and transitions, and a DRD is DMN 1.3 XML. There is no single
 * `parse()` to offer that would not be a lie about what those three things are.
 *
 * Serializers stay out of the public entry for now. Writing a definition back
 * belongs to an editing host, which assembles the surface itself; these are
 * exported because READING is what a viewer needs.
 */
export { bpmnLiteJsonToModel, BpmnLiteParseError } from './bpmn-lite/json/index.js';
export type { BpmnLiteModel, BpmnElement, BpmnSequenceFlow } from './bpmn-lite/types.js';

export { stateMachineConfigToModel, frameworkConfigToStateMachineModel } from './state-machine/serializer.js';
export type { StateMachineModel, SmPlace, SmTransition } from './state-machine/types.js';

export { readDrdXml, DmnDrdXmlParseError } from './dmn/drd/xml.js';
export type { DmnDrdModel, DmnDrdElement, DmnInformationRequirement } from './dmn/drd/types.js';
/**
 * Sidebar class type re-export. Surface wrappers (an embedding
 * host's BPMN page) need the Sidebar reference returned on
 * `Editor.sidebar` to mount their palette + property-panel hosts.
 * Its stability is internal-package only.
 */
export type { Sidebar } from './shell/Sidebar.js';

/**
 * XRefs registry re-export. Surface wrappers construct an XRefs
 * instance + populate it with backend-sourced data (handler
 * catalog, form definitions, deployed decisions) so the property
 * panel's `xrefScope`-bound SELECT fields render live autocomplete.
 *
 * Re-exported as a value (the class is the consumer's mint point)
 * + as a type for the {@link XRefItem} shape.
 */
export { XRefs } from './shell/XRefs.js';
export type { XRefItem } from './shell/XRefs.js';

/**
 * Translation seam. The package carries message keys and an English
 * fallback at every call site and owns no catalogue, so it speaks English
 * with zero configuration and speaks anything else the moment a host passes
 * a {@link Translator}. See `src/i18n.ts` for the two consumer shapes.
 */
export { createCatalogTranslator, defaultTranslator, interpolate } from './i18n.js';
export type { TranslationParams, Translator } from './i18n.js';

/**
 * Package semver string. Useful when shipping the IIFE bundle via a CDN
 * and a consumer needs to confirm which build they ended up loading.
 *
 * Kept as a literal here (not read from package.json at runtime) so the
 * built bundle has no JSON-import dependency.
 */
export const DESIGNER_VERSION = '0.1.0-alpha.1';
