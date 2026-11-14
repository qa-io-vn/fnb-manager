# Design system

How the web app's look, components and accessibility are kept consistent and cheap to change. The decision behind it is [ADR-034](decisions.md#adr-034--one-token-source-in-the-dtcg-format-accessible-primitives-in-the-shadcn-pattern-wcag-22-aa); the web app's structure is in [web-app.md](web-app.md). This page is for whoever changes a colour, adds a screen or reviews a change to `apps/web`.

## 1. Standards

| Layer | Standard | What it gives |
|---|---|---|
| Design tokens | [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/2025.10/) of the W3C Design Tokens Community Group (DTCG), the format's first stable version (a community-group report, not a W3C Recommendation) | one JSON source for every colour, size and duration, readable by design tools and code generators |
| Token build | [Style Dictionary](https://styledictionary.com/) 5, which reads DTCG natively | CSS variables, the Tailwind 4 `@theme` mapping and a typed TypeScript palette, all generated from the one source |
| Styling | Tailwind CSS 4 with CSS-first `@theme inline` | utility classes that resolve to the generated variables, so a token change restyles everything |
| Components | the [shadcn/ui](https://ui.shadcn.com/) pattern: component code lives in the repository, built on [Radix](https://www.radix-ui.com/primitives) primitives where an interaction needs them, variants typed with `class-variance-authority` | accessible behaviour (focus, keyboard, Escape, screen-reader roles) without a black-box library or version lock-in |
| Accessibility | WCAG 2.2 level AA | the project standard from ADR-034 on (it was 2.1 AA); axe checks it on every page in both colour schemes and at 360 px |

## 2. Tokens

### 2.1 Where they live

`packages/design-tokens/tokens/` holds the DTCG files; nothing else defines a colour or a font stack.

| File | Content |
|---|---|
| `color.light.tokens.json`, `color.dark.tokens.json`, `color.print.tokens.json` | the 28 semantic colours of each theme: the surfaces, ink, line, accent, the positive, negative, neutral and warning pairs, focus, the chart series `chart-1` to `chart-5` and `chart-muted`, and the heat scale `heat-0` to `heat-4`. Each value is an sRGB colour with its hex form |
| `font.tokens.json` | the sans and mono font stacks |

`pnpm --filter @fnb/design-tokens build` runs Style Dictionary, formats the result with Biome and writes into `packages/design-tokens/src/generated/`:

| Output | Used by |
|---|---|
| `tokens.css` | `apps/web/src/styles.css` imports it as `@fnb/design-tokens/tokens.css`: the light values on `:root`, the dark values under `prefers-color-scheme: dark`, the print values under `@media print`, and the Tailwind `@theme inline` mapping behind `bg-surface`, `text-ink` and the other colour utilities |
| `palette.ts` | `colors.light`, `colors.dark`, `colors.print` and `fontStacks`, typed; the chart theme builds its screen fallback and its print palette from them, and the install-assets test compares the manifest, `index.html` and favicon colours with them |

The generated files are committed, so the web app builds without a token step. A unit test of the package renders the tokens in memory and fails when a committed file differs (`pnpm --filter @fnb/design-tokens check` does the same from the command line), so `pnpm test`, CI and `pnpm verify` keep them in step. Another test checks that every theme defines the same tokens and that the text and focus pairs meet WCAG 2.2 AA contrast in all three themes, and `apps/web/src/test/no-raw-colours.test.ts` fails on a colour value written anywhere in the web app's source.

### 2.2 Naming

Tokens are named for their role, never for their colour: `accent`, not `green`. A component that needs a new role gets a new semantic token, reviewed like any other change; a raw hex value in `apps/web/src` is a defect.

### 2.3 Changing a colour

1. Edit the value in `packages/design-tokens/tokens/color.light.tokens.json`, and in the dark and print files where it should differ there (give both `components` and `hex`; a test keeps them equal).
2. Run `pnpm --filter @fnb/design-tokens build`.
3. Run `pnpm verify`: the token tests check the contrast pairs, axe checks the contrast of every page in both schemes, and the end-to-end print checks cover the print values.

## 3. Components

### 3.1 Where they live

`apps/web/src/components/ui/` holds the shared controls; screens compose them and never copy their class strings.

| Component | Built on | Variants and notes |
|---|---|---|
| `Button` | a `<button>` | `primary`, `secondary`, `ghost`, `link`; sizes `default` (44 px tall) and `compact` for table headers |
| `TextField` | a labelled `<input>` | the label, the hint and the error are wired with `aria-describedby` |
| `SelectField` | a native `<select>` | native on purpose: on phones the system picker is the most usable single-choice control |
| `CheckList` | a group of labelled checkboxes | the store picker's multi-select |
| `Popover` | Radix Popover | focus moves in and returns, Escape and outside clicks close it; the store picker opens in it |
| `ToggleGroup` | Radix Toggle Group | single choice with arrow-key navigation; the language toggle |
| `Collapsible` | Radix Collapsible | the folded store and period controls below 1024 px |
| `Notice` | a `<p>` or `<div>` with a tone | `info`, `positive`, `warning`, `negative` |

A new control is added to this table and to the catalogue page (section 5) in the same change.

### 3.2 Rules

- Touch targets are at least 44 × 44 px (NFR-UX-07 for the Mini Apps; the web app follows it too), above WCAG 2.2's 24 px minimum.
- Focus is always visible, drawn with the `focus` token, and is never hidden under the sticky top bar (`scroll-padding-top` matches its height).
- Motion respects `prefers-reduced-motion`.
- Colour is never the only carrier of meaning: changes carry a sign and a word, and charts have tables (NFR-A11Y-04).
- Strings come from the message catalogue in both languages; a component takes its text as props.

## 4. Accessibility: WCAG 2.2 AA

Every page meets WCAG 2.2 AA. axe runs with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice` tags at 1280 px, at 360 px and in the dark scheme (NFR-A11Y-01). The criteria new in 2.2 that apply to this app, and how each is met:

| Criterion | How it is met | Checked by |
|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | `scroll-padding-top` equals the sticky top bar's height, so a focused element is never fully covered | end-to-end keyboard check on a report page |
| 2.5.8 Target Size (Minimum) | 44 px controls (section 3.2) | axe `target-size` rule |
| 3.3.7 Redundant Entry | the login and reset forms keep what was typed after an error | end-to-end auth checks |
| 3.3.8 Accessible Authentication (Minimum) | the password field allows paste and carries `autocomplete="current-password"` or `new-password`, so password managers fill it | end-to-end auth checks |
| 3.2.6 Consistent Help | the help links sit in the same place on every page | review |

## 5. Catalogue

In development builds, `#/thiet-ke` shows every component of section 3.1 in each variant and state, in both languages. It is not linked from the navigation and is absent from production builds. An end-to-end check runs axe on it in light and dark and at 360 px, so a component's accessibility is tested once, in isolation, as well as on the pages that use it.

## 6. Migration

The design system replaces the hand-written styles in three verified steps. Each keeps every existing test green and adds its own.

| Step | Content | Verified by | State |
|---|---|---|---|
| DS1 | the token package, generated CSS and chart palette; `styles.css` and the chart theme read them; no visible change | before-and-after full-page screenshots of every demo page in light, dark, dark at 360 px and print equal to the byte; the token tests; the raw-colour check | verified locally on 2026-11-14 |
| DS2 | the `components/ui` controls of section 3.1; the shell, the auth pages and the report card use them; WCAG 2.2 AA | the end-to-end suite, axe with the `wcag22aa` tag, the new keyboard and auth checks | planned |
| DS3 | the catalogue page and its checks; this document's tables final | the catalogue's end-to-end check | planned |
