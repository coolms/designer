import { CommandStack } from '../canvas/CommandStack.js';
import { defaultTranslator } from '../i18n.js';
import type { Translator } from '../i18n.js';
import { Emitter } from '../internal/Emitter.js';
import { autoLayoutStateMachine } from './autoLayout.js';
import { renderPlace } from './renderers/placeRenderer.js';
import { SVG_NS } from './renderers/svg.js';
import {
    buildSmArrowheadMarker,
    renderTransition,
    smArrowheadMarkerId,
} from './renderers/transitionRenderer.js';
import { SmSelection } from './SmSelection.js';
import { emptyStateMachineModel } from './types.js';
import type {
    SmPlace,
    SmPosition,
    SmTransition,
    StateMachineModel,
} from './types.js';

/** Process-wide instance counter — gives each editor a unique arrowhead `<marker>` id. */
let stateMachineEditorInstanceCounter = 0;

/** Construction options for {@link StateMachineEditor}. */
export interface StateMachineEditorOptions {
    /**
     * Resolves this component's user-visible text. Defaults to the English
     * written at each call site, so nothing needs configuring to work.
     */
    readonly t?: Translator;

    readonly host: HTMLElement;
    /** The canvas root `<g>` (under the viewport transform) the editor paints into. */
    readonly svgGroup: SVGGElement;
    readonly initialModel?: StateMachineModel;
    /**
     * share the host shell's {@link CommandStack} so the shell's
     * toolbar undo/redo drive the same history the property panel dispatches
     * through. When omitted (headless tests), the editor owns a private stack.
     */
    readonly commands?: CommandStack;
}

interface StateMachineEvents extends Record<string, unknown> {
    change: StateMachineModel;
}

/**
 * State Machine editor — the third editor on the `@coolms/designer`
 * substrate, after the DMN table and BPMN-Lite. It owns the render
 * half: an immutable {@link StateMachineModel} painted onto the
 * shared canvas. The palette, commands, selection, property panel,
 * auto-layout and the config serializer all compose around it.
 *
 * **Two paint groups inside `svgGroup`, in document order** (mirroring
 * the bpmn-lite editor): a `…__sm-transitions` group (edges + the
 * `<defs>` arrowhead marker) appended FIRST so it paints UNDER the
 * `…__sm-places` group, so place rectangles cover the arrowhead tips
 * arriving at them. Dangling transition endpoints (a `from`/`to` that
 * resolves to no place) are skipped silently — the model may hold draft
 * state mid-edit; the serializer + the Symfony Workflow
 * compiler surface that on deploy.
 */
export class StateMachineEditor {
    /**
     * The translator this editor renders with. Public so the commands and
     * surface controllers built around it share one, rather than each
     * defaulting to English independently.
     */
    readonly t: Translator;
    private state_: StateMachineModel;
    private bannerEl: HTMLElement | null;
    private paintedTransitions: SVGGElement | null = null;
    private paintedPlaces: SVGGElement | null = null;
    private readonly emitter = new Emitter<StateMachineEvents>();
    private disposed = false;
    private readonly svgGroup: SVGGElement;
    private readonly instanceId: number;
    /** Selection state for the property-panel binding. */
    private readonly selection_ = new SmSelection();
    /** Undo/redo stack the property panel dispatches edits through. */
    private readonly commandStack_: CommandStack;
    /** Whether this editor owns (and must dispose) its command stack, vs sharing the shell's. */
    private readonly ownsCommandStack: boolean;

    constructor(options: StateMachineEditorOptions) {
        this.t = options.t ?? defaultTranslator;
        this.instanceId = ++stateMachineEditorInstanceCounter;
        this.svgGroup = options.svgGroup;
        this.ownsCommandStack = options.commands === undefined;
        this.commandStack_ = options.commands ?? new CommandStack();
        this.state_ = this.withAutoLayout(
            options.initialModel ?? emptyStateMachineModel(),
        );
        this.bannerEl = this.mountBanner(options.host);
        this.svgGroup.addEventListener('click', this.onCanvasClick);
        this.repaint();
    }

    get state(): StateMachineModel {
        return this.state_;
    }

    /** Selection state (the property panel binds to this). */
    get selection(): SmSelection {
        return this.selection_;
    }

    /** Undo/redo stack (the property panel dispatches commands here). */
    get commandStack(): CommandStack {
        return this.commandStack_;
    }

    /**
     * Replace the model + repaint + emit `change`. Used by the
     * host's load flow. A model that arrives fully at the origin
     * (the deserialize case — workflow YAML carries no diagram
     * geometry) is
     * auto-laid-out into columns; a model that already carries positions
     * is respected verbatim.
     */
    load(model: StateMachineModel): void {
        if (this.disposed) return;
        this.selection_.clear();
        this.commandStack_.clear();
        this.state_ = this.withAutoLayout(model);
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Force a topological re-arrange of every place (the "Auto-arrange"
     * affordance). Unlike the load-time pass, this discards existing
     * positions first so it always re-lays-out, then repaints + emits.
     * No-op when there are no places.
     */
    autoLayout(): void {
        if (this.disposed || this.state_.places.length === 0) return;
        const zeroed = this.state_.places.map((p) => ({
            ...p,
            position: { x: 0, y: 0 },
        }));
        this.state_ = {
            ...this.state_,
            places: autoLayoutStateMachine(zeroed, this.state_.transitions),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Thread auto-layout into the model. The pure
     * {@link autoLayoutStateMachine} already encodes the all-or-nothing
     * bail-out (a model that already carries positions comes back with
     * those positions intact), so this just swaps in the resulting places.
     */
    private withAutoLayout(model: StateMachineModel): StateMachineModel {
        return {
            ...model,
            places: autoLayoutStateMachine(model.places, model.transitions),
        };
    }

    onChange(listener: (state: StateMachineModel) => void): () => void {
        return this.emitter.on('change', listener);
    }

    /** Look up a place by id (its Symfony place name). Returns `null` on a miss. */
    findPlace(id: string): SmPlace | null {
        return this.state_.places.find((p) => p.id === id) ?? null;
    }

    /** Look up a transition by id. Returns `null` on a miss. */
    findTransition(id: string): SmTransition | null {
        return this.state_.transitions.find((t) => t.id === id) ?? null;
    }

    /**
     * Mint a free place id for a new state.
     *
     * ⚠️ A place's `id` IS its Symfony place name — it lands verbatim in
     * `framework.workflows.<name>.places`, so it must read as a state
     * ("draft", "published"), not as a surrogate key. `state_1` is a
     * placeholder the author is expected to rename via the property
     * panel, which is why {@link RenamePlaceCommand} exists and rewrites
     * incident transitions.
     */
    suggestPlaceId(): string {
        const taken = new Set(this.state_.places.map((p) => p.id));
        let n = this.state_.places.length + 1;
        let id = `state_${n}`;
        while (taken.has(id)) {
            n++;
            id = `state_${n}`;
        }
        return id;
    }

    /** Mint a free transition id (`t_1`, …) for a new edge. */
    suggestTransitionId(): string {
        const taken = new Set(this.state_.transitions.map((t) => t.id));
        let n = this.state_.transitions.length + 1;
        let id = `t_${n}`;
        while (taken.has(id)) {
            n++;
            id = `t_${n}`;
        }
        return id;
    }

    /**
     * Where to drop the next new place.
     *
     * Places are laid out in columns by {@link autoLayoutStateMachine},
     * but that BAILS once anything is positioned — so a new place needs
     * a sane spot of its own rather than landing on top of an existing
     * one. Right of the current content, vertically aligned with it.
     */
    suggestPlacePosition(): SmPosition {
        const bbox = this.contentBbox();
        if (bbox === null) return { x: 80, y: 80 };
        return { x: bbox.right + 60, y: bbox.top };
    }

    /**
     * Bounding box of all painted places (for the shell's
     * fit-to-content). `null` when there are no places. Padded a little
     * on the left for the initial-state entry marker (which paints ~18px
     * left of the first column's place box).
     */
    contentBbox(): { left: number; top: number; right: number; bottom: number } | null {
        if (this.state_.places.length === 0) return null;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const p of this.state_.places) {
            left = Math.min(left, p.position.x);
            top = Math.min(top, p.position.y);
            right = Math.max(right, p.position.x + p.size.width);
            bottom = Math.max(bottom, p.position.y + p.size.height);
        }
        return { left: left - 24, top: top - 8, right: right + 8, bottom: bottom + 8 };
    }

    // ─── Mutator seam (the commands call these) ───────────────────────────

    /**
     * Rename a place — its id IS the Symfony place name — and cascade the
     * new id to every incident transition's `from`/`to`. Symmetric, so the
     * {@link RenamePlaceCommand} reverts by calling this with the ids swapped.
     * No-op when `fromId === toId`.
     */
    renamePlace(fromId: string, toId: string): void {
        if (this.disposed || fromId === toId) return;
        const places = this.state_.places.map((p) =>
            p.id === fromId ? { ...p, id: toId } : p,
        );
        const transitions = this.state_.transitions.map((t) => {
            const from = t.from === fromId ? toId : t.from;
            const to = t.to === fromId ? toId : t.to;
            return from === t.from && to === t.to ? t : { ...t, from, to };
        });
        this.state_ = { ...this.state_, places, transitions };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /** The ids of every place currently flagged `initial`. */
    currentInitialPlaceIds(): string[] {
        return this.state_.places
            .filter((p) => p.initial === true)
            .map((p) => p.id);
    }

    /**
     * Set exactly the listed places as `initial`, clearing the flag on all
     * others. Enforces the `state_machine` single-initial invariant when
     * the caller passes one id; the {@link SetInitialPlaceCommand} restores
     * the prior set on revert.
     */
    applyInitialPlaces(initialIds: ReadonlyArray<string>): void {
        if (this.disposed) return;
        const wanted = new Set(initialIds);
        let changed = false;
        const places = this.state_.places.map((p) => {
            const shouldBe = wanted.has(p.id);
            if (shouldBe === (p.initial === true)) return p;
            changed = true;
            return shouldBe ? { ...p, initial: true } : withoutInitial(p);
        });
        if (!changed) return;
        this.state_ = { ...this.state_, places };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /** Update one editable property (`name`/`from`/`to`/`guard`) on a transition. */
    updateTransitionProperty(transitionId: string, key: string, value: unknown): void {
        if (this.disposed) return;
        let changed = false;
        const transitions = this.state_.transitions.map((t) => {
            if (t.id !== transitionId) return t;
            changed = true;
            if (key === 'guard') {
                const g = String(value ?? '');
                return g.trim().length === 0 ? withoutGuard(t) : { ...t, guard: g };
            }
            if (key === 'name') return { ...t, name: String(value ?? '') };
            if (key === 'from') return { ...t, from: String(value ?? '') };
            if (key === 'to') return { ...t, to: String(value ?? '') };
            return t;
        });
        if (!changed) return;
        this.state_ = { ...this.state_, transitions };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * delete seam — swap the places + transitions arrays wholesale,
     * then repaint + emit `change`. Unlike {@link load} this does NOT clear
     * the selection or the command stack (so it stays an undoable step), and
     * unlike the field mutators it touches both arrays at once. The
     * {@link RemovePlaceCommand} / {@link RemoveTransitionCommand} snapshot the
     * prior arrays and call this for both apply and revert.
     */
    replaceElements(
        places: ReadonlyArray<SmPlace>,
        transitions: ReadonlyArray<SmTransition>,
    ): void {
        if (this.disposed) return;
        this.state_ = { ...this.state_, places: [...places], transitions: [...transitions] };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Update one workflow-scope property. `supports` accepts the panel's
     * newline/comma-joined string (split into a class list); `auditTrail`
     * accepts a boolean (written to `workflowExtras.audit_trail`). No
     * repaint — these don't touch the canvas — but still emits `change`.
     */
    updateWorkflowProperty(key: string, value: unknown): void {
        if (this.disposed) return;
        switch (key) {
            case 'workflowName':
                this.state_ = { ...this.state_, workflowName: String(value ?? '') };
                break;
            case 'markingProperty':
                this.state_ = { ...this.state_, markingProperty: String(value ?? '') };
                break;
            case 'supports':
                this.state_ = { ...this.state_, supports: splitSupports(String(value ?? '')) };
                break;
            case 'auditTrail':
                this.setAuditTrail(Boolean(value));
                break;
            default:
                return;
        }
        this.emitter.emit('change', this.state_);
    }

    /**
     * Read a workflow-scope property in the DISPLAY shape the property
     * panel's field reads + writes (so the field seed + the command's
     * inverse value match): `supports` → newline-joined string, `auditTrail`
     * → boolean, others → their string value.
     */
    readWorkflowDisplayValue(key: string): unknown {
        switch (key) {
            case 'workflowName':
                return this.state_.workflowName;
            case 'markingProperty':
                return this.state_.markingProperty;
            case 'supports':
                return this.state_.supports.join('\n');
            case 'auditTrail':
                return this.isAuditEnabled();
            default:
                return undefined;
        }
    }

    private isAuditEnabled(): boolean {
        const at = this.state_.workflowExtras?.['audit_trail'];
        return (
            typeof at === 'object' &&
            at !== null &&
            (at as { enabled?: unknown }).enabled === true
        );
    }

    private setAuditTrail(enabled: boolean): void {
        const prev = this.state_.workflowExtras ?? {};
        if (enabled) {
            this.state_ = {
                ...this.state_,
                workflowExtras: { ...prev, audit_trail: { enabled: true } },
            };
            return;
        }
        const next: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(prev)) {
            if (k !== 'audit_trail') next[k] = v;
        }
        // Omit the key entirely when empty (exactOptionalPropertyTypes forbids
        // assigning `undefined` to the optional workflowExtras slot).
        this.state_ =
            Object.keys(next).length === 0
                ? {
                      workflowName: this.state_.workflowName,
                      supports: this.state_.supports,
                      markingProperty: this.state_.markingProperty,
                      places: this.state_.places,
                      transitions: this.state_.transitions,
                  }
                : { ...this.state_, workflowExtras: next };
    }

    /**
     * Delegated canvas click → selection. Walks up from the event target to
     * the nearest painted place/transition `<g>` (keyed by the
     * `data-place-id` / `data-transition-id` the renderers stamp); a click
     * on empty canvas clears the selection (workflow scope).
     */
    private readonly onCanvasClick = (event: Event): void => {
        if (this.disposed) return;
        const target = event.target;
        if (!(target instanceof Element)) {
            this.selection_.clear();
            return;
        }
        const placeG = target.closest('[data-place-id]');
        if (placeG !== null) {
            this.selection_.select({
                kind: 'place',
                id: placeG.getAttribute('data-place-id') ?? '',
            });
            return;
        }
        const transitionG = target.closest('[data-transition-id]');
        if (transitionG !== null) {
            this.selection_.select({
                kind: 'transition',
                id: transitionG.getAttribute('data-transition-id') ?? '',
            });
            return;
        }
        this.selection_.clear();
    };

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.svgGroup.removeEventListener('click', this.onCanvasClick);
        this.selection_.dispose();
        if (this.ownsCommandStack) {
            this.commandStack_.dispose();
        }
        if (this.paintedTransitions !== null) {
            this.paintedTransitions.remove();
            this.paintedTransitions = null;
        }
        if (this.paintedPlaces !== null) {
            this.paintedPlaces.remove();
            this.paintedPlaces = null;
        }
        if (this.bannerEl !== null) {
            this.bannerEl.remove();
            this.bannerEl = null;
        }
        this.emitter.dispose();
    }

    /** Test affordance — the painted `<g>` holding the place shapes. */
    get paintedPlacesElement(): SVGGElement | null {
        return this.paintedPlaces;
    }

    /** Test affordance — the painted `<g>` holding the transition paths + `<defs>`. */
    get paintedTransitionsElement(): SVGGElement | null {
        return this.paintedTransitions;
    }

    /** Test affordance — the per-instance arrowhead marker id. */
    get arrowheadMarkerId(): string {
        return smArrowheadMarkerId(this.instanceId);
    }

    private repaint(): void {
        if (this.paintedTransitions !== null) {
            this.paintedTransitions.remove();
            this.paintedTransitions = null;
        }
        if (this.paintedPlaces !== null) {
            this.paintedPlaces.remove();
            this.paintedPlaces = null;
        }

        const doc = this.svgGroup.ownerDocument;
        const transitionsRoot = this.paintTransitionsGroup(doc);
        const placesRoot = this.paintPlacesGroup(doc);

        this.svgGroup.appendChild(transitionsRoot);
        this.svgGroup.appendChild(placesRoot);

        this.paintedTransitions = transitionsRoot;
        this.paintedPlaces = placesRoot;

        this.refreshBannerVisibility();
    }

    private paintTransitionsGroup(doc: Document): SVGGElement {
        const root = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        root.classList.add('coolms-designer__sm-transitions');

        const defs = doc.createElementNS(SVG_NS, 'defs');
        defs.appendChild(buildSmArrowheadMarker(doc, this.instanceId));
        root.appendChild(defs);

        const markerUrl = `url(#${smArrowheadMarkerId(this.instanceId)})`;
        const placesById = new Map<string, SmPlace>();
        for (const place of this.state_.places) {
            placesById.set(place.id, place);
        }

        for (const transition of this.state_.transitions) {
            const source = placesById.get(transition.from);
            const target = placesById.get(transition.to);
            if (source === undefined || target === undefined) {
                // Dangling endpoint — model is mid-edit. Skip silently;
                // + the Symfony compiler catch it on deploy.
                continue;
            }
            root.appendChild(
                renderTransition(transition, source, target, doc, markerUrl),
            );
        }

        return root;
    }

    private paintPlacesGroup(doc: Document): SVGGElement {
        const root = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        root.classList.add('coolms-designer__sm-places');
        for (const place of this.state_.places) {
            root.appendChild(renderPlace(place, doc));
        }
        return root;
    }

    private mountBanner(host: HTMLElement): HTMLElement {
        const doc = host.ownerDocument;
        const banner = doc.createElement('div');
        banner.classList.add('coolms-designer__sm-banner');
        banner.setAttribute('data-coolms-designer-scaffold', 'state-machine');

        const title = doc.createElement('div');
        title.classList.add('coolms-designer__sm-banner-title');
        title.textContent = this.t('designer.sm.banner.title', 'State Machine editor');
        banner.appendChild(title);

        const subtitle = doc.createElement('div');
        subtitle.classList.add('coolms-designer__sm-banner-subtitle');
        subtitle.textContent = this.t(
            'designer.sm.banner.subtitle',
            'Add a place to start modelling your state machine',
        );
        banner.appendChild(subtitle);

        host.appendChild(banner);
        return banner;
    }

    private refreshBannerVisibility(): void {
        if (this.bannerEl === null) return;
        const isEmpty =
            this.state_.places.length === 0 &&
            this.state_.transitions.length === 0;
        this.bannerEl.style.display = isEmpty ? '' : 'none';
    }
}

/**
 * Parse the property panel's `supports` field — a newline/comma-separated
 * list of entity FQCNs — into the model's `string[]`. Blanks are dropped.
 */
function splitSupports(value: string): string[] {
    return value
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * Rebuild a place with the `initial` flag omitted (not set to `undefined`)
 * while preserving any `extras` passthrough — `exactOptionalPropertyTypes`
 * forbids assigning `undefined` to an optional slot, so we omit the key.
 */
function withoutInitial(p: SmPlace): SmPlace {
    return p.extras !== undefined
        ? { id: p.id, position: p.position, size: p.size, extras: p.extras }
        : { id: p.id, position: p.position, size: p.size };
}

/** Rebuild a transition with the `guard` omitted, preserving `extras`. */
function withoutGuard(t: SmTransition): SmTransition {
    return t.extras !== undefined
        ? { id: t.id, name: t.name, from: t.from, to: t.to, extras: t.extras }
        : { id: t.id, name: t.name, from: t.from, to: t.to };
}
