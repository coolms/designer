import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../../src/shell/Sidebar.js';

/**
 * F-8 redesign: the Sidebar is now a property-panel-only slide-over
 * panel (no palette section), and DEFAULTS to collapsed. The BPMN
 * dialog auto-toggles it based on selection state. These tests pin
 * the new contract.
 */
describe('Sidebar', () => {
    let parent: HTMLDivElement;
    let sidebar: Sidebar;

    beforeEach(() => {
        parent = document.createElement('div');
        document.body.appendChild(parent);
    });

    afterEach(() => {
        sidebar?.dispose();
        parent.remove();
    });

    it('mounts with default position (right) + COLLAPSED', () => {
        // F-8 default-collapsed: the panel has nothing to show without
        // a selection, so showing it empty wastes real estate.
        sidebar = new Sidebar(parent);

        const aside = parent.querySelector('aside');
        expect(aside).not.toBeNull();
        expect(aside?.classList.contains('coolms-designer__sidebar--right')).toBe(true);
        expect(aside?.classList.contains('coolms-designer__sidebar--collapsed')).toBe(true);
        // F-8: width stays inline even when collapsed (slide-over leaves
        // the panel's intrinsic size stable so re-entry doesn't flicker).
        expect(aside?.style.width).toBe('280px');
        expect(sidebar.isCollapsed).toBe(true);
    });

    it('honors position: left', () => {
        sidebar = new Sidebar(parent, { position: 'left' });
        const aside = parent.querySelector('aside');
        expect(aside?.classList.contains('coolms-designer__sidebar--left')).toBe(true);
    });

    it('honors custom width', () => {
        sidebar = new Sidebar(parent, { width: 400 });
        expect(parent.querySelector('aside')?.style.width).toBe('400px');
    });

    it('clamps width to a minimum', () => {
        sidebar = new Sidebar(parent, { width: 50 });
        expect(parent.querySelector('aside')?.style.width).toBe('120px');
    });

    it('starts EXPANDED when explicitly configured', () => {
        // F-8 default-collapsed -- consumers that want the legacy
        // always-expanded shape opt in with `collapsed: false`.
        sidebar = new Sidebar(parent, { collapsed: false });
        expect(sidebar.isCollapsed).toBe(false);
        const aside = parent.querySelector('aside');
        expect(aside?.classList.contains('coolms-designer__sidebar--collapsed')).toBe(false);
    });

    it('exposes propertyHost as a section (palette section removed)', () => {
        // F-8: the palette section is gone -- moved to Toolbar.paletteHost.
        // Only the property-panel host remains on the sidebar.
        sidebar = new Sidebar(parent);
        expect(sidebar.propertyHost.getAttribute('data-section')).toBe('properties');
        // The Sidebar API no longer exposes a paletteHost getter.
        // The cast pins this at compile time too via the lack of the
        // property -- runtime check is for double-safety.
        expect((sidebar as unknown as { paletteHost?: unknown }).paletteHost).toBeUndefined();
    });

    it('toggle button flips collapse state', () => {
        sidebar = new Sidebar(parent, { collapsed: false });
        const onCollapse = vi.fn();
        sidebar.onCollapseChange(onCollapse);

        const toggle = parent.querySelector('.coolms-designer__sidebar-toggle') as HTMLButtonElement;
        toggle.click();

        expect(sidebar.isCollapsed).toBe(true);
        expect(onCollapse).toHaveBeenCalledWith(true);

        toggle.click();
        expect(sidebar.isCollapsed).toBe(false);
        expect(onCollapse).toHaveBeenCalledWith(false);
    });

    it('setCollapsed is idempotent (no event on same value)', () => {
        sidebar = new Sidebar(parent, { collapsed: false });
        const onCollapse = vi.fn();
        sidebar.onCollapseChange(onCollapse);

        sidebar.setCollapsed(false); // already false
        expect(onCollapse).not.toHaveBeenCalled();

        sidebar.setCollapsed(true);
        sidebar.setCollapsed(true); // already true
        expect(onCollapse).toHaveBeenCalledTimes(1);
    });

    it('toggle button text + aria-expanded reflect state', () => {
        sidebar = new Sidebar(parent, { position: 'right', collapsed: false });
        const toggle = parent.querySelector('.coolms-designer__sidebar-toggle') as HTMLButtonElement;

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.textContent).toBe('›'); // right + expanded

        sidebar.setCollapsed(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toBe('‹'); // right + collapsed
    });

    it('left-side toggle text inverts direction', () => {
        sidebar = new Sidebar(parent, { position: 'left', collapsed: false });
        const toggle = parent.querySelector('.coolms-designer__sidebar-toggle') as HTMLButtonElement;
        expect(toggle.textContent).toBe('‹'); // left + expanded
        sidebar.setCollapsed(true);
        expect(toggle.textContent).toBe('›'); // left + collapsed
    });

    it('dispose removes DOM + detaches handlers', () => {
        sidebar = new Sidebar(parent);
        expect(parent.children.length).toBe(1);

        sidebar.dispose();

        expect(parent.children.length).toBe(0);
        // Subsequent setCollapsed is a no-op (no throw, no DOM mutation since DOM is gone).
        expect(() => sidebar.setCollapsed(true)).not.toThrow();
    });

    it('dispose is idempotent', () => {
        sidebar = new Sidebar(parent);
        sidebar.dispose();
        expect(() => sidebar.dispose()).not.toThrow();
    });
});
