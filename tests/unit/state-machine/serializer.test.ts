import { describe, it, expect } from 'vitest';

import {
    stateMachineModelToConfig,
    stateMachineModelToFrameworkConfig,
    stateMachineConfigToModel,
    frameworkConfigToStateMachineModel,
    stateMachineModelToYaml,
    DEFAULT_PLACE_SIZE,
} from '../../../src/state-machine/index.js';
import type {
    SmPlace,
    SmTransition,
    StateMachineModel,
    StateMachineWorkflowConfig,
} from '../../../src/state-machine/index.js';

/**
 * Serializer tests — an order-lifecycle example end-to-end: model →
 * Symfony config (with by-name coalescing), the reverse expansion,
 * the semantic round-trip, the framework envelope, and the preview
 * YAML emitter.
 */

function place(id: string, initial = false): SmPlace {
    return {
        id,
        position: { x: 0, y: 0 },
        size: DEFAULT_PLACE_SIZE,
        ...(initial ? { initial: true } : {}),
    };
}

function tr(id: string, name: string, from: string, to: string, guard?: string): SmTransition {
    return { id, name, from, to, ...(guard !== undefined ? { guard } : {}) };
}

/** An order lifecycle, as a designer model (per-edge transitions). */
function orderLifecycle(): StateMachineModel {
    return {
        workflowName: 'order_lifecycle',
        supports: ['Acme\\Shop\\Order'],
        markingProperty: 'status',
        places: [
            place('draft', true),
            place('submitted'),
            place('approved'),
            place('fulfilled'),
            place('delivered'),
            place('cancelled'),
        ],
        transitions: [
            tr('submit', 'submit', 'draft', 'submitted', 'subject.totalAmount > 0'),
            tr('approve', 'approve', 'submitted', 'approved', "is_granted('ROLE_MANAGER')"),
            tr('fulfill', 'fulfill', 'approved', 'fulfilled'),
            tr('deliver', 'deliver', 'fulfilled', 'delivered'),
            // The fan-in `cancel` — three per-edge transitions sharing a name.
            tr('cancel__draft', 'cancel', 'draft', 'cancelled'),
            tr('cancel__submitted', 'cancel', 'submitted', 'cancelled'),
            tr('cancel__approved', 'cancel', 'approved', 'cancelled'),
        ],
    };
}

describe('stateMachineModelToConfig', () => {
    it('emits the order config, coalescing the cancel fan-in by name', () => {
        const config = stateMachineModelToConfig(orderLifecycle());
        expect(config).toEqual<StateMachineWorkflowConfig>({
            type: 'state_machine',
            marking_store: { type: 'method', property: 'status' },
            supports: ['Acme\\Shop\\Order'],
            initial_marking: 'draft',
            places: ['draft', 'submitted', 'approved', 'fulfilled', 'delivered', 'cancelled'],
            transitions: {
                submit: { from: 'draft', to: 'submitted', guard: 'subject.totalAmount > 0' },
                approve: { from: 'submitted', to: 'approved', guard: "is_granted('ROLE_MANAGER')" },
                fulfill: { from: 'approved', to: 'fulfilled' },
                deliver: { from: 'fulfilled', to: 'delivered' },
                cancel: { from: ['draft', 'submitted', 'approved'], to: 'cancelled' },
            },
        });
    });

    it('collapses a single-source transition `from` to a bare scalar', () => {
        const config = stateMachineModelToConfig(orderLifecycle());
        expect(config.transitions['submit']!.from).toBe('draft'); // scalar, not ['draft']
        expect(config.transitions['cancel']!.from).toEqual(['draft', 'submitted', 'approved']);
    });

    it('drops a blank/whitespace guard but keeps a real one', () => {
        const model: StateMachineModel = {
            workflowName: 'wf',
            supports: [],
            markingProperty: 'status',
            places: [place('a', true), place('b')],
            transitions: [tr('go', 'go', 'a', 'b', '   ')],
        };
        expect(stateMachineModelToConfig(model).transitions['go']).toEqual({ from: 'a', to: 'b' });
    });

    it('omits initial_marking when no place is flagged initial', () => {
        const model: StateMachineModel = {
            workflowName: 'wf',
            supports: [],
            markingProperty: 'status',
            places: [place('a'), place('b')],
            transitions: [],
        };
        expect(stateMachineModelToConfig(model).initial_marking).toBeUndefined();
    });
});

describe('stateMachineConfigToModel', () => {
    it('expands a fan-in `from` list back into one edge per source', () => {
        const model = stateMachineConfigToModel('order_lifecycle', stateMachineModelToConfig(orderLifecycle()));
        const cancels = model.transitions.filter((t) => t.name === 'cancel');
        expect(cancels.map((t) => t.from)).toEqual(['draft', 'submitted', 'approved']);
        expect(cancels.every((t) => t.to === 'cancelled')).toBe(true);
        // List-sourced edges get disambiguated ids; single-source keep the name.
        expect(cancels.map((t) => t.id)).toEqual(['cancel__draft', 'cancel__submitted', 'cancel__approved']);
        expect(model.transitions.find((t) => t.name === 'submit')!.id).toBe('submit');
    });

    it('returns places at the origin with the initial flag set from initial_marking', () => {
        const model = stateMachineConfigToModel('order_lifecycle', stateMachineModelToConfig(orderLifecycle()));
        expect(model.places.every((p) => p.position.x === 0 && p.position.y === 0)).toBe(true);
        expect(model.places.find((p) => p.id === 'draft')!.initial).toBe(true);
        expect(model.places.find((p) => p.id === 'submitted')!.initial).toBeUndefined();
    });
});

describe('round-trip (semantic)', () => {
    it('preserves places, transitions, marking + supports through model → config → model', () => {
        const original = orderLifecycle();
        const round = stateMachineConfigToModel('order_lifecycle', stateMachineModelToConfig(original));

        // Places: id + initial flag + order (geometry is intentionally NOT preserved).
        expect(round.places.map((p) => ({ id: p.id, initial: p.initial ?? false }))).toEqual(
            original.places.map((p) => ({ id: p.id, initial: p.initial ?? false })),
        );
        // Transitions compared on the (name, from, to, guard) tuple — ids are internal.
        const tuple = (t: SmTransition) => ({ name: t.name, from: t.from, to: t.to, guard: t.guard });
        expect(round.transitions.map(tuple)).toEqual(original.transitions.map(tuple));

        expect(round.markingProperty).toBe('status');
        expect(round.supports).toEqual(['Acme\\Shop\\Order']);
        expect(round.workflowName).toBe('order_lifecycle');
    });
});

describe('framework envelope', () => {
    it('wraps + unwraps via the framework.workflows.{name} structure', () => {
        const envelope = stateMachineModelToFrameworkConfig(orderLifecycle());
        expect(Object.keys(envelope.framework.workflows)).toEqual(['order_lifecycle']);
        expect(envelope.framework.workflows['order_lifecycle']!.type).toBe('state_machine');

        const back = frameworkConfigToStateMachineModel(envelope)!;
        expect(back.workflowName).toBe('order_lifecycle');
        expect(back.places.map((p) => p.id)).toEqual([
            'draft', 'submitted', 'approved', 'fulfilled', 'delivered', 'cancelled',
        ]);
    });

    it('returns null from an empty framework envelope', () => {
        expect(
            frameworkConfigToStateMachineModel({ framework: { workflows: {} } }),
        ).toBeNull();
    });
});

describe('audit_trail', () => {
    function withAudit(): StateMachineModel {
        return { ...orderLifecycle(), workflowExtras: { audit_trail: { enabled: true } } };
    }

    it('emits audit_trail when the model flags it enabled', () => {
        expect(stateMachineModelToConfig(withAudit()).audit_trail).toEqual({ enabled: true });
        expect(stateMachineModelToConfig(orderLifecycle()).audit_trail).toBeUndefined();
    });

    it('round-trips audit_trail back into workflowExtras', () => {
        const round = stateMachineConfigToModel(
            'order_lifecycle',
            stateMachineModelToConfig(withAudit()),
        );
        expect(round.workflowExtras?.['audit_trail']).toEqual({ enabled: true });
    });

    it('renders an audit_trail line in the preview YAML', () => {
        expect(stateMachineModelToYaml(withAudit())).toContain('audit_trail: { enabled: true }');
        expect(stateMachineModelToYaml(orderLifecycle())).not.toContain('audit_trail');
    });
});

describe('stateMachineModelToYaml (preview)', () => {
    const yaml = stateMachineModelToYaml(orderLifecycle());

    it('emits the framework.workflows scaffold + state_machine type', () => {
        expect(yaml).toContain('framework:');
        expect(yaml).toContain('    workflows:');
        expect(yaml).toContain('        order_lifecycle:');
        expect(yaml).toContain('            type: state_machine');
        expect(yaml).toContain('marking_store: { type: method, property: status }');
        expect(yaml).toContain('initial_marking: draft');
    });

    it('double-quotes scalars that are not bare YAML identifiers (FQCN + guards)', () => {
        // FQCN backslashes escaped so a YAML parser restores Acme\Shop\Order.
        expect(yaml).toContain('supports: ["Acme\\\\Shop\\\\Order"]');
        // Guard with a space + operator is quoted.
        expect(yaml).toContain('guard: "subject.totalAmount > 0"');
        // Guard containing single quotes survives inside double quotes.
        expect(yaml).toContain('guard: "is_granted(\'ROLE_MANAGER\')"');
    });

    it('renders the cancel fan-in as a flow list `from`', () => {
        expect(yaml).toContain('cancel: { from: [draft, submitted, approved], to: cancelled }');
    });
});
