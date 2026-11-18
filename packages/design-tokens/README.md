# `@fnb/design-tokens`

Purpose and audience: the single source of every colour and font stack of the FNB Manager interfaces, in the Design Tokens Format Module 2025.10 of the W3C Design Tokens Community Group, built by Style Dictionary into CSS variables with the Tailwind 4 theme mapping and a typed palette (ADR-034). For developers who change a colour or add a token, and for reviewers. The standards, the rules and the component layer around the tokens are in [docs/design-system.md](../../docs/design-system.md).

Last updated 2026-11-18

## Layout

| Path | Content |
|---|---|
| `tokens/color.light.tokens.json`, `color.dark.tokens.json`, `color.print.tokens.json` | the 28 semantic colours of each theme, as sRGB colours with their hex form |
| `tokens/font.tokens.json` | the sans and mono font stacks |
| `scripts/build-tokens.mjs` | the build: Style Dictionary reads the DTCG files, Biome formats the output |
| `src/generated/tokens.css` | generated: the variables of the three themes and the `@theme inline` mapping; imported as `@fnb/design-tokens/tokens.css` by `apps/web/src/styles.css` and by the Mini Apps' `apps/zalo-staff/src/styles.css` and `apps/zalo-customer/src/styles.css` |
| `src/generated/palette.ts` | generated: `colors` (per theme), `fontStacks`, and the `ColorTheme` and `ColorName` types, exported from the package root |

## Commands

| What | Command |
|---|---|
| Regenerate after editing a token file | `pnpm --filter @fnb/design-tokens build` |
| Report stale generated files without writing | `pnpm --filter @fnb/design-tokens check` |
| Tests | `pnpm --filter @fnb/design-tokens test` |

The generated files are committed. The tests fail when they differ from a fresh build, when a theme lacks a token another theme has, when a colour's components and hex disagree, or when a text or focus pair falls below WCAG 2.2 AA contrast in any theme.

## Who uses it

`apps/web`: the stylesheet, the chart theme and the install-assets test.

`apps/zalo-staff` and `apps/zalo-customer`, the Zalo Mini Apps of track B: each app's stylesheet imports `tokens.css` with Tailwind, and `packages/zalo-mini/src/styles/mini-app.css` maps zmp-ui's light and dark `--zaui-*` variables (page background, text, bottom navigation) onto the token variables, so the Mini Apps follow the same light and dark colours without a separate output of this build. A change to this package also triggers `deploy-mini-apps.yml`.
