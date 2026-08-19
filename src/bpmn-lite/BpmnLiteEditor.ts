import type { Command, CommandStack } from '../canvas/CommandStack.js';
import { defaultTranslator } from '../i18n.js';
import type { Translator } from '../i18n.js';
import { Emitter } from '../internal/Emitter.js';
import { AddElementCommand } from './AddElementCommand.js';
import { BpmnLiteSelection } from './BpmnLiteSelection.js';
import {
    blankEventDefinitionFor,
    defaultDirectionFor,
    defaultGeometryFor,
} from './defaults.js';
import {
    arrowheadMarkerId,
    buildArrowheadMarker,
    renderSequenceFlow,
    type EdgeRenderer,
} from './renderers/edgeRenderers.js';
import { ElementRendererRegistry } from './renderers/ElementRendererRegistry.js';
import { defaultElementRendererRegistry } from './renderers/nodeRenderers.js';
import { computeOrthogonalRoute } from './renderers/routing.js';
import { SVG_NS } from './renderers/svg.js';
import { emptyBpmnLiteModel } from './types.js';
import type {
    BpmnElement,
    BpmnElementKind,
    BpmnEventSubtype,
    BpmnLiteModel,
    BpmnPosition,
    BpmnSequenceFlow,
    BpmnSize,
} from './types.js';

/**
 * Process-wide instance counter -- used to give each editor a
 * unique arrowhead `<marker>` id so two editors sharing a document
 * don't clash. Auto-incremented in the constructor.
 */
let bpmnLiteEditorInstanceCounter = 0;

/**
 * Construction options for {@link BpmnLiteEditor}.
 *
 * `flowRenderer` is the seam worth knowing about: it defaults to
 * {@link renderSequenceFlow} and is swapped when a consumer needs a
 * different sequence-flow visual (e.g. dashed for cancellation
 * flows).
 */
export interface BpmnLiteEditorOptions {
    /**
     * Resolves this component's user-visible text. Defaults to the English
     * written at each call site, so nothing needs configuring to work.
     */
    readonly t?: Translator;

    readonly host: HTMLElement;
    readonly commands: CommandStack;
    readonly svgGroup: SVGGElement;
    readonly renderers?: ElementRendererRegistry;
    /**
     * Sequence-flow renderer. Defaults to {@link renderSequenceFlow}.
     * Receives the flow + the resolved source + target {@link BpmnElement}s
     * + the document + the per-instance arrowhead marker URL.
     */
    readonly flowRenderer?: EdgeRenderer;
    readonly initialModel?: BpmnLiteModel;
}

interface BpmnLiteEvents extends Record<string, unknown> {
    change: BpmnLiteModel;
}

/**
 * BPMN-Lite editor -- node elements plus SequenceFlow edge
 * rendering layered underneath them.
 *
 * **Two paint groups inside `svgGroup`, in document order**:
 *  1. `<g class="coolms-designer__bpmn-lite-flows">` -- edges +
 *     `<defs>` with the arrowhead marker. Appended FIRST so it
 *     paints UNDERNEATH the elements group per the document-order
 *     SVG painter's algorithm.
 *  2. `<g class="coolms-designer__bpmn-lite-elements">` -- node
 *     elements painted in model order, on top of flows.
 *
 * The flows group is appended first so the nodes naturally cover
 * the arrowhead tips that arrive at them -- matching BPMN modeler
 * convention.
 *
 * **Flow rendering details worth knowing**:
 *  - An orthogonal Z-route auto-router, overridden by manual
 *    waypoints when the flow carries them.
 *  - The `<defs>` arrowhead marker is minted PER EDITOR INSTANCE --
 *    its id carries the instance counter, so two editors on one
 *    page cannot collide on the marker URL.
 *  - A default-flow "/" marker, per BPMN convention.
 *  - Dangling source/target refs are skipped SILENTLY. The editor
 *    legitimately holds draft state with broken refs mid-edit; the
 *    deploy pipeline is what catches them, as
 *    `WF.UNKNOWN_FLOW_ENDPOINT` from the engine validator.
 */
export class BpmnLiteEditor {
    /**
     * The translator this editor renders with. Public so the commands and
     * surface controllers built around it share one, rather than each
     * defaulting to English independently.
     */
    readonly t: Translator;
    private state_: BpmnLiteModel;
    private bannerEl: HTMLElement | null;
    private paintedFlows: SVGGElement | null = null;
    private paintedElements: SVGGElement | null = null;
    private readonly emitter = new Emitter<BpmnLiteEvents>();
    private disposed = false;
    private readonly commands: CommandStack;
    private readonly svgGroup: SVGGElement;
    private readonly renderers: ElementRendererRegistry;
    private readonly flowRenderer: EdgeRenderer;
    private readonly instanceId: number;
    /**
     * the editor-owned selection state. Consumers
     * (BpmnLitePropertyPanel, BpmnLiteSelectionController) read it
     * + drive its `select()` mutator. The editor's repaint loop
     * adds a `--selected` modifier class on the rendered <g> that
     * matches the current selection so CSS can light it up.
     */
    private readonly selection_: BpmnLiteSelection;
    private readonly offSelectionChange: () => void;

    constructor(options: BpmnLiteEditorOptions) {
        this.t = options.t ?? defaultTranslator;
        this.instanceId = ++bpmnLiteEditorInstanceCounter;
        this.commands = options.commands;
        this.svgGroup = options.svgGroup;
        this.renderers =
            options.renderers ?? defaultElementRendererRegistry();
        this.flowRenderer = options.flowRenderer ?? renderSequenceFlow;
        this.state_ = options.initialModel ?? emptyBpmnLiteModel();
        this.bannerEl = this.mountBanner(options.host);
        this.selection_ = new BpmnLiteSelection();
        // When the selection changes, refresh the highlight classes
        // on the painted groups -- a cheap surgical pass, NOT a full
        // repaint, so handles + transient drag state aren't disturbed.
        this.offSelectionChange = this.selection_.onChange(() =>
            this.refreshSelectionHighlight(),
        );
        this.repaint();
    }

    get state(): BpmnLiteModel {
        return this.state_;
    }

    load(model: BpmnLiteModel): void {
        if (this.disposed) return;
        this.state_ = model;
        // Fresh model = stale selection. Clear before repaint so the
        // selection-highlight pass doesn't try to mark a now-missing
        // element. select(null) emits a selection change which our
        // listener handles via refreshSelectionHighlight; that's a
        // cheap no-op when the painted groups have just been built.
        this.selection_.select(null);
        this.repaint();
        this.emitter.emit('change', model);
    }

    /**
     * append a new element to the model + repaint + emit
     * `change`. Mutator API used by {@link AddElementCommand};
     * external callers typically go through {@link dropElementAt}
     * (which wraps this in a command + pushes onto the stack).
     *
     * **Id uniqueness is the caller's responsibility**: the editor
     * trusts the supplied id is fresh. {@link nextElementId} is the
     * canonical way to mint one. Appending an element whose id
     * already exists in `state.elements` produces a model with
     * duplicate ids -- downstream paint succeeds, but the
     * serializer and the engine parser reject it on deploy.
     */
    addElement(element: BpmnElement): void {
        if (this.disposed) return;
        this.state_ = {
            ...this.state_,
            elements: [...this.state_.elements, element],
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Remove the element with the given id from the model, repaint
     * and emit `change`. Returns the removed element, or `null` if
     * no element matched the id. Mutator API used by
     * {@link AddElementCommand.revert} (the undo path).
     *
     * **It does NOT cascade-delete the element's incident flows** --
     * {@link DeleteElementCommand} owns that, so the cascade and the
     * removal coalesce into a single change. Calling this directly
     * leaves dangling flows, which the paint loop silently drops.
     */
    removeElement(id: string): BpmnElement | null {
        if (this.disposed) return null;
        const idx = this.state_.elements.findIndex((e) => e.id === id);
        if (idx === -1) return null;
        const removed = this.state_.elements[idx]!;
        this.state_ = {
            ...this.state_,
            elements: this.state_.elements.filter((_, i) => i !== idx),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
        return removed;
    }

    /**
     * mint a fresh element id of the form `<kind>_<n>`
     * where `n` is one more than the highest trailing-integer
     * suffix already in use for that kind. Resilient to mid-session
     * `load()` with arbitrary ids: only ids matching the
     * `<kind>_<digits>` pattern contribute to the max scan, so
     * loading a model with `start_1`, `start_2`, `start_42` produces
     * `start_43` next; loading with `event-abc` doesn't bump the
     * counter at all.
     */
    nextElementId(kind: BpmnElementKind): string {
        const prefix = `${kind}_`;
        let max = 0;
        for (const el of this.state_.elements) {
            if (!el.id.startsWith(prefix)) continue;
            const suffix = el.id.slice(prefix.length);
            if (!/^\d+$/.test(suffix)) continue;
            const n = parseInt(suffix, 10);
            if (n > max) max = n;
        }
        return `${prefix}${max + 1}`;
    }

    /**
     * drop a fresh element of `kind` at the given client
     * (page) coordinates. Returns the created element if the drop
     * landed inside the canvas + null otherwise. The element is
     * built with {@link defaultGeometryFor} defaults + centered at
     * the drop point + assigned a fresh id via
     * {@link nextElementId} + dispatched through the shared command
     * stack via an {@link AddElementCommand} so the toolbar's
     * undo/redo buttons can revert the drop.
     *
     * **Coordinate translation**: page coords → canvas-SVG-local
     * coords via `svg.getBoundingClientRect()` subtraction →
     * world coords via the canvas-group's `transform` attribute
     * (which the `Viewport` sets as
     * `translate(panX panY) scale(zoom)`). If the transform is
     * absent, the identity is assumed -- correct when the editor
     * mounts a fresh canvas with no pan/zoom applied.
     */
    dropElementAt(
        clientX: number,
        clientY: number,
        kind: BpmnElementKind,
        subtype?: BpmnEventSubtype,
        /**
         * Task flavour (`userTask` / `serviceTask`). Stamped because the
         * engine has NO plain `task` kind -- an activity dropped without
         * one emits `type: "task"`, which fails the parser outright. See
         * {@link PaletteItem.variant}.
         */
        variant?: string,
    ): BpmnElement | null {
        if (this.disposed) return null;
        const svg = this.svgGroup.ownerSVGElement;
        if (svg === null) return null;
        const bounds = svg.getBoundingClientRect();
        if (
            clientX < bounds.left ||
            clientX > bounds.right ||
            clientY < bounds.top ||
            clientY > bounds.bottom
        ) {
            return null;
        }
        const domPoint: BpmnPosition = {
            x: clientX - bounds.left,
            y: clientY - bounds.top,
        };
        const world = this.domToWorld(domPoint);

        const geometry = defaultGeometryFor(kind);

        /**
         * A boundary event is meaningless without a host, so its drop
         * is a DIFFERENT gesture: it must land ON an activity, and the
         * host under the cursor decides both `attachedTo` and the
         * docked position. Dropping one on empty canvas is rejected
         * (returns null, no command pushed) rather than creating an
         * orphan the author would then have to notice and delete.
         *
         * Which host kinds are legal is left to the deploy-time
         * `BoundaryAttachmentRule` -- see {@link BpmnElement.attachedTo}.
         */
        let docked: { attachedTo: string; position: BpmnPosition } | null = null;
        if (kind === 'boundaryEvent') {
            const host = this.elementAtWorldPoint(world);
            if (host === null) return null;
            docked = {
                attachedTo: host.id,
                position: dockPositionOnHost(host, world, geometry.size),
            };
        }

        /**
         * Scope capture: an element dropped inside a subprocess's rect
         * joins that scope. This is the ONLY way `parent` gets authored
         * — there is no "set parent" field in the property panel — so
         * the gesture has to be the obvious one (drop it in the box).
         *
         * A boundary event is excluded: it docks to an activity's EDGE
         * and belongs to the scope its HOST is in, not to whatever
         * container it happens to overlap. A subprocess CAN be captured,
         * which is how nested scopes are authored.
         */
        const scope =
            kind === 'boundaryEvent' ? null : this.containerAtWorldPoint(world);

        const dropDirection = defaultDirectionFor(kind);
        const element: BpmnElement = {
            id: this.nextElementId(kind),
            type: kind,
            position: docked?.position ?? {
                x: world.x - geometry.size.width / 2,
                y: world.y - geometry.size.height / 2,
            },
            size: geometry.size,
            ...(scope !== null ? { parent: scope.id } : {}),
            ...(geometry.label !== undefined ? { label: geometry.label } : {}),
            ...(subtype !== undefined
                ? { subtype, ...blankEventDefinitionFor(subtype) }
                : {}),
            ...(variant !== undefined ? { variant } : {}),
            // Conditional spread of a NARROWED local, not the call
            // result -- `exactOptionalPropertyTypes` rejects an explicit
            // `undefined` on an optional property.
            ...(dropDirection !== undefined
                ? { direction: dropDirection }
                : {}),
            ...(docked !== null
                ? {
                      attachedTo: docked.attachedTo,
                      /**
                       * Stamped EXPLICITLY even though absent already
                       * means interrupting on the wire. The property
                       * panel's boolean field renders `undefined` as
                       * unchecked, so leaving it unset showed an
                       * unchecked "Interrupting" box next to a SOLID
                       * (interrupting) ring -- the panel contradicting
                       * the canvas. `toJson` still omits a `true`, so
                       * the saved body stays clean either way.
                       */
                      interrupting: true,
                  }
                : {}),
        };
        const cmd: Command = new AddElementCommand(this, element);
        this.commands.execute(cmd);
        return element;
    }

    /**
     * Topmost element whose bounding box contains the given WORLD
     * point, or `null`. Later elements win because the paint order is
     * document order -- the last painted sibling is the one visually on
     * top, so it is the one the cursor is pointing at.
     *
     * **Boundary events are never returned.** They sit ON another
     * element's border, so a naive hit-test would let the author attach
     * a boundary to a boundary (which cannot deploy) simply because the
     * two overlap.
     */
    elementAtWorldPoint(point: BpmnPosition): BpmnElement | null {
        for (let i = this.state_.elements.length - 1; i >= 0; i--) {
            const el = this.state_.elements[i]!;
            if (el.type === 'boundaryEvent') continue;
            if (
                point.x >= el.position.x &&
                point.x <= el.position.x + el.size.width &&
                point.y >= el.position.y &&
                point.y <= el.position.y + el.size.height
            ) {
                return el;
            }
        }
        return null;
    }

    /**
     * Innermost `subProcess` whose rect contains the world point, or
     * `null` for the root scope.
     *
     * **Innermost wins**, not topmost: containers paint outermost-first
     * (see {@link paintRank}), so "last painted" is the OUTER box and a
     * plain reverse scan would put a drop into the wrong scope whenever
     * subprocesses are nested. Deepest-nesting is the unambiguous
     * answer, and it matches what the author sees — the smallest box
     * their cursor is inside.
     */
    containerAtWorldPoint(point: BpmnPosition): BpmnElement | null {
        let best: BpmnElement | null = null;
        let bestDepth = -1;

        for (const el of this.state_.elements) {
            if (el.type !== 'subProcess') continue;
            if (
                point.x < el.position.x ||
                point.x > el.position.x + el.size.width ||
                point.y < el.position.y ||
                point.y > el.position.y + el.size.height
            ) {
                continue;
            }
            const depth = this.paintRank(el);
            if (depth > bestDepth) {
                best = el;
                bestDepth = depth;
            }
        }

        return best;
    }

    /**
     * Element ids DIRECTLY inside the given container. Mirrors the
     * engine's `ProcessDefinitionAst::childrenOf`.
     */
    scopeChildren(containerId: string): ReadonlyArray<BpmnElement> {
        return this.state_.elements.filter((e) => e.parent === containerId);
    }

    /**
     * Every element currently attached to the given host id.
     * Used by the move + delete cascades.
     */
    attachedBoundaries(hostId: string): ReadonlyArray<BpmnElement> {
        return this.state_.elements.filter((e) => e.attachedTo === hostId);
    }

    /**
     * Append a new flow to the model, repaint and emit `change`.
     * Mutator API used by {@link AddFlowCommand}; external callers
     * (notably {@link ConnectMode}) typically construct
     * the command + dispatch through {@link commandStack} so
     * undo/redo wires automatically.
     *
     * **Id uniqueness is the caller's responsibility** (same
     * contract as {@link addElement}). {@link nextFlowId} is the
     * canonical minter.
     *
     * **Dangling source/target refs are accepted**: the paint
     * loop already skips flows whose endpoints don't resolve, and
     * the editor may legitimately hold draft state with broken refs
     * mid-edit. The engine validator catches them on deploy as
     * `WF.UNKNOWN_FLOW_ENDPOINT`.
     */
    addFlow(flow: BpmnSequenceFlow): void {
        if (this.disposed) return;
        this.state_ = {
            ...this.state_,
            flows: [...this.state_.flows, flow],
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * remove the flow with the given id + repaint + emit
     * `change`. Returns the removed flow, or `null` if no flow
     * matched the id. Inverse of {@link addFlow}; used by
     * {@link AddFlowCommand.revert}.
     */
    removeFlow(id: string): BpmnSequenceFlow | null {
        if (this.disposed) return null;
        const idx = this.state_.flows.findIndex((f) => f.id === id);
        if (idx === -1) return null;
        const removed = this.state_.flows[idx]!;
        this.state_ = {
            ...this.state_,
            flows: this.state_.flows.filter((_, i) => i !== idx),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
        return removed;
    }

    /**
     * mint a fresh flow id of the form `flow_<n>` where
     * `n` is one more than the highest trailing-integer suffix
     * already in use. Same resilience contract as
     * {@link nextElementId}: only ids matching the `flow_<digits>`
     * pattern contribute to the max scan.
     */
    nextFlowId(): string {
        const prefix = 'flow_';
        let max = 0;
        for (const f of this.state_.flows) {
            if (!f.id.startsWith(prefix)) continue;
            const suffix = f.id.slice(prefix.length);
            if (!/^\d+$/.test(suffix)) continue;
            const n = parseInt(suffix, 10);
            if (n > max) max = n;
        }
        return `${prefix}${max + 1}`;
    }

    /**
     * Replace the waypoints slot on the flow with the given id,
     * repaint and emit `change`. Passing `undefined` reverts the
     * flow to auto-routing -- the {@link computeOrthogonalRoute}
     * Z-route kicks in on the next paint. Returns true if the flow
     * existed and was updated.
     *
     * **Used by**: {@link UpdateFlowWaypointsCommand} (the
     * canonical reroute path); {@link WaypointDragController}
     * dispatches one command per drag-release so undo/redo restore
     * the prior routing exactly.
     */
    updateFlowWaypoints(
        flowId: string,
        waypoints: ReadonlyArray<BpmnPosition> | undefined,
    ): boolean {
        if (this.disposed) return false;
        const idx = this.state_.flows.findIndex((f) => f.id === flowId);
        if (idx === -1) return false;
        const flow = this.state_.flows[idx]!;
        const nextFlow: BpmnSequenceFlow = waypoints === undefined
            ? this.flowWithoutWaypoints(flow)
            : { ...flow, waypoints: [...waypoints] };
        this.state_ = {
            ...this.state_,
            flows: this.state_.flows.map((f, i) => (i === idx ? nextFlow : f)),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
        return true;
    }

    /**
     * Build a clone of the flow with the `waypoints` slot stripped
     * entirely (not just set to `undefined`). The renderer's
     * `flow.waypoints !== undefined` check treats explicit-undefined
     * the same as absent + auto-routes, but stripping keeps the
     * model's serialisation pristine: the JSON round-trip
     * will emit `{...}` with no `waypoints` key for auto-routed
     * flows, matching what the engine parser produces on the
     * inverse trip.
     */
    private flowWithoutWaypoints(flow: BpmnSequenceFlow): BpmnSequenceFlow {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { waypoints: _drop, ...rest } = flow;
        return rest;
    }

    /**
     * F-7.1 -- replace the position slot on the element with the given
     * id + repaint + emit `change`. Returns true if the element existed
     * + was updated. Position is the top-left corner of the element's
     * bounding box in world coordinates (the same frame as the
     * element geometry pipeline).
     *
     * **Used by**: {@link MoveElementCommand} (the canonical drag-to-
     * move path); the F-7.1 `MoveElementController` dispatches one
     * command per drag-release so undo/redo restore the prior position
     * exactly. The connected flows' auto-routes recompute on next paint
     * because the router reads source/target geometry from the
     * model at each call; the controller doesn't need to touch flow
     * waypoints. **Manual** waypoints (user-rerouted flows) are
     * preserved as-is -- moving an element doesn't blow away the
     * user's routing decisions.
     */
    updateElementPosition(
        id: string,
        position: BpmnPosition,
    ): boolean {
        if (this.disposed) return false;
        const idx = this.state_.elements.findIndex((e) => e.id === id);
        if (idx === -1) return false;
        const current = this.state_.elements[idx]!;
        // Captured BEFORE the write so attached boundaries can ride the
        // same delta. Hooking the cascade here (rather than in
        // MoveElementCommand) means EVERY move path gets it: pointer
        // drag, keyboard nudge, and undo -- undo simply moves the host
        // back, which shifts the boundaries by the inverse delta.
        const delta: BpmnPosition = {
            x: position.x - current.position.x,
            y: position.y - current.position.y,
        };
        const nextElement: BpmnElement = {
            ...current,
            position: { x: position.x, y: position.y },
        };
        this.state_ = {
            ...this.state_,
            elements: this.state_.elements.map((e, i) =>
                i === idx ? nextElement : e,
            ),
        };
        this.shiftAttachedBoundaries(id, delta);
        this.shiftScopeContents(id, delta);
        this.repaint();
        this.emitter.emit('change', this.state_);
        return true;
    }

    /**
     * replace a single property on the element with the
     * given id + repaint + emit `change`. Returns true on success;
     * false if no element matched. Used by
     * {@link UpdateElementPropertyCommand}.
     *
     * **Why `unknown` for value, not a tagged union**: the panel
     * registry is open -- custom field types can write any JSON-
     * compatible value. The schema provider + the field renderer
     * own the type contract for each key. The editor mutator is
     * a pass-through.
     *
     * **What this mutator does NOT do**: validate the key against
     * an editable-property whitelist. {@link UpdateElementPropertyCommand}
     * carries an {@link EditableElementPropertyKey} type guard at
     * the command layer; the editor mutator is the lower-level
     * surface that commands ride on. Going around the command stack
     * with a bogus key is a bug, not a security boundary.
     */
    updateElementProperty(
        id: string,
        key: string,
        value: unknown,
    ): boolean {
        if (this.disposed) return false;
        const idx = this.state_.elements.findIndex((e) => e.id === id);
        if (idx === -1) return false;
        const current = this.state_.elements[idx]!;
        const nextElement = this.elementWithProperty(current, key, value);
        this.state_ = {
            ...this.state_,
            elements: this.state_.elements.map((e, i) =>
                i === idx ? nextElement : e,
            ),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
        return true;
    }

    /**
     * replace a single property on the flow with the
     * given id + repaint + emit `change`. Returns true on success;
     * false if no flow matched. Used by
     * {@link UpdateFlowPropertyCommand}.
     *
     * **Reserved keys**: caller must NOT pass `'id'`, `'source'`,
     * `'target'`, or `'waypoints'`. The command layer's
     * {@link EditableFlowPropertyKey} guards against this at compile
     * time. The editor mutator is the lower-level surface that
     * commands ride on; runtime guards belong in the command
     * constructors, not here.
     */
    updateFlowProperty(
        id: string,
        key: string,
        value: unknown,
    ): boolean {
        if (this.disposed) return false;
        const idx = this.state_.flows.findIndex((f) => f.id === id);
        if (idx === -1) return false;
        const current = this.state_.flows[idx]!;
        const nextFlow = this.flowWithProperty(current, key, value);
        this.state_ = {
            ...this.state_,
            flows: this.state_.flows.map((f, i) => (i === idx ? nextFlow : f)),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
        return true;
    }

    /**
     * Build a clone of the element with a single property replaced.
     * **Strip-vs-set semantics**: when `value` is `undefined` AND
     * the key is optional in the type (`label` is the only such
     * key), the clone omits the key entirely so the JSON round-trip
     * stays pristine -- the engine parser produces
     * elements with NO `label` key for unlabelled elements, not
     * `label: undefined`. Empty-string labels are persisted as
     * empty strings (the user typed an empty input + tabbed away;
     * that's distinct from never having labelled the element).
     */
    /**
     * Re-dock every boundary attached to `hostId` after that host has
     * moved, preserving each boundary's position ALONG the border.
     * Exposed so the move path is one call rather than repeated
     * geometry at each call site.
     */
    /**
     * Drag the contents of a container along with it.
     *
     * A subprocess's children are ordinary elements whose geometry
     * merely happens to sit inside the box, so nothing moves them for
     * free — without this, dragging a scope would slide the container
     * off its own contents and leave them behind at the old position,
     * still `parent`-ed to it. Recursive so a nested scope's grandchildren
     * come too, and it reuses `updateElementPosition` per child, which
     * means each child's own boundaries re-dock on the way.
     */
    private shiftScopeContents(containerId: string, delta: BpmnPosition): void {
        if (delta.x === 0 && delta.y === 0) return;
        const children = this.state_.elements.filter(
            (e) => e.parent === containerId,
        );
        if (children.length === 0) return;

        const moved = new Set(children.map((e) => e.id));
        this.state_ = {
            ...this.state_,
            elements: this.state_.elements.map((e) =>
                moved.has(e.id)
                    ? {
                          ...e,
                          position: {
                              x: e.position.x + delta.x,
                              y: e.position.y + delta.y,
                          },
                      }
                    : e,
            ),
        };

        for (const child of children) {
            this.shiftAttachedBoundaries(child.id, delta);
            if (child.type === 'subProcess') {
                this.shiftScopeContents(child.id, delta);
            }
        }
    }

    private shiftAttachedBoundaries(
        hostId: string,
        delta: BpmnPosition,
    ): void {
        if (delta.x === 0 && delta.y === 0) return;
        const attached = this.state_.elements.filter(
            (e) => e.attachedTo === hostId,
        );
        if (attached.length === 0) return;
        const moved = new Set(attached.map((e) => e.id));
        this.state_ = {
            ...this.state_,
            elements: this.state_.elements.map((e) =>
                moved.has(e.id)
                    ? {
                          ...e,
                          position: {
                              x: e.position.x + delta.x,
                              y: e.position.y + delta.y,
                          },
                      }
                    : e,
            ),
        };
    }

    private elementWithProperty(
        element: BpmnElement,
        key: string,
        value: unknown,
    ): BpmnElement {
        /**
         * Strip-vs-set for the optional top-level slots. The wire
         * shape distinguishes "no field" from "empty string": the
         * engine parser produces elements with no `variant` /
         * `implementation` / `formKey` key for unset ones, not ones
         * with empty-string values. The set started as `{'label'}`
         * and grew to cover the variant and the variant-specific
         * fields the property panel surfaces.
         *
         * The SELECT field renderer emits `null` on the "empty" option
         * (it's the JSON-friendly equivalent of "no value"); strip on
         * BOTH undefined + null so the round-trip stays clean whether
         * the caller passes either sentinel.
         */
        const stripOnNullish = new Set<string>([
            'label',
            'variant',
            'implementation',
            'formKey',
            'subtype',
        ]);
        if (stripOnNullish.has(key) && (value === undefined || value === null)) {
            const next: Record<string, unknown> = { ...element };
            delete next[key];
            return next as unknown as BpmnElement;
        }
        /**
         * **Dotted keys address a nested definition block** --
         * `timer.value`, `message.correlation`, `condition.expression`.
         * Typed events keep their definitions as nested objects (that
         * IS the wire shape), so the property panel needs a way to bind
         * one input to one leaf. One level of nesting is all the wire
         * shape has, so this deliberately does not implement arbitrary
         * deep paths.
         *
         * The parent object is created on demand, so editing a leaf on
         * an element whose block was omitted (e.g. a body hand-authored
         * without a `timer`) materialises it rather than throwing.
         */
        const dot = key.indexOf('.');
        if (dot > 0) {
            const head = key.slice(0, dot);
            const leaf = key.slice(dot + 1);
            const currentParent = (element as unknown as Record<string, unknown>)[
                head
            ];
            const parent: Record<string, unknown> =
                typeof currentParent === 'object' && currentParent !== null
                    ? { ...(currentParent as Record<string, unknown>) }
                    : {};
            if (value === undefined || value === null) {
                delete parent[leaf];
            } else {
                parent[leaf] = value;
            }
            return { ...element, [head]: parent } as unknown as BpmnElement;
        }
        return { ...element, [key]: value } as BpmnElement;
    }

    /**
     * Same strip-vs-set logic as {@link elementWithProperty} but
     * for flows. `condition` + `isDefault` are both optional in the
     * {@link BpmnSequenceFlow} type.
     */
    private flowWithProperty(
        flow: BpmnSequenceFlow,
        key: string,
        value: unknown,
    ): BpmnSequenceFlow {
        const optionalKeys = new Set(['condition', 'isDefault']);
        if (optionalKeys.has(key) && value === undefined) {
            const { [key]: _drop, ...rest } = flow as unknown as Record<
                string,
                unknown
            >;
            return rest as unknown as BpmnSequenceFlow;
        }
        return { ...flow, [key]: value } as BpmnSequenceFlow;
    }

    /**
     * F-7.4 -- the union bounding box of all elements in the model,
     * in world coordinates. Returns `null` for an empty model (the
     * caller should fall back to a default viewport).
     *
     * Used by {@link createEditor} + the dialog's auto-fit on open
     * to compute the fit-to-content target for the shell's
     * viewport. Also useful for the F-7.4 "Fit" toolbar button that
     * re-centers on demand.
     *
     * **What this includes**: ALL element bboxes (events, tasks,
     * gateways). Excludes flow waypoints + sidecar geometry (labels,
     * markers) -- those track their hosts so element-bbox-only is the
     * correct primitive for "fit the diagram." Labels that overflow
     * their host's bbox (long titles below an event) might extend a
     * few pixels past the fit; that's an acceptable trade-off vs.
     * computing label glyph metrics here.
     */
    contentBbox(): {
        readonly left: number;
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
    } | null {
        if (this.state_.elements.length === 0) return null;
        let left = Number.POSITIVE_INFINITY;
        let top = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;
        for (const el of this.state_.elements) {
            const elLeft = el.position.x;
            const elTop = el.position.y;
            const elRight = elLeft + el.size.width;
            const elBottom = elTop + el.size.height;
            if (elLeft < left) left = elLeft;
            if (elTop < top) top = elTop;
            if (elRight > right) right = elRight;
            if (elBottom > bottom) bottom = elBottom;
        }
        return { left, top, right, bottom };
    }

    /**
     * look up an element by id. Returns `null` if no match.
     * Used by {@link ConnectMode} + {@link WaypointDragController}
     * to resolve drag-source / drag-target element geometry without
     * the controllers needing to walk `state.elements` themselves.
     */
    findElement(id: string): BpmnElement | null {
        return this.state_.elements.find((e) => e.id === id) ?? null;
    }

    /**
     * look up a flow by id. Returns `null` if no match.
     * Used by {@link UpdateFlowWaypointsCommand} to capture the
     * pre-apply waypoints + by {@link WaypointDragController} to
     * read the current route for handle placement.
     */
    findFlow(id: string): BpmnSequenceFlow | null {
        return this.state_.flows.find((f) => f.id === id) ?? null;
    }

    /**
     * the world-space center point of the element with the
     * given id. Returns `null` if the element is missing. Used by
     * {@link ConnectMode} to anchor the rubber-band's start point.
     */
    getElementCenter(id: string): BpmnPosition | null {
        const el = this.findElement(id);
        if (el === null) return null;
        return {
            x: el.position.x + el.size.width / 2,
            y: el.position.y + el.size.height / 2,
        };
    }

    /**
     * the resolved waypoint chain for the flow with the
     * given id. Returns manual waypoints (≥2 entries) verbatim;
     * falls back to {@link computeOrthogonalRoute} otherwise. Returns
     * `null` if the flow is missing OR its source/target refs are
     * dangling. Used by {@link WaypointDragController} to read the
     * current route for handle placement.
     */
    resolveFlowWaypoints(flowId: string): BpmnPosition[] | null {
        const flow = this.findFlow(flowId);
        if (flow === null) return null;
        if (flow.waypoints !== undefined && flow.waypoints.length >= 2) {
            return [...flow.waypoints];
        }
        const source = this.findElement(flow.source);
        const target = this.findElement(flow.target);
        if (source === null || target === null) return null;
        return computeOrthogonalRoute(source, target);
    }

    /**
     * convert a client (page) coordinate to world (canvas)
     * coordinates, accounting for the canvas SVG's bounding rect +
     * the canvas group's pan/zoom transform. Returns `null` if the
     * point falls outside the canvas SVG (callers typically treat
     * out-of-canvas as cancel-the-drag).
     */
    clientToWorld(clientX: number, clientY: number): BpmnPosition | null {
        const svg = this.svgGroup.ownerSVGElement;
        if (svg === null) return null;
        const bounds = svg.getBoundingClientRect();
        if (
            clientX < bounds.left ||
            clientX > bounds.right ||
            clientY < bounds.top ||
            clientY > bounds.bottom
        ) {
            return null;
        }
        return this.domToWorld({
            x: clientX - bounds.left,
            y: clientY - bounds.top,
        });
    }

    /**
     * the canvas root `<g>` the editor mounts both the
     * flows + the elements groups into. Internal-package accessor
     * exposed for {@link ConnectMode} + {@link WaypointDragController}
     * to attach pointer listeners + paint transient overlays.
     */
    get canvasGroup(): SVGGElement {
        return this.svgGroup;
    }

    /**
     * Internal helper -- read the canvas group's `transform`
     * attribute, parse the `translate(panX panY) scale(zoom)` form
     * the {@link Viewport} sets, return the inverse mapping
     * from DOM-local point to world point. Missing transform =
     * identity (no pan/zoom applied).
     */
    private domToWorld(dom: BpmnPosition): BpmnPosition {
        const transform = this.svgGroup.getAttribute('transform') ?? '';
        const translateMatch = transform.match(
            /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/,
        );
        const scaleMatch = transform.match(/scale\(\s*(-?[\d.]+)\s*\)/);
        const panX = translateMatch !== null ? parseFloat(translateMatch[1]!) : 0;
        const panY = translateMatch !== null ? parseFloat(translateMatch[2]!) : 0;
        const zoom = scaleMatch !== null ? parseFloat(scaleMatch[1]!) : 1;
        // Guard against the parser pulling a zero or NaN out of a
        // malformed transform string. Treat as identity in those
        // cases -- safer to drop at the raw cursor than at (NaN, NaN).
        const z = !Number.isFinite(zoom) || zoom === 0 ? 1 : zoom;
        const tx = Number.isFinite(panX) ? panX : 0;
        const ty = Number.isFinite(panY) ? panY : 0;
        return {
            x: (dom.x - tx) / z,
            y: (dom.y - ty) / z,
        };
    }

    onChange(listener: (state: BpmnLiteModel) => void): () => void {
        return this.emitter.on('change', listener);
    }

    /**
     * the editor-owned selection state. Consumers wire
     * canvas pointer events into `selection.select(...)`; the panel
     * subscribes via `selection.onChange`; the editor's repaint
     * loop reads it to mark the matching `<g>` with a
     * `--selected` modifier class.
     */
    get selection(): BpmnLiteSelection {
        return this.selection_;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.offSelectionChange();
        this.selection_.dispose();
        if (this.paintedFlows !== null) {
            this.paintedFlows.remove();
            this.paintedFlows = null;
        }
        if (this.paintedElements !== null) {
            this.paintedElements.remove();
            this.paintedElements = null;
        }
        if (this.bannerEl !== null) {
            this.bannerEl.remove();
            this.bannerEl = null;
        }
        this.emitter.dispose();
    }

    get commandStack(): CommandStack {
        return this.commands;
    }

    get rendererRegistry(): ElementRendererRegistry {
        return this.renderers;
    }

    get bannerElement(): HTMLElement | null {
        return this.bannerEl;
    }

    /**
     * Test affordance -- the painted SVG root group holding the
     * element shapes. Kept for backward compatibility with older
     * tests; {@link paintedFlowsElement} exposes the flows group.
     */
    get paintedRootElement(): SVGGElement | null {
        return this.paintedElements;
    }

    /** Test affordance -- the painted SVG group holding the flow `<path>`s + `<defs>`. */
    get paintedFlowsElement(): SVGGElement | null {
        return this.paintedFlows;
    }

    /** Test affordance -- the per-instance arrowhead marker id. */
    get arrowheadMarkerId(): string {
        return arrowheadMarkerId(this.instanceId);
    }

    private mountBanner(host: HTMLElement): HTMLElement {
        const doc = host.ownerDocument;
        const banner = doc.createElement('div');
        banner.classList.add('coolms-designer__bpmn-lite-banner');
        banner.setAttribute('data-coolms-designer-scaffold', 'bpmn-lite');

        const title = doc.createElement('div');
        title.classList.add('coolms-designer__bpmn-lite-banner-title');
        title.textContent = this.t('designer.bpmn.banner.title', 'BPMN-Lite editor');
        banner.appendChild(title);

        const subtitle = doc.createElement('div');
        subtitle.classList.add('coolms-designer__bpmn-lite-banner-subtitle');
        subtitle.textContent =
            this.t('designer.bpmn.banner.subtitle', 'Drag an element from the palette to begin.');
        banner.appendChild(subtitle);

        host.appendChild(banner);
        return banner;
    }

    /**
     * Re-render both paint groups. The flows group is appended
     * FIRST so SVG document-order layering paints it underneath
     * the elements group (which lands ON TOP, covering arrowhead
     * tips at the node). The order matters -- inverting it would
     * make arrowheads visible through transparent / outlined
     * elements.
     */
    private repaint(): void {
        if (this.paintedFlows !== null) {
            this.paintedFlows.remove();
            this.paintedFlows = null;
        }
        if (this.paintedElements !== null) {
            this.paintedElements.remove();
            this.paintedElements = null;
        }

        const doc = this.svgGroup.ownerDocument;
        const flowsRoot = this.paintFlowsGroup(doc);
        const elementsRoot = this.paintElementsGroup(doc);

        this.svgGroup.appendChild(flowsRoot);
        this.svgGroup.appendChild(elementsRoot);

        this.paintedFlows = flowsRoot;
        this.paintedElements = elementsRoot;

        this.refreshBannerVisibility();
        this.refreshSelectionHighlight();
    }

    /**
     * mark the painted `<g>` matching the current
     * selection with a `--selected` modifier class so CSS can light
     * it up. Clears the class from any other element / flow group.
     * Cheap full sweep over painted children -- with typical
     * diagrams (≤200 elements + flows) this is well below 1ms.
     *
     * Called from {@link repaint} (so selection survives a load /
     * undo / redo) AND from the selection.onChange subscription (so
     * picking a different target is reflected without a full repaint).
     */
    private refreshSelectionHighlight(): void {
        const target = this.selection_.target;
        if (this.paintedElements !== null) {
            for (const child of Array.from(this.paintedElements.children)) {
                const id = child.getAttribute('data-element-id');
                const selected =
                    target?.kind === 'element' && target.id === id;
                child.classList.toggle(
                    'coolms-designer__bpmn-element--selected',
                    selected,
                );
            }
        }
        if (this.paintedFlows !== null) {
            for (const child of Array.from(this.paintedFlows.children)) {
                const id = child.getAttribute('data-flow-id');
                if (id === null) continue;
                const selected = target?.kind === 'flow' && target.id === id;
                child.classList.toggle(
                    'coolms-designer__bpmn-flow--selected',
                    selected,
                );
            }
        }
    }

    /**
     * Build the `<g class="coolms-designer__bpmn-lite-flows">`
     * group: a sibling `<defs>` carrying the per-instance arrowhead
     * marker + one rendered `<g>` per flow whose source + target
     * resolve. Dangling-ref flows are skipped silently.
     */
    private paintFlowsGroup(doc: Document): SVGGElement {
        const root = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        root.classList.add('coolms-designer__bpmn-lite-flows');

        const defs = doc.createElementNS(SVG_NS, 'defs');
        defs.appendChild(buildArrowheadMarker(doc, this.instanceId));
        root.appendChild(defs);

        const markerUrl = `url(#${arrowheadMarkerId(this.instanceId)})`;
        const elementsById = new Map<string, BpmnElement>();
        for (const el of this.state_.elements) {
            elementsById.set(el.id, el);
        }

        for (const flow of this.state_.flows) {
            const source = elementsById.get(flow.source);
            const target = elementsById.get(flow.target);
            if (source === undefined || target === undefined) {
                // Dangling source/target -- the model is in an
                // intermediate state. Skip silently; the engine
                // validator will surface this as
                // `WF.UNKNOWN_FLOW_ENDPOINT` on deploy.
                continue;
            }
            const node = this.flowRenderer(
                flow,
                source,
                target,
                doc,
                markerUrl,
            );
            root.appendChild(node);
        }

        return root;
    }

    /**
     * Build the elements paint group -- one `<g>` per element via the
     * registry.
     *
     * **Containers paint FIRST.** SVG has no z-index; paint order IS
     * stacking order, so a subprocess dropped after its children would
     * cover them with its own (hit-testable) rect and make everything
     * inside unclickable. Sorting by scope DEPTH — outermost container,
     * then nested containers, then leaves — also gets nested scopes
     * right without a second rule.
     *
     * The sort is stable within a depth, so authoring order is
     * otherwise preserved.
     */
    private paintElementsGroup(doc: Document): SVGGElement {
        const root = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        root.classList.add('coolms-designer__bpmn-lite-elements');

        const ordered = [...this.state_.elements].sort(
            (a, b) => this.paintRank(a) - this.paintRank(b),
        );

        for (const element of ordered) {
            const renderer = this.renderers.resolve(element.type);
            const node = renderer(element, doc, this.t);
            root.appendChild(node);
        }

        return root;
    }

    /**
     * Lower paints earlier (further back). Containers rank by their own
     * nesting depth; anything that is not a container ranks behind every
     * container so it lands on top of the one it sits in.
     */
    private paintRank(element: BpmnElement): number {
        if (element.type !== 'subProcess') return Number.MAX_SAFE_INTEGER;

        let depth = 0;
        let cursor: string | undefined = element.parent;
        const seen = new Set<string>([element.id]);
        while (cursor !== undefined && !seen.has(cursor)) {
            seen.add(cursor);
            depth += 1;
            cursor = this.state_.elements.find((e) => e.id === cursor)?.parent;
        }

        return depth;
    }

    private refreshBannerVisibility(): void {
        if (this.bannerEl === null) return;
        const isEmpty =
            this.state_.elements.length === 0 &&
            this.state_.flows.length === 0;
        this.bannerEl.style.display = isEmpty ? '' : 'none';
    }
}

/**
 * Dock a boundary event onto its host's border.
 *
 * BPMN draws a boundary event straddling the host's outline, so this
 * snaps the drop point to the NEAREST edge and centres the event on it.
 * Picking the nearest edge (rather than always the bottom) lets the
 * author place several boundaries around one activity without them
 * stacking, and makes the gesture feel direct: the event lands where
 * the cursor was.
 *
 * Returned position is the event's top-left, in world coordinates, so
 * it round-trips through the diagram sidecar like any other element.
 */
export function dockPositionOnHost(
    host: BpmnElement,
    dropPoint: BpmnPosition,
    size: BpmnSize,
): BpmnPosition {
    const left = host.position.x;
    const top = host.position.y;
    const right = left + host.size.width;
    const bottom = top + host.size.height;

    // Distance from the drop point to each edge; smallest wins.
    const dLeft = Math.abs(dropPoint.x - left);
    const dRight = Math.abs(right - dropPoint.x);
    const dTop = Math.abs(dropPoint.y - top);
    const dBottom = Math.abs(bottom - dropPoint.y);
    const min = Math.min(dLeft, dRight, dTop, dBottom);

    // Clamp along the chosen edge so the event stays within the host's
    // span instead of sliding off a corner.
    const clamp = (v: number, lo: number, hi: number): number =>
        Math.min(Math.max(v, lo), hi);

    let cx: number;
    let cy: number;
    if (min === dTop) {
        cx = clamp(dropPoint.x, left, right);
        cy = top;
    } else if (min === dBottom) {
        cx = clamp(dropPoint.x, left, right);
        cy = bottom;
    } else if (min === dLeft) {
        cx = left;
        cy = clamp(dropPoint.y, top, bottom);
    } else {
        cx = right;
        cy = clamp(dropPoint.y, top, bottom);
    }

    return { x: cx - size.width / 2, y: cy - size.height / 2 };
}
