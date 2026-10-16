/**
 * Translation seam.
 *
 * Code holds only the KEY of a message: `t('designer.toolbar.undo')`, or
 * `t('designer.command.connect', { source, target })` with parameters. The
 * text lives in one place per language: a catalogue. The package ships its
 * base catalogue -- every key it uses, in its source language -- as
 * `src/i18n/messages.en.json`, bundled into the build, and that catalogue is
 * the last thing every lookup falls back to. `npm run i18n:check` fails a key
 * the code uses that the base catalogue lacks, and a translate call that
 * passes text where a key's parameters belong.
 *
 * The lookup order a host builds, most specific first:
 *
 *  1. the catalogue for the person's locale (`uk-UA`);
 *  2. the catalogue for its parent (`uk`);
 *  3. the catalogue for the platform's default locale, as the server reports it;
 *  4. the package's bundled base catalogue -- always, and always last.
 *
 * {@link createCatalogTranslator} takes 1-3 in that order and appends 4
 * itself, so a host cannot forget it; a blank or missing entry falls through
 * to the next. A host that passes nothing gets the base language
 * ({@link defaultTranslator}).
 *
 * **Placeholders are `%name%`**: the spelling XLIFF catalogues already use,
 * so a message moves between a bundled JSON file and a server catalogue
 * without being rewritten.
 *
 * Keys are dotted and namespaced under `designer.` so they can live inside a
 * consuming module's own catalogue without colliding with its messages.
 *
 * @example Standalone, with a bundled translation
 * ```ts
 * import { createEditor, createCatalogTranslator } from '@coolms/designer';
 * import uk from './locale/uk.json';
 *
 * createEditor(host, { surface: 'dmn-drd', t: createCatalogTranslator(uk) });
 * ```
 *
 * @example Server-driven: the person's locale, its parent, the platform default
 * ```ts
 * createEditor(host, {
 *     surface: 'dmn-drd',
 *     t: createCatalogTranslator(forLocale, forParent, forPlatformDefault),
 * });
 * ```
 */

import baseMessages from './i18n/messages.en.json';

/** Values substituted into `%name%` placeholders. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/** A flat catalogue: message key -> message text. */
export type Messages = Readonly<Record<string, string>>;

/** Resolves a message key, with its parameters, to display text. */
export type Translator = (key: string, params?: TranslationParams) => string;

/**
 * The package's base catalogue: every key the package uses, in its source
 * language. Bundled into the build; the last fallback of every lookup.
 */
export const designerMessages: Messages = baseMessages;

/**
 * Substitute `%name%` placeholders.
 *
 * An unknown placeholder is left ALONE rather than replaced with an empty
 * string: a visible `%count%` in the UI says "this message is missing a
 * parameter", where a silent blank says nothing and reads as a design.
 */
export function interpolate(text: string, params?: TranslationParams): string {
    if (params === undefined) return text;
    return text.replace(/%([A-Za-z0-9_]+)%/g, (whole, name: string) => {
        const value = params[name];
        return value === undefined ? whole : String(value);
    });
}

/**
 * Build a {@link Translator} over catalogues, most specific first -- the
 * person's locale, its parent, the platform default -- with the package's
 * base catalogue appended as the last fallback.
 *
 * A blank or missing entry falls through to the next catalogue, so a
 * partially translated catalogue degrades message by message. A key that no
 * catalogue holds reads as the key itself: the base catalogue holds every key
 * the package uses (`npm run i18n:check`), so only a key a host made up can
 * get there, and it should be visible.
 */
export function createCatalogTranslator(...catalogues: readonly Messages[]): Translator {
    const chain: readonly Messages[] = [...catalogues, designerMessages];
    return (key, params) => {
        for (const catalogue of chain) {
            const message = catalogue[key];
            if (message !== undefined && message !== '') return interpolate(message, params);
        }
        return interpolate(key, params);
    };
}

/**
 * The translator used when a host supplies none: the base catalogue alone.
 * This is what makes the package usable with zero configuration.
 */
export const defaultTranslator: Translator = createCatalogTranslator();
