/**
 * Shell module — Editor lifecycle, Toolbar, Sidebar,
 * cross-reference lookups. Public re-exports the Editor
 * factory + lifecycle types only -- Toolbar / Sidebar / XRefs stay
 * internal to the package (surface renderers import them directly
 * from their respective modules).
 */

export { createEditor } from './Editor.js';
export type { Editor, EditorOptions, EditorSurface, SurfaceChangeEvent } from './Editor.js';

// Internal-package surface — surface renderers import these directly,
// external consumers should not.
export { Toolbar } from './Toolbar.js';
export type { ToolbarOptions, ToolbarLabels } from './Toolbar.js';
export { Sidebar } from './Sidebar.js';
export type { SidebarOptions } from './Sidebar.js';
export { XRefs } from './XRefs.js';
export type { XRefItem } from './XRefs.js';
