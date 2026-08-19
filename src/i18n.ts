/**
 * Translation seam.
 *
 * The package owns message KEYS and an English fallback written inline at
 * every call site. It owns no catalogue, no loader and no locale state --
 * a host supplies a {@link Translator} and the strings come from wherever
 * that host keeps them.
 *
 * That split is what lets one package serve two very different consumers:
 *
 *  - **Standalone.** Pass nothing and the editor speaks English, because
 *    the fallback IS the message. Pass {@link createCatalogTranslator} over
 *    your own JSON and it speaks whatever you loaded, with no dependency
 *    added and no build step.
 *  - **Server-driven.** Pass a translator backed by an API and the strings
 *    arrive from the backend, so a new language is a catalogue change
 *    rather than a release of this package.
 *
 * **Placeholders are `%name%`**, deliberately: it is the spelling XLIFF
 * catalogues already use, so a message can move between a bundled JSON file
 * and a server catalogue without being rewritten.
 *
 * Keys are dotted and namespaced under `designer.` so they can live inside a
 * consuming module's own catalogue without colliding with its messages.
 *
 * @example Standalone, with a bundled catalogue
 * ```ts
 * import { createEditor, createCatalogTranslator } from '@coolms/designer';
 * import uk from './locale/uk.json';
 *
 * createEditor(host, { surface: 'dmn-drd', t: createCatalogTranslator(uk) });
 * ```
 *
 * @example Server-driven
 * ```ts
 * createEditor(host, {
 *     surface: 'dmn-drd',
 *     t: (key, fallback, params) => catalogue.get(key, fallback, params),
 * });
 * ```
 */

/** Values substituted into `%name%` placeholders. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/**
 * Resolves a message key to display text.
 *
 * `fallback` is the English source written at the call site. A translator
 * that has no entry for `key` MUST return it (interpolated) rather than the
 * key itself -- a missing translation should read as English, never as
 * `designer.toolbar.undo`.
 */
export type Translator = (
    key: string,
    fallback: string,
    params?: TranslationParams,
) => string;

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
 * The translator used when a host supplies none: ignore the key, return the
 * interpolated English fallback. This is what makes the package usable with
 * zero configuration.
 */
export const defaultTranslator: Translator = (_key, fallback, params) =>
    interpolate(fallback, params);

/**
 * Build a {@link Translator} over a flat `{key: message}` catalogue.
 *
 * Blank and missing entries both fall through to the call-site English, so a
 * partially translated catalogue degrades message by message instead of
 * showing empty labels.
 */
export function createCatalogTranslator(
    messages: Readonly<Record<string, string>>,
): Translator {
    return (key, fallback, params) => {
        const message = messages[key];
        return interpolate(
            message === undefined || message === '' ? fallback : message,
            params,
        );
    };
}
