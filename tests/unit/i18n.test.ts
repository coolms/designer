import { describe, expect, it } from 'vitest';

import {
    createCatalogTranslator,
    defaultTranslator,
    interpolate,
} from '../../src/i18n.js';

/**
 * The translation seam. The load-bearing property is that a MISSING
 * translation reads as English, never as a key -- a package that shows
 * `designer.toolbar.undo` to a user because a catalogue was incomplete is
 * worse than one that never offered translation at all.
 */
describe('interpolate', () => {
    it('substitutes %name% placeholders', () => {
        expect(interpolate('Connect %source% → %target%', { source: 'a', target: 'b' })).toBe(
            'Connect a → b',
        );
    });

    it('coerces numbers', () => {
        expect(interpolate('%count% rules', { count: 3 })).toBe('3 rules');
    });

    it('substitutes every occurrence of the same placeholder', () => {
        expect(interpolate('%x% and %x%', { x: 'one' })).toBe('one and one');
    });

    it('returns the text unchanged when no params are supplied', () => {
        expect(interpolate('Connect %source%')).toBe('Connect %source%');
    });

    it('leaves an unknown placeholder visible rather than blanking it', () => {
        // A visible %missing% reports the bug. An empty string hides it and
        // reads as a deliberate design.
        expect(interpolate('a %missing% b', { other: 'x' })).toBe('a %missing% b');
    });

    it('ignores text that merely contains percent signs', () => {
        expect(interpolate('100% done', { x: 'y' })).toBe('100% done');
    });
});

describe('defaultTranslator', () => {
    it('ignores the key and returns the interpolated fallback', () => {
        expect(defaultTranslator('designer.any.key', 'Undo')).toBe('Undo');
        expect(defaultTranslator('k', 'Add %kind%', { kind: 'Task' })).toBe('Add Task');
    });
});

describe('createCatalogTranslator', () => {
    const t = createCatalogTranslator({
        'designer.toolbar.undo': 'Скасувати',
        'designer.command.add': 'Додати %kind%',
        'designer.blank': '',
    });

    it('resolves a key present in the catalogue', () => {
        expect(t('designer.toolbar.undo', 'Undo')).toBe('Скасувати');
    });

    it('interpolates into the translated message, not the fallback', () => {
        expect(t('designer.command.add', 'Add %kind%', { kind: 'Задача' })).toBe(
            'Додати Задача',
        );
    });

    it('falls back to the call-site English for a missing key', () => {
        expect(t('designer.not.translated', 'Reroute Flow')).toBe('Reroute Flow');
    });

    it('falls back for a blank entry, so a partial catalogue degrades per message', () => {
        expect(t('designer.blank', 'Delete Flow')).toBe('Delete Flow');
    });

    it('never returns the key itself', () => {
        const out = t('designer.totally.absent', 'Definition key');
        expect(out).not.toContain('designer.');
        expect(out).toBe('Definition key');
    });
});
