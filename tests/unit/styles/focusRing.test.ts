import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The focus indicator, read from the stylesheet the package ships.
 *
 * A focused field draws a solid ring in `--coolms-designer-focus`, never a
 * translucent halo: a 15% wash of the focus colour around a white field is
 * barely distinguishable from the field. These tests fail on a halo, on a ring
 * in any other colour, and on a ring whose contrast against the field it sits
 * on is under 3:1 (the WCAG minimum for a non-text indicator), in the light
 * theme and the dark one.
 */
const CSS = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/styles/coolms-designer.css'),
    'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
    selector: string;
    body: string;
}

function rules(): Rule[] {
    const found: Rule[] = [];
    for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        found.push({ selector: m[1].trim(), body: m[2] });
    }
    return found;
}

function declaration(body: string, property: string): string | null {
    const m = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(body);
    return m ? m[1].trim() : null;
}

/** The custom properties as the light theme declares them, with the dark theme's on top when asked. */
function tokens(dark: boolean): Map<string, string> {
    const map = new Map<string, string>();
    const take = (r: Rule): void => {
        for (const m of r.body.matchAll(/(--coolms-designer-[\w-]+)\s*:\s*([^;]+)/g)) {
            map.set(m[1], m[2].trim());
        }
    };
    const all = rules();
    all.filter((r) => !r.selector.includes('data-theme')).forEach(take);
    if (dark) {
        all.filter((r) => r.selector.includes("[data-theme='dark']")).forEach(take);
    }
    return map;
}

function resolveValue(value: string, map: Map<string, string>, depth = 0): string {
    expect(depth, `a var() chain that does not end: ${value}`).toBeLessThan(10);
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
    if (null === m) {
        return value.trim();
    }
    const next = map.get(m[1]) ?? m[2];
    expect(next, `${m[1]} is declared nowhere and has no fallback`).toBeDefined();
    return resolveValue(next as string, map, depth + 1);
}

function luminance(hex: string): number {
    expect(hex, 'an opaque #rrggbb colour').toMatch(/^#[0-9a-f]{6}$/i);
    const channel = (i: number): number => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const focusRules = (): Rule[] => rules().filter((r) => r.selector.includes(':focus'));

describe('the focus ring', () => {
    it('is found on every focusable field the stylesheet styles', () => {
        // The denominator, so an empty list cannot pass the tests below.
        expect(focusRules().map((r) => r.selector)).toEqual([
            '.coolms-designer__field-input:focus',
            '.coolms-designer__dmn-table-entry-input:focus',
        ]);
    });

    it('is a solid 2px outline in the focus colour, and no focus rule paints a halo', () => {
        for (const r of focusRules()) {
            expect(declaration(r.body, 'outline'), r.selector).toBe('2px solid var(--coolms-designer-focus)');
            const shadow = declaration(r.body, 'box-shadow');
            expect(null === shadow || 'none' === shadow, `${r.selector} paints box-shadow: ${shadow}`).toBe(true);
        }
        expect(CSS, 'the halo token is gone, so an override of it cannot paint').not.toContain(
            '--coolms-designer-focus-ring',
        );
    });

    it.each([
        ['light', false],
        ['dark', true],
    ])('reads at 3:1 or more against each field it surrounds (%s)', (_theme, dark) => {
        const map = tokens(dark);
        const ring = resolveValue('var(--coolms-designer-focus)', map);
        for (const field of ['--coolms-designer-field-input-bg', '--coolms-designer-dmn-input-bg']) {
            const ratio = contrast(ring, resolveValue(`var(${field})`, map));
            expect(ratio, `${ring} on ${field}`).toBeGreaterThanOrEqual(3);
        }
    });
});
