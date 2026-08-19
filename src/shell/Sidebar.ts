import { Emitter } from '../internal/Emitter.js';

export interface SidebarOptions {
    /**
     * Which side of the canvas the sidebar attaches to. Default 'right'
     * (matches Figma, Sketch, dmn-js convention). 'left' is exposed for
     * future tenant themes that prefer the alternative.
     */
    readonly position?: 'left' | 'right';
    /** Initial collapse state. Default false (expanded). */
    readonly collapsed?: boolean;
    /**
     * Visible width in pixels when expanded. Default 280. Honored via
     * inline style so the editor's CSS contract doesn't have to know
     * the value at compile time.
     */
    readonly width?: number;
}

interface SidebarEvents extends Record<string, unknown> {
    collapse: boolean;
}

/**
 * F-8 redesign -- right-side floating panel that hosts the property
 * panel ONLY. The palette section that used to live in the top half
 * of the sidebar moved to the {@link Toolbar} `paletteHost` so all
 * create-tools (Connect + element palette) cluster together in the
 * action bar (Figma / Camunda Modeler / diagrams.net convention).
 *
 * **Slide-over semantics** -- the sidebar floats ABOVE the canvas via
 * `position: absolute` rather than being a flex sibling that shrinks
 * the canvas. Opening or closing on selection change therefore does
 * NOT reflow the diagram: every element stays at its current screen
 * position under the cursor, so rapid select/deselect doesn't jank.
 * Matches Figma's right-rail behaviour.
 *
 * **Default state** -- collapsed. The BPMN-Lite dialog wires
 * `selection.onChange` to flip the panel on/off so the user sees
 * the property panel only when an element or flow is actively
 * selected (Figma / Sketch / XD convention).
 *
 * DOM structure (post-F-8):
 *
 *   <aside class="coolms-designer__sidebar coolms-designer__sidebar--right">
 *     <button class="coolms-designer__sidebar-toggle">‹</button>
 *     <div class="coolms-designer__sidebar-body">
 *       <section class="coolms-designer__sidebar-properties" data-section="properties"/>
 *     </div>
 *   </aside>
 *
 * The `--collapsed` modifier triggers a CSS `translateX(100%)` so
 * the entire panel slides off the right edge; the canvas
 * underneath is unaffected (it has been the full body width all
 * along).
 */
export class Sidebar {
    private readonly host: HTMLElement;
    private readonly toggle: HTMLButtonElement;
    private readonly body: HTMLElement;
    private readonly properties: HTMLElement;
    private readonly emitter = new Emitter<SidebarEvents>();
    private readonly position: 'left' | 'right';
    private readonly expandedWidth: number;
    private collapsed: boolean;
    private disposed = false;

    private readonly onToggleClick: () => void;

    constructor(parent: Element, options: SidebarOptions = {}) {
        const doc = parent.ownerDocument;
        this.position = options.position ?? 'right';
        this.expandedWidth = Math.max(120, options.width ?? 280);
        // F-8 redesign -- default collapsed. The BPMN-Lite dialog
        // expands on selection.onChange; the property panel has
        // nothing to show without a selection so showing it empty
        // is wasted real estate.
        this.collapsed = options.collapsed ?? true;

        this.host = doc.createElement('aside');
        this.host.classList.add(
            'coolms-designer__sidebar',
            `coolms-designer__sidebar--${this.position}`,
        );

        this.toggle = doc.createElement('button');
        this.toggle.type = 'button';
        this.toggle.classList.add('coolms-designer__sidebar-toggle');
        this.toggle.setAttribute('aria-label', 'Toggle sidebar');
        this.host.appendChild(this.toggle);

        this.body = doc.createElement('div');
        this.body.classList.add('coolms-designer__sidebar-body');
        this.host.appendChild(this.body);

        this.properties = doc.createElement('section');
        this.properties.classList.add('coolms-designer__sidebar-properties');
        this.properties.setAttribute('data-section', 'properties');
        this.body.appendChild(this.properties);

        this.applyCollapsedState();
        parent.appendChild(this.host);

        this.onToggleClick = () => this.setCollapsed(!this.collapsed);
        this.toggle.addEventListener('click', this.onToggleClick);
    }

    /** The sidebar's root `<aside>` element. */
    get element(): HTMLElement {
        return this.host;
    }

    /**
     * Host element for property-panel content. The property
     * framework binds field renderers here based on selection state.
     */
    get propertyHost(): HTMLElement {
        return this.properties;
    }

    get isCollapsed(): boolean {
        return this.collapsed;
    }

    /**
     * F-8 redesign -- show/hide the panel via slide-over. Emits
     * `collapse` event when the state changes. The BPMN-Lite dialog
     * calls this from its `selection.onChange` subscription
     * (`setCollapsed(target === null)`) so the panel auto-toggles
     * with selection state.
     */
    setCollapsed(collapsed: boolean): void {
        if (this.disposed) return;
        if (this.collapsed === collapsed) return;
        this.collapsed = collapsed;
        this.applyCollapsedState();
        this.emitter.emit('collapse', collapsed);
    }

    /** Subscribe to collapse changes. Returns unsubscribe thunk. */
    onCollapseChange(listener: (collapsed: boolean) => void): () => void {
        return this.emitter.on('collapse', listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.toggle.removeEventListener('click', this.onToggleClick);
        this.emitter.dispose();
        this.host.remove();
    }

    private applyCollapsedState(): void {
        this.host.classList.toggle('coolms-designer__sidebar--collapsed', this.collapsed);
        // Width still drives the EXPANDED panel size; the slide-over
        // animation (translateX) lives entirely in CSS, keyed off the
        // `--collapsed` modifier class. Setting style.width to '' on
        // collapse would re-trigger a layout; leaving the inline width
        // in place keeps the panel's intrinsic size stable across the
        // slide so re-entry doesn't flicker.
        this.host.style.width = `${this.expandedWidth}px`;
        // Arrow direction toggles based on position + collapse state.
        // right + expanded → ›, right + collapsed → ‹
        // left  + expanded → ‹, left  + collapsed → ›
        const expandedArrow = this.position === 'right' ? '›' : '‹';
        const collapsedArrow = this.position === 'right' ? '‹' : '›';
        this.toggle.textContent = this.collapsed ? collapsedArrow : expandedArrow;
        this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
    }
}
