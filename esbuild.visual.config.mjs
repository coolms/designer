/**
 * esbuild driver for the visual-regression fixture bundle.
 *
 * This is a SEPARATE bundle from the public `dist/index.mjs` /
 * `dist/coolms-designer.global.js`. The public bundle deliberately
 * omits the surface modules (DmnTableEditor, PropertyPanel) -- they
 * are internal, reached through `createEditor` -- while the visual
 * fixture mounts them directly, so it needs a bundle carrying both
 * the shell and the table editor.
 *
 * Output: `tests/visual/.compiled/main.js` (IIFE, source-mapped).
 * Loaded by `tests/visual/fixtures/index.html`.
 *
 * Run via `npm run build:visual`. Re-runs are idempotent and fast
 * (< 200 ms typical) because the dep graph is small + esbuild's
 * cache stays warm.
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'tests/visual/.compiled');
mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: [resolve(__dirname, 'tests/visual/fixtures/main.ts')],
    outfile: resolve(outDir, 'main.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022', 'chrome108'],
    sourcemap: true,
    logLevel: 'info',
    // Don't minify -- screenshot diff debugging is easier when
    // source references in the inspector line up with the source.
    minify: false,
});
