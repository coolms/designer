/**
 * The message gate: code holds keys, the base catalogue holds the text.
 *
 *     npm run i18n:check                      check src/ against src/i18n/messages.en.json
 *     node tools/check-messages.mjs --self-test
 *
 * FAILS (exit 1) when the code
 *  - uses a key the base catalogue does not hold -- every string literal shaped like a key (`'designer.<...>'`)
 *    anywhere under src/ is a key, wherever it is written: a call, a map of keys, a default;
 *  - passes text where a key's parameters belong: a translate call (`t(` / `.t(`) whose second argument is a
 *    string literal -- the text belongs in the catalogue;
 *  - composes a key at run time (a template literal starting `designer.` with a `${...}` in it) -- such a key
 *    cannot be checked, so the code must name each key it can reach (a map of literal keys);
 *  - holds, in the base catalogue, a message OUTSIDE the state-machine surface (`designer.sm.`) that names a
 *    framework. The package depends on none; the state-machine surface alone authors a framework's workflow
 *    configuration and names it as its file format. The publish guard's `frameworks` check used to hold that per
 *    source file; with the text in one catalogue, the guard allows the catalogue and this holds it per key.
 * REPORTS, without failing:
 *  - each other catalogue shipped beside the base one (`messages.<locale>.json`): N of M base keys present;
 *  - base-catalogue keys no code uses;
 *  - text still written directly into the DOM (textContent, title, placeholder, aria-label, alt and label set
 *    from a string literal) -- the count, so it can be driven to zero and then made a failure.
 * Exit 0 CLEAR, 1 FOUND, 2 UNEVALUABLE (the catalogue or the sources could not be read).
 *
 * The self-test plants each failing shape in a copy of the real sources and asserts the check names it, and
 * asserts the real sources pass: a gate that refuses everything and one that refuses nothing both fail it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CATALOGUE_DIR = join(SRC, 'i18n');
const BASE = join(CATALOGUE_DIR, 'messages.en.json');

function sources(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...sources(full));
        else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** Every string literal in a source, with where it starts and, for a template, whether it interpolates. */
function literals(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i === -1) break; continue; }
        if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i === -1) break; i += 2; continue; }
        if (ch === "'" || ch === '"' || ch === '`') {
            let j = i + 1;
            let value = '';
            let dynamic = false;
            while (j < text.length && text[j] !== ch) {
                if (text[j] === '\\') { value += text[j + 1]; j += 2; continue; }
                if (ch === '`' && text[j] === '$' && text[j + 1] === '{') dynamic = true;
                value += text[j];
                j += 1;
            }
            out.push({ start: i, end: j + 1, quote: ch, value, dynamic });
            i = j + 1;
            continue;
        }
        i += 1;
    }
    return out;
}

const KEY = /^designer\.[A-Za-z0-9_.-]+$/;
// The publish guard's `frameworks` pattern, and the one surface allowed to name a framework.
const FRAMEWORK = /\b(Symfony|ApiPlatform|API[- ]Platform|Twig|Mercure|Messenger)\b/;
const FRAMEWORK_SURFACE = 'designer.sm.';
const DOM_TEXT = [
    /\.textContent\s*=\s*(['"`])(?=[^'"`]*[A-Za-z]{2})/g,
    /\.(title|placeholder|alt)\s*=\s*(['"`])(?=[^'"`]*[A-Za-z]{2})/g,
    /setAttribute\(\s*['"](aria-label|title|placeholder|alt)['"]\s*,\s*(['"`])(?=[^'"`]*[A-Za-z]{2})/g,
    /\blabel\s*:\s*(['"`])(?=[^'"`]*[A-Za-z]{2}[^'"`]*\1)(?!designer\.)/g,
];

/**
 * The keys of a JSON object's top level, in the order written and each decoded as JSON reads it -- so two copies on
 * one line, or the same key spelled once with an escape, are both seen. A string-aware scan: a quoted key inside a
 * value, or a key of a nested object, is not one.
 */
function topLevelKeys(raw) {
    const keys = [];
    let depth = 0;
    let i = 0;
    while (i < raw.length) {
        const c = raw[i];
        if (c === '"') {
            let j = i + 1;
            while (j < raw.length && raw[j] !== '"') j += raw[j] === '\\' ? 2 : 1;
            const literal = raw.slice(i, j + 1);
            let k = j + 1;
            while (/\s/.test(raw[k] ?? '')) k += 1;
            if (depth === 1 && raw[k] === ':') keys.push(JSON.parse(literal));
            i = j + 1;
            continue;
        }
        if (c === '{' || c === '[') depth += 1;
        else if (c === '}' || c === ']') depth -= 1;
        i += 1;
    }
    return keys;
}

/** The surface whose keys may name a framework, and where those keys may be used. */
const FRAMEWORK_SOURCES = 'src/state-machine/';

/** The check over a set of files: { [path]: text }, the base catalogue, and the catalogue's raw text. */
export function check(files, base, rawCatalogue = null) {
    const failures = [];
    const used = new Set();
    let direct = 0;
    for (const [file, text] of Object.entries(files)) {
        const lits = literals(text);
        for (const lit of lits) {
            if (lit.dynamic && lit.value.startsWith('designer.')) {
                failures.push(`${file}: a key composed at run time (${lit.value.replace(/\s+/g, ' ')}) -- name each key it can reach`);
            } else if (!lit.dynamic && KEY.test(lit.value)) {
                used.add(lit.value);
                if (base[lit.value] === undefined) failures.push(`${file}: '${lit.value}' is not in the base catalogue`);
                // The publish guard allows the whole catalogue to name a framework, trusting the state-machine keys to
                // be the only ones that do: such a key used from another surface would carry the name there.
                if (lit.value.startsWith(FRAMEWORK_SURFACE) && !file.split(sep).join('/').startsWith(FRAMEWORK_SOURCES)) {
                    failures.push(`${file}: '${lit.value}' is a state-machine key, used outside ${FRAMEWORK_SOURCES}`);
                }
            }
        }
        // translate calls whose second argument is a string literal
        for (let i = 0; i < text.length; i += 1) {
            if (text[i] !== 't' || text[i + 1] !== '(') continue;
            if (i > 0 && /[A-Za-z0-9_$]/.test(text[i - 1])) continue;
            const first = lits.find((l) => l.start > i + 1 && /^\s*$/.test(text.slice(i + 2, l.start)));
            if (!first || !first.value.startsWith('designer.')) continue;
            let j = first.end;
            while (/\s/.test(text[j] ?? '')) j += 1;
            if (text[j] !== ',') continue;
            j += 1;
            while (/\s/.test(text[j] ?? '')) j += 1;
            if (text[j] === "'" || text[j] === '"' || text[j] === '`') {
                failures.push(`${file}: t('${first.value}', ...) passes text as its second argument -- the text belongs in the catalogue`);
            }
        }
        for (const rx of DOM_TEXT) direct += [...text.matchAll(rx)].length;
    }
    for (const [key, message] of Object.entries(base)) {
        const m = FRAMEWORK.exec(message);
        if (m && !key.startsWith(FRAMEWORK_SURFACE)) {
            failures.push(`base catalogue: '${key}' names a framework (${m[0]}) outside the state-machine surface`);
        }
    }
    // A key written twice: JSON.parse keeps the last, so the first copy's text would ship in the file unread.
    if (rawCatalogue !== null) {
        const seen = new Map();
        for (const key of topLevelKeys(rawCatalogue)) seen.set(key, (seen.get(key) ?? 0) + 1);
        for (const [key, n] of seen) {
            if (n > 1) failures.push(`base catalogue: '${key}' is written ${n} times -- JSON keeps only the last`);
        }
    }
    const unused = Object.keys(base).filter((k) => !used.has(k));
    return { failures, used, unused, direct };
}

function readTree() {
    const files = {};
    for (const f of sources(SRC)) files[relative(ROOT, f)] = readFileSync(f, 'utf8');
    return files;
}

function otherCatalogues(base) {
    const out = [];
    for (const name of readdirSync(CATALOGUE_DIR)) {
        const m = /^messages\.(.+)\.json$/.exec(name);
        if (!m || join(CATALOGUE_DIR, name) === BASE) continue;
        const cat = JSON.parse(readFileSync(join(CATALOGUE_DIR, name), 'utf8'));
        const keys = Object.keys(base);
        const have = keys.filter((k) => typeof cat[k] === 'string' && cat[k] !== '').length;
        out.push(`${m[1]}: ${have} of ${keys.length} base keys`);
    }
    return out;
}

function main() {
    let base;
    let files;
    let raw;
    try {
        raw = readFileSync(BASE, 'utf8');
        base = JSON.parse(raw);
        files = readTree();
    } catch (err) {
        console.error(`i18n:check UNEVALUABLE -- ${err.message}`);
        process.exit(2);
    }
    const { failures, used, unused, direct } = check(files, base, raw);
    const others = otherCatalogues(base);
    console.log(`i18n:check -- ${Object.keys(files).length} source files, ${used.size} keys used, ${Object.keys(base).length} in the base catalogue (${relative(ROOT, BASE)})`);
    console.log(`  other catalogues shipped here: ${others.length ? others.join('; ') : 'none (the platform serves them)'}`);
    console.log(`  base keys no code uses: ${unused.length}${unused.length ? ' -- ' + unused.slice(0, 10).join(', ') : ''}`);
    console.log(`  text still written directly into the DOM (reported, not failed): ${direct}`);
    if (failures.length) {
        console.log(`FOUND -- ${failures.length}:`);
        for (const f of failures) console.log('  ' + f);
        process.exit(1);
    }
    console.log('CLEAR -- every key the code uses is in the base catalogue; no call passes text');
}

function selfTest() {
    const raw = readFileSync(BASE, 'utf8');
    const base = JSON.parse(raw);
    const files = readTree();
    const anyFile = Object.keys(files).find((f) => basename(f) === 'Toolbar.ts') ?? Object.keys(files)[0];
    const cases = [
        ['the real sources pass', files, 0],
        ['a key missing from the base catalogue fails', { ...files, [anyFile]: files[anyFile] + "\nconst planted = t('designer.planted.missing');\n" }, 1],
        ['a call passing text as its second argument fails', { ...files, [anyFile]: files[anyFile] + "\nconst planted = t('designer.toolbar.undo', 'Undo');\n" }, 1],
        ['a key composed at run time fails', { ...files, [anyFile]: files[anyFile] + '\nconst planted = t(`designer.palette.kind.${kind}`);\n' }, 1],
        ['a missing key in a map of keys fails', { ...files, [anyFile]: files[anyFile] + "\nconst PLANTED = { a: 'designer.planted.mapped' };\n" }, 1],
    ];
    const framed = (name) => ({ ...base, 'designer.toolbar.save': `Save to ${name}` });
    const smFramed = { ...base, 'designer.sm.field.guard.description': 'Symfony EL' };
    // Every alternative of the pattern, planted one at a time: a dropped name turns its own case.
    const names = ['Symfony', 'ApiPlatform', 'API Platform', 'API-Platform', 'Twig', 'Mercure', 'Messenger'];
    const smFile = Object.keys(files).find((f) => f.split(sep).join('/').startsWith('src/state-machine/'));
    // A duplicate key: the planted copy, above the real one, is what JSON.parse would drop.
    const doubled = raw.replace('    "designer.toolbar.save":', '    "designer.toolbar.save": "a hidden copy",\n    "designer.toolbar.save":');
    // ...on the same line, and spelled with an escape: JSON reads each as the one key.
    const doubledInline = raw.replace('    "designer.toolbar.save":', '    "designer.toolbar.save": "a hidden copy", "designer.toolbar.save":');
    const doubledEscaped = raw.replace('    "designer.toolbar.save":', '    "designer.toolbar.sav\\u0065": "a hidden copy",\n    "designer.toolbar.save":');
    const lookAlike = 'src/state-machine-extra/planted.ts';
    let bad = 0;
    let ran = 0;
    for (const [name, set, want, catalogue = base, rawText = raw] of [
        ...cases,
        ...names.map((n) => [`a framework named outside the state-machine surface fails: ${n}`, files, 1, framed(n)]),
        ['a framework named inside the state-machine surface passes', files, 0, smFramed],
        ['a state-machine key used outside src/state-machine/ fails',
            { ...files, [anyFile]: files[anyFile] + "\nconst planted = t('designer.sm.banner.title');\n" }, 1],
        ['a state-machine key used inside src/state-machine/ passes',
            { ...files, [smFile]: files[smFile] + "\nconst planted = t('designer.sm.banner.title');\n" }, 0],
        ['a key written twice in the base catalogue fails', files, 1, base, doubled],
        ['a key written twice on one line fails', files, 1, base, doubledInline],
        ['a key written twice, once with an escape, fails', files, 1, base, doubledEscaped],
        ['a state-machine key used from a look-alike folder (src/state-machine-extra/) fails',
            { ...files, [lookAlike]: "const planted = t('designer.sm.banner.title');\n" }, 1],
    ]) {
        const got = check(set, catalogue, rawText).failures.length > 0 ? 1 : 0;
        const ok = got === want;
        ran += 1;
        if (!ok) bad += 1;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    }
    console.log(`i18n:check self-test: ${ran} cases, ${bad} failed`);
    process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
