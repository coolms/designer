import type {
    FieldContext,
    FieldInstance,
    FieldRenderer,
} from '../FieldRenderer.js';
import type { FieldDescriptor, TextareaFieldDescriptor } from '../FieldDescriptor.js';

/**
 * Multi-line text input. Default 4 rows. Same change semantics as
 * {@link TextField} (fires onChange on `change`, not on keystroke).
 */
export class TextareaField implements FieldRenderer<string> {
    readonly type = 'textarea';

    create(
        host: HTMLElement,
        descriptor: FieldDescriptor,
        context: FieldContext<string>,
    ): FieldInstance {
        const d = descriptor as TextareaFieldDescriptor;
        const textarea = host.ownerDocument.createElement('textarea');
        textarea.classList.add('coolms-designer__field-input', 'coolms-designer__field-textarea');
        textarea.value = context.initialValue ?? '';
        textarea.rows = Math.max(1, d.rows ?? 4);
        if (d.placeholder !== undefined) textarea.placeholder = d.placeholder;
        textarea.disabled = context.readOnly;
        host.appendChild(textarea);

        const onChange = (): void => {
            context.onChange(textarea.value);
        };
        textarea.addEventListener('change', onChange);

        return {
            setValue: (value: unknown): void => {
                const next = typeof value === 'string' ? value : '';
                if (textarea.value !== next) textarea.value = next;
            },
            setDisabled: (disabled: boolean): void => {
                textarea.disabled = disabled;
            },
            destroy: (): void => {
                textarea.removeEventListener('change', onChange);
                textarea.remove();
            },
        };
    }
}
