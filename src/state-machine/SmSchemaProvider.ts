import type { FieldDescriptor } from '../property-panel/FieldDescriptor.js';
import { defaultTranslator } from '../i18n.js';
import type { Translator } from '../i18n.js';

/**
 * property-panel schema for the State Machine editor. Returns the
 * field descriptors the {@link StateMachinePropertyPanel} mounts for each
 * selection scope:
 *
 *  - **place** -- `name` (the Symfony place name) + `initial` flag.
 *  - **transition** -- `name` (the verb) + `from`/`to` place selects +
 *    `guard` (a Symfony EL expression).
 *  - **workflow** (nothing selected) -- `workflowName`, `markingProperty`,
 *    `supports` (entity FQCNs), and the `auditTrail` toggle.
 *
 * The transition `from`/`to` selects are computed from the current place
 * list, so that schema is a method (not a constant). Reuses the
 * built-in field types verbatim (text / textarea / select / el-expression
 * / boolean) -- no custom field renderer needed.
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
                label: t('designer.sm.field.name.label'),
                description: t(
                    'designer.sm.place.name.description',
                ),
                placeholder: t('designer.sm.place.name.placeholder'),
            },
            {
                type: 'boolean',
                key: 'initial',
                label: t('designer.sm.field.initial.label'),
                checkboxLabel: t('designer.sm.field.initial.checkboxLabel'),
                description: t(
                    'designer.sm.field.initial.description',
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
                label: t('designer.sm.field.name.label'),
                description: t('designer.sm.transition.name.description'),
                placeholder: t('designer.sm.transition.name.placeholder'),
            },
            {
                type: 'select',
                key: 'from',
                label: t('designer.sm.field.from.label'),
                options,
                allowEmpty: false,
            },
            {
                type: 'select',
                key: 'to',
                label: t('designer.sm.field.to.label'),
                options,
                allowEmpty: false,
            },
            {
                type: 'el-expression',
                key: 'guard',
                label: t('designer.sm.field.guard.label'),
                elFlavour: 'workflow',
                description: t(
                    'designer.sm.field.guard.description',
                ),
                placeholder: t('designer.sm.field.guard.placeholder'),
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
                label: t('designer.sm.field.workflowName.label'),
                description: t('designer.sm.field.workflowName.description'),
                placeholder: t('designer.sm.field.workflowName.placeholder'),
            },
            {
                type: 'text',
                key: 'markingProperty',
                label: t('designer.sm.field.markingProperty.label'),
                description: t(
                    'designer.sm.field.markingProperty.description',
                ),
                placeholder: t('designer.sm.field.markingProperty.placeholder'),
            },
            {
                type: 'textarea',
                key: 'supports',
                label: t('designer.sm.field.supports.label'),
                rows: 3,
                description: t('designer.sm.field.supports.description'),
                placeholder: t('designer.sm.field.supports.placeholder'),
            },
            {
                type: 'boolean',
                key: 'auditTrail',
                label: t('designer.sm.field.auditTrail.label'),
                checkboxLabel: t('designer.sm.field.auditTrail.checkboxLabel'),
                description: t('designer.sm.field.auditTrail.description'),
            },
        ];
    }
}
