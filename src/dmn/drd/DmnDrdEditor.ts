import { CommandStack } from '../../canvas/CommandStack.js';
import { defaultTranslator } from '../../i18n.js';
import type { Translator } from '../../i18n.js';
import { Emitter } from '../../internal/Emitter.js';
import { autoLayoutDmnDrd } from './autoLayout.js';
import { DrdSelection } from './DrdSelection.js';
import {
    buildDrdArrowheadMarker,
    drdArrowheadMarkerId,
    renderRequirement,
} from './renderers/edgeRenderers.js';
import { renderElement } from './renderers/ElementRendererRegistry.js';
import { SVG_NS } from './renderers/svg.js';
import { emptyDmnDrdModel } from './types.js';
import type {
    DmnDrdElement,
    DmnDrdElementKind,
    DmnDrdModel,
    DmnDrdPosition,
    DmnInformationRequirement,
} from './types.js';

/** Process-wide instance counter — gives each editor a unique arrowhead `<marker>` id. */
let dmnDrdEditorInstanceCounter = 0;

/** Construction options for {@link DmnDrdEditor}. */
export interface DmnDrdEditorOptions {
    /**
     * Resolves this component's user-visible text. Defaults to the English
     * written at each call site, so nothing needs configuring to work.
     */
    readonly t?: Translator;

    readonly host: HTMLElement;
    /** The canvas root `<g>` (under the viewport transform) the editor paints into. */
    readonly svgGroup: SVGGElement;
    readonly initialModel?: DmnDrdModel;
    /**
     * Share the host shell's {@link CommandStack} so the shell's
     * toolbar undo/redo drive the same history the (future) property
     * panel dispatches through. When omitted (headless tests), the
     * editor owns a private stack.
     */
    readonly commands?: CommandStack;
}

interface DmnDrdEvents extends Record<string, unknown> {
    change: DmnDrdModel;
}

/**
 * DMN DRD editor — the fourth surface on the `@coolms/designer`
 * substrate, after the DMN table, BPMN-Lite and the state machine.
 * It owns the render half: an immutable {@link DmnDrdModel} painted
 * onto the shared canvas — Decision/InputData nodes joined by
 * InformationRequirement arrows. The palette, connect mode, property
 * panel and the DMN-XML serializer compose around it.
 *
 * **Two paint groups inside `svgGroup`, in document order** (mirroring
 * the state-machine editor): a `…__drd-requirements` group (edges + the
 * `<defs>` arrowhead marker) appended FIRST so it paints UNDER the
 * `…__drd-elements` group, so node boxes cover the arrowhead tips
 * arriving at them. Dangling requirement endpoints (a `from`/`to` that
 * resolves to no node) — and any self-reference — are skipped silently;
 * the model may hold draft state mid-edit, and the future serializer +
 * backend DMN parser surface those on deploy.
 */
export class DmnDrdEditor {
    /**
     * The translator this editor renders with. Public so the commands and
     * surface controllers built around it share one, rather than each
     * defaulting to English independently.
     */
    readonly t: Translator;
    private state_: DmnDrdModel;
    private bannerEl: HTMLElement | null;
    private paintedRequirements: SVGGElement | null = null;
    private paintedElements: SVGGElement | null = null;
    private readonly emitter = new Emitter<DmnDrdEvents>();
    private disposed = false;
    private readonly svgGroup: SVGGElement;
    private readonly instanceId: number;
    /** Selection state for the (future) property-panel binding. */
    private readonly selection_ = new DrdSelection();
    /** Undo/redo stack the future property panel dispatches edits through. */
    private readonly commandStack_: CommandStack;
    /** Whether this editor owns (and must dispose) its command stack, vs sharing the shell's. */
    private readonly ownsCommandStack: boolean;

    constructor(options: DmnDrdEditorOptions) {
        this.t = options.t ?? defaultTranslator;
        this.instanceId = ++dmnDrdEditorInstanceCounter;
        this.svgGroup = options.svgGroup;
        this.ownsCommandStack = options.commands === undefined;
        this.commandStack_ = options.commands ?? new CommandStack();
        this.state_ = this.withAutoLayout(
            options.initialModel ?? emptyDmnDrdModel(),
        );
        this.bannerEl = this.mountBanner(options.host);
        this.svgGroup.addEventListener('click', this.onCanvasClick);
        this.repaint();
    }

    get state(): DmnDrdModel {
        return this.state_;
    }

    /** Selection state (the future property panel binds to this). */
    get selection(): DrdSelection {
        return this.selection_;
    }

    /** Undo/redo stack (the future property panel dispatches commands here). */
    get commandStack(): CommandStack {
        return this.commandStack_;
    }

    /**
     * Replace the model + repaint + emit `change`. A model that arrives
     * fully at the origin (the deserialize case — DMN XML with no DMNDI
     * carries no diagram geometry) is auto-laid-out into columns; a
     * model that already carries positions is respected verbatim.
     */
    load(model: DmnDrdModel): void {
        if (this.disposed) return;
        this.selection_.clear();
        this.commandStack_.clear();
        this.state_ = this.withAutoLayout(model);
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Force a topological re-arrange of every node (the "Auto-arrange"
     * affordance). Unlike the load-time pass, this discards existing
     * positions first so it always re-lays-out, then repaints + emits.
     * No-op when there are no nodes.
     */
    autoLayout(): void {
        if (this.disposed || this.state_.elements.length === 0) return;
        const zeroed = this.state_.elements.map((e) => ({
            ...e,
            position: { x: 0, y: 0 },
        }));
        this.state_ = {
            ...this.state_,
            elements: autoLayoutDmnDrd(zeroed, this.state_.requirements),
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Thread auto-layout into the model. The pure {@link autoLayoutDmnDrd}
     * already encodes the all-or-nothing bail-out (a model that already
     * carries positions comes back with those positions intact), so this
     * just swaps in the resulting elements.
     */
    private withAutoLayout(model: DmnDrdModel): DmnDrdModel {
        return {
            ...model,
            elements: autoLayoutDmnDrd(model.elements, model.requirements),
        };
    }

    onChange(listener: (state: DmnDrdModel) => void): () => void {
        return this.emitter.on('change', listener);
    }

    /** Look up a node by id. Returns `null` on a miss. */
    findElement(id: string): DmnDrdElement | null {
        return this.state_.elements.find((e) => e.id === id) ?? null;
    }

    /** Look up a requirement by id. Returns `null` on a miss. */
    findRequirement(id: string): DmnInformationRequirement | null {
        return this.state_.requirements.find((r) => r.id === id) ?? null;
    }

    /**
     * Bounding box of all painted nodes (for the shell's fit-to-content).
     * `null` when there are no nodes. Padded a little on every side.
     */
    contentBbox(): { left: number; top: number; right: number; bottom: number } | null {
        if (this.state_.elements.length === 0) return null;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const e of this.state_.elements) {
            left = Math.min(left, e.position.x);
            top = Math.min(top, e.position.y);
            right = Math.max(right, e.position.x + e.size.width);
            bottom = Math.max(bottom, e.position.y + e.size.height);
        }
        return { left: left - 12, top: top - 12, right: right + 12, bottom: bottom + 12 };
    }

    // ─── slice-2 mutator seam (the property-panel commands call these) ────

    /**
     * Update one editable property (`name` / `decisionLogicRef`) on an
     * element. Unlike a state-machine place rename, a DRD element's `id`
     * is stable canvas identity — NOT its name — so this never touches
     * requirement endpoints (which reference ids). A blank
     * `decisionLogicRef` is omitted rather than stored as `''`
     * (`exactOptionalPropertyTypes`).
     */
    updateElementProperty(elementId: string, key: string, value: unknown): void {
        if (this.disposed) return;
        let changed = false;
        const elements = this.state_.elements.map((el) => {
            if (el.id !== elementId) return el;
            changed = true;
            if (key === 'name') return { ...el, name: String(value ?? '') };
            if (key === 'decisionLogicRef') {
                const ref = String(value ?? '');
                return ref.trim().length === 0
                    ? withoutDecisionLogicRef(el)
                    : { ...el, decisionLogicRef: ref };
            }
            return el;
        });
        if (!changed) return;
        this.state_ = { ...this.state_, elements };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /** Update one editable endpoint (`from` / `to`) on a requirement. */
    updateRequirementProperty(requirementId: string, key: string, value: unknown): void {
        if (this.disposed) return;
        let changed = false;
        const requirements = this.state_.requirements.map((r) => {
            if (r.id !== requirementId) return r;
            changed = true;
            if (key === 'from') return { ...r, from: String(value ?? '') };
            if (key === 'to') return { ...r, to: String(value ?? '') };
            return r;
        });
        if (!changed) return;
        this.state_ = { ...this.state_, requirements };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Update one diagram-scope property — `name` is the DRG / definition
     * key. No repaint (it doesn't touch the canvas) but still emits
     * `change`.
     */
    updateDiagramProperty(key: string, value: unknown): void {
        if (this.disposed) return;
        if (key !== 'name') return;
        this.state_ = { ...this.state_, name: String(value ?? '') };
        this.emitter.emit('change', this.state_);
    }

    /**
     * Read a diagram-scope property in the DISPLAY shape the property
     * panel's field reads + writes (so the field seed + the command's
     * inverse value match).
     */
    readDiagramDisplayValue(key: string): unknown {
        return key === 'name' ? this.state_.name : undefined;
    }

    // ─── slice-3 structural seam (palette / connect / drag / delete call these) ─

    /**
     * Append a fully-formed element (caller supplies the id, via
     * {@link suggestElementId}). A duplicate id is rejected silently —
     * requirement endpoints resolve by id, so two same-id nodes would
     * corrupt the graph.
     */
    addElement(element: DmnDrdElement): void {
        if (this.disposed) return;
        if (this.state_.elements.some((e) => e.id === element.id)) return;
        this.state_ = { ...this.state_, elements: [...this.state_.elements, element] };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Remove an element by id AND cascade-remove every requirement that
     * references it (`from` or `to`) — a dangling edge would otherwise be
     * silently dropped on paint but linger in the model. Clears the
     * selection if the removed element was selected. The
     * {@link RemoveElementCommand} captures the incident requirements
     * before calling this so undo can restore them.
     */
    removeElement(elementId: string): void {
        if (this.disposed) return;
        if (this.findElement(elementId) === null) return;
        this.state_ = {
            ...this.state_,
            elements: this.state_.elements.filter((e) => e.id !== elementId),
            requirements: this.state_.requirements.filter(
                (r) => r.from !== elementId && r.to !== elementId,
            ),
        };
        if (this.selection_.elementId === elementId) this.selection_.clear();
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /** Move an element to a new position (drag + {@link MoveElementCommand}). */
    moveElement(elementId: string, position: DmnDrdPosition): void {
        if (this.disposed) return;
        let changed = false;
        const elements = this.state_.elements.map((e) => {
            if (e.id !== elementId) return e;
            changed = true;
            return { ...e, position };
        });
        if (!changed) return;
        this.state_ = { ...this.state_, elements };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /** Append a fully-formed requirement (caller supplies the id). Duplicate id rejected. */
    addRequirement(requirement: DmnInformationRequirement): void {
        if (this.disposed) return;
        if (this.state_.requirements.some((r) => r.id === requirement.id)) return;
        this.state_ = {
            ...this.state_,
            requirements: [...this.state_.requirements, requirement],
        };
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /** Remove a requirement by id. Clears the selection if it was selected. */
    removeRequirement(requirementId: string): void {
        if (this.disposed) return;
        if (this.findRequirement(requirementId) === null) return;
        this.state_ = {
            ...this.state_,
            requirements: this.state_.requirements.filter((r) => r.id !== requirementId),
        };
        if (this.selection_.requirementId === requirementId) this.selection_.clear();
        this.repaint();
        this.emitter.emit('change', this.state_);
    }

    /**
     * Suggest a unique element id for a new node of the given kind —
     * `decision_1` / `input_1`, bumping the suffix past any collision.
     * Deterministic (no randomness) so the palette + tests are stable;
     * the caller is free to supply its own id instead.
     */
    suggestElementId(kind: DmnDrdElementKind): string {
        const prefix = kind === 'inputData' ? 'input' : 'decision';
        const taken = new Set(this.state_.elements.map((e) => e.id));
        let n = this.state_.elements.length + 1;
        let id = `${prefix}_${n}`;
        while (taken.has(id)) {
            n++;
            id = `${prefix}_${n}`;
        }
        return id;
    }

    /** Suggest a unique requirement id (`ir_1`, …) for a new edge. */
    suggestRequirementId(): string {
        const taken = new Set(this.state_.requirements.map((r) => r.id));
        let n = this.state_.requirements.length + 1;
        let id = `ir_${n}`;
        while (taken.has(id)) {
            n++;
            id = `ir_${n}`;
        }
        return id;
    }

    /**
     * Delegated canvas click → selection. Walks up from the event target
     * to the nearest painted node/requirement `<g>` (keyed by the
     * `data-element-id` / `data-requirement-id` the renderers stamp); a
     * click on empty canvas clears the selection (diagram scope).
     */
    private readonly onCanvasClick = (event: Event): void => {
        if (this.disposed) return;
        const target = event.target;
        if (!(target instanceof Element)) {
            this.selection_.clear();
            return;
        }
        const elementG = target.closest('[data-element-id]');
        if (elementG !== null) {
            this.selection_.select({
                kind: 'element',
                id: elementG.getAttribute('data-element-id') ?? '',
            });
            return;
        }
        const requirementG = target.closest('[data-requirement-id]');
        if (requirementG !== null) {
            this.selection_.select({
                kind: 'requirement',
                id: requirementG.getAttribute('data-requirement-id') ?? '',
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
        if (this.paintedRequirements !== null) {
            this.paintedRequirements.remove();
            this.paintedRequirements = null;
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

    /** Test affordance — the painted `<g>` holding the node shapes. */
    get paintedElementsElement(): SVGGElement | null {
        return this.paintedElements;
    }

    /** Test affordance — the painted `<g>` holding the requirement paths + `<defs>`. */
    get paintedRequirementsElement(): SVGGElement | null {
        return this.paintedRequirements;
    }

    /** Test affordance — the per-instance arrowhead marker id. */
    get arrowheadMarkerId(): string {
        return drdArrowheadMarkerId(this.instanceId);
    }

    private repaint(): void {
        if (this.paintedRequirements !== null) {
            this.paintedRequirements.remove();
            this.paintedRequirements = null;
        }
        if (this.paintedElements !== null) {
            this.paintedElements.remove();
            this.paintedElements = null;
        }

        const doc = this.svgGroup.ownerDocument;
        const requirementsRoot = this.paintRequirementsGroup(doc);
        const elementsRoot = this.paintElementsGroup(doc);

        this.svgGroup.appendChild(requirementsRoot);
        this.svgGroup.appendChild(elementsRoot);

        this.paintedRequirements = requirementsRoot;
        this.paintedElements = elementsRoot;

        this.refreshBannerVisibility();
    }

    private paintRequirementsGroup(doc: Document): SVGGElement {
        const root = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        root.classList.add('coolms-designer__drd-requirements');

        const defs = doc.createElementNS(SVG_NS, 'defs');
        defs.appendChild(buildDrdArrowheadMarker(doc, this.instanceId));
        root.appendChild(defs);

        const markerUrl = `url(#${drdArrowheadMarkerId(this.instanceId)})`;
        const elementsById = new Map<string, DmnDrdElement>();
        for (const el of this.state_.elements) {
            elementsById.set(el.id, el);
        }

        for (const requirement of this.state_.requirements) {
            if (requirement.from === requirement.to) {
                // A node can't require itself — skip (invalid / mid-edit).
                continue;
            }
            const source = elementsById.get(requirement.from);
            const target = elementsById.get(requirement.to);
            if (source === undefined || target === undefined) {
                // Dangling endpoint — model is mid-edit. Skip silently;
                // the serializer + the backend DMN parser catch it on deploy.
                continue;
            }
            root.appendChild(
                renderRequirement(requirement, source, target, doc, markerUrl),
            );
        }

        return root;
    }

    private paintElementsGroup(doc: Document): SVGGElement {
        const root = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
        root.classList.add('coolms-designer__drd-elements');
        for (const el of this.state_.elements) {
            root.appendChild(renderElement(el, doc));
        }
        return root;
    }

    private mountBanner(host: HTMLElement): HTMLElement {
        const doc = host.ownerDocument;
        const banner = doc.createElement('div');
        banner.classList.add('coolms-designer__drd-banner');
        banner.setAttribute('data-coolms-designer-scaffold', 'dmn-drd');

        const title = doc.createElement('div');
        title.classList.add('coolms-designer__drd-banner-title');
        title.textContent = this.t('designer.drd.banner.title', 'Decision Requirements editor');
        banner.appendChild(title);

        const subtitle = doc.createElement('div');
        subtitle.classList.add('coolms-designer__drd-banner-subtitle');
        subtitle.textContent = this.t(
            'designer.drd.banner.subtitle',
            'Add a decision or input to start modelling your DRD',
        );
        banner.appendChild(subtitle);

        host.appendChild(banner);
        return banner;
    }

    private refreshBannerVisibility(): void {
        if (this.bannerEl === null) return;
        const isEmpty =
            this.state_.elements.length === 0 &&
            this.state_.requirements.length === 0;
        this.bannerEl.style.display = isEmpty ? '' : 'none';
    }
}

/**
 * Rebuild an element with the `decisionLogicRef` omitted (not set to
 * `undefined`) while preserving any `extras` passthrough —
 * `exactOptionalPropertyTypes` forbids assigning `undefined` to an
 * optional slot, so we omit the key.
 */
function withoutDecisionLogicRef(el: DmnDrdElement): DmnDrdElement {
    return el.extras !== undefined
        ? {
              id: el.id,
              kind: el.kind,
              name: el.name,
              position: el.position,
              size: el.size,
              extras: el.extras,
          }
        : {
              id: el.id,
              kind: el.kind,
              name: el.name,
              position: el.position,
              size: el.size,
          };
}
