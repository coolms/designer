import { describe, it, expect } from 'vitest';

import {
    PALETTE_KINDS,
    PALETTE_LABELS,
    defaultGeometryFor,
} from '../../../src/bpmn-lite/index.js';

/**
 * defaults table pins. These are the per-kind sizes + labels
 * the palette + drop pipeline rely on; any deliberate change should
 * land here intentionally (a snapshot would also catch them but
 * named cases are more readable in PR review).
 */
describe('bpmn-lite defaults', () => {
    describe('PALETTE_KINDS', () => {
        it('lists the five core BPMN-Lite kinds in modeler-convention order', () => {
            expect(PALETTE_KINDS).toEqual([
                'startEvent',
                'endEvent',
                'task',
                'exclusiveGateway',
                'parallelGateway',
            ]);
        });
    });

    describe('PALETTE_LABELS', () => {
        it('covers every PALETTE_KINDS entry', () => {
            for (const kind of PALETTE_KINDS) {
                expect(PALETTE_LABELS[kind]).toBeTypeOf('string');
                expect(PALETTE_LABELS[kind].length).toBeGreaterThan(0);
            }
        });

        it('uses title case with spaces (matches BPMN modeler convention)', () => {
            expect(PALETTE_LABELS.startEvent).toBe('Start Event');
            expect(PALETTE_LABELS.endEvent).toBe('End Event');
            expect(PALETTE_LABELS.task).toBe('Task');
            expect(PALETTE_LABELS.exclusiveGateway).toBe('Exclusive Gateway');
            expect(PALETTE_LABELS.parallelGateway).toBe('Parallel Gateway');
        });
    });

    describe('defaultGeometryFor', () => {
        it('sizes events at 36x36 (small-icon convention)', () => {
            expect(defaultGeometryFor('startEvent').size).toEqual({
                width: 36,
                height: 36,
            });
            expect(defaultGeometryFor('endEvent').size).toEqual({
                width: 36,
                height: 36,
            });
        });

        it('sizes tasks at 100x80 and gives them a "Task" label', () => {
            const geo = defaultGeometryFor('task');
            expect(geo.size).toEqual({ width: 100, height: 80 });
            expect(geo.label).toBe('Task');
        });

        it('sizes gateways at 50x50 (canonical diamond)', () => {
            expect(defaultGeometryFor('exclusiveGateway').size).toEqual({
                width: 50,
                height: 50,
            });
            expect(defaultGeometryFor('parallelGateway').size).toEqual({
                width: 50,
                height: 50,
            });
        });

        it('events + gateways have no default label (events are iconic; gateways inherit task label)', () => {
            expect(defaultGeometryFor('startEvent').label).toBeUndefined();
            expect(defaultGeometryFor('endEvent').label).toBeUndefined();
            expect(defaultGeometryFor('exclusiveGateway').label).toBeUndefined();
            expect(defaultGeometryFor('parallelGateway').label).toBeUndefined();
        });
    });
});
