import type { FieldDescriptor } from '../property-panel/FieldDescriptor.js';
import { defaultTranslator } from '../i18n.js';
import type { Translator } from '../i18n.js';

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
    private readonly t: Translator;

    /**
     * @param t Resolves the field text. Defaults to the English written
     *          inline at each call site.
     */
    constructor(t: Translator = defaultTranslator) {
        this.t = t;
    }

    /** Fields for a selected place. */
    placeSchema(): ReadonlyArray<FieldDescriptor> {
        const t = this.t;
        return [
            {
                type: 'text',
                key: 'name',
                label: t('designer.sm.field.name.label', 'Name'),
                description: t(
                    'designer.sm.place.name.description',
                    'The place (state) name — used verbatim in the Symfony places list and referenced by transitions.',
                ),
                placeholder: t('designer.sm.place.name.placeholder', 'e.g. submitted'),
            },
            {
                type: 'boolean',
                key: 'initial',
                label: t('designer.sm.field.initial.label', 'Initial state'),
                checkboxLabel: t('designer.sm.field.initial.checkboxLabel', 'Start here'),
                description: t(
                    'designer.sm.field.initial.description',
                    "Symfony initial_marking. A state machine has exactly one — turning this on clears it on the previous initial place.",
                ),
            },
        ];
    }

    /** Fields for a selected transition. `placeIds` drives the from/to selects. */
    transitionSchema(
        placeIds: ReadonlyArray<string>,
    ): ReadonlyArray<FieldDescriptor> {
        const t = this.t;
        const options = placeIds.map((id) => ({ value: id, label: id }));
        return [
            {
                type: 'text',
                key: 'name',
                label: t('designer.sm.field.name.label', 'Name'),
                description: t('designer.sm.transition.name.description', 'The transition name — the verb that moves between states.'),
                placeholder: t('designer.sm.transition.name.placeholder', 'e.g. submit'),
            },
            {
                type: 'select',
                key: 'from',
                label: t('designer.sm.field.from.label', 'From'),
                options,
                allowEmpty: false,
            },
            {
                type: 'select',
                key: 'to',
                label: t('designer.sm.field.to.label', 'To'),
                options,
                allowEmpty: false,
            },
            {
                type: 'el-expression',
                key: 'guard',
                label: t('designer.sm.field.guard.label', 'Guard'),
                elFlavour: 'workflow',
                description: t(
                    'designer.sm.field.guard.description',
                    "Symfony EL — e.g. subject.totalAmount > 0 or is_granted('ROLE_MANAGER'). Blank means the transition is always allowed.",
                ),
                placeholder: t('designer.sm.field.guard.placeholder', 'subject.totalAmount > 0'),
            },
        ];
    }

    /** Machine-level fields, shown when nothing is selected. */
    workflowSchema(): ReadonlyArray<FieldDescriptor> {
        const t = this.t;
        return [
            {
                type: 'text',
                key: 'workflowName',
                label: t('designer.sm.field.workflowName.label', 'Workflow name'),
                description: t('designer.sm.field.workflowName.description', 'The framework.workflows.<name> config key.'),
                placeholder: t('designer.sm.field.workflowName.placeholder', 'order_lifecycle'),
            },
            {
                type: 'text',
                key: 'markingProperty',
                label: t('designer.sm.field.markingProperty.label', 'Marking property'),
                description: t(
                    'designer.sm.field.markingProperty.description',
                    'The entity property holding the current state (marking_store.property).',
                ),
                placeholder: t('designer.sm.field.markingProperty.placeholder', 'status'),
            },
            {
                type: 'textarea',
                key: 'supports',
                label: t('designer.sm.field.supports.label', 'Supports (entity classes)'),
                rows: 3,
                description: t('designer.sm.field.supports.description', 'One fully-qualified class name per line.'),
                placeholder: t('designer.sm.field.supports.placeholder', 'Acme\\Shop\\Order'),
            },
            {
                type: 'boolean',
                key: 'auditTrail',
                label: t('designer.sm.field.auditTrail.label', 'Audit trail'),
                checkboxLabel: t('designer.sm.field.auditTrail.checkboxLabel', 'Log every transition'),
                description: t('designer.sm.field.auditTrail.description', 'Symfony audit_trail.enabled — emit an audit log row per transition.'),
            },
        ];
    }
}
