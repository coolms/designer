import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph, GraphInvariantError } from '../../../src/model/Graph.js';
import type {
    ChangeEvent,
    EdgeElement,
    NodeElement,
} from '../../../src/model/index.js';

/** Convenience factories so the tests stay readable. */
function node(
    id: string,
    overrides: Partial<Omit<NodeElement, 'id' | 'kind'>> = {},
): NodeElement {
    return {
        id,
        kind: 'node',
        type: overrides.type ?? 'userTask',
        position: overrides.position ?? { x: 0, y: 0 },
        size: overrides.size ?? { width: 100, height: 60 },
        properties: overrides.properties ?? {},
    };
}

function edge(
    id: string,
    source: string,
    target: string,
    overrides: Partial<Omit<EdgeElement, 'id' | 'kind' | 'source' | 'target'>> = {},
): EdgeElement {
    return {
        id,
        kind: 'edge',
        type: overrides.type ?? 'sequenceFlow',
        source,
        target,
        waypoints: overrides.waypoints ?? [],
        properties: overrides.properties ?? {},
    };
}

describe('Graph', () => {
    let graph: Graph;

    beforeEach(() => {
        graph = new Graph();
    });

    // ------------------------------------------------------------------
    // Initial state
    // ------------------------------------------------------------------

    describe('initial state', () => {
        it('starts empty with revision 0', () => {
            expect(graph.size).toBe(0);
            expect(graph.revision).toBe(0);
            expect(graph.isDisposed).toBe(false);
            expect(graph.listenerCount).toBe(0);
            expect(graph.getElements()).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // addElement
    // ------------------------------------------------------------------

    describe('addElement', () => {
        it('inserts a node + emits added event', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.addElement(node('n1'));

            expect(graph.size).toBe(1);
            expect(graph.getElement('n1')).toMatchObject({ id: 'n1', kind: 'node' });
            expect(graph.revision).toBe(1);
            expect(onChange).toHaveBeenCalledWith({
                revision: 1,
                changes: [{ type: 'added', elementId: 'n1' }],
            });
        });

        it('throws on duplicate id', () => {
            graph.addElement(node('n1'));
            expect(() => graph.addElement(node('n1'))).toThrow(GraphInvariantError);
            expect(() => graph.addElement(node('n1'))).toThrow(/Duplicate element id/);
        });

        it('throws on edge with missing source', () => {
            graph.addElement(node('n1'));
            expect(() => graph.addElement(edge('e1', 'missing', 'n1'))).toThrow(
                /source "missing" is not an existing node/,
            );
        });

        it('throws on edge with missing target', () => {
            graph.addElement(node('n1'));
            expect(() => graph.addElement(edge('e1', 'n1', 'missing'))).toThrow(
                /target "missing" is not an existing node/,
            );
        });

        it('throws when edge "endpoint" resolves to another edge (not a node)', () => {
            graph.addElement(node('n1'));
            graph.addElement(node('n2'));
            graph.addElement(edge('e1', 'n1', 'n2'));
            // e1 is an edge — trying to use its id as an edge endpoint must fail.
            expect(() => graph.addElement(edge('e2', 'e1', 'n2'))).toThrow(
                /not an existing node/,
            );
        });

        it('allows self-loop edges', () => {
            graph.addElement(node('n1'));
            expect(() => graph.addElement(edge('e1', 'n1', 'n1'))).not.toThrow();
        });

        it('throws when graph is disposed', () => {
            graph.dispose();
            expect(() => graph.addElement(node('n1'))).toThrow(/disposed/);
        });
    });

    // ------------------------------------------------------------------
    // removeElement
    // ------------------------------------------------------------------

    describe('removeElement', () => {
        it('removes a node + emits removed event', () => {
            graph.addElement(node('n1'));
            const onChange = vi.fn();
            graph.onChange(onChange);

            const removed = graph.removeElement('n1');

            expect(removed).toBe(true);
            expect(graph.size).toBe(0);
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    changes: [{ type: 'removed', elementId: 'n1' }],
                }),
            );
        });

        it('is idempotent for unknown ids (returns false, no event)', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);
            expect(graph.removeElement('nope')).toBe(false);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('cascade-removes incident edges in the same event', () => {
            graph.addElement(node('n1'));
            graph.addElement(node('n2'));
            graph.addElement(node('n3'));
            graph.addElement(edge('e1', 'n1', 'n2'));
            graph.addElement(edge('e2', 'n2', 'n3'));
            graph.addElement(edge('e3', 'n1', 'n3'));

            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.removeElement('n2'); // should cascade e1 + e2

            expect(graph.size).toBe(3); // n1, n3, e3
            expect(graph.getElement('e1')).toBeUndefined();
            expect(graph.getElement('e2')).toBeUndefined();
            expect(graph.getElement('e3')).toBeDefined();

            expect(onChange).toHaveBeenCalledTimes(1);
            const event = onChange.mock.calls[0]![0] as ChangeEvent;
            // 3 removals batched: e1, e2, then n2 (node removed last).
            expect(event.changes).toHaveLength(3);
            expect(event.changes.map((c) => (c.type === 'removed' ? c.elementId : c.type))).toEqual(
                ['e1', 'e2', 'n2'],
            );
        });

        it('cascades self-loop edges too', () => {
            graph.addElement(node('n1'));
            graph.addElement(edge('e1', 'n1', 'n1'));

            graph.removeElement('n1');

            expect(graph.size).toBe(0);
        });
    });

    // ------------------------------------------------------------------
    // updateElement
    // ------------------------------------------------------------------

    describe('updateElement', () => {
        beforeEach(() => {
            graph.addElement(node('n1'));
            graph.addElement(node('n2'));
            graph.addElement(edge('e1', 'n1', 'n2'));
        });

        it('patches a node position', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.updateElement('n1', { position: { x: 100, y: 200 } });

            const updated = graph.getElement('n1') as NodeElement;
            expect(updated.position).toEqual({ x: 100, y: 200 });
            expect(updated.size).toEqual({ width: 100, height: 60 }); // unchanged
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    changes: [{ type: 'updated', elementId: 'n1' }],
                }),
            );
        });

        it('patches edge waypoints + reconnect source', () => {
            graph.addElement(node('n3'));
            graph.updateElement('e1', {
                source: 'n3',
                waypoints: [
                    { x: 10, y: 10 },
                    { x: 50, y: 50 },
                ],
            });

            const updated = graph.getElement('e1') as EdgeElement;
            expect(updated.source).toBe('n3');
            expect(updated.target).toBe('n2'); // unchanged
            expect(updated.waypoints).toEqual([
                { x: 10, y: 10 },
                { x: 50, y: 50 },
            ]);
        });

        it('replaces properties wholesale (does NOT merge)', () => {
            graph.updateElement('n1', { properties: { a: 1, b: 2 } });
            graph.updateElement('n1', { properties: { c: 3 } });

            const updated = graph.getElement('n1') as NodeElement;
            expect(updated.properties).toEqual({ c: 3 }); // a + b gone
        });

        it('throws on unknown id', () => {
            expect(() => graph.updateElement('nope', { properties: {} })).toThrow(
                /Cannot update unknown element/,
            );
        });

        it('throws if patch attempts to change kind', () => {
            expect(() =>
                graph.updateElement('n1', { kind: 'edge' } as unknown as Parameters<typeof graph.updateElement>[1]),
            ).toThrow(/kind is immutable/);
        });

        it('throws when patched edge has missing source', () => {
            expect(() => graph.updateElement('e1', { source: 'missing' })).toThrow(
                /not an existing node/,
            );
        });
    });

    // ------------------------------------------------------------------
    // clear
    // ------------------------------------------------------------------

    describe('clear', () => {
        it('wipes everything + emits reset', () => {
            graph.addElement(node('n1'));
            graph.addElement(node('n2'));
            graph.addElement(edge('e1', 'n1', 'n2'));

            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.clear();

            expect(graph.size).toBe(0);
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({ changes: [{ type: 'reset' }] }),
            );
        });

        it('is a no-op when already empty (no event)', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);
            graph.clear();
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------

    describe('queries', () => {
        beforeEach(() => {
            graph.addElement(node('n1', { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }));
            graph.addElement(node('n2', { position: { x: 200, y: 0 }, size: { width: 100, height: 100 } }));
            graph.addElement(node('n3', { position: { x: 50, y: 50 }, size: { width: 80, height: 80 } })); // overlaps n1
            graph.addElement(edge('e1', 'n1', 'n2'));
            graph.addElement(edge('e2', 'n1', 'n3'));
        });

        it('getNodes returns only nodes', () => {
            expect(graph.getNodes().map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
        });

        it('getEdges returns only edges', () => {
            expect(graph.getEdges().map((e) => e.id)).toEqual(['e1', 'e2']);
        });

        it('getIncoming filters by target', () => {
            expect(graph.getIncoming('n3').map((e) => e.id)).toEqual(['e2']);
            expect(graph.getIncoming('n1').map((e) => e.id)).toEqual([]);
        });

        it('getOutgoing filters by source', () => {
            expect(graph.getOutgoing('n1').map((e) => e.id)).toEqual(['e1', 'e2']);
            expect(graph.getOutgoing('n3').map((e) => e.id)).toEqual([]);
        });

        it('getElement returns the live reference', () => {
            const fetched = graph.getElement('n1');
            expect(fetched?.id).toBe('n1');
            expect(graph.getElement('nope')).toBeUndefined();
        });

        describe('findNodeAt', () => {
            it('returns null when no node contains the point', () => {
                expect(graph.findNodeAt({ x: 500, y: 500 })).toBeNull();
            });

            it('returns the node containing the point', () => {
                expect(graph.findNodeAt({ x: 250, y: 50 })?.id).toBe('n2');
            });

            it('returns top-most (last-inserted) when nodes overlap', () => {
                // (60, 60) is inside both n1 and n3, but n3 was added later.
                expect(graph.findNodeAt({ x: 60, y: 60 })?.id).toBe('n3');
            });

            it('treats bounds as inclusive (boundary point hits)', () => {
                expect(graph.findNodeAt({ x: 0, y: 0 })?.id).toBe('n1');
                expect(graph.findNodeAt({ x: 100, y: 100 })?.id).toBe('n3'); // overlap point, n3 wins
            });
        });
    });

    // ------------------------------------------------------------------
    // transaction
    // ------------------------------------------------------------------

    describe('transaction', () => {
        it('coalesces multiple mutations into one change event', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.transaction(() => {
                graph.addElement(node('n1'));
                graph.addElement(node('n2'));
                graph.addElement(edge('e1', 'n1', 'n2'));
            });

            expect(onChange).toHaveBeenCalledTimes(1);
            const event = onChange.mock.calls[0]![0] as ChangeEvent;
            expect(event.revision).toBe(1);
            expect(event.changes).toEqual([
                { type: 'added', elementId: 'n1' },
                { type: 'added', elementId: 'n2' },
                { type: 'added', elementId: 'e1' },
            ]);
        });

        it('nested transactions emit on outermost commit only', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.transaction(() => {
                graph.addElement(node('n1'));
                graph.transaction(() => {
                    graph.addElement(node('n2'));
                });
                // No event here yet — outer transaction still open.
                graph.addElement(node('n3'));
            });

            expect(onChange).toHaveBeenCalledTimes(1);
            const event = onChange.mock.calls[0]![0] as ChangeEvent;
            expect(event.changes.map((c) => (c.type === 'added' ? c.elementId : c.type))).toEqual(
                ['n1', 'n2', 'n3'],
            );
        });

        it('a transaction with no mutations emits nothing', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);

            graph.transaction(() => {
                // intentionally empty
            });

            expect(onChange).not.toHaveBeenCalled();
            expect(graph.revision).toBe(0);
        });

        it('returns whatever the callback returns', () => {
            const result = graph.transaction(() => {
                graph.addElement(node('n1'));
                return 42;
            });
            expect(result).toBe(42);
        });

        it('throwing inside still flushes the queued changes (not atomic)', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);

            expect(() => {
                graph.transaction(() => {
                    graph.addElement(node('n1'));
                    throw new Error('boom');
                });
            }).toThrow('boom');

            // The half-applied mutation stays + the change event fires.
            // Atomicity is the CommandStack's job, not the Graph's.
            expect(graph.size).toBe(1);
            expect(onChange).toHaveBeenCalledTimes(1);
        });
    });

    // ------------------------------------------------------------------
    // generateId
    // ------------------------------------------------------------------

    describe('generateId', () => {
        it('returns sequential ids when prefix is unused', () => {
            expect(graph.generateId('node')).toBe('node_1');
            graph.addElement(node('node_1'));
            expect(graph.generateId('node')).toBe('node_2');
        });

        it('skips ids already taken (non-contiguous)', () => {
            graph.addElement(node('foo_1'));
            graph.addElement(node('foo_3'));
            expect(graph.generateId('foo')).toBe('foo_2');
        });

        it('throws on empty prefix', () => {
            expect(() => graph.generateId('')).toThrow(/non-empty/);
        });
    });

    // ------------------------------------------------------------------
    // Subscriptions + lifecycle
    // ------------------------------------------------------------------

    describe('subscriptions', () => {
        it('onChange returns unsubscribe thunk', () => {
            const onChange = vi.fn();
            const off = graph.onChange(onChange);

            graph.addElement(node('n1'));
            expect(onChange).toHaveBeenCalledTimes(1);

            off();
            graph.addElement(node('n2'));
            expect(onChange).toHaveBeenCalledTimes(1);
        });

        it('listenerCount reflects subscriptions', () => {
            const off1 = graph.onChange(() => {});
            graph.onChange(() => {});
            expect(graph.listenerCount).toBe(2);
            off1();
            expect(graph.listenerCount).toBe(1);
        });

        it('revision counter advances per emitted event, not per mutation', () => {
            graph.addElement(node('n1'));
            expect(graph.revision).toBe(1);

            graph.transaction(() => {
                graph.addElement(node('n2'));
                graph.addElement(node('n3'));
            });
            expect(graph.revision).toBe(2); // single event, single increment
        });
    });

    describe('dispose', () => {
        it('clears state + drops subscribers + throws on subsequent mutations', () => {
            const onChange = vi.fn();
            graph.onChange(onChange);
            graph.addElement(node('n1'));

            graph.dispose();

            expect(graph.isDisposed).toBe(true);
            expect(graph.listenerCount).toBe(0);
            expect(() => graph.addElement(node('n2'))).toThrow(/disposed/);
        });

        it('is idempotent', () => {
            graph.dispose();
            expect(() => graph.dispose()).not.toThrow();
        });
    });
});
