/**
 * Type-only schema language for the property panel. A surface's
 * {@link SchemaProvider} returns an ordered list of these per element;
 * the {@link PropertyPanel} maps each to a {@link FieldRenderer} via
 * the {@link FieldRegistry} and mounts the resulting field instances.
 *
 * Field descriptors are JSON-friendly so future ships can persist
 * them via tenant config or fetch them from the backend (M3.2.h
 * Angular wrapper anticipates the latter for tenant-extensible
 * schemas).
 *
 * Built-in `type` values at M3.2.e: `text`, `textarea`, `select`,
 * `el-expression`, `boolean`. Surface authors can register additional
 * types via {@link FieldRegistry.register} -- the registry's lookup
 * fails fast at panel-mount time if the schema references an
 * unregistered type.
 */

/** Common shape across all field descriptors. */
export interface FieldDescriptorBase {
    /** Property key under `element.properties` this field reads + writes. */
    readonly key: string;
    /** Field type discriminator — looked up against the {@link FieldRegistry}. */
    readonly type: string;
    /** Human-readable label rendered above the input. */
    readonly label: string;
    /** Optional secondary help text rendered as small/muted under the label. */
    readonly description?: string;
    /**
     * Force read-only state even when the panel itself isn't read-only.
     * Useful for derived properties surfaced for reference (e.g.
     * a node's `incomingFlowCount` shown but not editable).
     */
    readonly readOnly?: boolean;
}

export interface TextFieldDescriptor extends FieldDescriptorBase {
    readonly type: 'text';
    readonly placeholder?: string;
    /** HTML maxlength attribute -- soft UI guidance, not a hard validation. */
    readonly maxLength?: number;
}

export interface TextareaFieldDescriptor extends FieldDescriptorBase {
    readonly type: 'textarea';
    readonly placeholder?: string;
    readonly rows?: number;
}

/**
 * Either provide a static `options` list OR a `xrefScope` for
 * registry-driven autocomplete -- the field renderer rejects schemas
 * that omit both or supply both.
 */
export interface SelectFieldDescriptor extends FieldDescriptorBase {
    readonly type: 'select';
    readonly placeholder?: string;
    /** Static option list. Mutually exclusive with `xrefScope`. */
    readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
    /**
     * Cross-reference scope -- the field renders the {@link XRefs}
     * scope's contents at render time + subscribes to scope changes so
     * the dropdown stays live as the producer publishes updates.
     * Mutually exclusive with `options`.
     */
    readonly xrefScope?: string;
    /**
     * Whether the empty/null value is allowed (rendered as an "—" option).
     * Default `true`. Set false for required selects so the user MUST pick
     * one of the listed options.
     */
    readonly allowEmpty?: boolean;
}

export interface ElExpressionFieldDescriptor extends FieldDescriptorBase {
    readonly type: 'el-expression';
    readonly placeholder?: string;
    /**
     * Expression-language flavour hint. Currently informational only
     * (the renderer is plain monospace input). M3.3+ can add
     * real EL syntax highlighting via a future plugin point.
     */
    readonly elFlavour?: 'common' | 'workflow';
}

export interface BooleanFieldDescriptor extends FieldDescriptorBase {
    readonly type: 'boolean';
    /** Optional inline label rendered next to the checkbox itself (in addition to the main label). */
    readonly checkboxLabel?: string;
}

/** Built-in descriptor union. Surface-registered custom types extend via type assertion at the schema author's discretion. */
export type FieldDescriptor =
    | TextFieldDescriptor
    | TextareaFieldDescriptor
    | SelectFieldDescriptor
    | ElExpressionFieldDescriptor
    | BooleanFieldDescriptor;
