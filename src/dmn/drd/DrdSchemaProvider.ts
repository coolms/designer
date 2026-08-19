import type { FieldDescriptor } from '../../property-panel/FieldDescriptor.js';
import type { DmnDrdElementKind } from './types.js';

/**
 * M4.j (slice 2) property-panel schema for the DMN DRD editor. Returns
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
    /** Fields for a selected element. Decision adds the decision-logic ref. */
    elementSchema(kind: DmnDrdElementKind): ReadonlyArray<FieldDescriptor> {
        const fields: FieldDescriptor[] = [
            {
                type: 'text',
                key: 'name',
                label: 'Name',
                description:
                    kind === 'inputData'
                        ? 'The input-data name — the raw fact this node supplies to the decisions that require it.'
                        : 'The decision name — what this node decides.',
                placeholder: kind === 'inputData' ? 'e.g. Applicant age' : 'e.g. Eligibility',
            },
        ];
        if (kind === 'decision') {
            fields.push({
                type: 'text',
                key: 'decisionLogicRef',
                label: 'Decision logic',
                description:
                    'The decisionTable definition key supplying this decision\'s logic. Blank means the logic is authored elsewhere.',
                placeholder: 'e.g. pricing.eligibility',
            });
        }
        return fields;
    }

    /** Fields for a selected requirement. `elementIds` drives the from/to selects. */
    requirementSchema(
        elementIds: ReadonlyArray<string>,
    ): ReadonlyArray<FieldDescriptor> {
        const options = elementIds.map((id) => ({ value: id, label: id }));
        return [
            {
                type: 'select',
                key: 'from',
                label: 'From (required)',
                description: 'The source node — the Decision or InputData this requirement depends on.',
                options,
                allowEmpty: false,
            },
            {
                type: 'select',
                key: 'to',
                label: 'To (requiring decision)',
                description: 'The decision that requires the source. The arrow points into it.',
                options,
                allowEmpty: false,
            },
        ];
    }

    /** Diagram-level fields, shown when nothing is selected. */
    diagramSchema(): ReadonlyArray<FieldDescriptor> {
        return [
            {
                type: 'text',
                key: 'name',
                label: 'Definition key',
                description: 'The DecisionDefinition.definitionKey this DRD deploys as.',
                placeholder: 'e.g. pricing',
            },
        ];
    }
}
