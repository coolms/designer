import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for `@coolms/designer` visual regression.
 *
 * **Scope**: a small, deterministic set of mount scenarios for the
 * DMN table editor — empty mount + populated table — pin
 * the rendered pixel output against committed goldens. The aim is to
 * catch unintended UI drift in the canvas substrate, shell
 * chrome, property-panel layout, or table view
 * as code lands across the package.
 *
 * **Browser scope**: Chromium only. The package targets evergreen
 * Chromium-based runtimes (the Angular wrapper runs in Chrome
 * via the admin SPA). Cross-engine regressions would be useful
 * eventually but are out of scope for now.
 *
 * **Goldens are NOT committed** by default. Per-platform font
 * rendering and GPU-rasterizer differences mean the binary PNGs
 * drift between dev machines + CI. The workflow is documented in
 * `tests/visual/README.md`: the FIRST `npm run test:visual` on a new
 * checkout runs with `--update-snapshots` to seed goldens; CI uses
 * the `linux` golden suffix produced by the matching runner.
 *
 * **maxDiffPixelRatio: 0.01** is the per-test tolerance. The
 * editor's SVG canvas + native HTML table render reliably under 1%
 * pixel diff with the anti-flicker rules in the fixture HTML (no
 * animations, no caret, system font stack). Tighter thresholds
 * trip on sub-pixel rasterization drift between equivalent runs;
 * looser ones miss real layout regressions.
 *
 * **Web server**: launches the package's tiny `tests/visual/server.mjs`
 * (zero deps, Node built-ins) on port 8085. Playwright tears it down
 * at end-of-run. `reuseExistingServer` lets `npm run test:visual:update`
 * run quickly during golden-curation sessions.
 */

const PORT = Number(process.env['PORT'] ?? 8085);

export default defineConfig({
    testDir: './tests/visual',
    testMatch: '**/*.spec.ts',

    // Visual tests are CPU-light + browser-bound; running them
    // serially keeps the screenshot rasterizer deterministic.
    fullyParallel: false,
    workers: 1,

    timeout: 30_000,
    forbidOnly: !!process.env['CI'],
    retries: process.env['CI'] ? 2 : 0,
    reporter: process.env['CI'] ? 'github' : 'list',

    // Golden PNGs land under
    // `tests/visual/__snapshots__/{spec}/{name}-{platform}.png`.
    // Playwright auto-appends the platform suffix (linux / darwin /
    // win32) so a multi-OS CI matrix doesn't trample each other.
    snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',

    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.01,
            animations: 'disabled',
            caret: 'hide',
        },
    },

    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        // Tracing on test failure is the cheap-and-cheerful way to
        // diagnose why a screenshot diverged -- the resulting
        // `trace.zip` opens in `npx playwright show-trace`.
        trace: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    webServer: {
        command: 'node tests/visual/server.mjs',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env['CI'],
        timeout: 10_000,
        env: { PORT: String(PORT) },
    },
});
