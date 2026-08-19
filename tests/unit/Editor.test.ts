/**
 * Editor smoke test -- lives at the top of the test tree as the
 * "is the package alive" check. Started life as the scaffold
 * proof; expanded in M3.2.b/c/d as new lifecycle responsibilities
 * landed (canvas substrate, graph wiring, shell composition).
 *
 * Per-subsystem unit suites live in `tests/unit/{canvas,model,shell}/`;
 * this file asserts only the composition contract that external
 * consumers of `createEditor` depend on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, DESIGNER_VERSION, type Editor } from '../../src/index.js';

describe('createEditor — package smoke test', () => {
    let host: HTMLDivElement;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    afterEach(() => {
        host.remove();
    });

    it('exports a semver version string', () => {
        expect(DESIGNER_VERSION).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/);
    });

    describe('createEditor mount/destroy contract', () => {
        it('mounts a root with toolbar + body{canvas + sidebar}', () => {
            const editor = createEditor(host, { surface: 'dmn-table' });

            const root = host.querySelector('.coolms-designer');
            expect(root).not.toBeNull();
            expect(root?.getAttribute('data-coolms-designer-surface')).toBe('dmn-table');
            expect(root?.classList.contains('coolms-designer--dmn-table')).toBe(true);

            // Toolbar above the body.
            const toolbar = root?.querySelector('.coolms-designer__toolbar');
            expect(toolbar).not.toBeNull();

            // Body contains canvas + sidebar.
            const body = root?.querySelector('.coolms-designer__body');
            expect(body).not.toBeNull();

            const canvas = body?.querySelector('.coolms-designer__canvas');
            expect(canvas?.namespaceURI).toBe('http://www.w3.org/2000/svg');

            const sidebar = body?.querySelector('.coolms-designer__sidebar');
            expect(sidebar).not.toBeNull();

            editor.destroy();
        });

        it('hideToolbar / hideSidebar omit those subsystems', () => {
            const editor = createEditor(host, {
                surface: 'dmn-table',
                hideToolbar: true,
                hideSidebar: true,
            });

            expect(host.querySelector('.coolms-designer__toolbar')).toBeNull();
            expect(host.querySelector('.coolms-designer__sidebar')).toBeNull();
            // Canvas + body still present.
            expect(host.querySelector('.coolms-designer__body')).not.toBeNull();
            expect(host.querySelector('.coolms-designer__canvas')).not.toBeNull();

            editor.destroy();
        });

        it('exposes xrefs + selection on the public handle', () => {
            const editor = createEditor(host, { surface: 'dmn-table' });
            expect(editor.xrefs).toBeDefined();
            expect(editor.xrefs.scopeKeys).toEqual([]);
            expect(editor.selection).toBeDefined();
            expect(editor.selection.id).toBeNull();
            editor.destroy();
        });

        it('exposes the surface + host + revision counter', () => {
            const editor = createEditor(host, { surface: 'bpmn-lite' });

            expect(editor.surface).toBe('bpmn-lite');
            expect(editor.host).toBe(host);
            expect(editor.revision).toBe(1); // bumped once by the init event
            expect(editor.isDestroyed).toBe(false);

            editor.destroy();
        });

        it('emits an init change event synchronously after mount', () => {
            const onChange = vi.fn();
            const editor = createEditor(host, { surface: 'dmn-table', onChange });

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith({ revision: 1, kind: 'init' });

            editor.destroy();
        });

        it('removes all owned DOM on destroy', () => {
            const editor = createEditor(host, { surface: 'dmn-table' });
            expect(host.children.length).toBe(1);

            editor.destroy();

            expect(host.children.length).toBe(0);
            expect(editor.isDestroyed).toBe(true);
        });

        it('destroy is idempotent', () => {
            const editor = createEditor(host, { surface: 'dmn-table' });
            editor.destroy();
            expect(() => editor.destroy()).not.toThrow();
            expect(editor.isDestroyed).toBe(true);
        });

        it('does not fire onChange after destroy', () => {
            const onChange = vi.fn();
            const editor = createEditor(host, { surface: 'dmn-table', onChange });
            onChange.mockClear();

            editor.destroy();
            // No mutations possible at M3.2.a but the guard is in place for M3.2.c.
            expect(onChange).not.toHaveBeenCalled();
        });

        it('applies the read-only modifier class when configured', () => {
            const editor = createEditor(host, { surface: 'dmn-table', readOnly: true });

            const root = host.querySelector('.coolms-designer');
            expect(root?.classList.contains('coolms-designer--read-only')).toBe(true);

            editor.destroy();
        });
    });

    describe('createEditor input validation', () => {
        it('rejects a non-HTMLElement host', () => {
            expect(() =>
                createEditor(null as unknown as HTMLElement, { surface: 'dmn-table' }),
            ).toThrow(TypeError);
            expect(() =>
                createEditor({} as HTMLElement, { surface: 'dmn-table' }),
            ).toThrow(/HTMLElement/);
        });

        it('rejects an unknown surface', () => {
            expect(() =>
                createEditor(host, { surface: 'not-a-real-surface' as never }),
            ).toThrow(/unknown surface/);
        });

        it('accepts every documented surface', () => {
            // Future surfaces (bpmn-lite, dmn-drd, state-machine) accept the
            // factory call at M3.2.a even though their surface-specific code
            // doesn't exist yet — the shell mount/destroy is identical until
            // / M3.3 / M3.5 layer in the specialisations.
            const surfaces = ['dmn-table', 'bpmn-lite', 'dmn-drd', 'state-machine'] as const;
            const editors: Editor[] = surfaces.map((surface) =>
                createEditor(host, { surface }),
            );
            // jsdom doesn't fire layout — just confirm each mount produced a root.
            expect(host.querySelectorAll('.coolms-designer')).toHaveLength(surfaces.length);
            editors.forEach((e) => e.destroy());
        });
    });
});
