import type { FieldDescriptor } from '../property-panel/FieldDescriptor.js';

/**
 * property-panel schema for the State Machine editor. Returns the
 * field descriptors the {@link StateMachinePropertyPanel} mounts for each
 * selection scope:
 *
 *  - **place** — `name` (the Symfony place name) + `initial` flag.
 *  - **transition** — `name` (the verb) + `from`/`to` place selects +
 *    `guard` (a Symfony EL expression).
 *  - **workflow** (nothing selected) — `workflowName`, `markingProperty`,
 *    `supports` (entity FQCNs), and the `auditTrail` toggle.
 *
 * The transition `from`/`to` selects are computed from the current place
 * list, so that schema is a method (not a constant). Reuses the
 * built-in field types verbatim (text / textarea / select / el-expression
 * / boolean) — no custom field renderer needed.
 */
export class SmSchemaProvider {
    /** Fields for a selected place. */
    placeSchema(): ReadonlyArray<FieldDescriptor> {
        return [
            {
                type: 'text',
                key: 'name',
                label: 'Name',
                description:
                    'The place (state) name — used verbatim in the Symfony places list and referenced by transitions.',
                placeholder: 'e.g. submitted',
            },
            {
                type: 'boolean',
                key: 'initial',
                label: 'Initial state',
                checkboxLabel: 'Start here',
                description:
                    "Symfony initial_marking. A state machine has exactly one — turning this on clears it on the previous initial place.",
            },
        ];
    }

    /** Fields for a selected transition. `placeIds` drives the from/to selects. */
    transitionSchema(
        placeIds: ReadonlyArray<string>,
    ): ReadonlyArray<FieldDescriptor> {
        const options = placeIds.map((id) => ({ value: id, label: id }));
        return [
            {
                type: 'text',
                key: 'name',
                label: 'Name',
                description: 'The transition name — the verb that moves between states.',
                placeholder: 'e.g. submit',
            },
            {
                type: 'select',
                key: 'from',
                label: 'From',
                options,
                allowEmpty: false,
            },
            {
                type: 'select',
                key: 'to',
                label: 'To',
                options,
                allowEmpty: false,
            },
            {
                type: 'el-expression',
                key: 'guard',
                label: 'Guard',
                elFlavour: 'workflow',
                description:
                    "Symfony EL — e.g. subject.totalAmount > 0 or is_granted('ROLE_MANAGER'). Blank means the transition is always allowed.",
                placeholder: 'subject.totalAmount > 0',
            },
        ];
    }

    /** Machine-level fields, shown when nothing is selected. */
    workflowSchema(): ReadonlyArray<FieldDescriptor> {
        return [
            {
                type: 'text',
                key: 'workflowName',
                label: 'Workflow name',
                description: 'The framework.workflows.<name> config key.',
                placeholder: 'order_lifecycle',
            },
            {
                type: 'text',
                key: 'markingProperty',
                label: 'Marking property',
                description:
                    'The entity property holding the current state (marking_store.property).',
                placeholder: 'status',
            },
            {
                type: 'textarea',
                key: 'supports',
                label: 'Supports (entity classes)',
                rows: 3,
                description: 'One fully-qualified class name per line.',
                placeholder: 'Acme\\Shop\\Order',
            },
            {
                type: 'boolean',
                key: 'auditTrail',
                label: 'Audit trail',
                checkboxLabel: 'Log every transition',
                description: 'Symfony audit_trail.enabled — emit an audit log row per transition.',
            },
        ];
    }
}
