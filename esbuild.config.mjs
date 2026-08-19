// esbuild driver for @coolms/designer.
//
// Ships two bundles:
//  - dist/index.mjs                      ESM, for bundler + native-ESM consumers
//  - dist/coolms-designer.global.js      IIFE, exposes window.CoolmsDesigner for <script>-tag use
//
// TypeScript declarations are emitted separately by `tsc -p tsconfig.build.json` (see package.json).
// CSS is copied verbatim, not bundled — the stylesheet is a public contract (CSS custom properties)
// and we deliberately avoid CSS-in-JS or CSS-modules so consumers can override without a build step.

import { build } from 'esbuild';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, 'dist');

if (!existsSync(dist)) {
    mkdirSync(dist, { recursive: true });
}

/** @type {import('esbuild').BuildOptions} */
const common = {
    entryPoints: [resolve(__dirname, 'src/index.ts')],
    bundle: true,
    platform: 'browser',
    target: ['es2022', 'chrome108', 'firefox110', 'safari16'],
    sourcemap: true,
    logLevel: 'info',
    treeShaking: true,
    // Zero runtime deps: nothing should resolve outside `src/`. If a future ship
    // introduces a dev-time helper (e.g. a test-only fixture lib), it must NOT bleed into the
    // production bundle — add `external:` entries here when that day comes.
};

await Promise.all([
    build({
        ...common,
        format: 'esm',
        outfile: resolve(dist, 'index.mjs'),
    }),
    build({
        ...common,
        format: 'iife',
        globalName: 'CoolmsDesigner',
        outfile: resolve(dist, 'coolms-designer.global.js'),
    }),
]);

console.log('[esbuild] @coolms/designer built — ESM + IIFE');
