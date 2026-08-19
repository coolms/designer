/**
 * Extract every message key + its English fallback from the sources.
 *
 * The fallbacks are written inline at the call sites, which makes them the
 * single source of truth: a catalogue generated from here cannot drift from
 * what the code will actually render, and nobody has to remember to add a key
 * to a list when they add a string.
 *
 * Output is a flat `{key: english}` JSON object on stdout -- deliberately
 * format-neutral. A host converts it to whatever its catalogue wants (XLIFF,
 * gettext, a database) rather than this package taking a position.
 *
 *     npm run i18n:extract > en.json
 *
 * Parsing note: this reads `t('key', 'fallback')` with a small hand-rolled
 * scanner rather than a regex. Fallbacks wrap across lines, contain escaped
 * quotes and apostrophes, and mix quote styles -- all of which a regex gets
 * wrong quietly, which is the worst way to get a catalogue wrong.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every .ts file under src/, recursively. */
function sources(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...sources(full));
        } else if (entry.endsWith('.ts')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Read a JS string literal starting at `i` (which must index the opening
 * quote). Returns the decoded value and the index just past the closing
 * quote, or null when the literal is a template with an interpolation --
 * those are dynamic keys, handled separately.
 */
function readString(text, i) {
    const quote = text[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') return null;
    let out = '';
    let j = i + 1;
    while (j < text.length) {
        const ch = text[j];
        if (ch === '\\') {
            const next = text[j + 1];
            out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            j += 2;
            continue;
        }
        if (quote === '`' && ch === '$' && text[j + 1] === '{') return null;
        if (ch === quote) return { value: out, end: j + 1 };
        out += ch;
        j += 1;
    }
    return null;
}

function skipSpace(text, i) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    return i;
}

const messages = new Map();
const dynamic = [];

for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (let i = 0; i < text.length; i += 1) {
        // A call to `t(` that is not part of a longer identifier.
        if (text[i] !== 't' || text[i + 1] !== '(') continue;
        if (i > 0 && /[A-Za-z0-9_$.]/.test(text[i - 1])) continue;

        let j = skipSpace(text, i + 2);

        // A template key (`designer.palette.kind.${kind}`) is composed at
        // runtime; report it rather than guessing its expansions.
        if (text[j] === '`') {
            const raw = readString(text, j);
            if (raw === null) {
                const end = text.indexOf('`', j + 1);
                dynamic.push(text.slice(j, end + 1).replace(/\s+/g, ' '));
            }
            continue;
        }

        const key = readString(text, j);
        if (key === null || !key.value.startsWith('designer.')) continue;

        j = skipSpace(text, key.end);
        if (text[j] !== ',') continue;
        j = skipSpace(text, j + 1);

        const fallback = readString(text, j);
        if (fallback === null) continue;

        const existing = messages.get(key.value);
        if (existing !== undefined && existing !== fallback.value) {
            process.stderr.write(
                `conflicting fallbacks for ${key.value}:\n  ${existing}\n  ${fallback.value}\n`,
            );
            process.exitCode = 1;
        }
        messages.set(key.value, fallback.value);
    }
}

/**
 * Three keys are composed at runtime from a closed set -- the element kinds,
 * the event subtypes, the task variants. Each set is a literal map in
 * `defaults.ts` that ALSO holds the English, so expanding them here keeps one
 * source of truth rather than duplicating the members into this script.
 */
function expandFromMap(prefix, constName) {
    const text = readFileSync(join(SRC, 'bpmn-lite', 'defaults.ts'), 'utf8');
    const start = text.indexOf(`const ${constName}`);
    if (start === -1) {
        process.stderr.write(`cannot find ${constName} to expand ${prefix}\n`);
        process.exitCode = 1;
        return;
    }
    const open = text.indexOf('{', start);
    const close = text.indexOf('\n};', open);
    for (const [, member, english] of text
        .slice(open, close)
        .matchAll(/^\s*(\w+)\s*:\s*'([^']+)'/gm)) {
        messages.set(`${prefix}${member}`, english);
    }
}

expandFromMap('designer.palette.kind.', 'PALETTE_LABELS');
expandFromMap('designer.palette.subtype.', 'EVENT_SUBTYPE_LABELS');
expandFromMap('designer.palette.variant.', 'TASK_VARIANT_LABELS');

const unexpanded = [...new Set(dynamic)].filter(
    (d) => !/palette\.(kind|subtype|variant)\./.test(d),
);
if (unexpanded.length > 0) {
    // A composed key nobody taught this script to expand would silently leave
    // a hole in the catalogue, so it fails rather than warning.
    process.stderr.write('\nruntime-composed key(s) with no expansion rule:\n');
    for (const d of unexpanded.sort()) {
        process.stderr.write(`  ${d}\n`);
    }
    process.exitCode = 1;
}

const sorted = {};
for (const key of [...messages.keys()].sort()) {
    sorted[key] = messages.get(key);
}
process.stderr.write(`${messages.size} static message(s) extracted\n`);
process.stdout.write(`${JSON.stringify(sorted, null, 2)}\n`);
