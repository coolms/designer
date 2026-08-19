import { describe, it, expect } from 'vitest';

import {
    writeDrdXml,
    readDrdXml,
    DmnDrdXmlParseError,
    defaultSizeForKind,
} from '../../../../src/dmn/drd/index.js';
import type { DmnDrdModel } from '../../../../src/dmn/drd/index.js';

/**
 * DMN-DRD XML serializer tests — the round-trip guarantee
 * (`readDrdXml(writeDrdXml(m))` ≅ m), the requiredInput/requiredDecision
 * source distinction, DMNDI geometry preservation, the decisionLogicRef
 * vendor attribute, the no-geometry fallback, lenient namespace-prefix
 * reading, and the malformed-XML error. Mirrors the decision-table
 * xml round-trip + the state-machine serializer coverage.
 */
describe('DMN DRD XML serializer', () => {
    function model(over: Partial<DmnDrdModel> = {}): DmnDrdModel {
        return {
            name: 'pricing',
            elements: [
                { id: 'age', kind: 'inputData', name: 'Applicant age', position: { x: 40, y: 40 }, size: defaultSizeForKind('inputData') },
                { id: 'eligible', kind: 'decision', name: 'Eligibility', position: { x: 320, y: 40 }, size: defaultSizeForKind('decision'), decisionLogicRef: 'pricing.eligibility' },
            ],
            requirements: [{ id: 'ir1', from: 'age', to: 'eligible' }],
            ...over,
        };
    }

    it('round-trips a model structurally (ids, kinds, names, geometry, requirements, logicRef)', () => {
        const m = model();
        const back = readDrdXml(writeDrdXml(m));

        expect(back.name).toBe('pricing');
        expect(back.elements.map((e) => e.id)).toEqual(['age', 'eligible']);

        const age = back.elements.find((e) => e.id === 'age')!;
        expect(age.kind).toBe('inputData');
        expect(age.name).toBe('Applicant age');
        expect(age.position).toEqual({ x: 40, y: 40 });
        expect(age.size).toEqual(defaultSizeForKind('inputData'));
        expect(age.decisionLogicRef).toBeUndefined();

        const eligible = back.elements.find((e) => e.id === 'eligible')!;
        expect(eligible.kind).toBe('decision');
        expect(eligible.position).toEqual({ x: 320, y: 40 });
        expect(eligible.decisionLogicRef).toBe('pricing.eligibility');

        expect(back.requirements).toHaveLength(1);
        expect(back.requirements[0]).toEqual({ id: 'ir1', from: 'age', to: 'eligible' });
    });

    it('emits requiredInput for an InputData source and requiredDecision for a Decision source', () => {
        const m: DmnDrdModel = {
            name: 'chain',
            elements: [
                { id: 'in1', kind: 'inputData', name: 'fact', position: { x: 0, y: 0 }, size: defaultSizeForKind('inputData') },
                { id: 'sub', kind: 'decision', name: 'sub', position: { x: 200, y: 0 }, size: defaultSizeForKind('decision') },
                { id: 'top', kind: 'decision', name: 'top', position: { x: 400, y: 0 }, size: defaultSizeForKind('decision') },
            ],
            requirements: [
                { id: 'r_in', from: 'in1', to: 'sub' }, // input → decision
                { id: 'r_dec', from: 'sub', to: 'top' }, // decision → decision
            ],
        };
        const xml = writeDrdXml(m);
        expect(xml).toContain('requiredInput');
        expect(xml).toContain('requiredDecision');

        const back = readDrdXml(xml);
        expect(back.requirements.map((r) => r.id).sort()).toEqual(['r_dec', 'r_in']);
        expect(back.requirements.find((r) => r.id === 'r_in')).toEqual({ id: 'r_in', from: 'in1', to: 'sub' });
        expect(back.requirements.find((r) => r.id === 'r_dec')).toEqual({ id: 'r_dec', from: 'sub', to: 'top' });
    });

    it('drops a dangling / self requirement on write (not valid DMN)', () => {
        const m = model({
            requirements: [
                { id: 'ir1', from: 'age', to: 'eligible' },
                { id: 'dangle', from: 'ghost', to: 'eligible' }, // ghost is not a node
                { id: 'self', from: 'eligible', to: 'eligible' }, // self-reference
            ],
        });
        const back = readDrdXml(writeDrdXml(m));
        expect(back.requirements.map((r) => r.id)).toEqual(['ir1']);
    });

    it('falls back to origin + default size when DMNDI geometry is absent', () => {
        const xml = `<?xml version="1.0"?>
            <definitions name="d" xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/">
              <inputData id="age" name="Age"/>
              <decision id="dec" name="Dec">
                <informationRequirement id="ir"><requiredInput href="#age"/></informationRequirement>
              </decision>
            </definitions>`;
        const back = readDrdXml(xml);
        const age = back.elements.find((e) => e.id === 'age')!;
        expect(age.position).toEqual({ x: 0, y: 0 });
        expect(age.size).toEqual(defaultSizeForKind('inputData'));
        expect(back.requirements[0]).toEqual({ id: 'ir', from: 'age', to: 'dec' });
    });

    it('reads leniently through a namespace prefix', () => {
        const xml = `<?xml version="1.0"?>
            <dmn:definitions name="d" xmlns:dmn="https://www.omg.org/spec/DMN/20191111/MODEL/">
              <dmn:inputData id="age" name="Age"/>
              <dmn:decision id="dec" name="Dec">
                <dmn:informationRequirement id="ir"><dmn:requiredInput href="#age"/></dmn:informationRequirement>
              </dmn:decision>
            </dmn:definitions>`;
        const back = readDrdXml(xml);
        expect(back.elements.map((e) => e.id).sort()).toEqual(['age', 'dec']);
        expect(back.requirements[0]).toEqual({ id: 'ir', from: 'age', to: 'dec' });
    });

    it('round-trips an empty model', () => {
        const back = readDrdXml(writeDrdXml({ name: 'empty', elements: [], requirements: [] }));
        expect(back.name).toBe('empty');
        expect(back.elements).toEqual([]);
        expect(back.requirements).toEqual([]);
    });

    it('throws DmnDrdXmlParseError on malformed XML', () => {
        expect(() => readDrdXml('<definitions><decision</definitions>')).toThrow(DmnDrdXmlParseError);
    });
});
