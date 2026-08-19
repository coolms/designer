/**
 * Typed in-process event emitter. Used by every canvas subsystem (Viewport,
 * PointerInput, CommandStack) for subscription plumbing.
 *
 * Why not DOM CustomEvent? Three reasons:
 *  1. **Typing.** The event-map generic gives per-event payload types
 *     out of the box; CustomEvent forces a `detail: unknown` cast at every
 *     consumer site.
 *  2. **Lifecycle.** DOM listeners attached to anything other than the
 *     emitter object itself need careful detach on destroy or they leak.
 *     A standalone Emitter has a single `dispose()` that drops every
 *     subscriber.
 *  3. **Composition.** Emitter is internal — surface-specific code that
 *     wants to expose events to public consumers can wrap an internal
 *     Emitter without committing to DOM-event semantics in the API.
 *
 * Subscribers can subscribe/unsubscribe DURING an emit cycle — we
 * iterate a snapshot of the listener set so mutations to the live set
 * during dispatch don't drop the in-flight pass.
 */
export class Emitter<T extends Record<string, unknown>> {
    private readonly listeners = new Map<keyof T, Set<(payload: unknown) => void>>();

    /**
     * Subscribe to an event. Returns a thunk that unsubscribes when called;
     * idempotent (subsequent calls are no-ops).
     */
    on<K extends keyof T>(event: K, listener: (payload: T[K]) => void): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        const wrapped = listener as (payload: unknown) => void;
        set.add(wrapped);
        return () => {
            const current = this.listeners.get(event);
            if (!current) return;
            current.delete(wrapped);
            if (current.size === 0) {
                this.listeners.delete(event);
            }
        };
    }

    /**
     * Dispatch an event. Listeners run synchronously in subscription order;
     * an exception in one listener does NOT stop subsequent listeners (we
     * collect-and-rethrow at the end to preserve fault-tolerance).
     */
    emit<K extends keyof T>(event: K, payload: T[K]): void {
        const set = this.listeners.get(event);
        if (!set) return;
        const errors: unknown[] = [];
        // Snapshot so subscribe/unsubscribe during emit doesn't disturb the pass.
        for (const listener of [...set]) {
            try {
                listener(payload);
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1) {
            throw errors[0];
        } else if (errors.length > 1) {
            // Multiple listener errors are exceptional — surface them all together
            // rather than silently swallowing all but the first.
            throw new AggregateError(errors, '[@coolms/designer] multiple listener errors');
        }
    }

    /** Drop every subscriber. After dispose() the emitter is still usable; it has zero listeners. */
    dispose(): void {
        this.listeners.clear();
    }

    /** Listener count for an event. Test affordance + leak-detection hook. */
    listenerCount<K extends keyof T>(event: K): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}
