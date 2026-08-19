/**
 * Editor shell — the package's single public mount point.
 *
 * scope: composes the full chrome (toolbar + canvas + sidebar)
 * around the canvas substrate and graph model. The
 * placeholder banner is gone -- the toolbar replaces it as the
 * editor's visible identity signal.
 *
 * **DOM structure**:
 *
 *   <div class="coolms-designer coolms-designer--{surface}">
 *     <Toolbar/>                                                    ← top bar (save/deploy/undo/redo/zoom)
 *     <div class="coolms-designer__body">
 *       <svg class="coolms-designer__canvas">…</svg>                 ← Canvas substrate
 *       <aside class="coolms-designer__sidebar">…</aside>            ← Sidebar (palette + properties hosts)
 *     </div>
 *   </div>
 *
 * Surface-specific code (DMN table, BPMN-Lite, etc.) layers inside
 * this structure: BPMN palette items mount into
 * `toolbar.paletteHost` -- the create-tools cluster in the action bar
 * -- property fields into `sidebar.propertyHost`, and canvas content
 * into `canvas.group`. The shell stays generic.
 *
 * **Why mount-and-destroy stays the first contract**: every later phase
 * depends on this lifecycle. Visual regression tests need a
 * predictable mount. The Angular wrapper needs a stable
 * `destroy()` for component teardown. Getting this contract wrong
 * later means a churn across every editor surface.
 */

import type { CommandStack } from '../canvas/CommandStack.js';
import type { Viewport } from '../canvas/Viewport.js';
import { Canvas } from '../canvas/index.js';
import { Graph } from '../model/index.js';
import { Selection } from '../property-panel/Selection.js';
import { Sidebar } from './Sidebar.js';
import { Toolbar } from './Toolbar.js';
import { XRefs } from './XRefs.js';
import { defaultTranslator } from '../i18n.js';
import type { Translator } from '../i18n.js';

/**
 * The editor surfaces the package ships. Each surface is a distinct
 * authoring experience over the shared shell + canvas +
 * property-panel infrastructure.
 *
 * - `dmn-table` — DMN 1.3 decision-table editor.
 *   Spreadsheet-style, does NOT use the SVG canvas (tables aren't graphs).
 * - `bpmn-lite` — BPMN-Lite process editor.
 *   Full canvas surface — palette, drag-drop, orthogonal routing.
 * - `dmn-drd` — DMN Decision Requirements Diagram.
 *   Canvas surface; smaller element set than BPMN.
 * - `state-machine` — Symfony Workflow state-machine editor.
 *   Canvas surface with auto-layout (states are topologically ordered).
 *
 * Surfaces that don't exist yet still appear in the union so consumers
 * fail at compile time with a clear "not implemented yet" error from
 * the factory rather than a runtime null deref.
 */
export type EditorSurface = 'dmn-table' | 'bpmn-lite' | 'dmn-drd' | 'state-machine';

/**
 * Change event emitted whenever the underlying model mutates. The exact
 * payload shape is owned by the model layer; the kind variants are:
 *  - 'init'     — fired synchronously on mount (revision=1)
 *  - 'mutation' — fired on Graph.onChange for ordinary mutations
 *  - 'reset'    — fired when Graph.clear() runs (load a different file)
 */
export interface SurfaceChangeEvent {
    /** Monotonic counter — useful for "did anything change since X" checks. */
    readonly revision: number;
    /** Classifier matching the change semantics. */
    readonly kind: 'init' | 'mutation' | 'reset';
}

/**
 * Options for {@link createEditor}. All fields except `surface` are
 * optional; the editor mounts with sensible defaults so the simplest
 * call site stays a one-liner.
 */
export interface EditorOptions {
    /** Which surface to render. See {@link EditorSurface}. */
    readonly surface: EditorSurface;

    /**
     * Initial model payload, opaque to the shell. The model layer
     * accepts this via the consumer's own hydration step; surface
     * renderers narrow it to per-surface unions.
     */
    readonly initialModel?: unknown;

    /**
     * Whether the editor is read-only. Read-only mode hides the
     * toolbar's mutation controls (save / deploy / undo / redo) but
     * keeps zoom + pan + selection. Useful for read-only
     * instance-detail previews in a monitoring view.
     *
     * Default: `false`.
     */
    readonly readOnly?: boolean;

    /**
     * Resolves the editor's user-visible text.
     *
     * Omit it and every string is the English written at its call site,
     * which is what keeps the package usable with no configuration. Supply
     * one and the strings come from wherever you keep them -- a bundled
     * catalogue via {@link createCatalogTranslator}, or a server.
     *
     * It is handed to the chrome this factory builds AND exposed on the
     * returned handle, so surface code a host constructs itself can pass
     * the same translator on rather than inventing a second one.
     */
    readonly t?: Translator;

    /**
     * Notified on every model mutation. Cheap and synchronous — heavy
     * work (network calls, auto-save) should be debounced by the
     * consumer.
     */
    readonly onChange?: (event: SurfaceChangeEvent) => void;

    /**
     * Save handler. If provided, the toolbar renders a Save button that
     * dispatches this callback on click. Async — the button is disabled
     * + carries aria-busy while the returned promise is pending.
     *
     * Hidden in read-only mode regardless of whether this is provided.
     */
    readonly onSave?: () => void | Promise<void>;

    /**
     * Deploy handler. Same shape + read-only semantics as `onSave`.
     */
    readonly onDeploy?: () => void | Promise<void>;

    /**
     * polish-bundle (F-6) -- connect-mode toggle. If provided,
     * the action-bar Toolbar renders a Connect button next to
     * undo/redo (matching the Image Editor's mode-toggle placement).
     * The host owns the mode controller; this callback fires when
     * the button is clicked. Hidden in read-only mode regardless of
     * whether provided.
     */
    readonly onToggleConnect?: () => void;

    /**
     * polish-bundle (F-6) -- hand-tool (pan) toggle. Same
     * shape + read-only semantics as `onToggleConnect`. Surfaces
     * with built-in pan modes (BPMN-Lite) pass this; surfaces
     * without (DMN table) omit it.
     */
    readonly onToggleHand?: () => void;

    /**
     * polish-bundle (F-7.4) -- fit-to-content callback. If
     * provided, the toolbar renders a `bi-arrows-fullscreen` button
     * in the right-side viewport-controls group (between the zoom
     * cluster and the rest). The surface owns the bbox computation;
     * the shell just exposes the affordance. Surfaces that don't have
     * a meaningful "fit" semantic (rare) omit this.
     */
    readonly onFit?: () => void;

    /** Hide the toolbar entirely (rare; useful for embedded thumbnails). Default false. */
    readonly hideToolbar?: boolean;

    /** Hide the sidebar entirely (e.g. read-only previews). Default false. */
    readonly hideSidebar?: boolean;

    /** Sidebar position. Default 'right'. */
    readonly sidebarPosition?: 'left' | 'right';

    /** Initial sidebar collapse state. Default false. */
    readonly initialSidebarCollapsed?: boolean;
}

/**
 * Public handle returned by {@link createEditor}. The contract is
 * intentionally small for external consumers: mount once, optionally
 * subscribe to changes, destroy exactly once.
 *
 * `graph` and `xrefs` are exposed as **internal-package** API
 * surface. External consumers interact via the high-level lifecycle
 * + onChange callback; surface renderers shipping inside this
 * package (DMN table, BPMN-Lite) reach into these for direct
 * mutation + cross-reference plumbing. Production external code
 * should NOT depend on their stability.
 *
 * A second `destroy()` is a no-op, not an error — many framework
 * lifecycles fire teardown more than once (e.g. Angular `ngOnDestroy`
 * + hot-reload). Throwing here just creates noise.
 */
export interface Editor {
    /** The surface this editor was created for; immutable. */
    readonly surface: EditorSurface;

    /** The host element passed to the factory; immutable. */
    readonly host: HTMLElement;

    /**
     * The resolved translator -- the one passed in `options.t`, or the
     * English-fallback default. Always defined, so surface code can use it
     * without re-deriving the default and drifting from the shell.
     */
    readonly t: Translator;

    /** Monotonic revision counter — increments on every change event. */
    readonly revision: number;

    /**
     * Cross-reference registry. Surface renderers register scoped item
     * lists here (e.g. DMN editor publishes deployed decision keys);
     * property-panel autocomplete fields query them.
     *
     * **Internal-package API.** Not part of the npm-published stability
     * contract. External consumers should use the Angular wrapper's
     * higher-level cross-ref bindings instead.
     */
    readonly xrefs: XRefs;

    /**
     * Current-selection model. Surface renderers call `select(id)` on
     * canvas click; the property panel binds to the selected element's
     * properties.
     *
     * **Internal-package API** (same caveats as `xrefs`).
     */
    readonly selection: Selection;

    /**
     * Container element holding the canvas + sidebar (flex row layout).
     * Surface-specific renderers that aren't canvas-based (the DMN
     * table) mount their own DOM into this element alongside the
     * canvas and sidebar.
     *
     * **Internal-package API.**
     */
    readonly body: HTMLElement;

    /**
     * The shared {@link CommandStack} powering toolbar undo/redo +
     * surface-renderer mutations. Surface editors constructed
     * alongside this shell (the DMN table editor, the BPMN-Lite
     * element commands) MUST dispatch through this stack
     * so the toolbar's undo/redo buttons stay coherent with their
     * mutations.
     *
     * **Internal-package API** -- same stability caveat as `xrefs` /
     * `selection`. A framework wrapper passes this through to
     * {@link DmnTableEditor} unchanged.
     */
    readonly commands: CommandStack;

    /**
     * The viewport-transformed `<g>` group inside the canvas SVG --
     * the {@link Canvas.group} reference. Surface renderers that DO
     * paint to the canvas (the BPMN-Lite element renderers, the
     * state-machine editor) append their element trees here so the
     * pan/zoom transform cascades naturally; surface editors that
     * don't (the DMN table, which mounts HTML siblings to the
     * hidden canvas) ignore this reference.
     *
     * **Internal-package API** -- same stability caveat as `commands`
     * / `xrefs` / `selection`. A framework wrapper passes this
     * through to {@link BpmnLiteEditor} unchanged.
     */
    readonly canvasGroup: SVGGElement;

    /**
     * The shared {@link Viewport} powering pan + zoom. The toolbar
     * subscribes to this for the zoom-level indicator + drives it
     * from the zoom-in/zoom-out buttons; the polish-bundle
     * (F-4) {@link PanMode} drives it from left-click drag.
     *
     * **Internal-package API** -- same stability caveat as
     * `commands` / `canvasGroup`. Exposed so the Angular
     * wrapper can construct surface-level controllers (PanMode,
     * future zoom-fit-to-content, etc) without rolling its own
     * canvas reference.
     */
    readonly viewport: Viewport;

    /**
     * polish-bundle (F-6) -- the action-bar {@link Toolbar},
     * or `undefined` when constructed with `hideToolbar: true`.
     *
     * Exposed so the modal host can call
     * `editor.toolbar?.setConnectActive(...)` /
     * `setHandActive(...)` when its mode controllers flip state,
     * keeping the action-bar button's pressed styling in sync with
     * the host's mode state.
     *
     * **Internal-package API** -- same stability caveat as
     * `commands` / `canvasGroup` / `viewport`.
     */
    readonly toolbar?: Toolbar;

    /**
     * The chrome panel that hosts the property-panel slot.
     * `undefined` when the shell was constructed with
     * `showSidebar: false` (read-only previews). Surface editors
     * mount their property fields into `sidebar.propertyHost`; the
     * palette goes to `toolbar.paletteHost` instead, so every
     * create-tool sits in one action bar. A framework wrapper uses
     * these accessors to wire the Palette + the
     * BpmnLitePropertyPanel into the same chrome the DmnTableEditor's
     * toolbar runs in.
     *
     * **Internal-package API** -- same stability caveat as
     * `commands` / `canvasGroup`. Exposed so framework wrappers can
     * compose surface-specific controllers without re-rolling the
     * shell layout.
     */
    readonly sidebar?: Sidebar;

    /**
     * Unmount the editor: remove all DOM, detach event listeners,
     * cancel pending timers. Safe to call multiple times.
     */
    destroy(): void;

    /**
     * Returns `true` once `destroy()` has been called. Useful for
     * framework wrappers that need to guard against late callbacks.
     */
    readonly isDestroyed: boolean;
}

/**
 * Mount an editor into a host element. The host should be a positioned
 * container (the editor sets its own positioning context but inherits
 * the host's bounds).
 *
 * @example Minimal DMN table mount with save handler
 *
 *   const editor = createEditor(document.querySelector('#host')!, {
 *       surface: 'dmn-table',
 *       onChange: (e) => console.log('rev', e.revision),
 *       onSave: async () => { await api.save(getModelJson()); },
 *   });
 *
 *   // later
 *   editor.destroy();
 *
 * @param host The DOM element to mount into. Must be in the document.
 * @param options See {@link EditorOptions}.
 * @returns A live {@link Editor} handle.
 *
 * @throws TypeError if `host` is not an HTMLElement.
 * @throws TypeError if `options.surface` is not a recognised surface.
 */
export function createEditor(host: HTMLElement, options: EditorOptions): Editor {
    if (!(host instanceof HTMLElement)) {
        throw new TypeError(
            '[@coolms/designer] createEditor: `host` must be an HTMLElement; got ' +
                String(host),
        );
    }
    if (!isSurface(options.surface)) {
        throw new TypeError(
            `[@coolms/designer] createEditor: unknown surface "${String(options.surface)}". ` +
                `Expected one of: dmn-table, bpmn-lite, dmn-drd, state-machine.`,
        );
    }

    const doc = host.ownerDocument;

    // Resolved ONCE, here, and handed to everything the factory builds as
    // well as exposed on the handle -- so the chrome and any surface code a
    // host wires up afterwards cannot end up on different translators.
    const t = options.t ?? defaultTranslator;

    // Root wrapper — one element to remove on destroy.
    const root = doc.createElement('div');
    root.classList.add('coolms-designer', `coolms-designer--${options.surface}`);
    if (options.readOnly === true) {
        root.classList.add('coolms-designer--read-only');
    }
    root.setAttribute('data-coolms-designer-surface', options.surface);

    // Subsystems first so toolbar can subscribe to commands + viewport
    // before any user-visible interaction is possible.
    const graph = new Graph();
    const xrefs = new XRefs();
    const selection = new Selection();

    // Body sits below the toolbar and contains the canvas + sidebar.
    // We mount the body first so the canvas's SVG has a parent with
    // the expected flex layout, then mount the toolbar above it.
    const body = doc.createElement('div');
    body.classList.add('coolms-designer__body');

    // Read-only surfaces (e.g. the M4 cockpit instance diagram embedded in a
    // scrollable page) must not trap plain-wheel scroll — disable wheel-pan
    // there so the page scrolls; Ctrl/Cmd + wheel still zooms.
    const canvas = new Canvas(body, options.surface, {
        enableWheelPan: options.readOnly !== true,
    });

    let toolbar: Toolbar | undefined;
    let sidebar: Sidebar | undefined;

    if (!(options.hideToolbar ?? false)) {
        toolbar = new Toolbar(root, {
            commands: canvas.commands,
            viewport: canvas.viewport,
            t,
            ...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
            ...(options.onSave !== undefined ? { onSave: options.onSave } : {}),
            ...(options.onDeploy !== undefined ? { onDeploy: options.onDeploy } : {}),
            // polish-bundle (F-6) -- mode-toggle callbacks
            // surface in the action bar next to undo/redo.
            ...(options.onToggleConnect !== undefined ? { onToggleConnect: options.onToggleConnect } : {}),
            ...(options.onToggleHand !== undefined ? { onToggleHand: options.onToggleHand } : {}),
            ...(options.onFit !== undefined ? { onFit: options.onFit } : {}),
        });
    }
    // Body is appended AFTER the toolbar so flex column-order puts the
    // toolbar visually above the canvas + sidebar.
    root.appendChild(body);

    if (!(options.hideSidebar ?? false)) {
        sidebar = new Sidebar(body, {
            position: options.sidebarPosition ?? 'right',
            collapsed: options.initialSidebarCollapsed ?? false,
        });
    }

    // Composed revision = init heartbeat (1) + each Graph emit (+1).
    let destroyed = false;
    let initRevision = 0;

    const offGraph = graph.onChange((event) => {
        if (destroyed) return;
        canvas.render.request();
        const kind: SurfaceChangeEvent['kind'] = event.changes.some((c) => c.type === 'reset')
            ? 'reset'
            : 'mutation';
        options.onChange?.({ revision: event.revision + initRevision, kind });
    });

    host.appendChild(root);

    // Init heartbeat. The shift `initRevision = 1` means the first
    // model mutation publishes revision=2, keeping the externally
    // observable sequence strictly monotonic.
    initRevision = 1;
    options.onChange?.({ revision: 1, kind: 'init' });

    const handle: Editor = {
        surface: options.surface,
        host,
        t,
        xrefs,
        selection,
        body,
        commands: canvas.commands,
        canvasGroup: canvas.group,
        viewport: canvas.viewport,
        // F-8 fix -- the Editor interface always declared `toolbar?` but
        // the local `toolbar` variable was never assigned to the handle,
        // so external consumers always got `editor.toolbar === undefined`
        // (the BPMN-Lite dialog's `editor.toolbar?.paletteHost` lookup
        // therefore short-circuited and the palette never mounted into
        // the redesigned creation subgroup). Spread it in the same way
        // sidebar is.
        ...(toolbar !== undefined ? { toolbar } : {}),
        ...(sidebar !== undefined ? { sidebar } : {}),
        get revision() {
            return graph.revision + initRevision;
        },
        get isDestroyed() {
            return destroyed;
        },
        destroy(): void {
            if (destroyed) return;
            destroyed = true;
            offGraph();
            toolbar?.dispose();
            sidebar?.dispose();
            canvas.destroy();
            graph.dispose();
            selection.dispose();
            xrefs.dispose();
            root.remove();
        },
    };

    return handle;
}

const SURFACES: ReadonlySet<EditorSurface> = new Set([
    'dmn-table',
    'bpmn-lite',
    'dmn-drd',
    'state-machine',
]);

function isSurface(value: unknown): value is EditorSurface {
    return typeof value === 'string' && SURFACES.has(value as EditorSurface);
}
