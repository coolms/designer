import { describe, expect, it } from 'vitest';
import { FieldRegistry } from '../../../src/property-panel/FieldRegistry.js';
import type { FieldRenderer } from '../../../src/property-panel/FieldRenderer.js';

const makeRenderer = (type: string): FieldRenderer => ({
    type,
    create: () => ({ setValue: () => {}, setDisabled: () => {}, destroy: () => {} }),
});

describe('FieldRegistry', () => {
    it('starts empty', () => {
        const r = new FieldRegistry();
        expect(r.types).toEqual([]);
        expect(r.get('text')).toBeUndefined();
    });

    it('register adds a renderer', () => {
        const r = new FieldRegistry();
        const renderer = makeRenderer('text');
        r.register(renderer);
        expect(r.get('text')).toBe(renderer);
        expect(r.types).toEqual(['text']);
    });

    it('register replaces existing type', () => {
        const r = new FieldRegistry();
        const first = makeRenderer('text');
        const second = makeRenderer('text');
        r.register(first);
        r.register(second);
        expect(r.get('text')).toBe(second);
    });

    it('unregister thunk removes the entry', () => {
        const r = new FieldRegistry();
        const renderer = makeRenderer('text');
        const off = r.register(renderer);
        off();
        expect(r.get('text')).toBeUndefined();
    });

    it('unregister thunk only removes if the same renderer is still registered', () => {
        const r = new FieldRegistry();
        const first = makeRenderer('text');
        const second = makeRenderer('text');
        const offFirst = r.register(first);
        r.register(second);
        // Old thunk should NOT remove the new renderer.
        offFirst();
        expect(r.get('text')).toBe(second);
    });

    it('throws on empty type', () => {
        const r = new FieldRegistry();
        expect(() => r.register(makeRenderer(''))).toThrow(/non-empty/);
    });

    it('dispose clears + throws on subsequent register', () => {
        const r = new FieldRegistry();
        r.register(makeRenderer('text'));
        r.dispose();
        expect(r.types).toEqual([]);
        expect(() => r.register(makeRenderer('text'))).toThrow(/disposed/);
    });

    it('dispose is idempotent', () => {
        const r = new FieldRegistry();
        r.dispose();
        expect(() => r.dispose()).not.toThrow();
    });
});
