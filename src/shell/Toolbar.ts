import type { CommandStack } from '../canvas/CommandStack.js';
import type { Viewport } from '../canvas/Viewport.js';

export interface ToolbarLabels {
    readonly save: string;
    readonly deploy: string;
    readonly undo: string;
    readonly redo: string;
    readonly zoomIn: string;
    readonly zoomOut: string;
    readonly zoomReset: string;
    readonly zoomFit: string;
    readonly connect: string;
    readonly connectExit: string;
    readonly hand: string;
    readonly handExit: string;
}

const DEFAULT_LABELS: ToolbarLabels = {
    save: 'Save',
    deploy: 'Deploy',
    undo: 'Undo',
    redo: 'Redo',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Reset zoom',
    zoomFit: 'Fit diagram to canvas',
    connect: 'Connect mode — draw flows between elements',
    connectExit: 'Exit connect mode',
    hand: 'Hand tool — drag to pan the canvas',
    handExit: 'Exit hand tool',
};

export interface ToolbarOptions {
    readonly commands: CommandStack;
    readonly viewport: Viewport;
    /**
     * Save handler. If omitted, the save button is not rendered. May be
     * async -- the button is disabled while the returned promise is
     * pending so consumers don't fire concurrent saves.
     */
    readonly onSave?: () => void | Promise<void>;
    /** Deploy handler. If omitted, the deploy button is not rendered. */
    readonly onDeploy?: () => void | Promise<void>;
    /**
     * polish-bundle (F-6) -- connect-mode toggle. If omitted,
     * the connect button is not rendered. Each invocation flips the
     * surface's connect mode; the surface owns the active-state
     * machine + calls `setConnectActive(...)` back on the toolbar
     * to keep the button's pressed styling in sync.
     */
    readonly onToggleConnect?: () => void;
    /**
     * polish-bundle (F-6) -- hand-tool (pan) toggle. Same
     * shape as `onToggleConnect`. Surfaces without an explicit pan
     * mode (DMN table) simply don't pass this option.
     */
    readonly onToggleHand?: () => void;
    /**
     * polish-bundle (F-7.4) -- fit-to-content callback. If
     * omitted, the Fit button is not rendered. The surface owns the
     * bbox computation; the toolbar just exposes the affordance. Each
     * invocation re-fits whatever content the surface currently shows.
     */
    readonly onFit?: () => void;
    /**
     * Read-only mode hides save/deploy/undo/redo entirely. Zoom controls
     * stay visible because viewing a read-only diagram still benefits
     * from zoom. The mode-toggle buttons (Connect, Hand) ALSO hide --
     * a read-only viewer doesn't draw edges or need an explicit pan
     * mode (middle-click + wheel still pan).
     */
    readonly readOnly?: boolean;
    /** Override one or more button labels (for i18n at the consumer layer). */
    readonly labels?: Partial<ToolbarLabels>;
    /**
     * Multiplicative zoom factor for the zoom-in / zoom-out buttons.
     * Default 1.25. Wheel zoom step is independent (canvas option).
     */
    readonly zoomStep?: number;
}

/**
 * Top-bar chrome with save / deploy / undo / redo / zoom controls.
 *
 * Subscribes to {@link CommandStack.onChange} to live-update the undo /
 * redo button enabled state + tooltips (showing the next undo/redo
 * label). Subscribes to {@link Viewport.onChange} to live-update the
 * zoom percentage indicator.
 *
 * Read-only mode hides every mutation control (save / deploy / undo /
 * redo) but keeps zoom -- M4 cockpit's instance-detail screens render
 * read-only diagrams that still want zoom.
 *
 * The toolbar is INTERNAL chrome; surface code does NOT directly mount
 * extra controls here. Custom toolbar slots are deferred to a later
 * phase if a surface actually needs them.
 *
 * Async save/deploy guard: while the returned promise is pending the
 * button is disabled + carries `aria-busy="true"`. Errors are NOT
 * surfaced in the toolbar UI -- the consumer's onSave handler is
 * expected to display its own toast / banner (the Angular wrapper at
 * does this via the platform notification service).
 */
export class Toolbar {
    private readonly host: HTMLElement;
    /**
     * F-8 redesign -- the toolbar is now a SINGLE horizontal row of
     * subgroups, separated by visual dividers. The old left/right
     * group split is gone -- the right end was just zoom, which now
     * lives in the viewport subgroup. Save/deploy live in a leading
     * "action" subgroup only when wired (BPMN-Lite dialog uses footer
     * buttons + leaves both undefined, so the action subgroup stays
     * empty + invisible).
     *
     * Subgroups (left to right):
     *  1. **actionGroup** -- save, deploy (consumer-wired)
     *  2. **historyGroup** -- undo, redo
     *  3. **viewportGroup** -- hand, fit, zoom-, %, zoom+
     *  4. **creationGroup** -- connect, then palette items (consumer-mounted)
     *
     * Each subgroup is a flex row; separators sit between subgroups.
     * Read-only mode collapses #1 + #2 + #4 (creation) entirely so
     * only #3 (viewport) remains.
     */
    private readonly actionGroup: HTMLElement;
    private readonly historyGroup: HTMLElement;
    private readonly viewportGroup: HTMLElement;
    private readonly creationGroup: HTMLElement;
    private readonly labels: ToolbarLabels;
    private readonly commands: CommandStack;
    private readonly viewport: Viewport;
    private readonly readOnly: boolean;
    private readonly onSave?: () => void | Promise<void>;
    private readonly onDeploy?: () => void | Promise<void>;
    private readonly onToggleConnect?: () => void;
    private readonly onToggleHand?: () => void;
    private readonly onFit?: () => void;
    private readonly zoomStep: number;

    private readonly buttons: {
        save?: HTMLButtonElement;
        deploy?: HTMLButtonElement;
        undo?: HTMLButtonElement;
        redo?: HTMLButtonElement;
        connect?: HTMLButtonElement;
        hand?: HTMLButtonElement;
        zoomFit?: HTMLButtonElement;
        zoomIn: HTMLButtonElement;
        zoomOut: HTMLButtonElement;
        zoomReset: HTMLButtonElement;
    };
    private readonly subscriptions: Array<() => void> = [];
    private disposed = false;

    constructor(parent: Element, options: ToolbarOptions) {
        const doc = parent.ownerDocument;
        this.commands = options.commands;
        this.viewport = options.viewport;
        this.readOnly = options.readOnly ?? false;
        if (options.onSave !== undefined) {
            this.onSave = options.onSave;
        }
        if (options.onDeploy !== undefined) {
            this.onDeploy = options.onDeploy;
        }
        if (options.onToggleConnect !== undefined) {
            this.onToggleConnect = options.onToggleConnect;
        }
        if (options.onToggleHand !== undefined) {
            this.onToggleHand = options.onToggleHand;
        }
        if (options.onFit !== undefined) {
            this.onFit = options.onFit;
        }
        this.labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
        this.zoomStep = Math.max(1.001, options.zoomStep ?? 1.25);

        this.host = doc.createElement('div');
        this.host.classList.add('coolms-designer__toolbar');
        this.host.setAttribute('role', 'toolbar');
        this.host.setAttribute('aria-label', 'Designer toolbar');

        // F-8 redesign -- four subgroups in document order. The
        // `--action` and `--creation` subgroups stay empty when their
        // respective callbacks aren't wired; CSS collapses empty
        // subgroups via `:empty` so they take zero width + no
        // separators render around them.
        this.actionGroup = this.createSubgroup(doc, 'action');
        this.historyGroup = this.createSubgroup(doc, 'history');
        this.viewportGroup = this.createSubgroup(doc, 'viewport');
        this.creationGroup = this.createSubgroup(doc, 'creation');

        // F-8 redesign -- viewport subgroup carries Hand + Fit + Zoom
        // cluster in a single flow. Order matches the user's mental
        // model: "what camera operation do I want" (hand pan) ->
        // "frame everything" (fit) -> "scale" (zoom in/out + reset).
        // F-3 keeps the bi-* icon vocabulary; F-7.4 keeps Fit's
        // bi-arrows-fullscreen glyph.
        if (this.onToggleHand && !this.readOnly) {
            this.buttons = {
                ...this.createZoomCluster(),
                hand: this.createIconButton(
                    this.viewportGroup,
                    'hand',
                    'bi-hand-index',
                    this.labels.hand,
                ),
            };
            // Hand button minted last so we can move it to the FRONT
            // of viewportGroup -- the cluster needs to read Hand ->
            // Fit -> Zoom-out -> % -> Zoom-in left to right.
            this.viewportGroup.insertBefore(
                this.buttons.hand!,
                this.viewportGroup.firstChild,
            );
            this.buttons.hand!.setAttribute('aria-pressed', 'false');
        } else {
            this.buttons = this.createZoomCluster();
        }

        if (!this.readOnly) {
            if (this.onSave) {
                this.buttons.save = this.createButton(this.actionGroup, 'save', this.labels.save, this.labels.save);
            }
            if (this.onDeploy) {
                this.buttons.deploy = this.createButton(this.actionGroup, 'deploy', this.labels.deploy, this.labels.deploy);
            }
            // bi-arrow-counterclockwise / bi-arrow-clockwise match the
            // Image Editor's top-toolbar undo/redo glyphs verbatim.
            this.buttons.undo = this.createIconButton(this.historyGroup, 'undo', 'bi-arrow-counterclockwise', this.labels.undo);
            this.buttons.redo = this.createIconButton(this.historyGroup, 'redo', 'bi-arrow-clockwise', this.labels.redo);

            // F-8 redesign -- Connect heads the creation subgroup;
            // the palette items the consumer mounts via
            // {@link paletteHost} follow it in the same row, so
            // "draw a flow" + "drop an element" read as sibling
            // create-tools.
            if (this.onToggleConnect) {
                this.buttons.connect = this.createIconButton(
                    this.creationGroup,
                    'connect',
                    'bi-arrow-up-right',
                    this.labels.connect,
                );
                this.buttons.connect.setAttribute('aria-pressed', 'false');
            }
        }

        // Wire actions
        if (this.buttons.save) {
            this.attachAsyncHandler(this.buttons.save, () => this.onSave?.());
        }
        if (this.buttons.deploy) {
            this.attachAsyncHandler(this.buttons.deploy, () => this.onDeploy?.());
        }
        if (this.buttons.undo) {
            this.buttons.undo.addEventListener('click', () => {
                this.commands.undo();
            });
        }
        if (this.buttons.redo) {
            this.buttons.redo.addEventListener('click', () => {
                this.commands.redo();
            });
        }
        if (this.buttons.connect) {
            this.buttons.connect.addEventListener('click', () => {
                this.onToggleConnect?.();
            });
        }
        if (this.buttons.hand) {
            this.buttons.hand.addEventListener('click', () => {
                this.onToggleHand?.();
            });
        }
        this.buttons.zoomIn.addEventListener('click', () => this.viewport.zoomBy(this.zoomStep));
        this.buttons.zoomOut.addEventListener('click', () => this.viewport.zoomBy(1 / this.zoomStep));
        this.buttons.zoomReset.addEventListener('click', () => this.viewport.setZoom(1));
        if (this.buttons.zoomFit) {
            this.buttons.zoomFit.addEventListener('click', () => {
                this.onFit?.();
            });
        }

        // Subscribe to live state
        this.subscriptions.push(this.commands.onChange(() => this.syncCommandState()));
        this.subscriptions.push(this.viewport.onChange(() => this.syncZoomState()));

        // Initial render
        this.syncCommandState();
        this.syncZoomState();

        parent.appendChild(this.host);
    }

    get element(): HTMLElement {
        return this.host;
    }

    /**
     * F-8 redesign -- the toolbar's "creation" subgroup is now the
     * mount point for surface-specific palette drag sources. The
     * BPMN-Lite dialog's `Palette` appends its drag-source buttons
     * here; the Connect button (when wired) sits at the FRONT of
     * this same subgroup so create-tools cluster together. The
     * shell does NOT clear or manage palette content; the surface
     * owns its own mount + dispose lifecycle, same contract as the
     * old `sidebar.paletteHost` (which is gone now -- the right
     * sidebar is property-panel-only after F-8).
     */
    get paletteHost(): HTMLElement {
        return this.creationGroup;
    }

    private createSubgroup(doc: Document, kind: string): HTMLElement {
        const group = doc.createElement('div');
        group.classList.add(
            'coolms-designer__toolbar-group',
            `coolms-designer__toolbar-group--${kind}`,
        );
        this.host.appendChild(group);
        return group;
    }

    /**
     * F-8 helper -- mint the Fit + Zoom-out + 100% + Zoom-in
     * cluster into the viewport subgroup. Returns the four button
     * refs so the caller can fold them into the
     * {@link Toolbar.buttons} record. Fit only mounts when `onFit`
     * was wired.
     */
    private createZoomCluster(): {
        zoomOut: HTMLButtonElement;
        zoomReset: HTMLButtonElement;
        zoomIn: HTMLButtonElement;
        zoomFit?: HTMLButtonElement;
    } {
        const out: {
            zoomOut: HTMLButtonElement;
            zoomReset: HTMLButtonElement;
            zoomIn: HTMLButtonElement;
            zoomFit?: HTMLButtonElement;
        } = {
            zoomOut: this.createIconButton(
                this.viewportGroup,
                'zoom-out',
                'bi-zoom-out',
                this.labels.zoomOut,
            ),
            zoomReset: this.createButton(
                this.viewportGroup,
                'zoom-reset',
                '100%',
                this.labels.zoomReset,
            ),
            zoomIn: this.createIconButton(
                this.viewportGroup,
                'zoom-in',
                'bi-zoom-in',
                this.labels.zoomIn,
            ),
        };
        if (this.onFit) {
            // Insert BEFORE zoom-out so the visual order reads
            // [fit] [zoom-out] [100%] [zoom-in]. After F-8, Hand
            // (when present) gets inserted EVEN earlier so the
            // full viewport cluster reads [hand] [fit] [zoom-out]
            // [100%] [zoom-in].
            out.zoomFit = this.createIconButton(
                this.viewportGroup,
                'zoom-fit',
                'bi-arrows-fullscreen',
                this.labels.zoomFit,
            );
            this.viewportGroup.insertBefore(out.zoomFit, out.zoomOut);
        }
        out.zoomReset.classList.add(
            'coolms-designer__toolbar-button--zoom-display',
        );
        return out;
    }

    /**
     * polish-bundle (F-6) -- flip the Connect mode toggle's
     * pressed state. The dialog (or any host that owns the
     * ConnectMode controller) calls this whenever the mode flips so
     * the button's `aria-pressed` + the `--mode-active` CSS class
     * (which the modifier class drives) stay in sync with the
     * actual mode controller state. No-op when the button isn't
     * mounted (e.g. read-only or surface didn't wire a connect
     * callback).
     */
    setConnectActive(active: boolean): void {
        this.applyModeActive(this.buttons.connect, active, this.labels.connect, this.labels.connectExit);
    }

    /**
     * polish-bundle (F-6) -- mirror of {@link setConnectActive}
     * for the Hand-tool (pan) toggle.
     */
    setHandActive(active: boolean): void {
        this.applyModeActive(this.buttons.hand, active, this.labels.hand, this.labels.handExit);
    }

    private applyModeActive(
        btn: HTMLButtonElement | undefined,
        active: boolean,
        idleLabel: string,
        activeLabel: string,
    ): void {
        if (btn === undefined) return;
        btn.classList.toggle('coolms-designer__toolbar-button--mode-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        const tip = active ? activeLabel : idleLabel;
        btn.setAttribute('aria-label', tip);
        btn.title = tip;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const off of this.subscriptions) off();
        this.subscriptions.length = 0;
        this.host.remove();
    }

    private createButton(
        parent: Element,
        action: string,
        text: string,
        ariaLabel: string,
    ): HTMLButtonElement {
        const doc = parent.ownerDocument;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.classList.add('coolms-designer__toolbar-button');
        btn.setAttribute('data-action', action);
        btn.setAttribute('aria-label', ariaLabel);
        btn.title = ariaLabel;
        btn.textContent = text;
        parent.appendChild(btn);
        return btn;
    }

    /**
     * polish-bundle (F-3) -- mount a button whose visible glyph
     * is a Bootstrap-Icons span. The `aria-label` continues to surface
     * the human label so assistive tech reads the action correctly;
     * the `<i>` child is `aria-hidden` (the bi-* class is purely
     * presentational). The icon class is appended as a separate class
     * token alongside the base `bi` class -- matches the Image Editor
     * top-toolbar's `<i class="bi bi-zoom-out"></i>` pattern.
     *
     * **Consumer assumption**: Bootstrap Icons CSS is loaded by the
     * host app. The theme-admin Angular app bundles bootstrap-icons
     * globally, so both the routed `BpmnEditorPage` and the modal
     * `BpmnEditorDialogComponent` render the glyphs correctly. A
     * standalone consumer without the CSS would see empty buttons --
     * documented in the package README.
     */
    private createIconButton(
        parent: Element,
        action: string,
        biClass: string,
        ariaLabel: string,
    ): HTMLButtonElement {
        const doc = parent.ownerDocument;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.classList.add('coolms-designer__toolbar-button');
        btn.classList.add('coolms-designer__toolbar-button--icon');
        btn.setAttribute('data-action', action);
        btn.setAttribute('aria-label', ariaLabel);
        btn.title = ariaLabel;
        const icon = doc.createElement('i');
        icon.classList.add('bi');
        icon.classList.add(biClass);
        icon.setAttribute('aria-hidden', 'true');
        btn.appendChild(icon);
        parent.appendChild(btn);
        return btn;
    }

    private attachAsyncHandler(
        button: HTMLButtonElement,
        handler: () => void | Promise<void>,
    ): void {
        button.addEventListener('click', () => {
            if (button.disabled) return;
            const result = handler();
            if (!(result instanceof Promise)) return;

            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            // `.finally()` returns a new promise that mirrors the upstream
            // rejection -- catch it so a rejected save/deploy doesn't leak
            // an unhandled-rejection. The consumer's own onSave/onDeploy
            // promise rejects independently; surfacing user-visible errors
            // is the consumer's job (the Angular wrapper at M3.2.h fires a
            // toast via the platform notification service).
            result
                .finally(() => {
                    if (this.disposed) return;
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                })
                .catch(() => {
                    /* swallowed: see comment above */
                });
        });
    }

    private syncCommandState(): void {
        if (this.buttons.undo) {
            this.buttons.undo.disabled = !this.commands.canUndo;
            this.buttons.undo.title = this.commands.nextUndoLabel
                ? `${this.labels.undo}: ${this.commands.nextUndoLabel}`
                : this.labels.undo;
        }
        if (this.buttons.redo) {
            this.buttons.redo.disabled = !this.commands.canRedo;
            this.buttons.redo.title = this.commands.nextRedoLabel
                ? `${this.labels.redo}: ${this.commands.nextRedoLabel}`
                : this.labels.redo;
        }
    }

    private syncZoomState(): void {
        const pct = Math.round(this.viewport.state.zoom * 100);
        // polish-bundle (F-3) -- the zoom-reset button doubles
        // as the percentage indicator (Image Editor pattern). The
        // previously separate `zoom-indicator` span is gone; one
        // clickable element shows the current zoom + resets to 100%
        // on click.
        this.buttons.zoomReset.textContent = `${pct}%`;
    }
}
