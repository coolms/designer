import { Emitter } from '../internal/Emitter.js';

/**
 * A single cross-reference item. Returned by {@link XRefs.query} for
 * autocomplete pickers in the property panel.
 *
 * Surface examples:
 *  - BPMN service-task `decisionKey` picker queries `'decisions'` scope,
 *    which the DMN editor populates from its Graph.
 *  - BPMN service-task `implementation` picker queries `'handlers'`
 *    scope, which the Angular wrapper populates from
 *    `GET /api/v1/workflow/handlers`.
 *  - StateMachine `transitionTo` picker queries `'states'` scope,
 *    populated by the State Machine editor from its Graph.
 */
export interface XRefItem {
    /** Stable identifier -- the value the property field stores. */
    readonly id: string;
    /** Human-readable label -- what the dropdown shows. */
    readonly label: string;
    /** Optional secondary text for ambiguous labels (e.g. an FQCN). */
    readonly description?: string;
    /** Opaque per-item metadata for renderers that want extra context. */
    readonly meta?: Readonly<Record<string, unknown>>;
}

interface XRefEvents extends Record<string, unknown> {
    /** Fired on registerLookup / updateLookup / removeLookup. Payload is the scope key. */
    change: string;
}

/**
 * Cross-reference lookup registry -- the seam through which property-
 * panel autocomplete fields query for picker options. Items
 * are organized by scope; surface renderers + the Angular wrapper
 * register scoped lists, property fields query them.
 *
 * The registry is in-memory + per-editor-instance. There's no
 * persistence: scopes that depend on backend data (handler catalog,
 * deployed decision keys) are repopulated when the Angular wrapper
 * fetches them.
 *
 * Why a registry vs direct cross-references between Graph instances:
 * each surface editor has its OWN graph, so the BPMN editor can't
 * directly walk into the DMN editor's nodes. The XRefs registry is
 * the boundary layer that says "tell me what's available in
 * 'decisions' scope" without coupling the editors.
 *
 * Public-internal API: not re-exported from the package root; surface
 * renderers + the Angular wrapper import from
 * `'../shell/XRefs.js'` directly.
 */
export class XRefs {
    private readonly scopes = new Map<string, XRefItem[]>();
    private readonly emitter = new Emitter<XRefEvents>();
    private disposed = false;

    /**
     * Register or replace items for a scope. Subsequent calls REPLACE
     * the entire list -- there's no merge. Returns a thunk that removes
     * the scope entirely (idempotent).
     *
     * Multiple registrations against the same scope are unusual but
     * legal: each call replaces, so the last writer wins. Surface
     * authors should pick a unique scope per source (e.g.
     * `'decisions:pricing'`) to avoid collisions.
     */
    registerLookup(scope: string, items: ReadonlyArray<XRefItem>): () => void {
        this.assertNotDisposed();
        if (scope.length === 0) {
            throw new Error('[@coolms/designer] XRefs.registerLookup: scope must be non-empty.');
        }
        this.scopes.set(scope, [...items]);
        this.emitter.emit('change', scope);
        return () => {
            if (this.disposed) return;
            if (this.scopes.delete(scope)) {
                this.emitter.emit('change', scope);
            }
        };
    }

    /**
     * Look up items for a scope, optionally filtered by a case-
     * insensitive substring match on `label` OR `id`. Returns a fresh
     * array each call.
     *
     * Unknown scope returns `[]` (not an error -- the field UI gracefully
     * degrades to "no options yet" until the producer registers).
     */
    query(scope: string, prefix?: string): ReadonlyArray<XRefItem> {
        const items = this.scopes.get(scope);
        if (!items) return [];
        if (prefix === undefined || prefix === '') return [...items];

        const needle = prefix.toLowerCase();
        return items.filter(
            (item) => item.label.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle),
        );
    }

    /**
     * Subscribe to changes on a specific scope. Listener fires only
     * when that scope is registered, replaced, or removed -- other
     * scopes' updates don't trigger it.
     */
    onChange(scope: string, listener: () => void): () => void {
        return this.emitter.on('change', (changedScope) => {
            if (changedScope === scope) listener();
        });
    }

    /** Registered scope keys (snapshot). Test affordance. */
    get scopeKeys(): ReadonlyArray<string> {
        return [...this.scopes.keys()];
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.scopes.clear();
        this.emitter.dispose();
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('[@coolms/designer] XRefs has been disposed.');
        }
    }
}
