import { test, expect } from '@playwright/test';

/**
 * visual-regression spec for the DMN table editor.
 *
 * Each test:
 *  1. Navigates to the fixture HTML with a scenario name in the URL hash.
 *  2. Waits for the fixture entrypoint to set `window.__designerReady`
 *     -- the signal it has mounted + the render loop has flushed two
 *     rAF tics.
 *  3. Screenshots the `#app` container and compares against the
 *     committed golden under `__snapshots__/`.
 *
 * **Failure debugging**:
 *  - On a diff failure Playwright writes the actual + expected + diff
 *    PNGs alongside the test name in `test-results/`. Inspect them
 *    visually to decide whether the change was intentional.
 *  - If intentional: re-run `npm run test:visual:update` to refresh
 *    the goldens, commit the new PNGs, and add a note to the PR.
 *  - If unintentional: the diff highlights the affected region; the
 *    canvas substrate + M3.2.d shell composition logs ought
 *    to point at the recent commits that touched those areas.
 *
 * **Adding a scenario**: append it to the `SCENARIOS` registry in
 * `fixtures/main.ts`, then add a `test()` block here referencing the
 * same name. The fixture HTML + Playwright config require no edits.
 */

const SCENARIOS = [
    {
        name: 'empty',
        description: 'fresh-mount DMN table editor with the package default model',
    },
    {
        name: 'populated',
        description: '2-input × 1-output decision table with three rules',
    },
] as const;

test.describe('@coolms/designer DMN table editor', () => {
    for (const scenario of SCENARIOS) {
        test(`renders consistently: ${scenario.description}`, async ({ page }) => {
            // The fixture stamps `__designerError` if it can't mount.
            // Promote that to a test failure with the error message
            // verbatim so we don't waste a screenshot diff diagnosing
            // an upstream regression that prevented mount entirely.
            page.on('pageerror', (err) => {
                throw new Error(`Fixture pageerror: ${err.message}`);
            });

            await page.goto(`/#${scenario.name}`, { waitUntil: 'domcontentloaded' });

            await page.waitForFunction(
                () => {
                    const w = window as unknown as {
                        __designerReady?: boolean;
                        __designerError?: string;
                    };
                    if (w.__designerError !== undefined) {
                        throw new Error(`Mount failed: ${w.__designerError}`);
                    }
                    return w.__designerReady === true;
                },
                undefined,
                { timeout: 5_000 },
            );

            await expect(page.locator('#app')).toHaveScreenshot(
                `dmn-${scenario.name}.png`,
            );
        });
    }
});
