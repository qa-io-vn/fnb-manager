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

`apps/web/src/components/ui/` holds the shared controls; screens compose them and never copy their class strings. A unit test (`ui.test.tsx`) pins each variant to the classes the screens used before the design system, so a change to a variant is deliberate.

| Export | Built on | Variants and use |
|---|---|---|
| `Button`, `buttonVariants` | a `<button>` (type `button` unless a form sets `submit`) | `tone`: `primary`, `secondary`, `warning`; `size`: `regular` (`px-4 font-semibold`) and `compact` (`px-3 text-sm font-medium`); all 44 px tall. Every button of the shell, the auth pages, Hôm nay and the report cards except the table sort headers and the skip link |
| `fieldVariants` | classes for a native `<input>`, `<select>` or a field-like `<button>` | `kind`: `control` (the period inputs and selects, the tenant select), `trigger` (the store picker and the folded-controls summary), `form` (the sign-in fields) |
| `TextField` | a labelled `<input>` | label linked by `id`, `required`, and the `autocomplete` value password managers need |
| `TextLink` | React Router's `Link` | the underlined accent link of the auth pages and the report cards |
| `Popover`, `PopoverTrigger`, `PopoverContent` | Radix Popover | focus moves into the panel and back to the trigger, Escape and outside clicks close it, the panel stays inside the viewport; `PopoverContent` requires a `label`, which names its dialog for screen readers; the store picker opens in it |
| `cn` | `clsx` and `tailwind-merge` | joins classes so that a screen's override replaces a variant's class instead of adding a second one |

Two patterns stay native because they already follow the WAI-ARIA pattern and Radix would add nothing: the language switch is a pair of toggle buttons with `aria-pressed`, and the folded store and period controls are a disclosure button with `aria-expanded` and `aria-controls`. A control moves into `components/ui` as soon as a second screen needs it, together with a line in this table and a case in `ui.test.tsx`.

### 3.2 Rules

- Touch targets are at least 44 × 44 px (NFR-UX-07 for the Mini Apps; the web app follows it too), above WCAG 2.2's 24 px minimum.
- Focus is always visible, drawn with the `focus` token, and is never hidden under the sticky top bar (`scroll-padding-top` matches its height).
- Motion respects `prefers-reduced-motion`.
- Colour is never the only carrier of meaning: changes carry a sign and a word, and charts have tables (NFR-A11Y-04).
- Strings come from the message catalogue in both languages; a component takes its text as props.

## 4. Accessibility: WCAG 2.2 AA

Every page meets WCAG 2.2 AA. axe runs with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` and `best-practice` tags at 1280 px, at 360 px (after scrolling every wide table to its end) and in the dark scheme (NFR-A11Y-01). The criteria new in 2.2 that apply to this app, and how each is met:

| Criterion | How it is met | Checked by |
|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | the top bar publishes its height as `--top-bar-height`, and `html` sets `scroll-padding-top` to it, so the browser never scrolls a focused control under the sticky bar. Without it, tabbing back through Ngày left table sort buttons fully hidden | `e2e:demo/demo`: Tab and Shift+Tab through Ngày at 360 px |
| 2.5.8 Target Size (Minimum) | 44 px controls; wide tables snap so that a whole column rests right after the pinned first column, and pad their end so the last column can rest there too, so no sort button rests half under the pinned column (it left 9.5 px of a button visible before) | axe `target-size` after scrolling every table to its end; `table-scroller.test.tsx` |
| 3.3.7 Redundant Entry | the sign-in and reset forms keep what was typed after an error | review |
| 3.3.8 Accessible Authentication (Minimum) | the e-mail and password fields carry `autocomplete` (`username`, `current-password`, `new-password`) and never block pasting, so password managers fill them | `ui.test.tsx`; review |
| 3.2.6 Consistent Help | the app has no help link yet; when one is added it goes in the same place on every page | review |

## 5. Catalogue

In development builds, `#/thiet-ke` shows every export of section 3.1 in each variant and state: the six tone and size combinations of `Button` and a disabled one, `TextField`, an input and a select with `fieldVariants`, `TextLink`, the `Popover`, and the native language switch. Its title, section titles and labels come from the message catalogue in both languages, like every visible string of the app; each section title names the export in brackets. The route is added only when `import.meta.env.DEV` is true, so the production build contains neither the route nor the page.

An end-to-end check opens it, runs the page check (axe in light at 1280 px, at 360 px and in dark, no sideways scroll), opens the popover and runs axe again, and checks that Escape returns focus to the trigger. Another checks that the production build sends `#/thiet-ke` back to Hôm nay. A component's accessibility is therefore tested once, in isolation, as well as on the pages that use it; the first run found that the popover panel was a dialog without a name, which is why `PopoverContent` now requires a `label`.

## 6. Migration

The design system replaces the hand-written styles in three verified steps. Each keeps every existing test green and adds its own.

| Step | Content | Verified by | State |
|---|---|---|---|
| DS1 | the token package, generated CSS and chart palette; `styles.css` and the chart theme read them; no visible change | before-and-after full-page screenshots of every demo page in light, dark, dark at 360 px and print equal to the byte; the token tests; the raw-colour check | verified locally on 2026-11-14 |
| DS2 | the `components/ui` controls of section 3.1; the shell, the auth pages, Hôm nay and the report cards use them; WCAG 2.2 AA with the focus and target-size fixes of section 4 | the end-to-end suite with the WCAG 2.2 axe tags and the keyboard check, the unit tests of the controls and the table scroller, and the before-and-after screenshots (identical, apart from rounding of at most 1/255 inside the blurred top bar) | verified locally on 2026-11-14 |
| DS3 | the catalogue page and its checks; this document's tables final | the catalogue's end-to-end checks in development and production | verified locally on 2026-11-14 |

The shared controls added about 33 kB gzipped to the start-up JavaScript (248.5 kB after DS1, 281.1 kB after DS2: Radix Popover with its positioning, `tailwind-merge` and `class-variance-authority`), inside the 400 kB budget of `scripts/check-size.mjs`.
