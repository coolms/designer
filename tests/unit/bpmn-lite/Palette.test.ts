import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CommandStack } from '../../../src/canvas/CommandStack.js';
import {
    BpmnLiteEditor,
    PALETTE_KINDS,
    PALETTE_ITEMS,
    PALETTE_LABELS,
    paletteItemKey,
    Palette,
    SVG_NS,
    iconSvgForKind,
} from '../../../src/bpmn-lite/index.js';

/**
 * Palette tests. Pins:
 *   - mounts one button per palette kind (default + custom kinds[])
 *   - pointerdown spawns a ghost div tracking the cursor
 *   - pointerup over the canvas drops an element through the editor's
 *     dropElementAt + the command stack picks it up
 *   - pointerup outside the canvas tears down the drag without
 *     adding an element
 *   - dispose() detaches buttons + cancels in-flight drag
 *
 * **jsdom note**: jsdom doesn't implement getBoundingClientRect() for
 * SVG elements very richly -- it returns a zero-sized rect by default.
 * The tests stub it on the relevant SVG element before driving the
 * drop, so the editor's hit-test sees the cursor "inside" the canvas.
 */
describe('Palette', () => {
    let host: HTMLElement;
    let paletteHost: HTMLElement;
    let svgGroup: SVGGElement;
    let svg: SVGSVGElement;
    let commands: CommandStack;
    let editor: BpmnLiteEditor;

    function makeSvgGroup(): { svg: SVGSVGElement; g: SVGGElement } {
        const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(g);
        document.body.appendChild(svg);
        return { svg, g };
    }

    /** Stub the SVG canvas's bounding rect so drop hit-tests succeed in jsdom. */
    function stubCanvasRect(
        svg: SVGSVGElement,
        rect: { left: number; top: number; width: number; height: number },
    ): void {
        svg.getBoundingClientRect = (): DOMRect => ({
            left: rect.left,
            top: rect.top,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            width: rect.width,
            height: rect.height,
            x: rect.left,
            y: rect.top,
            toJSON(): unknown {
                return this;
            },
        });
    }

    beforeEach(() => {
        host = document.createElement('div');
        paletteHost = document.createElement('div');
        document.body.appendChild(host);
        document.body.appendChild(paletteHost);
        const made = makeSvgGroup();
        svg = made.svg;
        svgGroup = made.g;
        commands = new CommandStack();
        editor = new BpmnLiteEditor({ host, commands, svgGroup });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        paletteHost.remove();
        svg.remove();
    });

    it('mounts a button per PALETTE_ITEMS entry in order', () => {
        const palette = new Palette({ host: paletteHost, editor });

        expect(palette.buttonElements).toHaveLength(PALETTE_ITEMS.length);

        // Typed events share a kind, so identity is the kind:subtype key.
        const items = palette.buttonElements.map((btn) =>
            btn.getAttribute('data-palette-item'),
        );
        expect(items).toEqual(
            PALETTE_ITEMS.map((i) =>
                paletteItemKey(i.kind, i.subtype, i.variant),
            ),
        );

        palette.dispose();
    });

    it('honours the kind-only `kinds` shorthand', () => {
        const palette = new Palette({
            host: paletteHost,
            editor,
            kinds: PALETTE_KINDS,
        });

        expect(palette.buttonElements).toHaveLength(PALETTE_KINDS.length);
        const kinds = palette.buttonElements.map((btn) =>
            btn.getAttribute('data-palette-kind'),
        );
        expect(kinds).toEqual([...PALETTE_KINDS]);

        palette.dispose();
    });

    /**
     * The tiles are icon-only, so without a `title` there is no native
     * hover tooltip and an author cannot tell one glyph from another --
     * exactly the complaint that surfaced after the palette grew to 16
     * tiles. `aria-label` alone is announced by screen readers but shows
     * nothing on mouse-over.
     */
    it('every tile carries a title so it has a native hover tooltip', () => {
        const palette = new Palette({ host: paletteHost, editor });

        for (const btn of palette.buttonElements) {
            const title = btn.getAttribute('title');
            expect(title, `${btn.getAttribute('data-palette-item')} has no title`)
                .toBeTruthy();
            // Same text the tile renders + announces.
            expect(title).toBe(btn.getAttribute('aria-label'));
        }
        // Typed tiles must read by subtype, not by structural kind.
        const timer = palette.buttonElements.find(
            (b) => b.getAttribute('data-palette-item') === 'intermediateCatchEvent:timer',
        );
        expect(timer?.getAttribute('title')).toBe('Timer Event');

        palette.dispose();
    });

    it('button text content is the human label', () => {
        const palette = new Palette({ host: paletteHost, editor });

        const first = palette.buttonElements[0]!;
        expect(first.textContent).toBe(PALETTE_LABELS.startEvent);

        palette.dispose();
    });

    it('button carries the SVG icon + label spans (M3.3.m polish-bundle F-2)', () => {
        const palette = new Palette({ host: paletteHost, editor });
        const first = palette.buttonElements[0]!;

        // Icon span exists, contains an <svg>, marked aria-hidden.
        const iconSpan = first.querySelector(
            '.coolms-designer__palette-icon',
        );
        expect(iconSpan).not.toBeNull();
        expect(iconSpan?.getAttribute('aria-hidden')).toBe('true');
        expect(iconSpan?.querySelector('svg')).not.toBeNull();

        // Label span exists + carries the human-readable label.
        const labelSpan = first.querySelector(
            '.coolms-designer__palette-label',
        );
        expect(labelSpan?.textContent).toBe(PALETTE_LABELS.startEvent);

        // aria-label on the button continues to expose the human label
        // to assistive tech (the icon is aria-hidden so the label span
        // is the accessible name).
        expect(first.getAttribute('aria-label')).toBe(
            PALETTE_LABELS.startEvent,
        );

        palette.dispose();
    });

    it('iconSvgForKind returns shape-specific SVG markup per kind', () => {
        // Pins the visual vocabulary so canvas + palette stay
        // synchronised. Each SVG must be non-empty + contain the
        // signature primitive for its kind.
        expect(iconSvgForKind('startEvent')).toContain('<circle');
        expect(iconSvgForKind('endEvent')).toContain('<circle');
        // End event circle is bolder than start event circle.
        expect(iconSvgForKind('endEvent')).toContain('stroke-width="3"');
        expect(iconSvgForKind('task')).toContain('<rect');
        expect(iconSvgForKind('task')).toContain('rx="4"');
        // Gateways are diamond paths; XOR adds a cross-stroke + parallel
        // adds a plus-stroke.
        expect(iconSvgForKind('exclusiveGateway')).toContain(
            'M14 2 L26 14 L14 26 L2 14 Z',
        );
        expect(iconSvgForKind('exclusiveGateway')).toContain('M9 9 L19 19');
        expect(iconSvgForKind('parallelGateway')).toContain(
            'M14 2 L26 14 L14 26 L2 14 Z',
        );
        expect(iconSvgForKind('parallelGateway')).toContain('M14 8 L14 20');
        // All variants stroke with currentColor so CSS can theme them
        // via the containing tile.
        for (const kind of PALETTE_KINDS) {
            expect(iconSvgForKind(kind)).toContain('stroke="currentColor"');
        }
    });

    it('button has type="button" + the palette class', () => {
        const palette = new Palette({ host: paletteHost, editor });

        const first = palette.buttonElements[0]!;
        expect(first.getAttribute('type')).toBe('button');
        expect(first.classList.contains('coolms-designer__palette-button')).toBe(
            true,
        );

        palette.dispose();
    });

    it('respects a custom kinds[] option', () => {
        const palette = new Palette({
            host: paletteHost,
            editor,
            kinds: ['task', 'startEvent'],
        });

        expect(palette.buttonElements).toHaveLength(2);
        expect(palette.buttonElements[0]!.getAttribute('data-palette-kind')).toBe(
            'task',
        );
        expect(palette.buttonElements[1]!.getAttribute('data-palette-kind')).toBe(
            'startEvent',
        );

        palette.dispose();
    });

    it('pointerdown spawns a ghost div + sets draggingKind', () => {
        const palette = new Palette({ host: paletteHost, editor });
        // Find the task button (index 2 by default order).
        const taskBtn = palette.buttonElements.find(
            (b) => b.getAttribute('data-palette-kind') === 'task',
        )!;

        taskBtn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 50,
                clientY: 60,
                bubbles: true,
            }),
        );

        expect(palette.draggingKind).toBe('task');
        const ghost = palette.ghostElement;
        expect(ghost).not.toBeNull();
        expect(ghost?.classList.contains('coolms-designer__palette-ghost')).toBe(
            true,
        );
        // The activity tiles are typed now (User Task / Service Task) --
        // there is no generic "Task" tile, because the engine has no
        // plain `task` kind to deploy it as.
        expect(ghost?.textContent).toBe('User Task');
        expect(ghost?.style.left).toBe('50px');
        expect(ghost?.style.top).toBe('60px');

        palette.dispose();
    });

    it('pointermove updates the ghost position', () => {
        const palette = new Palette({ host: paletteHost, editor });
        const btn = palette.buttonElements[0]!;
        btn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 50,
                clientY: 60,
                bubbles: true,
            }),
        );

        document.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX: 200,
                clientY: 250,
                bubbles: true,
            }),
        );

        expect(palette.ghostElement?.style.left).toBe('200px');
        expect(palette.ghostElement?.style.top).toBe('250px');

        palette.dispose();
    });

    it('pointerup over the canvas drops a new element through the command stack', () => {
        stubCanvasRect(svg, { left: 100, top: 100, width: 800, height: 600 });

        const palette = new Palette({ host: paletteHost, editor });
        const taskBtn = palette.buttonElements.find(
            (b) => b.getAttribute('data-palette-kind') === 'task',
        )!;

        taskBtn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 0,
                clientY: 0,
                bubbles: true,
            }),
        );

        // Drop in the middle of the canvas (client (400, 300)).
        document.dispatchEvent(
            new PointerEvent('pointerup', {
                clientX: 400,
                clientY: 300,
                bubbles: true,
            }),
        );

        expect(editor.state.elements).toHaveLength(1);
        const el = editor.state.elements[0]!;
        expect(el.type).toBe('task');
        // Element centered at drop minus rect origin (300, 200) -> world (300, 200);
        // task default size 100x80 -> position = (300 - 50, 200 - 40) = (250, 160).
        expect(el.position).toEqual({ x: 250, y: 160 });
        expect(el.size).toEqual({ width: 100, height: 80 });

        // Drag teardown.
        expect(palette.draggingKind).toBeNull();
        expect(palette.ghostElement).toBeNull();

        // Command stack received it -- undo reverses.
        commands.undo();
        expect(editor.state.elements).toHaveLength(0);

        palette.dispose();
    });

    it('pointerup outside the canvas tears down the drag without adding an element', () => {
        stubCanvasRect(svg, { left: 1000, top: 1000, width: 100, height: 100 });

        const palette = new Palette({ host: paletteHost, editor });
        const btn = palette.buttonElements[0]!;

        btn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 50,
                clientY: 50,
                bubbles: true,
            }),
        );

        // Release at (10, 10) -- nowhere near the canvas at (1000, 1000).
        document.dispatchEvent(
            new PointerEvent('pointerup', {
                clientX: 10,
                clientY: 10,
                bubbles: true,
            }),
        );

        expect(editor.state.elements).toHaveLength(0);
        expect(palette.draggingKind).toBeNull();
        expect(palette.ghostElement).toBeNull();

        palette.dispose();
    });

    it('right/middle pointerdown does NOT start a drag', () => {
        const palette = new Palette({ host: paletteHost, editor });
        const btn = palette.buttonElements[0]!;

        btn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 2, // right
                clientX: 50,
                clientY: 50,
                bubbles: true,
            }),
        );

        expect(palette.draggingKind).toBeNull();
        expect(palette.ghostElement).toBeNull();

        palette.dispose();
    });

    it('a second pointerdown during an in-flight drag is ignored', () => {
        const palette = new Palette({ host: paletteHost, editor });
        const taskBtn = palette.buttonElements.find(
            (b) => b.getAttribute('data-palette-kind') === 'task',
        )!;
        const startBtn = palette.buttonElements.find(
            (b) => b.getAttribute('data-palette-kind') === 'startEvent',
        )!;

        taskBtn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 10,
                clientY: 10,
                bubbles: true,
            }),
        );
        const firstGhost = palette.ghostElement;

        startBtn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 20,
                clientY: 20,
                bubbles: true,
            }),
        );

        // Still dragging the task, not the startEvent.
        expect(palette.draggingKind).toBe('task');
        expect(palette.ghostElement).toBe(firstGhost);

        palette.dispose();
    });

    it('dispose removes buttons + cancels any in-flight drag', () => {
        const palette = new Palette({ host: paletteHost, editor });
        const btn = palette.buttonElements[0]!;

        btn.dispatchEvent(
            new PointerEvent('pointerdown', {
                button: 0,
                clientX: 50,
                clientY: 50,
                bubbles: true,
            }),
        );
        expect(palette.draggingKind).not.toBeNull();
        expect(paletteHost.children.length).toBeGreaterThan(0);

        palette.dispose();

        expect(paletteHost.children.length).toBe(0);
        expect(palette.draggingKind).toBeNull();
        expect(palette.ghostElement).toBeNull();
        // Ghost div is detached from body too.
        expect(
            document.body.querySelector('.coolms-designer__palette-ghost'),
        ).toBeNull();
    });

    it('dispose is idempotent -- second call is a no-op', () => {
        const palette = new Palette({ host: paletteHost, editor });

        palette.dispose();
        expect(() => palette.dispose()).not.toThrow();
    });
});
