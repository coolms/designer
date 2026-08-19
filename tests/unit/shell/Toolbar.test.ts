import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandStack, type Command } from '../../../src/canvas/CommandStack.js';
import { Viewport } from '../../../src/canvas/Viewport.js';
import { Toolbar } from '../../../src/shell/Toolbar.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

class NoOpCommand implements Command {
    readonly label: string;
    constructor(label: string) {
        this.label = label;
    }
    apply(): void {}
    revert(): void {}
}

describe('Toolbar', () => {
    let parent: HTMLDivElement;
    let group: SVGGElement;
    let commands: CommandStack;
    let viewport: Viewport;
    let toolbar: Toolbar;

    beforeEach(() => {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        commands = new CommandStack();
        viewport = new Viewport(group);
    });

    afterEach(() => {
        toolbar?.dispose();
        commands.dispose();
        viewport.dispose();
        parent.remove();
    });

    function button(action: string): HTMLButtonElement | null {
        return parent.querySelector(`button[data-action="${action}"]`);
    }

    describe('rendering', () => {
        it('mounts toolbar root + four subgroups with role="toolbar"', () => {
            // F-8 redesign -- the toolbar is now a single horizontal
            // row of four subgroups (action / history / viewport /
            // creation), not the old left/right split. Empty
            // subgroups stay in the DOM but collapse to zero size via
            // CSS `:empty`, so the structural count is always 4.
            toolbar = new Toolbar(parent, { commands, viewport });

            const root = parent.querySelector('.coolms-designer__toolbar');
            expect(root?.getAttribute('role')).toBe('toolbar');
            const groups = parent.querySelectorAll(
                '.coolms-designer__toolbar-group',
            );
            expect(groups).toHaveLength(4);
            // Each subgroup has its own modifier class so consumers
            // can target them individually (e.g. for visual
            // regression scenarios).
            expect(
                parent.querySelector('.coolms-designer__toolbar-group--action'),
            ).not.toBeNull();
            expect(
                parent.querySelector('.coolms-designer__toolbar-group--history'),
            ).not.toBeNull();
            expect(
                parent.querySelector(
                    '.coolms-designer__toolbar-group--viewport',
                ),
            ).not.toBeNull();
            expect(
                parent.querySelector(
                    '.coolms-designer__toolbar-group--creation',
                ),
            ).not.toBeNull();
        });

        it('exposes paletteHost = creation subgroup (F-8)', () => {
            // F-8 redesign -- BPMN-Lite Palette mounts its drag-source
            // buttons here so create-tools (Connect + element palette)
            // cluster together in the action bar (Figma / Camunda
            // Modeler convention). The Sidebar no longer has a
            // paletteHost.
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(toolbar.paletteHost).toBe(
                parent.querySelector(
                    '.coolms-designer__toolbar-group--creation',
                ),
            );
        });

        it('always renders the three zoom buttons', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(button('zoom-in')).not.toBeNull();
            expect(button('zoom-out')).not.toBeNull();
            expect(button('zoom-reset')).not.toBeNull();
        });

        it('renders save + deploy only when handlers are provided', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(button('save')).toBeNull();
            expect(button('deploy')).toBeNull();

            toolbar.dispose();
            toolbar = new Toolbar(parent, {
                commands,
                viewport,
                onSave: () => {},
                onDeploy: () => {},
            });
            expect(button('save')).not.toBeNull();
            expect(button('deploy')).not.toBeNull();
        });

        it('renders undo/redo by default; hides them in read-only', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(button('undo')).not.toBeNull();
            expect(button('redo')).not.toBeNull();

            toolbar.dispose();
            toolbar = new Toolbar(parent, { commands, viewport, readOnly: true });
            expect(button('undo')).toBeNull();
            expect(button('redo')).toBeNull();
            // Zoom controls survive read-only.
            expect(button('zoom-in')).not.toBeNull();
        });

        it('mounts bi-* icon spans on undo/redo/zoom-in/zoom-out (M3.3.m F-3)', () => {
            // Pins the platform-icon contract: undo/redo/zoom-in/zoom-out
            // each render a `<i class="bi bi-{glyph}" aria-hidden="true">`
            // matching the Image Editor top-toolbar so the BPMN designer
            // reads as a sibling. The zoom-reset button stays as a text
            // "{percent}%" display (Image Editor pattern too).
            toolbar = new Toolbar(parent, { commands, viewport });

            const checks: Array<{ action: string; bi: string }> = [
                { action: 'undo', bi: 'bi-arrow-counterclockwise' },
                { action: 'redo', bi: 'bi-arrow-clockwise' },
                { action: 'zoom-in', bi: 'bi-zoom-in' },
                { action: 'zoom-out', bi: 'bi-zoom-out' },
            ];

            for (const { action, bi } of checks) {
                const btn = button(action)!;
                expect(btn).not.toBeNull();
                expect(
                    btn.classList.contains('coolms-designer__toolbar-button--icon'),
                ).toBe(true);
                const icon = btn.querySelector<HTMLElement>(`i.bi.${bi}`);
                expect(icon).not.toBeNull();
                expect(icon?.getAttribute('aria-hidden')).toBe('true');
                // aria-label on the button continues to surface the
                // human action label so assistive tech reads the action
                // (the icon span is hidden).
                expect(btn.getAttribute('aria-label')).not.toBe('');
            }

            // zoom-reset stays as a text display — no bi-* icon.
            const reset = button('zoom-reset')!;
            expect(reset.querySelector('i.bi')).toBeNull();
            expect(
                reset.classList.contains(
                    'coolms-designer__toolbar-button--zoom-display',
                ),
            ).toBe(true);
        });

        it('honors label overrides', () => {
            toolbar = new Toolbar(parent, {
                commands,
                viewport,
                onSave: () => {},
                labels: { save: 'Зберегти' },
            });
            const save = button('save')!;
            expect(save.textContent).toBe('Зберегти');
            expect(save.getAttribute('aria-label')).toBe('Зберегти');
        });
    });

    describe('undo/redo wiring', () => {
        it('undo/redo start disabled when stack is empty', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(button('undo')?.disabled).toBe(true);
            expect(button('redo')?.disabled).toBe(true);
        });

        it('undo enables after execute', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            commands.execute(new NoOpCommand('Add element'));
            expect(button('undo')?.disabled).toBe(false);
            expect(button('redo')?.disabled).toBe(true);
        });

        it('undo button fires CommandStack.undo on click', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            commands.execute(new NoOpCommand('Add element'));

            button('undo')!.click();
            expect(commands.canUndo).toBe(false);
            expect(commands.canRedo).toBe(true);
            expect(button('redo')?.disabled).toBe(false);
        });

        it('button title carries next undo label tooltip', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            commands.execute(new NoOpCommand('Move user task'));
            expect(button('undo')?.title).toContain('Move user task');
        });
    });

    describe('zoom wiring', () => {
        it('zoom indicator starts at 100%', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(button('zoom-reset')?.textContent).toBe('100%');
        });

        it('zoom-in multiplies zoom by step', () => {
            toolbar = new Toolbar(parent, { commands, viewport, zoomStep: 2 });
            button('zoom-in')!.click();
            expect(viewport.state.zoom).toBe(2);
            expect(button('zoom-reset')?.textContent).toBe('200%');
        });

        it('zoom-out divides zoom by step', () => {
            toolbar = new Toolbar(parent, { commands, viewport, zoomStep: 2 });
            button('zoom-out')!.click();
            expect(viewport.state.zoom).toBe(0.5);
            expect(button('zoom-reset')?.textContent).toBe('50%');
        });

        it('zoom-reset returns to 100%', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            viewport.setZoom(2.5);
            button('zoom-reset')!.click();
            expect(viewport.state.zoom).toBe(1);
            expect(button('zoom-reset')?.textContent).toBe('100%');
        });
    });

    describe('save/deploy async handling', () => {
        it('synchronous save is fired on click', () => {
            const onSave = vi.fn();
            toolbar = new Toolbar(parent, { commands, viewport, onSave });
            button('save')!.click();
            expect(onSave).toHaveBeenCalledOnce();
        });

        it('async save disables button + sets aria-busy until promise resolves', async () => {
            let resolve!: () => void;
            const promise = new Promise<void>((r) => {
                resolve = r;
            });
            toolbar = new Toolbar(parent, { commands, viewport, onSave: () => promise });

            const save = button('save')!;
            save.click();

            expect(save.disabled).toBe(true);
            expect(save.getAttribute('aria-busy')).toBe('true');

            resolve();
            await promise;
            // microtask flush
            await Promise.resolve();

            expect(save.disabled).toBe(false);
            expect(save.hasAttribute('aria-busy')).toBe(false);
        });

        it('async save re-enables button even if promise rejects', async () => {
            const promise = Promise.reject(new Error('save failed'));
            // suppress unhandled rejection
            promise.catch(() => {});
            toolbar = new Toolbar(parent, { commands, viewport, onSave: () => promise });

            const save = button('save')!;
            save.click();
            expect(save.disabled).toBe(true);

            await promise.catch(() => {});
            await Promise.resolve();

            expect(save.disabled).toBe(false);
        });
    });

    describe('dispose', () => {
        it('removes toolbar root + unsubscribes from commands + viewport', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            expect(parent.children.length).toBe(1);

            toolbar.dispose();

            expect(parent.querySelector('.coolms-designer__toolbar')).toBeNull();
            // After dispose, command changes shouldn't reach the (now removed) button.
            // Just verify no throw on subsequent activity.
            expect(() => commands.execute(new NoOpCommand('post-dispose'))).not.toThrow();
        });

        it('is idempotent', () => {
            toolbar = new Toolbar(parent, { commands, viewport });
            toolbar.dispose();
            expect(() => toolbar.dispose()).not.toThrow();
        });
    });
});
