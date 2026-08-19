import { describe, it, expect } from 'vitest';

import {
    ElementRendererRegistry,
    UnknownElementKindError,
    defaultElementRendererRegistry,
    renderStartEvent,
    renderTask,
    type ElementRenderer,
} from '../../../src/bpmn-lite/index.js';

describe('ElementRendererRegistry', () => {
    it('starts empty', () => {
        const r = new ElementRendererRegistry();
        expect(r.kinds()).toEqual([]);
        expect(r.has('task')).toBe(false);
    });

    it('register stores the renderer and chains', () => {
        const r = new ElementRendererRegistry();
        const result = r.register('task', renderTask);

        expect(result).toBe(r);
        expect(r.has('task')).toBe(true);
        expect(r.resolve('task')).toBe(renderTask);
    });

    it('register overwrites a prior registration for the same kind', () => {
        const first: ElementRenderer = renderTask;
        const second: ElementRenderer = renderStartEvent;
        const r = new ElementRendererRegistry()
            .register('task', first)
            .register('task', second);

        expect(r.resolve('task')).toBe(second);
    });

    it('resolve throws UnknownElementKindError for unregistered kinds', () => {
        const r = new ElementRendererRegistry();

        expect(() => r.resolve('task')).toThrow(UnknownElementKindError);
        expect(() => r.resolve('task')).toThrow(
            /No renderer registered for BPMN element kind "task"/,
        );
    });

    it('UnknownElementKindError carries the kind as a public property', () => {
        try {
            new ElementRendererRegistry().resolve('startEvent');
        } catch (err) {
            expect(err).toBeInstanceOf(UnknownElementKindError);
            expect((err as UnknownElementKindError).kind).toBe('startEvent');
            expect((err as UnknownElementKindError).name).toBe(
                'UnknownElementKindError',
            );
            return;
        }
        throw new Error('expected throw');
    });

    it('kinds() returns all registered kinds', () => {
        const r = new ElementRendererRegistry()
            .register('task', renderTask)
            .register('startEvent', renderStartEvent);

        expect(r.kinds().sort()).toEqual(['startEvent', 'task']);
    });

    it('defaultElementRendererRegistry registers every paintable kind', () => {
        const r = defaultElementRendererRegistry();

        expect(r.kinds().sort()).toEqual([
            'boundaryEvent',
            'callActivity',
            'endEvent',
            'eventBasedGateway',
            'exclusiveGateway',
            'inclusiveGateway',
            'intermediateCatchEvent',
            'parallelGateway',
            'startEvent',
            'subProcess',
            'task',
        ]);
        // Each kind resolves to a function.
        for (const kind of r.kinds()) {
            expect(typeof r.resolve(kind)).toBe('function');
        }
    });

    it('defaultElementRendererRegistry returns a fresh registry per call', () => {
        const a = defaultElementRendererRegistry();
        const b = defaultElementRendererRegistry();

        expect(a).not.toBe(b);
        // Mutating one does not affect the other.
        a.register('task', renderStartEvent);
        expect(a.resolve('task')).toBe(renderStartEvent);
        expect(b.resolve('task')).toBe(renderTask);
    });

    it('has() returns false for unregistered kinds and true for registered', () => {
        const r = new ElementRendererRegistry().register(
            'startEvent',
            renderStartEvent,
        );

        expect(r.has('startEvent')).toBe(true);
        expect(r.has('endEvent')).toBe(false);
    });
});
