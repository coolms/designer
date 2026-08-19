import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommandStack } from '../../src/canvas/CommandStack.js';
import { createCatalogTranslator } from '../../src/i18n.js';
import { createEditor } from '../../src/shell/Editor.js';
import { paletteItemLabel } from '../../src/bpmn-lite/defaults.js';
import {
    AddFlowCommand,
    BpmnLiteEditor,
    BpmnLiteSchemaProvider,
    SVG_NS,
} from '../../src/bpmn-lite/index.js';
import { DrdSchemaProvider } from '../../src/dmn/drd/index.js';
import { SmSchemaProvider } from '../../src/state-machine/index.js';
import type { BpmnElement, BpmnSequenceFlow } from '../../src/bpmn-lite/index.js';

/**
 * The seam is only worth having if it reaches the pixels. These pin the whole
 * path -- a translator handed to the factory or a provider actually changes
 * what a user reads -- rather than re-testing the resolver in isolation.
 */
describe('translation reaches the UI', () => {
    let host: HTMLElement;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    afterEach(() => {
        host.remove();
    });

    it('translates the toolbar, and exposes the translator on the handle', () => {
        const t = createCatalogTranslator({
            'designer.toolbar.undo': 'Скасувати',
            'designer.toolbar.ariaLabel': 'Панель',
        });
        const editor = createEditor(host, { surface: 'dmn-table', t });

        expect(editor.t).toBe(t);
        const toolbar = host.querySelector('.coolms-designer__toolbar');
        expect(toolbar).not.toBeNull();
        expect(toolbar!.getAttribute('aria-label')).toBe('Панель');
        // The untranslated neighbours must still read as English, not as keys.
        const redo = host.querySelector('[data-action="redo"]');
        expect(redo?.getAttribute('aria-label')).toBe('Redo');

        editor.destroy();
    });

    it('defaults to English when no translator is supplied', () => {
        const editor = createEditor(host, { surface: 'dmn-table' });
        const toolbar = host.querySelector('.coolms-designer__toolbar');
        expect(toolbar!.getAttribute('aria-label')).toBe('Designer toolbar');
        editor.destroy();
    });

    it('translates DRD property-panel field text', () => {
        const t = createCatalogTranslator({
            'designer.drd.element.name.label': 'Назва',
            'designer.drd.element.decisionLogicRef.label': 'Логіка рішення',
        });
        const fields = new DrdSchemaProvider(t).elementSchema('decision');

        expect(fields[0]?.label).toBe('Назва');
        expect(fields[1]?.label).toBe('Логіка рішення');
        // Descriptions were not in the catalogue, so they stay English.
        expect(fields[0]?.description).toContain('The decision name');
    });

    it('translates BPMN-Lite property-panel field text', () => {
        const t = createCatalogTranslator({ 'designer.bpmn.task.label.label': 'Назва' });
        const fields = new BpmnLiteSchemaProvider({}, t).getSchema('task');
        expect(fields[0]?.label).toBe('Назва');
    });

    it('translates state-machine property-panel field text', () => {
        const t = createCatalogTranslator({ 'designer.sm.field.initial.label': 'Початковий стан' });
        const fields = new SmSchemaProvider(t).placeSchema();
        expect(fields[1]?.label).toBe('Початковий стан');
    });

    /**
     * The composed labels are why placeholders exist rather than string
     * concatenation: English puts the noun last in "Timer Event", and a
     * translation must be free to put it first.
     */
    it('lets a translation reorder a composed label', () => {
        const t = createCatalogTranslator({
            'designer.palette.subtype.timer': 'таймера',
            'designer.palette.catchEvent': 'Подія %subtype%',
        });
        expect(paletteItemLabel('intermediateCatchEvent', 'timer', undefined, t)).toBe(
            'Подія таймера',
        );
        // The same call with no catalogue is the English source.
        expect(paletteItemLabel('intermediateCatchEvent', 'timer')).toBe('Timer Event');
    });

    it('translates an undo label, substituting the element ids', () => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        const svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);

        const t = createCatalogTranslator({
            'designer.command.connect': "З'єднати %source% та %target%",
        });
        const element = (id: string): BpmnElement => ({
            id,
            type: 'task',
            position: { x: 0, y: 0 },
            size: { width: 100, height: 80 },
        });
        const editor = new BpmnLiteEditor({
            host,
            svgGroup,
            commands: new CommandStack(),
            t,
            initialModel: {
                processId: 'p',
                elements: [element('a'), element('b')],
                flows: [],
            },
        });
        const flow: BpmnSequenceFlow = { id: 'f1', source: 'a', target: 'b' };

        expect(new AddFlowCommand(editor, flow).label).toBe("З'єднати a та b");

        editor.dispose();
        svg.remove();
    });
});
