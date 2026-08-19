import type { FieldDescriptor } from '../../property-panel/FieldDescriptor.js';
import { defaultTranslator } from '../../i18n.js';
import type { Translator } from '../../i18n.js';
import type { DmnDrdElementKind } from './types.js';

/**
 * Property-panel schema for the DMN DRD editor. Returns
 * the field descriptors the {@link DmnDrdPropertyPanel} mounts for each
 * selection scope:
 *
 *  - **element** — `name` for any node; plus `decisionLogicRef` for a
 *    Decision (the decision-table key its logic comes from). An InputData
 *    has no logic, so it gets only `name`.
 *  - **requirement** — `from` / `to` element selects (the dependency +
 *    the dependent decision).
 *  - **diagram** (nothing selected) — `name` (the DRG / definition key).
 *
 * The requirement `from`/`to` selects are computed from the current
 * element list, so that schema is a method (not a constant). Reuses the
 * built-in field types verbatim (text / select) — no custom field
 * renderer needed.
 */
export class DrdSchemaProvider {
    private readonly t: Translator;

    /**
     * @param t Resolves the field labels, descriptions and placeholders.
     *          Defaults to the English written inline below.
     */
    constructor(t: Translator = defaultTranslator) {
        this.t = t;
    }

    /** Fields for a selected element. Decision adds the decision-logic ref. */
    elementSchema(kind: DmnDrdElementKind): ReadonlyArray<FieldDescriptor> {
        const t = this.t;
        const isInput = kind === 'inputData';
        const fields: FieldDescriptor[] = [
            {
                type: 'text',
                key: 'name',
                label: t('designer.drd.element.name.label', 'Name'),
                description: isInput
                    ? t(
                          'designer.drd.element.name.description.inputData',
                          'The input-data name — the raw fact this node supplies to the decisions that require it.',
                      )
                    : t(
                          'designer.drd.element.name.description.decision',
                          'The decision name — what this node decides.',
                      ),
                placeholder: isInput
                    ? t('designer.drd.element.name.placeholder.inputData', 'e.g. Applicant age')
                    : t('designer.drd.element.name.placeholder.decision', 'e.g. Eligibility'),
            },
        ];
        if (kind === 'decision') {
            fields.push({
                type: 'text',
                key: 'decisionLogicRef',
                label: t('designer.drd.element.decisionLogicRef.label', 'Decision logic'),
                description: t(
                    'designer.drd.element.decisionLogicRef.description',
                    'The decisionTable definition key supplying this decision\'s logic. Blank means the logic is authored elsewhere.',
                ),
                placeholder: t(
                    'designer.drd.element.decisionLogicRef.placeholder',
                    'e.g. pricing.eligibility',
                ),
            });
        }
        return fields;
    }

    /** Fields for a selected requirement. `elementIds` drives the from/to selects. */
    requirementSchema(
        elementIds: ReadonlyArray<string>,
    ): ReadonlyArray<FieldDescriptor> {
        const t = this.t;
        const options = elementIds.map((id) => ({ value: id, label: id }));
        return [
            {
                type: 'select',
                key: 'from',
                label: t('designer.drd.requirement.from.label', 'From (required)'),
                description: t(
                    'designer.drd.requirement.from.description',
                    'The source node — the Decision or InputData this requirement depends on.',
                ),
                options,
                allowEmpty: false,
            },
            {
                type: 'select',
                key: 'to',
                label: t('designer.drd.requirement.to.label', 'To (requiring decision)'),
                description: t(
                    'designer.drd.requirement.to.description',
                    'The decision that requires the source. The arrow points into it.',
                ),
                options,
                allowEmpty: false,
            },
        ];
    }

    /** Diagram-level fields, shown when nothing is selected. */
    diagramSchema(): ReadonlyArray<FieldDescriptor> {
        const t = this.t;
        return [
            {
                type: 'text',
                key: 'name',
                label: t('designer.drd.diagram.name.label', 'Definition key'),
                description: t(
                    'designer.drd.diagram.name.description',
                    'The DecisionDefinition.definitionKey this DRD deploys as.',
                ),
                placeholder: t('designer.drd.diagram.name.placeholder', 'e.g. pricing'),
            },
        ];
    }
}
