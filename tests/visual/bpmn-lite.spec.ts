import { test, expect } from '@playwright/test';

/**
 * visual-regression spec for the BPMN-Lite editor surface.
 *
 * Mirrors the DMN spec pattern verbatim -- per-scenario hash
 * navigation, `__designerReady` mount signal, golden screenshot
 * comparison. Each scenario name resolves to an entry in the shared
 * `tests/visual/fixtures/main.ts` registry so the fixture HTML +
 * Playwright config require no per-spec changes.
 *
 * **Scenarios**:
 *  - `bpmn-empty` -- bare-mount BPMN-Lite editor with shell +
 *    canvas + palette + empty property panel. Pins fresh-mount
 *    geometry of the canvas substrate, M3.3.d palette tile
 *    layout, M3.3.f panel "no selection" empty state.
 *  - `bpmn-populated` -- 7-element approve-request flow with branching
 *    XOR gateway + default flow marker. Loaded through the M3.3.g
 *    JSON round-trip so the diagram sidecar geometry hits the
 *    rendered canvas. Pins M3.3.b node + M3.3.c edge paint.
 *  - `bpmn-property-panel` -- service-task selected with the M3.3.i
 *    XRef autocomplete scopes populated. Pins the variant-specific
 *    field rendering (label + variant SELECT + implementation
 *    autocomplete) that landed in M3.3.i.
 *
 * **Failure debugging**:
 *  - On a diff failure Playwright writes the actual + expected + diff
 *    PNGs alongside the test name in `test-results/`. Inspect them
 *    visually to decide whether the change was intentional.
 *  - If intentional: re-run `npm run test:visual:update` to refresh
 *    the goldens, commit the new PNGs, and add a note to the PR.
 *  - If unintentional: the diff highlights the affected region; the
 *    i commit history ought to point at the recent commits
 *    that touched the relevant subsystem (renderers, palette,
 *    property panel, schema provider).
 *
 * **Goldens are NOT committed by default** -- see the config
 * docblock + `tests/visual/README.md` for the platform-suffixed
 * golden curation workflow.
 */

const SCENARIOS = [
    {
        name: 'bpmn-empty',
        description: 'fresh-mount BPMN-Lite editor: shell + canvas + palette + empty panel',
    },
    {
        name: 'bpmn-populated',
        description: '7-element approve-request flow with XOR gateway + default-flow marker',
    },
    {
        name: 'bpmn-property-panel',
        description: 'service-task selected with M3.3.i implementation autocomplete populated',
    },
] as const;

test.describe('@coolms/designer BPMN-Lite editor', () => {
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
                `${scenario.name}.png`,
            );
        });
    }
});
