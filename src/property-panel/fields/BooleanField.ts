import type {
    FieldContext,
    FieldInstance,
    FieldRenderer,
} from '../FieldRenderer.js';
import type { BooleanFieldDescriptor, FieldDescriptor } from '../FieldDescriptor.js';

/**
 * Single checkbox. Reads + writes `boolean`. `undefined` / non-boolean
 * values coerce to `false` for display (the field never displays an
 * indeterminate state at M3.2.e -- a tri-state checkbox would land as
 * a separate field type if a surface needs it).
 *
 * The DOM layout is `<label class="coolms-designer__field-checkbox-row">
 * <input type="checkbox"/><span>{checkboxLabel}</span></label>` which
 * makes the entire label clickable -- standard checkbox UX. The main
 * descriptor `label` continues to render above the field via the
 * PropertyPanel's per-field wrapper.
 */
export class BooleanField implements FieldRenderer<boolean> {
    readonly type = 'boolean';

    create(
        host: HTMLElement,
        descriptor: FieldDescriptor,
        context: FieldContext<boolean>,
    ): FieldInstance {
        const d = descriptor as BooleanFieldDescriptor;
        const doc = host.ownerDocument;

        const row = doc.createElement('label');
        row.classList.add('coolms-designer__field-checkbox-row');

        const input = doc.createElement('input');
        input.type = 'checkbox';
        input.classList.add('coolms-designer__field-checkbox');
        input.checked = context.initialValue === true;
        input.disabled = context.readOnly;
        row.appendChild(input);

        if (d.checkboxLabel !== undefined) {
            const text = doc.createElement('span');
            text.textContent = d.checkboxLabel;
            row.appendChild(text);
        }
        host.appendChild(row);

        const onChange = (): void => {
            context.onChange(input.checked);
        };
        input.addEventListener('change', onChange);

        return {
            setValue: (value: unknown): void => {
                const next = value === true;
                if (input.checked !== next) input.checked = next;
            },
            setDisabled: (disabled: boolean): void => {
                input.disabled = disabled;
            },
            destroy: (): void => {
                input.removeEventListener('change', onChange);
                row.remove();
            },
        };
    }
}
