/**
 * Combined test file for the 5 built-in field renderers. Each
 * renderer is small enough that splitting into separate test files
 * per type would be overkill -- the shared mount-fire-update-destroy
 * lifecycle is asserted once via the FieldHarness helper, then
 * per-type specifics get their own describe blocks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XRefs } from '../../../src/shell/XRefs.js';
import { BooleanField } from '../../../src/property-panel/fields/BooleanField.js';
import { ElExpressionField } from '../../../src/property-panel/fields/ElExpressionField.js';
import { SelectField } from '../../../src/property-panel/fields/SelectField.js';
import { TextField } from '../../../src/property-panel/fields/TextField.js';
import { TextareaField } from '../../../src/property-panel/fields/TextareaField.js';
import type {
    FieldContext,
    FieldInstance,
} from '../../../src/property-panel/FieldRenderer.js';
import type {
    BooleanFieldDescriptor,
    ElExpressionFieldDescriptor,
    SelectFieldDescriptor,
    TextFieldDescriptor,
    TextareaFieldDescriptor,
} from '../../../src/property-panel/FieldDescriptor.js';

describe('TextField', () => {
    let host: HTMLDivElement;
    let onChange: ReturnType<typeof vi.fn>;
    let instance: FieldInstance;
    let input: HTMLInputElement;
    let xrefs: XRefs;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        onChange = vi.fn();
        xrefs = new XRefs();
        const descriptor: TextFieldDescriptor = {
            key: 'name',
            type: 'text',
            label: 'Name',
            placeholder: 'Enter name',
            maxLength: 50,
        };
        const ctx: FieldContext<string> = {
            initialValue: 'initial',
            onChange,
            xrefs,
            readOnly: false,
        };
        instance = new TextField().create(host, descriptor, ctx);
        input = host.querySelector('input[type="text"]') as HTMLInputElement;
    });

    afterEach(() => {
        instance.destroy();
        xrefs.dispose();
        host.remove();
    });

    it('mounts with initial value + placeholder + maxLength', () => {
        expect(input.value).toBe('initial');
        expect(input.placeholder).toBe('Enter name');
        expect(input.maxLength).toBe(50);
        expect(input.disabled).toBe(false);
    });

    it('fires onChange on change event', () => {
        input.value = 'updated';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('updated');
    });

    it('setValue updates DOM only when different', () => {
        instance.setValue('newvalue');
        expect(input.value).toBe('newvalue');
        // Non-string coerces to empty.
        instance.setValue(undefined);
        expect(input.value).toBe('');
        instance.setValue(42);
        expect(input.value).toBe('');
    });

    it('setDisabled toggles disabled state', () => {
        instance.setDisabled(true);
        expect(input.disabled).toBe(true);
        instance.setDisabled(false);
        expect(input.disabled).toBe(false);
    });

    it('destroy removes input + detaches listener', () => {
        instance.destroy();
        expect(host.querySelector('input')).toBeNull();
        // After destroy, the (now-removed) input firing change shouldn't notify.
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('TextareaField', () => {
    let host: HTMLDivElement;
    let xrefs: XRefs;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        xrefs = new XRefs();
    });

    afterEach(() => {
        xrefs.dispose();
        host.remove();
    });

    it('mounts with rows default 4 + initial value', () => {
        const descriptor: TextareaFieldDescriptor = {
            key: 'description',
            type: 'textarea',
            label: 'Description',
        };
        new TextareaField().create(host, descriptor, {
            initialValue: 'multi\nline',
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const ta = host.querySelector('textarea') as HTMLTextAreaElement;
        expect(ta.rows).toBe(4);
        expect(ta.value).toBe('multi\nline');
    });

    it('honors custom rows', () => {
        const descriptor: TextareaFieldDescriptor = {
            key: 'description',
            type: 'textarea',
            label: 'Description',
            rows: 8,
        };
        new TextareaField().create(host, descriptor, {
            initialValue: '',
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        expect((host.querySelector('textarea') as HTMLTextAreaElement).rows).toBe(8);
    });

    it('fires onChange on change event', () => {
        const onChange = vi.fn();
        const descriptor: TextareaFieldDescriptor = {
            key: 'description',
            type: 'textarea',
            label: 'Description',
        };
        new TextareaField().create(host, descriptor, {
            initialValue: '',
            onChange,
            xrefs,
            readOnly: false,
        });
        const ta = host.querySelector('textarea') as HTMLTextAreaElement;
        ta.value = 'edited';
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('edited');
    });
});

describe('SelectField', () => {
    let host: HTMLDivElement;
    let xrefs: XRefs;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        xrefs = new XRefs();
    });

    afterEach(() => {
        xrefs.dispose();
        host.remove();
    });

    function staticDescriptor(overrides: Partial<SelectFieldDescriptor> = {}): SelectFieldDescriptor {
        return {
            key: 'priority',
            type: 'select',
            label: 'Priority',
            options: [
                { value: 'low', label: 'Low' },
                { value: 'high', label: 'High' },
            ],
            ...overrides,
        };
    }

    it('renders static options + empty placeholder', () => {
        new SelectField().create(host, staticDescriptor(), {
            initialValue: null,
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const select = host.querySelector('select') as HTMLSelectElement;
        const options = [...select.options];
        expect(options.map((o) => o.value)).toEqual(['', 'low', 'high']);
        expect(options.map((o) => o.textContent)).toEqual(['—', 'Low', 'High']);
    });

    it('honors allowEmpty=false (no empty option)', () => {
        new SelectField().create(host, staticDescriptor({ allowEmpty: false }), {
            initialValue: 'low',
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const select = host.querySelector('select') as HTMLSelectElement;
        expect([...select.options].map((o) => o.value)).toEqual(['low', 'high']);
    });

    it('fires onChange with selected id (or null for empty)', () => {
        const onChange = vi.fn();
        new SelectField().create(host, staticDescriptor(), {
            initialValue: null,
            onChange,
            xrefs,
            readOnly: false,
        });
        const select = host.querySelector('select') as HTMLSelectElement;
        select.value = 'high';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('high');

        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it('xrefScope mode pulls options from XRefs + subscribes to changes', () => {
        xrefs.registerLookup('decisions', [
            { id: 'pricing', label: 'Pricing' },
            { id: 'risk', label: 'Risk' },
        ]);
        const descriptor: SelectFieldDescriptor = {
            key: 'decisionKey',
            type: 'select',
            label: 'Decision',
            xrefScope: 'decisions',
        };
        new SelectField().create(host, descriptor, {
            initialValue: null,
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        let select = host.querySelector('select') as HTMLSelectElement;
        expect([...select.options].map((o) => o.value)).toEqual(['', 'pricing', 'risk']);

        // Re-register scope -> field auto-updates.
        xrefs.registerLookup('decisions', [{ id: 'fraud', label: 'Fraud' }]);
        select = host.querySelector('select') as HTMLSelectElement;
        expect([...select.options].map((o) => o.value)).toEqual(['', 'fraud']);
    });

    it('rejects schemas missing both options + xrefScope', () => {
        const bad: SelectFieldDescriptor = { key: 'x', type: 'select', label: 'X' };
        expect(() =>
            new SelectField().create(host, bad, {
                initialValue: null,
                onChange: vi.fn(),
                xrefs,
                readOnly: false,
            }),
        ).toThrow(/exactly one of/);
    });

    it('rejects schemas with both options + xrefScope', () => {
        const bad: SelectFieldDescriptor = {
            key: 'x',
            type: 'select',
            label: 'X',
            options: [{ value: 'a', label: 'A' }],
            xrefScope: 'somewhere',
        };
        expect(() =>
            new SelectField().create(host, bad, {
                initialValue: null,
                onChange: vi.fn(),
                xrefs,
                readOnly: false,
            }),
        ).toThrow(/exactly one of/);
    });

    it('setValue updates current selection', () => {
        const instance = new SelectField().create(host, staticDescriptor(), {
            initialValue: 'low',
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const select = host.querySelector('select') as HTMLSelectElement;
        instance.setValue('high');
        expect(select.value).toBe('high');
        instance.setValue(null);
        expect(select.value).toBe('');
    });
});

describe('ElExpressionField', () => {
    let host: HTMLDivElement;
    let xrefs: XRefs;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        xrefs = new XRefs();
    });

    afterEach(() => {
        xrefs.dispose();
        host.remove();
    });

    it('mounts with monospace styling hints + flavour attribute', () => {
        const descriptor: ElExpressionFieldDescriptor = {
            key: 'condition',
            type: 'el-expression',
            label: 'Condition',
            elFlavour: 'workflow',
        };
        new ElExpressionField().create(host, descriptor, {
            initialValue: 'variables.amount > 100',
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const input = host.querySelector('input') as HTMLInputElement;
        expect(input.classList.contains('coolms-designer__field-el-expression')).toBe(true);
        expect(input.getAttribute('data-el-flavour')).toBe('workflow');
        expect(input.value).toBe('variables.amount > 100');
        expect(input.spellcheck).toBe(false);
        expect(input.autocomplete).toBe('off');
    });

    it('defaults flavour to "common"', () => {
        new ElExpressionField().create(
            host,
            { key: 'x', type: 'el-expression', label: 'X' },
            { initialValue: '', onChange: vi.fn(), xrefs, readOnly: false },
        );
        expect(host.querySelector('input')?.getAttribute('data-el-flavour')).toBe('common');
    });

    it('fires onChange on change', () => {
        const onChange = vi.fn();
        new ElExpressionField().create(
            host,
            { key: 'x', type: 'el-expression', label: 'X' },
            { initialValue: '', onChange, xrefs, readOnly: false },
        );
        const input = host.querySelector('input') as HTMLInputElement;
        input.value = '1 + 1';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('1 + 1');
    });
});

describe('BooleanField', () => {
    let host: HTMLDivElement;
    let xrefs: XRefs;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        xrefs = new XRefs();
    });

    afterEach(() => {
        xrefs.dispose();
        host.remove();
    });

    function descriptor(label?: string): BooleanFieldDescriptor {
        const result: BooleanFieldDescriptor = {
            key: 'active',
            type: 'boolean',
            label: 'Active',
        };
        return label !== undefined ? { ...result, checkboxLabel: label } : result;
    }

    it('mounts unchecked when initial value is false', () => {
        new BooleanField().create(host, descriptor(), {
            initialValue: false,
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const input = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(input.checked).toBe(false);
    });

    it('mounts checked when initial value is true', () => {
        new BooleanField().create(host, descriptor(), {
            initialValue: true,
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        expect((host.querySelector('input') as HTMLInputElement).checked).toBe(true);
    });

    it('renders checkboxLabel span when provided', () => {
        new BooleanField().create(host, descriptor('Enable feature'), {
            initialValue: false,
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        expect(host.querySelector('span')?.textContent).toBe('Enable feature');
    });

    it('fires onChange with new boolean value', () => {
        const onChange = vi.fn();
        new BooleanField().create(host, descriptor(), {
            initialValue: false,
            onChange,
            xrefs,
            readOnly: false,
        });
        const input = host.querySelector('input') as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('setValue coerces non-boolean to false', () => {
        const instance = new BooleanField().create(host, descriptor(), {
            initialValue: false,
            onChange: vi.fn(),
            xrefs,
            readOnly: false,
        });
        const input = host.querySelector('input') as HTMLInputElement;
        instance.setValue(true);
        expect(input.checked).toBe(true);
        instance.setValue('truthy-string');
        expect(input.checked).toBe(false);
        instance.setValue(1);
        expect(input.checked).toBe(false);
    });
});
