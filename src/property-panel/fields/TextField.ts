import type {
    FieldContext,
    FieldInstance,
    FieldRenderer,
} from '../FieldRenderer.js';
import type { FieldDescriptor, TextFieldDescriptor } from '../FieldDescriptor.js';

/**
 * Single-line text input. Reads + writes `string`. `undefined` is
 * coerced to empty string for display.
 *
 * Fires `onChange` on `change` (blur / Enter), NOT on every keystroke
 * -- avoids per-keystroke graph mutations + change-event storms. If
 * a surface needs live-updating behaviour for some reason, it can
 * register a custom field type that wires `input` instead.
 */
export class TextField implements FieldRenderer<string> {
    readonly type = 'text';

    create(
        host: HTMLElement,
        descriptor: FieldDescriptor,
        context: FieldContext<string>,
    ): FieldInstance {
        const d = descriptor as TextFieldDescriptor;
        const input = host.ownerDocument.createElement('input');
        input.type = 'text';
        input.classList.add('coolms-designer__field-input');
        input.value = context.initialValue ?? '';
        if (d.placeholder !== undefined) input.placeholder = d.placeholder;
        if (d.maxLength !== undefined) input.maxLength = d.maxLength;
        input.disabled = context.readOnly;
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
