import type { FieldRenderer } from './FieldRenderer.js';

/**
 * Maps field-type discriminator strings to their {@link FieldRenderer}
 * implementations. Surface authors register custom field types here;
 * the built-ins (text / textarea / select / el-expression /
 * boolean) are typically registered at PropertyPanel construction
 * time by the panel's factory helper.
 *
 * Replacement semantics: registering a type that already exists
 * REPLACES the previous renderer. Useful for tenant-side overrides
 * (e.g. tenant ships a custom `select` that talks to a corporate
 * autocomplete endpoint). The previous renderer is silently dropped
 * -- it's the caller's job to keep track of what's where.
 *
 * Living references: the {@link PropertyPanel} resolves renderers at
 * field-mount time (selection-change), not at descriptor-author
 * time. Registering a new renderer for an in-use type doesn't
 * disturb currently-mounted fields; the new renderer takes effect on
 * the next selection change.
 */
export class FieldRegistry {
    private readonly renderers = new Map<string, FieldRenderer>();
    private disposed = false;

    /**
     * Register or replace a renderer for the given type. Returns an
     * unregister thunk that removes the entry (idempotent).
     *
     * The parameter is typed as `FieldRenderer<any>` (not the default
     * `FieldRenderer<unknown>`) because the registry is the type-erasure
     * boundary: at the call site the renderer's `TValue` is known
     * (e.g. `TextField` is `FieldRenderer<string>`), but the registry
     * stores it for lookup-by-string-key + the {@link PropertyPanel}
     * hands it a {@link FieldContext}<unknown> at mount time. Field
     * implementations handle the unknown-erased value defensively
     * (e.g. text fields coerce non-string to empty).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register(renderer: FieldRenderer<any>): () => void {
        this.assertNotDisposed();
        if (renderer.type.length === 0) {
            throw new Error('[@coolms/designer] FieldRegistry.register: renderer.type must be non-empty.');
        }
        this.renderers.set(renderer.type, renderer);
        return () => {
            if (this.disposed) return;
            // Guard against unregistering a replacement -- only remove if THIS renderer is still the registered one.
            if (this.renderers.get(renderer.type) === renderer) {
                this.renderers.delete(renderer.type);
            }
        };
    }

    /** Look up a renderer by type. Returns `undefined` for unknown types. */
    get(type: string): FieldRenderer | undefined {
        return this.renderers.get(type);
    }

    /** Registered type list -- snapshot. Test affordance. */
    get types(): ReadonlyArray<string> {
        return [...this.renderers.keys()];
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.renderers.clear();
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('[@coolms/designer] FieldRegistry has been disposed.');
        }
    }
}
