import { describe, expect, it, vi } from 'vitest';
import { XRefs } from '../../../src/shell/XRefs.js';

describe('XRefs', () => {
    it('starts empty', () => {
        const xrefs = new XRefs();
        expect(xrefs.scopeKeys).toEqual([]);
        expect(xrefs.query('any')).toEqual([]);
    });

    it('registerLookup populates a scope + fires change', () => {
        const xrefs = new XRefs();
        const onChange = vi.fn();
        xrefs.onChange('decisions', onChange);

        xrefs.registerLookup('decisions', [
            { id: 'pricing.discount', label: 'Pricing Discount' },
            { id: 'risk.score', label: 'Risk Score' },
        ]);

        expect(xrefs.scopeKeys).toEqual(['decisions']);
        expect(xrefs.query('decisions')).toHaveLength(2);
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('query filters case-insensitively by label or id', () => {
        const xrefs = new XRefs();
        xrefs.registerLookup('decisions', [
            { id: 'pricing.discount', label: 'Pricing Discount' },
            { id: 'risk.score', label: 'Risk Score' },
            { id: 'shipping.tier', label: 'Shipping Tier' },
        ]);

        expect(xrefs.query('decisions', 'pri').map((i) => i.id)).toEqual(['pricing.discount']);
        expect(xrefs.query('decisions', 'SCORE').map((i) => i.id)).toEqual(['risk.score']);
        // Match against id when label doesn't hit.
        expect(xrefs.query('decisions', 'shipping').map((i) => i.id)).toEqual(['shipping.tier']);
        // Empty prefix returns everything.
        expect(xrefs.query('decisions', '').map((i) => i.id)).toHaveLength(3);
    });

    it('unknown scope returns empty list (not an error)', () => {
        const xrefs = new XRefs();
        expect(xrefs.query('nope')).toEqual([]);
    });

    it('re-registering a scope replaces the list', () => {
        const xrefs = new XRefs();
        xrefs.registerLookup('decisions', [{ id: 'a', label: 'A' }]);
        xrefs.registerLookup('decisions', [{ id: 'b', label: 'B' }]);
        expect(xrefs.query('decisions').map((i) => i.id)).toEqual(['b']);
    });

    it('unregister thunk drops the scope', () => {
        const xrefs = new XRefs();
        const off = xrefs.registerLookup('decisions', [{ id: 'a', label: 'A' }]);

        const onChange = vi.fn();
        xrefs.onChange('decisions', onChange);

        off();

        expect(xrefs.scopeKeys).toEqual([]);
        expect(xrefs.query('decisions')).toEqual([]);
        expect(onChange).toHaveBeenCalledOnce(); // fires on removal too
    });

    it('unregister is idempotent', () => {
        const xrefs = new XRefs();
        const off = xrefs.registerLookup('a', []);
        off();
        expect(() => off()).not.toThrow();
    });

    it('onChange fires only for its scope', () => {
        const xrefs = new XRefs();
        const onDecisions = vi.fn();
        const onHandlers = vi.fn();
        xrefs.onChange('decisions', onDecisions);
        xrefs.onChange('handlers', onHandlers);

        xrefs.registerLookup('decisions', [{ id: 'a', label: 'A' }]);

        expect(onDecisions).toHaveBeenCalledOnce();
        expect(onHandlers).not.toHaveBeenCalled();
    });

    it('throws on empty scope', () => {
        const xrefs = new XRefs();
        expect(() => xrefs.registerLookup('', [])).toThrow(/non-empty/);
    });

    it('dispose drops everything + throws on subsequent registerLookup', () => {
        const xrefs = new XRefs();
        xrefs.registerLookup('decisions', [{ id: 'a', label: 'A' }]);
        xrefs.dispose();

        expect(xrefs.scopeKeys).toEqual([]);
        expect(() => xrefs.registerLookup('decisions', [])).toThrow(/disposed/);
    });

    it('dispose is idempotent', () => {
        const xrefs = new XRefs();
        xrefs.dispose();
        expect(() => xrefs.dispose()).not.toThrow();
    });
});
