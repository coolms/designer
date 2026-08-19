import type {
    FieldContext,
    FieldInstance,
    FieldRenderer,
} from '../FieldRenderer.js';
import type { FieldDescriptor, SelectFieldDescriptor } from '../FieldDescriptor.js';
import type { XRefs } from '../../shell/XRefs.js';

interface OptionLike {
    readonly value: string;
    readonly label: string;
}

/**
 * Single-select dropdown. Supports two modes:
 *  1. **Static options** -- descriptor carries an `options` list, the
 *     dropdown renders them verbatim. No live updates.
 *  2. **XRef-driven** -- descriptor carries an `xrefScope`, the field
 *     populates from the {@link XRefs} registry's contents for that
 *     scope + subscribes to scope changes (so the dropdown stays live
 *     as the producer publishes updates). This is how BPMN service
 *     task `decisionKey` pickers stay in sync with deployed
 *     decisions.
 *
 * Exactly one of `options` / `xrefScope` must be present. The
 * renderer throws at mount time if both or neither are provided --
 * surface authors get a fast-fail rather than a silently-empty
 * dropdown.
 *
 * Reads + writes `string`. `null` / `undefined` map to the empty
 * placeholder option when `allowEmpty` is true (default); otherwise
 * the first available option is auto-selected on mount but the
 * descriptor's value is NOT auto-written (the panel writes only on
 * user interaction, per general property-panel convention).
 */
export class SelectField implements FieldRenderer<string | null> {
    readonly type = 'select';

    create(
        host: HTMLElement,
        descriptor: FieldDescriptor,
        context: FieldContext<string | null>,
    ): FieldInstance {
        const d = descriptor as SelectFieldDescriptor;
        const hasStatic = d.options !== undefined && d.options.length >= 0;
        const hasXref = d.xrefScope !== undefined && d.xrefScope.length > 0;
        if (hasStatic === hasXref) {
            throw new Error(
                `[@coolms/designer] SelectField "${d.key}": exactly one of "options" or "xrefScope" must be provided.`,
            );
        }
        const allowEmpty = d.allowEmpty ?? true;

        const select = host.ownerDocument.createElement('select');
        select.classList.add('coolms-designer__field-input', 'coolms-designer__field-select');
        select.disabled = context.readOnly;
        host.appendChild(select);

        let unsubscribeXref: (() => void) | undefined;

        const render = (options: ReadonlyArray<OptionLike>, currentValue: string | null): void => {
            select.innerHTML = '';
            if (allowEmpty) {
                const empty = host.ownerDocument.createElement('option');
                empty.value = '';
                empty.textContent = d.placeholder ?? '—';
                select.appendChild(empty);
            }
            for (const option of options) {
                const opt = host.ownerDocument.createElement('option');
                opt.value = option.value;
                opt.textContent = option.label;
                select.appendChild(opt);
            }
            // Restore selection -- if currentValue isn't present in the new option set,
            // the browser falls back to the first option (the empty one when allowEmpty).
            select.value = currentValue ?? '';
        };

        let currentOptions: ReadonlyArray<OptionLike>;
        let currentValue: string | null = context.initialValue ?? null;
        if (hasStatic) {
            currentOptions = d.options ?? [];
        } else {
            const scope = d.xrefScope!;
            currentOptions = xrefsToOptions(context.xrefs, scope);
            unsubscribeXref = context.xrefs.onChange(scope, () => {
                currentOptions = xrefsToOptions(context.xrefs, scope);
                render(currentOptions, currentValue);
            });
        }
        render(currentOptions, currentValue);

        const onChange = (): void => {
            const next = select.value === '' ? null : select.value;
            currentValue = next;
            context.onChange(next);
        };
        select.addEventListener('change', onChange);

        return {
            setValue: (value: unknown): void => {
                const next = typeof value === 'string' ? value : value === null ? null : null;
                if (currentValue !== next) {
                    currentValue = next;
                    select.value = next ?? '';
                }
            },
            setDisabled: (disabled: boolean): void => {
                select.disabled = disabled;
            },
            destroy: (): void => {
                select.removeEventListener('change', onChange);
                unsubscribeXref?.();
                select.remove();
            },
        };
    }
}

function xrefsToOptions(xrefs: XRefs, scope: string): OptionLike[] {
    return xrefs.query(scope).map((item) => ({ value: item.id, label: item.label }));
}
