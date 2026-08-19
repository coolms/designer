import type { XRefs } from '../shell/XRefs.js';
import type { FieldDescriptor } from './FieldDescriptor.js';

/**
 * Per-mount context handed to a {@link FieldRenderer.create} call.
 * Carries the initial value + change callback + cross-reference
 * registry + read-only mode. Field renderers should hold the context
 * for the lifetime of their {@link FieldInstance} and call back into
 * `onChange` whenever the user mutates the value.
 */
export interface FieldContext<TValue = unknown> {
    /** Initial value -- may be `undefined` if the element has no property at this key. */
    readonly initialValue: TValue | undefined;
    /**
     * Callback the field invokes when the user mutates the value.
     * The {@link PropertyPanel} responds by writing the new properties
     * map back to {@link Graph.updateElement}.
     *
     * Renderers MUST debounce high-frequency events themselves (e.g.
     * a keyup handler should call onChange on `change`, not on every
     * `input` event) -- the panel does not coalesce.
     */
    readonly onChange: (next: TValue) => void;
    /** Cross-reference registry for autocomplete + select fields. */
    readonly xrefs: XRefs;
    /**
     * Whether the field is read-only. Composed from the descriptor's
     * `readOnly` flag and the panel-level read-only mode -- either
     * setting true makes the field read-only.
     */
    readonly readOnly: boolean;
}

/**
 * Mounted field instance. The {@link FieldRenderer} returns one of
 * these on `create`; the {@link PropertyPanel} keeps the reference
 * and calls into it for value updates + tear-down on selection
 * change.
 */
export interface FieldInstance {
    /**
     * Programmatically update the displayed value. Called when the
     * underlying element changes externally (e.g. undo/redo / load
     * a different model) so the field stays in sync without forcing
     * a full panel re-render.
     *
     * Implementations should be defensive against being called with
     * the same value they currently display -- a fast path that
     * compares + skips DOM writes is welcome but not required.
     */
    setValue(value: unknown): void;
    /**
     * Programmatic read-only toggle. Lets the panel flip its global
     * read-only mode without re-mounting every field.
     */
    setDisabled(disabled: boolean): void;
    /** Unmount + release all owned listeners. Safe to call multiple times. */
    destroy(): void;
}

/**
 * Field renderer contract -- implement once per field type, register
 * via {@link FieldRegistry.register}. Renderers are stateless
 * factories; each `create` call mounts a fresh DOM tree into the
 * passed host element + returns a per-mount {@link FieldInstance}.
 *
 * Type parameter `TValue` narrows the JS value type the field reads
 * and writes (string for text, boolean for checkbox, etc.). Custom
 * field types can use richer types -- the registry stores them as
 * unknown-erased renderers internally + the panel doesn't care.
 */
export interface FieldRenderer<TValue = unknown> {
    /** Type discriminator matching the descriptor's `type` field. */
    readonly type: string;
    /**
     * Mount the field into `host`. Returns a {@link FieldInstance}
     * for follow-up updates + tear-down.
     */
    create(
        host: HTMLElement,
        descriptor: FieldDescriptor,
        context: FieldContext<TValue>,
    ): FieldInstance;
}
