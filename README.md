# @coolms/designer

Framework-agnostic, vanilla TypeScript visual designer for BPMN-Lite processes, DMN decision tables, DMN DRDs, and Symfony Workflow state machines.

**Zero runtime dependencies. MIT-licensed.**

## Why this exists

It was written from scratch rather than assembled from general-purpose modelers, for three reasons:

- **Palette scope.** A full BPMN 2.0 palette offers elements that an execution engine implementing a deliberate subset cannot run. An editor that can draw what the engine will reject teaches the wrong thing at authoring time.
- **Two models to keep in step.** Driving a general-purpose modeler means maintaining a moddle XML model alongside whatever JSON the engine actually consumes, and keeping the two honest with each other.
- **Cross-surface references.** A BPMN service task pointing at a DMN decision needs a shared lookup registry. When the editors are separate packages, that glue has nowhere to live.

The package mounts to any DOM element and assumes nothing about the host stack. Our own admin wraps it in Angular; the IIFE bundle drops into a `<script>` tag with no build step at all.

## Status

**Alpha.** Four surfaces ship, covered by 951 unit tests:

| Surface | `surface` option | What it authors |
|---|---|---|
| BPMN-Lite process | `bpmn-lite` | Executable process graphs — tasks, gateways, boundary and intermediate events, subprocesses |
| DMN decision table | `dmn-table` | Input/output clauses, hit policy, expression-language cell editor, DMN XML round-trip |
| DMN DRD | `dmn-drd` | Decision requirement diagrams — decisions, input data, knowledge sources |
| State machine | `state-machine` | Symfony Workflow `framework.workflows.*` configuration, round-tripped through YAML |

The public API is narrow on purpose and will stay that way; see [Public surface](#public-surface).

## Installation

```bash
npm install @coolms/designer
```

## Usage

```ts
import { createEditor } from '@coolms/designer';
import '@coolms/designer/styles';

const host = document.querySelector('#editor-host')!;
const editor = createEditor(host, {
    surface: 'dmn-table',
    onChange: (state) => console.log('graph changed', state),
});

// later
editor.destroy();
```

`destroy()` fully unwinds DOM, listeners and timers — it is safe to mount and unmount the editor repeatedly in a single-page app.

## Public surface

There is one entry point, and it is deliberately narrow:

```ts
import { createEditor, XRefs, DESIGNER_VERSION } from '@coolms/designer';
import type { Editor, EditorOptions, EditorSurface, SurfaceChangeEvent, XRefItem } from '@coolms/designer';
```

Every surface is reached through `createEditor` and its `surface` option — the per-surface editor classes, property panels and serializers are internal, and the module graph is organised by responsibility behind that factory. Only the three subpaths declared in `exports` (`.`, `./global`, `./styles`) are importable; anything else is internal and free to move between minor versions while the package is in alpha.

Keeping it to one entry point is not just API taste. The editors share module-level registries, and a package that offers both a root bundle and per-surface bundles hands a consumer two copies of that state the moment they import from both — which fails as a silent, confusing registry miss rather than a build error.

`XRefs` is the cross-reference registry: register a named scope of items (deployed decisions, form definitions, service-task handlers) and property-panel fields bound to that scope render live autocomplete against it.

## Translation

The package carries **message keys and an English fallback at every call site**, and owns no catalogue, no loader and no locale state. Pass nothing and the editor speaks English — that is the fallback doing its job, not a missing feature. Pass a translator and every label, description, placeholder, `aria-label` and undo tooltip comes from wherever you keep your strings.

```ts
import { createEditor, createCatalogTranslator } from '@coolms/designer';
import uk from './locale/uk.json';

createEditor(host, { surface: 'bpmn-lite', t: createCatalogTranslator(uk) });
```

`t` is `(key, fallback, params?) => string`, so a server-driven host supplies its own instead:

```ts
createEditor(host, {
    surface: 'bpmn-lite',
    t: (key, fallback, params) => myCatalogue.get(key, fallback, params),
});
```

Three properties worth knowing:

- **A missing entry reads as English, never as a key.** A partially translated catalogue degrades one message at a time; it never shows `designer.toolbar.undo` to a user.
- **Placeholders are `%name%`**, the spelling XLIFF catalogues already use, so a message moves between a bundled JSON file and a server catalogue without being rewritten.
- **Composed labels are one message, not a concatenation.** `'%subtype% Event'` is a single entry precisely so a translation can put the noun first — which most languages do.

Keys are namespaced under `designer.` (`designer.toolbar.undo`, `designer.bpmn.field.label.label`, `designer.command.connect`) so they can live inside a host application's own catalogue without colliding. The editor exposes the resolved translator as `editor.t`, so surface code you construct yourself shares one rather than defaulting to English independently.

## Module federation

If you load this package as a federated remote, declare it **shared and singleton**. The editors keep module-level registries — the renderer registry, the field registry, the cross-reference scopes — so two copies means two registries, and a lookup that should resolve quietly returns nothing. It fails as a blank property panel rather than a build error, which is the worst way for it to fail. The same reasoning is why the package has one entry point.

## Build outputs

| File | Format | Use |
|------|--------|-----|
| `dist/index.mjs` | ESM | Modern bundlers, native ES modules |
| `dist/coolms-designer.global.js` | IIFE | Direct `<script>` tag, exposes `window.CoolmsDesigner` |
| `dist/index.d.ts` | TypeScript declarations | Bundler + IDE integration |
| `dist/coolms-designer.css` | CSS | Default theme; re-skin via CSS custom properties |

The build asserts that nothing resolves outside `src/`, so the zero-dependency claim is checked rather than promised.

## Theming

Styling is governed by CSS custom properties documented in `src/styles/coolms-designer.css`. Re-skinning is a stylesheet override, not a fork — the theme contract is the public surface, not the class names.

## Development

```bash
npm install
npm run typecheck      # TypeScript no-emit check
npm test               # vitest run
npm run test:watch     # vitest watch mode
npm run build          # full build (ESM + IIFE + types + CSS)
npm run test:visual    # Playwright visual regression (builds the fixture bundle first)
```

The visual-regression harness is scaffolded but has **no committed goldens yet** — the first run writes them under `tests/visual/__snapshots__/`, and they are platform-specific, so it is a local tool rather than a CI gate for now. `npm run test:visual:update` refreshes them; review the image diff before committing any.

## License

[MIT](./LICENSE). Use freely — no attribution required in rendered output (but a `// thanks` is always appreciated).
