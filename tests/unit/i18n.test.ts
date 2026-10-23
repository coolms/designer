import { describe, expect, it } from 'vitest';

import {
    createCatalogTranslator,
    defaultTranslator,
    designerMessages,
    interpolate,
} from '../../src/i18n.js';

/**
 * The translation seam. Code holds keys only; the text lives in catalogues, and the lookup runs the person's
 * locale, its parent, the platform default, then the package's bundled base catalogue -- which holds every key the
 * package uses, so a missing translation reads as the base language, never as a key.
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

describe('designerMessages, the bundled base catalogue', () => {
    it('holds the keys the package uses, each with text', () => {
        expect(Object.keys(designerMessages).length).toBeGreaterThan(200);
        for (const [key, text] of Object.entries(designerMessages)) {
            expect(key.startsWith('designer.'), key).toBe(true);
            expect(text.trim()).not.toBe('');
        }
    });
});

describe('defaultTranslator', () => {
    it('reads the bundled base catalogue', () => {
        expect(defaultTranslator('designer.toolbar.undo')).toBe(designerMessages['designer.toolbar.undo']);
    });

    it('interpolates its parameters', () => {
        expect(defaultTranslator('designer.command.connect', { source: 'a', target: 'b' })).toBe(
            interpolate(designerMessages['designer.command.connect'] ?? '', { source: 'a', target: 'b' }),
        );
        expect(defaultTranslator('designer.command.connect', { source: 'a', target: 'b' })).not.toContain('%source%');
    });
});

describe('createCatalogTranslator', () => {
    const forLocale = { 'designer.toolbar.undo': 'Скасувати', 'designer.blank': '' };
    const forParent = { 'designer.toolbar.undo': 'parent-undo', 'designer.toolbar.redo': 'Повторити' };
    const forDefault = { 'designer.toolbar.redo': 'default-redo', 'designer.toolbar.save': 'Зберегти' };
    const t = createCatalogTranslator(forLocale, forParent, forDefault);

    it('takes the most specific catalogue first: the locale over its parent', () => {
        expect(t('designer.toolbar.undo')).toBe('Скасувати');
    });

    it('falls through to the parent, then to the platform default', () => {
        expect(t('designer.toolbar.redo')).toBe('Повторити');
        expect(t('designer.toolbar.save')).toBe('Зберегти');
    });

    it('falls through to the bundled base catalogue last', () => {
        expect(t('designer.toolbar.zoomIn')).toBe(designerMessages['designer.toolbar.zoomIn']);
    });

    it('falls through a blank entry, so a partial catalogue degrades per message', () => {
        const blank = createCatalogTranslator({ 'designer.toolbar.deploy': '' });
        expect(blank('designer.toolbar.deploy')).toBe(designerMessages['designer.toolbar.deploy']);
    });

    it('interpolates into the translated message', () => {
        const uk = createCatalogTranslator({ 'designer.command.connect': "З'єднати %source% та %target%" });
        expect(uk('designer.command.connect', { source: 'a', target: 'b' })).toBe("З'єднати a та b");
    });

    it('shows a key no catalogue holds -- only a key a host made up can get there', () => {
        expect(t('designer.totally.absent')).toBe('designer.totally.absent');
    });
});
