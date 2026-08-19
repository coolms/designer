import type { BpmnLiteEditor } from './BpmnLiteEditor.js';
import {
    PALETTE_ITEMS,
    paletteItemKey,
    paletteItemLabel,
    type PaletteItem,
} from './defaults.js';
import type { BpmnElementKind, BpmnEventSubtype } from './types.js';

/**
 * Options for constructing the M3.3.d {@link Palette}.
 */
export interface PaletteOptions {
    /**
     * Palette host element -- typically `editor.sidebar.paletteHost`
     * from the shell. Buttons append into this element in
     * {@link PALETTE_KINDS} order.
     */
    readonly host: HTMLElement;
    /**
     * The BpmnLiteEditor instance to drop elements into. The
     * palette calls `editor.dropElementAt(...)` on pointer-up over
     * the canvas; the editor handles coordinate translation +
     * command dispatch.
     */
    readonly editor: BpmnLiteEditor;
    /**
     * Optional override for the kinds the palette renders. Kind-only
     * shorthand for {@link items}; each kind becomes an untyped tile.
     * Retained because it predates typed events + is pinned by tests.
     * When both are supplied, `items` wins.
     */
    readonly kinds?: ReadonlyArray<BpmnElementKind>;
    /**
     * Optional override for the tiles the palette renders. Defaults to
     * {@link PALETTE_ITEMS}. Use this (not {@link kinds}) to ship a
     * palette carrying typed events, since a tile is a kind + subtype.
     */
    readonly items?: ReadonlyArray<PaletteItem>;
}

/**
 * Internal drag-state record. Lives only while the user is mid-drag
 * from a palette button toward the canvas.
 */
interface DragState {
    readonly kind: BpmnElementKind;
    readonly subtype?: BpmnEventSubtype;
    readonly variant?: string;
    readonly ghost: HTMLElement;
    readonly onMove: (ev: PointerEvent) => void;
    readonly onUp: (ev: PointerEvent) => void;
}

/**
 * Palette -- mounts a column of draggable buttons into the
 * sidebar's palette host. A pointer-down on a button starts a
 * "ghost" drag (a positioned div that follows the cursor); on
 * pointer-up over the canvas, the palette calls
 * `editor.dropElementAt(clientX, clientY, kind)` which converts
 * coordinates + dispatches an {@link AddElementCommand} through the
 * shared command stack.
 *
 * **Why custom pointer tracking instead of HTML5 drag-and-drop**:
 * HTML5 DnD has well-known browser quirks (drag images sized by the
 * source, drop-target detection differs cross-engine, pointer
 * capture state can leak). Custom pointer tracking with a ghost div
 * has predictable behaviour + matches the PointerInput
 * convention the canvas uses. The ghost is a positioned-fixed div
 * with `pointer-events: none` so the cursor still triggers
 * pointerup on whatever's underneath.
 *
 * **What M3.3.d does NOT do** (deferred):
 *  - **Snap-to-grid on drop** -- M3.3.d drops at the raw cursor
 *    position. The M3.2.b `Snap` utility wires up at M3.3.e+ once
 *    drag-to-move exists.
 *  - **Pre-validate the drop point** (e.g. "can't drop a start
 *    event inside a subprocess that already has one") -- M2.c
 *    validates on deploy; the editor lets the user mid-edit
 *    freely.
 *  - **Element preview on hover** -- the ghost is text-only at
 *    M3.3.d. the polish ship adds shape previews.
 *  - **Keyboard-driven element add** -- click-to-arm + click-to-
 *    place is a future affordance.
 *
 * **Dispose contract**: removes all buttons + cancels any in-
 * progress drag (releases the ghost div + detaches the document-
 * level pointermove/pointerup listeners). Safe to call multiple
 * times.
 */
export class Palette {
    private readonly host: HTMLElement;
    private readonly editor: BpmnLiteEditor;
    private readonly items: ReadonlyArray<PaletteItem>;
    private readonly buttons: HTMLButtonElement[] = [];
    private dragState: DragState | null = null;
    private disposed = false;

    constructor(options: PaletteOptions) {
        this.host = options.host;
        this.editor = options.editor;
        this.items =
            options.items ??
            options.kinds?.map((kind) => ({ kind })) ??
            PALETTE_ITEMS;
        this.mountButtons();
    }

    /** Internal-package test affordance -- the mounted button list. */
    get buttonElements(): ReadonlyArray<HTMLButtonElement> {
        return this.buttons;
    }

    /** Internal-package test affordance -- the current drag's ghost, if any. */
    get ghostElement(): HTMLElement | null {
        return this.dragState?.ghost ?? null;
    }

    /** Internal-package test affordance -- the kind currently being dragged, if any. */
    get draggingKind(): BpmnElementKind | null {
        return this.dragState?.kind ?? null;
    }

    /** Internal-package test affordance -- the subtype currently being dragged, if any. */
    get draggingSubtype(): BpmnEventSubtype | null {
        return this.dragState?.subtype ?? null;
    }

    /**
     * Unmount the palette: detach buttons + abort any in-flight
     * drag. Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelDrag();
        for (const btn of this.buttons) {
            btn.remove();
        }
        this.buttons.length = 0;
    }

    private mountButtons(): void {
        const doc = this.host.ownerDocument;
        for (const { kind, subtype, variant } of this.items) {
            const label = paletteItemLabel(kind, subtype, variant);
            const btn = doc.createElement('button');
            btn.classList.add('coolms-designer__palette-button');
            // `data-palette-kind` stays the bare kind (existing tests +
            // consumer CSS select on it); the typed tile is disambiguated
            // by `data-palette-item`.
            btn.setAttribute('data-palette-kind', kind);
            btn.setAttribute(
                'data-palette-item',
                paletteItemKey(kind, subtype, variant),
            );
            if (subtype !== undefined) {
                btn.setAttribute('data-palette-subtype', subtype);
            }
            if (variant !== undefined) {
                btn.setAttribute('data-palette-variant', variant);
            }
            btn.setAttribute('type', 'button');
            btn.setAttribute('aria-label', label);
            // `title` is what produces the NATIVE hover tooltip -- an
            // `aria-label` alone is announced by screen readers but shows
            // nothing on mouse-over, which left the icon-only tiles
            // unidentifiable. The canvas elements already carried
            // their `<title>`; the palette tiles were missed.
            btn.setAttribute('title', label);

            // polish-bundle (F-2) -- icon-on-top + label-below
            // structure to match the platform's "tools panel" tile
            // convention (Image Editor / Media tools / etc). The SVG
            // mimics the canvas paint of each kind so the palette tile
            // previews the shape the author is about to drop. innerHTML
            // is safe here -- the iconSvgForKind output is hand-authored
            // string-literal SVG with no user-controlled substitution.
            btn.innerHTML =
                `<span class="coolms-designer__palette-icon" aria-hidden="true">${iconSvgForKind(kind, subtype, variant)}</span>` +
                `<span class="coolms-designer__palette-label">${label}</span>`;

            btn.addEventListener('pointerdown', (ev) =>
                this.onPointerDown(ev, kind, subtype, variant),
            );
            this.host.appendChild(btn);
            this.buttons.push(btn);
        }
    }

    private onPointerDown(
        ev: PointerEvent,
        kind: BpmnElementKind,
        subtype?: BpmnEventSubtype,
        variant?: string,
    ): void {
        if (this.disposed) return;
        if (this.dragState !== null) return; // single drag at a time
        // Left button only (button === 0) -- right/middle drags do
        // not start palette drops.
        if (ev.button !== 0) return;
        ev.preventDefault();

        const doc = this.host.ownerDocument;
        const ghost = doc.createElement('div');
        ghost.classList.add('coolms-designer__palette-ghost');
        ghost.setAttribute('data-palette-kind', kind);
        ghost.setAttribute(
            'data-palette-item',
            paletteItemKey(kind, subtype, variant),
        );
        // polish-bundle (F-2) -- ghost shows the same icon as
        // the palette tile so the drop preview matches the source.
        ghost.innerHTML =
            `<span class="coolms-designer__palette-icon" aria-hidden="true">${iconSvgForKind(kind, subtype, variant)}</span>` +
            `<span>${paletteItemLabel(kind, subtype, variant)}</span>`;
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        doc.body.appendChild(ghost);

        const onMove = (e: PointerEvent): void => {
            if (this.dragState === null) return;
            this.dragState.ghost.style.left = `${e.clientX}px`;
            this.dragState.ghost.style.top = `${e.clientY}px`;
        };
        const onUp = (e: PointerEvent): void => {
            this.endDrag();
            this.editor.dropElementAt(
                e.clientX,
                e.clientY,
                kind,
                subtype,
                variant,
            );
        };

        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onUp);

        // Conditional spread, not `subtype,` -- the package compiles with
        // `exactOptionalPropertyTypes`, so an explicit `undefined` is not
        // assignable to an optional property.
        this.dragState = {
            kind,
            ...(subtype !== undefined ? { subtype } : {}),
            ...(variant !== undefined ? { variant } : {}),
            ghost,
            onMove,
            onUp,
        };
    }

    /**
     * Tear down the drag's DOM + listeners WITHOUT dispatching a
     * drop -- used both by the normal `pointerup` path (which then
     * calls `editor.dropElementAt`) and by `dispose()` /
     * cancellation paths.
     */
    private endDrag(): void {
        if (this.dragState === null) return;
        const doc = this.host.ownerDocument;
        doc.removeEventListener('pointermove', this.dragState.onMove);
        doc.removeEventListener('pointerup', this.dragState.onUp);
        this.dragState.ghost.remove();
        this.dragState = null;
    }

    /** Alias for {@link endDrag} -- used by `dispose()`. */
    private cancelDrag(): void {
        this.endDrag();
    }
}

/**
 * polish-bundle (F-2) -- inline SVG icons that mirror each
 * kind's canvas paint (M3.3.b renderers). The author sees the same
 * shape on the palette tile + the drag ghost + the dropped element.
 *
 * **Why hand-authored SVG strings, not a sprite sheet or external
 * files**: the designer is a npm-distributed package; a sprite-sheet
 * import would pull a runtime dependency on a bundler config. The
 * SVG strings are tiny (~150 chars each), tree-shake cleanly when
 * unused, and let consumers theme via CSS custom properties on the
 * containing tile (`currentColor` for stroke + fill).
 *
 * **Visual vocabulary** (matches the canvas at a glance):
 *  - startEvent: thin-bordered circle (BPMN 2.0 untyped start)
 *  - endEvent: thick-bordered circle (BPMN 2.0 untyped end)
 *  - task: rounded rectangle (BPMN 2.0 abstract task)
 *  - exclusiveGateway: diamond with X (BPMN 2.0 XOR marker)
 *  - parallelGateway: diamond with + (BPMN 2.0 AND marker)
 *  - intermediateCatchEvent: DOUBLE ring + a subtype glyph (BPMN 2.0
 *    intermediate marker; the glyph is what distinguishes timer from
 *    message from signal from condition)
 *
 * Exported so visual regression scenarios + the Playwright
 * fixtures can render the same icon outside the palette mount.
 */
export function iconSvgForKind(
    kind: BpmnElementKind,
    subtype?: BpmnEventSubtype,
    variant?: string,
): string {
    if (kind === 'task' && variant !== undefined) {
        // BPMN 2.0 task-type markers, drawn top-left inside the rounded
        // rect exactly as the spec places them: a person for a user
        // task, a gear for a service task.
        const marker =
            variant === 'serviceTask'
                ? '<circle cx="8" cy="8" r="2.4" stroke-width="1.2"/>' +
                  '<path d="M8 4.2 L8 5.1 M8 10.9 L8 11.8 M4.2 8 L5.1 8 M10.9 8 L11.8 8" stroke-width="1.2"/>'
                : '<circle cx="8" cy="6.6" r="1.9" stroke-width="1.2"/>' +
                  '<path d="M5.1 11.6 C5.1 9.6 10.9 9.6 10.9 11.6" stroke-width="1.2" stroke-linecap="round"/>';
        return (
            '<svg viewBox="0 0 32 24" width="32" height="24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.5">' +
            '<rect x="2" y="2" width="28" height="20" rx="4" ry="4"/>' +
            marker +
            '</svg>'
        );
    }
    switch (kind) {
        case 'intermediateCatchEvent':
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5">' +
                '<circle cx="14" cy="14" r="11"/>' +
                '<circle cx="14" cy="14" r="8.5"/>' +
                eventGlyphSvg(subtype) +
                '</svg>'
            );
        case 'boundaryEvent':
            // Double ring sitting on a host edge -- the short arc behind
            // the rings is the activity border the event docks onto, so
            // the tile shows the GESTURE (drop me on a task), not just
            // the shape.
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5">' +
                '<path d="M2 22 L26 22" stroke-opacity="0.4"/>' +
                '<circle cx="14" cy="14" r="10"/>' +
                '<circle cx="14" cy="14" r="7.5"/>' +
                eventGlyphSvg(subtype, 0.88) +
                '</svg>'
            );
        case 'subProcess':
            // A container with a start/end pair inside it -- the tile
            // shows what the author gets (a SCOPE to fill), not just an
            // empty box, which would be indistinguishable from the task
            // tile at this size.
            return (
                '<svg viewBox="0 0 32 24" width="32" height="24" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5">' +
                '<rect x="2" y="2" width="28" height="20" rx="4" ry="4" stroke-dasharray="3 2"/>' +
                '<circle cx="10" cy="12" r="3" stroke-width="1.2"/>' +
                '<circle cx="22" cy="12" r="3" stroke-width="2"/>' +
                '<path d="M13 12 L19 12" stroke-width="1.2"/>' +
                '</svg>'
            );
        case 'callActivity':
            // Thick border -- the BPMN marker for "this activity is
            // another process" -- plus a small arrow leaving the box to
            // say the work happens ELSEWHERE.
            return (
                '<svg viewBox="0 0 32 24" width="32" height="24" fill="none" ' +
                'stroke="currentColor" stroke-width="3">' +
                '<rect x="3" y="3" width="26" height="18" rx="4" ry="4"/>' +
                '<path d="M12 12 L20 12 M17 9 L20 12 L17 15" stroke-width="1.5" stroke-linecap="round"/>' +
                '</svg>'
            );
        case 'startEvent':
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5">' +
                '<circle cx="14" cy="14" r="11"/>' +
                '</svg>'
            );
        case 'endEvent':
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="3">' +
                '<circle cx="14" cy="14" r="10"/>' +
                '</svg>'
            );
        case 'task':
            return (
                '<svg viewBox="0 0 32 24" width="32" height="24" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5">' +
                '<rect x="2" y="2" width="28" height="20" rx="4" ry="4"/>' +
                '</svg>'
            );
        case 'exclusiveGateway':
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5" ' +
                'stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M14 2 L26 14 L14 26 L2 14 Z"/>' +
                '<path d="M9 9 L19 19 M19 9 L9 19" stroke-width="2"/>' +
                '</svg>'
            );
        case 'parallelGateway':
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5" ' +
                'stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M14 2 L26 14 L14 26 L2 14 Z"/>' +
                '<path d="M14 8 L14 20 M8 14 L20 14" stroke-width="2.5"/>' +
                '</svg>'
            );
        case 'inclusiveGateway':
            // Diamond + bold O (BPMN 2.0 OR marker).
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5" ' +
                'stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M14 2 L26 14 L14 26 L2 14 Z"/>' +
                '<circle cx="14" cy="14" r="5.5" stroke-width="2.5"/>' +
                '</svg>'
            );
        case 'eventBasedGateway':
            // Diamond + double ring + pentagon (BPMN 2.0 event-gateway
            // marker) -- the pentagon is what distinguishes it from a
            // plain intermediate event sitting in a diamond.
            return (
                '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" ' +
                'stroke="currentColor" stroke-width="1.5" ' +
                'stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M14 2 L26 14 L14 26 L2 14 Z"/>' +
                '<circle cx="14" cy="14" r="7"/>' +
                '<circle cx="14" cy="14" r="5.2"/>' +
                '<path d="M14 10.8 L16.9 12.9 L15.8 16.3 L12.2 16.3 L11.1 12.9 Z" ' +
                'stroke-width="1"/>' +
                '</svg>'
            );
    }
}

/**
 * The inner marker that types an event. Centred on (14,14) + sized to
 * sit inside the 8.5-radius inner ring, so the same path set works for
 * the palette tile, the canvas node + (next slice) the boundary badge.
 *
 * BPMN 2.0 marker vocabulary: clock = timer, envelope = message,
 * triangle = signal, lined page = conditional. An absent subtype paints
 * a bare double ring (the spec's untyped intermediate event) rather
 * than guessing a marker.
 */
function eventGlyphSvg(subtype?: BpmnEventSubtype, scale = 1): string {
    // `scale` shrinks the glyph for the slightly smaller boundary rings.
    // Applied as an SVG transform about the (14,14) centre so the paths
    // below stay written in one coordinate system.
    const wrap = (inner: string): string =>
        scale === 1
            ? inner
            : `<g transform="translate(14 14) scale(${scale}) translate(-14 -14)">${inner}</g>`;
    switch (subtype) {
        case 'timer':
            // Clock face + hands.
            return wrap(
                '<circle cx="14" cy="14" r="5.5" stroke-width="1.2"/>' +
                    '<path d="M14 10.5 L14 14 L16.5 15.5" stroke-width="1.2" ' +
                    'stroke-linecap="round" stroke-linejoin="round"/>',
            );
        case 'message':
            // Envelope: body + flap.
            return wrap(
                '<rect x="9.5" y="10.75" width="9" height="6.5" rx="0.5" stroke-width="1.2"/>' +
                    '<path d="M9.5 11.25 L14 14.75 L18.5 11.25" stroke-width="1.2" ' +
                    'stroke-linecap="round" stroke-linejoin="round"/>',
            );
        case 'signal':
            // Upward triangle.
            return wrap(
                '<path d="M14 9.5 L19 17.5 L9 17.5 Z" stroke-width="1.2" ' +
                    'stroke-linejoin="round"/>',
            );
        case 'condition':
            // Lined page (BPMN conditional marker).
            return wrap(
                '<rect x="10" y="9.75" width="8" height="8.5" rx="0.5" stroke-width="1.2"/>' +
                    '<path d="M11.75 12 L16.25 12 M11.75 14 L16.25 14 M11.75 16 L16.25 16" ' +
                    'stroke-width="1" stroke-linecap="round"/>',
            );
        case 'error':
            // Lightning bolt (BPMN error marker).
            return wrap(
                '<path d="M10 18.5 L13.5 13.2 L15.5 15.4 L18.5 9.5" ' +
                    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
            );
        case 'compensation':
            // Rewind: two left-pointing triangles.
            return wrap(
                '<path d="M13.8 10 L13.8 18 L8.5 14 Z M19.5 10 L19.5 18 L14.2 14 Z" ' +
                    'stroke-width="1.2" stroke-linejoin="round"/>',
            );
        default:
            return '';
    }
}
