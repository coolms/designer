# Changelog

All notable changes to `@coolms/designer` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the package's first publish, so nothing in it is
reconstructed — every entry is written in the same commit as the change it
describes.

## 0.1.0-alpha.1 — 2026-09-03

First publish.

**A pre-release, carrying no compatibility promise.** The class names are not a
stability contract and the API is still moving. What is stable enough to build
against is the theming surface — the CSS custom properties — and that is stated
deliberately rather than by omission.

```
npm install @coolms/designer@alpha
```

### Added

- **Four authoring surfaces**, framework-agnostic and rendered to SVG: BPMN-Lite
  process diagrams, DMN decision tables, DMN decision requirement diagrams, and
  Symfony Workflow state machines.
- **A shell** — toolbar, canvas with pan/zoom, collapsible sidebar, property
  panel — shared by all four, with a `mount()`/`destroy()` lifecycle that a
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
  neutrals flip — including the paper a shape is drawn on and its outline, which
  would otherwise vanish against each other.
- **A two-level theming contract.** A core vocabulary on `.coolms-designer`
  (`--coolms-designer-paper`, `-ink` and its steps, `-line`, `-accent`,
  `-danger`, `-shadow-*`) that every panel resolves through, plus role tokens on
  the individual panels for when one part should differ from the rest.
  Overriding one core token re-skins the whole editor.

  ⚠️ **Override on the element that declares the token, never on `:root`.** Every
  token is declared on the element that consumes it, and a declaration on an
  element beats a value inherited from an ancestor. The two rules match
  different elements, so they never compete and no amount of specificity on a
  `:root` selector changes it — such an override paints nothing and reports
  nothing. See the Theming section of the README for the two cases.
- **970 tests** across 59 files (`npm test`), plus a visual-regression suite
  (`npm run test:visual`).

### Known limitations

- The package publishes from `dist/`, which is a build product. It is rebuilt
  as part of the release; a stale one would ship a stylesheet older than this
  file describes.
- `0.1.x` is an alpha line. Expect the API to move between alphas, and pin
  exactly if that matters to you.
