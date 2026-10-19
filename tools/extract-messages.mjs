/**
 * Print the package's base catalogue: every message key the code uses, with its text in the package's source
 * language, as a flat `{key: text}` JSON object on stdout, sorted by key.
 *
 *     npm run i18n:extract > base.json
 *
 * The catalogue is `src/i18n/messages.en.json`, and it is the one place the text lives: the code holds keys only,
 * and `npm run i18n:check` fails a key the code uses that the catalogue lacks. A host converts this output to
 * whatever its own catalogues want (XLIFF, gettext, a database) -- the format stays neutral.
 *
 * Until 2026-10-14 this script read the text out of the call sites, where it was written as a second argument, and
 * it skipped every call written `this.t(` or `x.t(` -- 40 of the package's 240 keys never reached a host's
 * catalogue. Reading the catalogue instead leaves nothing to skip.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'i18n', 'messages.en.json');
const messages = JSON.parse(readFileSync(BASE, 'utf8'));
const sorted = {};
for (const key of Object.keys(messages).sort()) sorted[key] = messages[key];
process.stderr.write(`${Object.keys(sorted).length} message(s) in the base catalogue\n`);
process.stdout.write(`${JSON.stringify(sorted, null, 2)}\n`);
