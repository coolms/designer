# Visual regression suite

M3.2.i scaffold for catching unintended UI drift in the `@coolms/designer`
canvas substrate, shell composition, property-panel
layout, and DMN table editor via per-scenario PNG
snapshots.

## How it runs

```
npm run build:visual     # esbuild bundles tests/visual/fixtures/main.ts
npm run test:visual       # Playwright launches a tiny static server,
                          # navigates Chromium to per-scenario URLs,
                          # screenshots, diffs against goldens.
```

`test:visual` runs `build:visual` first via the npm script chain, so a
single command is enough for a clean run.

## Updating goldens

```
npm run test:visual:update
```

Use this whenever an intentional UI change lands. The command re-runs
the full suite with `--update-snapshots`, replacing the PNGs under
`tests/visual/__snapshots__/dmn-table.spec.ts/`.

**Always inspect the diff before committing updated goldens.** Open
the PNGs that changed under `__snapshots__/` and confirm the diff is
the change you intended -- not a flake, not a font-pack regression, not
a subpixel-rasterizer drift that ought to be fixed at the fixture
level instead.

## Why goldens are platform-specific

Playwright's `snapshotPathTemplate` (configured in
`playwright.config.ts`) appends a platform suffix to every snapshot:
`dmn-empty-linux.png`, `dmn-empty-darwin.png`, `dmn-empty-win32.png`.
This is necessary because:

  - Font rendering differs between operating systems -- the same
    `font-family: -apple-system, BlinkMacSystemFont, ...` stack
    resolves to a different actual font on each platform.
  - The Chromium rasterizer changes between platforms (Skia uses
    different SIMD code paths) producing subtly different antialiasing.
  - macOS uses CoreText for text rendering; Linux uses FreeType;
    Windows uses DirectWrite. Each produces pixel-distinct output.

The first developer / CI runner on a given platform produces the
golden; subsequent runs on the same platform compare against it.
Cross-platform consistency would require a heavyweight font-pack
(`fontconfig` overrides + bundled fonts) which is out of M3.2 scope.

## Why goldens are not committed up-front

Same reason: until a real environment generates them, any committed
PNG would just be "what one machine happened to produce" -- not a
trusted baseline. The first `npm run test:visual:update` after this
scaffold lands is what produces the initial goldens. Commit them
afterwards, with a note in the PR about which platform produced them
and the Playwright/Chromium version.

## Adding a scenario

1. Edit `fixtures/main.ts`: add an entry to the `SCENARIOS` object.
   Each scenario is a synchronous function `(host: HTMLElement) => void`
   that mounts whatever editor state you want to pin. Keep it
   deterministic -- no `Date.now()`, no `Math.random()`, no network
   calls.
2. Edit `dmn-table.spec.ts`: add a `{name, description}` entry to the
   `SCENARIOS` const at the top of the file.
3. Run `npm run test:visual:update` to seed the new golden.
4. Inspect the resulting PNG, commit, ship.

The fixture HTML + Playwright config require no changes -- both are
driven by the scenario registry.

## File layout

```
tests/visual/
├── README.md                                 (this file)
├── server.mjs                                tiny static file server, zero deps
├── dmn-table.spec.ts                         Playwright spec
├── fixtures/
│   ├── index.html                            shell loaded by Playwright; reads URL hash
│   └── main.ts                               compiled to .compiled/main.js by build:visual
├── .compiled/                                gitignored; produced by build:visual
│   └── main.js
└── __snapshots__/                            partially gitignored; per-platform PNGs
    └── dmn-table.spec.ts/
        ├── dmn-empty-linux.png               etc.
        └── dmn-populated-linux.png
```

## Troubleshooting

**"Page error: Cannot read property '...' of undefined"** -- mount
script failed. Check `tests/visual/.compiled/main.js` exists and the
designer source compiles (`npm run typecheck`). Run `npm run build:visual`
manually to surface esbuild errors.

**"Timeout waiting for __designerReady"** -- the editor mounted but
the rAF settle never fired. Either the render loop is stuck (file a
bug; see `src/canvas/RenderLoop.ts`) or the page emitted an error
before signaling ready. Open the trace:

```
npx playwright show-trace test-results/.../trace.zip
```

**Screenshot diff is tiny but consistent** -- subpixel drift. Bump
`maxDiffPixelRatio` in `playwright.config.ts` if the diff is below
the noise floor of the platform's rasterizer (1% is the default).

**Screenshot diff is large and unexpected** -- a real regression.
Compare the actual + expected PNGs side-by-side under `test-results/`.
The recent commits on the canvas / shell / table modules are the
likely culprits; `git log -- src/canvas src/shell src/dmn` narrows
the search.
