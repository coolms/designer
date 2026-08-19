import { describe, it, expect } from 'vitest';

import { BpmnLiteSelection } from '../../../src/bpmn-lite/index.js';
import type { BpmnLiteSelectionTarget } from '../../../src/bpmn-lite/index.js';

/**
 * BpmnLiteSelection tests. Pins:
 *  - initial state is null
 *  - select / clear lifecycle + change event firing
 *  - elementId / flowId convenience accessors
 *  - subscribers can unsubscribe
 *  - dispose stops firing
 */
describe('BpmnLiteSelection', () => {
    it('starts with null target + null convenience getters', () => {
        const sel = new BpmnLiteSelection();
        expect(sel.target).toBeNull();
        expect(sel.elementId).toBeNull();
        expect(sel.flowId).toBeNull();
    });

    it('select stores the target + exposes the right convenience getter', () => {
        const sel = new BpmnLiteSelection();

        sel.select({ kind: 'element', id: 't1' });
        expect(sel.target).toEqual({ kind: 'element', id: 't1' });
        expect(sel.elementId).toBe('t1');
        expect(sel.flowId).toBeNull();

        sel.select({ kind: 'flow', id: 'f1' });
        expect(sel.flowId).toBe('f1');
        expect(sel.elementId).toBeNull();
    });

    it('clear() shorthand selects null', () => {
        const sel = new BpmnLiteSelection();
        sel.select({ kind: 'element', id: 't1' });
        sel.clear();
        expect(sel.target).toBeNull();
    });

    it('onChange fires for every select call -- including re-confirmation', () => {
        const sel = new BpmnLiteSelection();
        const captured: Array<BpmnLiteSelectionTarget | null> = [];
        sel.onChange((t) => captured.push(t));

        sel.select({ kind: 'element', id: 't1' });
        sel.select({ kind: 'element', id: 't1' });
        sel.clear();

        expect(captured).toHaveLength(3);
        expect(captured[2]).toBeNull();
    });

    it('onChange returns an unsubscribe thunk', () => {
        const sel = new BpmnLiteSelection();
        const captured: Array<BpmnLiteSelectionTarget | null> = [];
        const off = sel.onChange((t) => captured.push(t));

        sel.select({ kind: 'element', id: 't1' });
        off();
        sel.select({ kind: 'element', id: 't2' });

        expect(captured).toHaveLength(1);
        expect(captured[0]).toEqual({ kind: 'element', id: 't1' });
    });

    it('dispose stops firing + further selects are no-ops', () => {
        const sel = new BpmnLiteSelection();
        const captured: Array<BpmnLiteSelectionTarget | null> = [];
        sel.onChange((t) => captured.push(t));

        sel.dispose();
        sel.select({ kind: 'element', id: 't1' });

        expect(captured).toHaveLength(0);
    });

    it('dispose is idempotent', () => {
        const sel = new BpmnLiteSelection();
        sel.dispose();
        expect(() => sel.dispose()).not.toThrow();
    });
});
