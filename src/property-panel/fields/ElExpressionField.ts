import type {
    FieldContext,
    FieldInstance,
    FieldRenderer,
} from '../FieldRenderer.js';
import type { ElExpressionFieldDescriptor, FieldDescriptor } from '../FieldDescriptor.js';

/**
 * Expression-language input. At M3.2.e it's a monospace single-line
 * input with no syntax highlighting + a `data-el-flavour` attribute
 * for future syntax-highlighting plugins to read.
 *
 * Future enhancement (M3.3 BPMN editor or later): plug in a real EL
 * tokenizer + highlight tokens (functions, identifiers, literals).
 * The single-line vs multi-line question is also open -- decision-table
 * cells need single-line, BPMN condition expressions can grow, EL
 * function bodies (rare) might want multi-line. Current single-line
 * default fits the DMN backend's per-cell EL strings.
 *
 * Reads + writes `string`.
 */
export class ElExpressionField implements FieldRenderer<string> {
    readonly type = 'el-expression';

    create(
        host: HTMLElement,
        descriptor: FieldDescriptor,
        context: FieldContext<string>,
    ): FieldInstance {
        const d = descriptor as ElExpressionFieldDescriptor;
        const input = host.ownerDocument.createElement('input');
        input.type = 'text';
        input.classList.add(
            'coolms-designer__field-input',
            'coolms-designer__field-el-expression',
        );
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.value = context.initialValue ?? '';
        if (d.placeholder !== undefined) input.placeholder = d.placeholder;
        input.disabled = context.readOnly;
        // Hint attribute for future syntax highlighters to dispatch on.
        input.setAttribute('data-el-flavour', d.elFlavour ?? 'common');
        host.appendChild(input);

        const onChange = (): void => {
            context.onChange(input.value);
        };
        input.addEventListener('change', onChange);

        return {
            setValue: (value: unknown): void => {
                const next = typeof value === 'string' ? value : '';
                if (input.value !== next) input.value = next;
            },
            setDisabled: (disabled: boolean): void => {
                input.disabled = disabled;
            },
            destroy: (): void => {
                input.removeEventListener('change', onChange);
                input.remove();
            },
        };
    }
}
