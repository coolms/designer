import { describe, expect, it, vi } from 'vitest';
import { Selection } from '../../../src/property-panel/Selection.js';

describe('Selection', () => {
    it('starts empty', () => {
        const sel = new Selection();
        expect(sel.id).toBeNull();
        expect(sel.isSelected('any')).toBe(false);
    });

    it('select fires change event with new id', () => {
        const sel = new Selection();
        const onChange = vi.fn();
        sel.onChange(onChange);

        sel.select('node1');

        expect(sel.id).toBe('node1');
        expect(sel.isSelected('node1')).toBe(true);
        expect(onChange).toHaveBeenCalledWith('node1');
    });

    it('selecting the same id is a no-op (no event)', () => {
        const sel = new Selection();
        sel.select('node1');
        const onChange = vi.fn();
        sel.onChange(onChange);

        sel.select('node1');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('clear sets id to null + fires change', () => {
        const sel = new Selection();
        sel.select('node1');
        const onChange = vi.fn();
        sel.onChange(onChange);

        sel.clear();
        expect(sel.id).toBeNull();
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('clear on already-empty selection is a no-op', () => {
        const sel = new Selection();
        const onChange = vi.fn();
        sel.onChange(onChange);
        sel.clear();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('onChange returns unsubscribe thunk', () => {
        const sel = new Selection();
        const onChange = vi.fn();
        const off = sel.onChange(onChange);
        off();
        sel.select('node1');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('listenerCount reflects subscriptions', () => {
        const sel = new Selection();
        expect(sel.listenerCount).toBe(0);
        const off = sel.onChange(() => {});
        sel.onChange(() => {});
        expect(sel.listenerCount).toBe(2);
        off();
        expect(sel.listenerCount).toBe(1);
    });

    it('dispose drops listeners + clears selection + no-ops further mutations', () => {
        const sel = new Selection();
        const onChange = vi.fn();
        sel.onChange(onChange);
        sel.select('node1');
        onChange.mockClear();

        sel.dispose();
        expect(sel.id).toBeNull();
        sel.select('node2');
        expect(sel.id).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('dispose is idempotent', () => {
        const sel = new Selection();
        sel.dispose();
        expect(() => sel.dispose()).not.toThrow();
    });
});
