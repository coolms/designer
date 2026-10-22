# Changelog

All notable changes to `@coolms/designer` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the package's first publish, so nothing in it is
reconstructed -- every entry is written in the same commit as the change it
describes.

## Unreleased

### Changed

- **Breaking: requires Node 22.12, 24 or 26.** `engines.node` moves from
  `>=20` to `^22.12.0 || ^24.0.0 || ^26.0.0`: exactly the Node lines CI runs,
  each from the highest floor any package in the lockfile declares. Node 20 is
  past its end of life; the odd lines and Node 27 and later are not declared
  until CI runs them, and CI checks the range against its matrix and the
  lockfile. The build runs on esbuild 0.28 and the tests on vitest 5 with vite
  8.3.4, which clears 20 of the 21 advisories `.github/advisories.txt` listed.
  Both built bundles gain the same four statements and lose none: esbuild 0.28
  declares TypeScript parameter properties as class fields (`editor` and
  `element` on the add-element command, `kind` on
  `UnknownElementKindError`), as TypeScript does with
  `useDefineForClassFields`, and keeps a `void` the source writes. Every value
  is the same; on the add-element command, `editor` and `element` now come
  before `label` in its own keys.
- **Code holds only message keys; the text lives in catalogues.** Every
  translate call is `t(key)` or `t(key, params)` -- the English second argument
  is gone from all 246 call sites. The package ships its base catalogue,
  `src/i18n/messages.en.json` (240 keys), bundled into the build and exported
  as `designerMessages`.
- **`Translator` is `(key, params?) => string`** (was `(key, fallback,
  params?)`). A host translator written for the old signature must drop its
  `fallback` argument; a missing entry now falls through to the next catalogue
  instead of to text at the call site.
- **`createCatalogTranslator(...catalogues)` takes catalogues most specific
  first** -- the person's locale, its parent, the platform default -- and
  always appends the base catalogue last. One catalogue, as before, still
  works. A key no catalogue holds reads as the key.
- `PALETTE_LABELS` and `EVENT_SUBTYPE_LABELS` are read from the base catalogue;
  `PALETTE_LABEL_KEYS` and `EVENT_SUBTYPE_LABEL_KEYS` name the keys. The three
  palette keys composed at run time are maps of literal keys now.
- `npm run i18n:extract` prints the base catalogue. It used to read the text
  out of the call sites and skipped every call written `this.t(` or `x.t(`:
  40 of the 240 keys never reached a host's catalogue.

### Added

- **`npm run i18n:check`, in CI.** Fails on a key the code uses that the base
  catalogue lacks, on a translate call passing text as its second argument,
  on a key composed at run time, and on a base-catalogue message outside the
  state-machine surface (`designer.sm.`) that names a framework -- the check
  the publish guard held per source file, held per key now that the text is in
  one catalogue -- with a state-machine key used outside `src/state-machine/`,
  and a key written twice in the catalogue (JSON keeps only the last), failing
  too. Reports each other shipped catalogue's
  coverage of the base keys, base keys no code uses, and text still written
  directly into the DOM (15 today). Its self-test plants each failing shape
  and asserts it is caught.

- Declares `bugs` so a page imported from this package, and the catalogue,
  know where a correction is filed. The registry filled the gap from GitHub when
  the manifest was silent; the declared field is the one that holds on any
  registry.

## 0.1.0-alpha.1 -- 2026-09-03

First publish.

**A pre-release, carrying no compatibility promise.** The class names are not a
stability contract and the API is still moving. What is stable enough to build
against is the theming surface -- the CSS custom properties -- and that is stated
deliberately rather than by omission.

```
npm install @coolms/designer@alpha
```

### Added

- **Four authoring surfaces**, framework-agnostic and rendered to SVG: BPMN-Lite
  process diagrams, DMN decision tables, DMN decision requirement diagrams, and
  Symfony Workflow state machines.
- **A shell** -- toolbar, canvas with pan/zoom, collapsible sidebar, property
  panel -- shared by all four, with a `mount()`/`destroy()` lifecycle that a
  framework wrapper can drive.
- **Zero runtime dependencies.** The build asserts that nothing resolves outside
  `src/`, so this is checked rather than promised.
- **Dark mode**, driven by `data-theme="dark"` on the document element or any
  ancestor of the editor.

  Deliberately **not** wired to `prefers-color-scheme`: an editor embedded in an
  application has to match the application, and asking the browser instead makes
  the two disagree on any machine whose OS setting and chosen theme differ.

  The diagram notation does **not** follow the theme. Start green, end red,
  gateway amber and boundary violet mean something, so only the chrome and the
  neutrals flip -- including the paper a shape is drawn on and its outline, which
  would otherwise vanish against each other.
- **A two-level theming contract.** A core vocabulary on `.coolms-designer`
  (`--coolms-designer-paper`, `-ink` and its steps, `-line`, `-accent`,
  `-danger`, `-shadow-*`) that every panel resolves through, plus role tokens on
  the individual panels for when one part should differ from the rest.
  Overriding one core token re-skins the whole editor.

  !! **Override on the element that declares the token, never on `:root`.** Every
  token is declared on the element that consumes it, and a declaration on an
  element beats a value inherited from an ancestor. The two rules match
  different elements, so they never compete and no amount of specificity on a
  `:root` selector changes it -- such an override paints nothing and reports
  nothing. See the Theming section of the README for the two cases.
- **970 tests** across 59 files (`npm test`), plus a visual-regression suite
  (`npm run test:visual`).

### Known limitations

- The package publishes from `dist/`, which is a build product. It is rebuilt
  as part of the release; a stale one would ship a stylesheet older than this
  file describes.
- `0.1.x` is an alpha line. Expect the API to move between alphas, and pin
  exactly if that matters to you.
