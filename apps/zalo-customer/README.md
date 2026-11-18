# Customer Mini App (`@fnb/zalo-customer`)

Purpose and audience: the customer Zalo Mini App of track C, one build per brand from configuration and listed in Zalo's search (`mini_apps.browsable` true). For developers of the customer screens and for reviewers of Zalo's design rules. Phase 13 (#208) built only what the owner needs to check the platform: the session check, and a phone-consent probe in Development builds. The customer features come in phase 18a (#33); nothing has run inside Zalo yet, because the owner's Zalo accounts do not exist yet (#8).

Last updated 2026-11-18

## What it shows

- One screen, with no bottom navigation: the shared session screen of `@fnb/zalo-mini` ("Đang kết nối…", then the signed-in member's name, role and stores, or the unpaired instructions with the code entry).
- In a Development build only, an entry to the phone-consent probe: it opens Zalo's phone-number consent dialog and records whether the dialog completed and the error code of a refusal; the phone token is never shown or kept. The probe is loaded lazily behind the Development stage, and its marker `phone-probe` is in `developmentOnlyMarkers` (`vite.config.ts`), so a Testing build that still contains it fails, since a review rejects demo placeholders.

The routes are in `src/app.tsx`, the probe in `src/probe/`. Everything else comes from [`@fnb/zalo-mini`](../../packages/zalo-mini/README.md).

## Commands

```sh
pnpm --filter @fnb/zalo-customer dev        # browser mode on http://127.0.0.1:5751, Development stage, so the probe entry shows
pnpm --filter @fnb/zalo-customer build      # vite build (Testing stage, no probe), then the size budgets
pnpm --filter @fnb/zalo-customer test       # Vitest with jsdom
pnpm --filter @fnb/zalo-customer test:e2e   # Playwright on 5752 (plus E2E_PORT_OFFSET)
```

The address options of the stand-in session and the variables of a Zalo build are those of the staff app ([apps/zalo-staff/README.md](../zalo-staff/README.md)); the stand-in member here is a synthetic owner.

## Tests

| Where | What |
|---|---|
| `src/app.test.tsx` | only the session check for the owner, with no bottom navigation; the unpaired instructions; the configuration of the customer app |
| `src/probe/probe.test.tsx` | consent recorded without keeping the token, a refusal with its error code, the outcome on the probe screen, the probe's strings in both languages |
| `src/i18n/catalog.test.ts` | every Vietnamese key has an English message with the same placeholders |
| `e2e/session.spec.ts` | in `phone-light` and `phone-dark` at 360 × 800 px: the owner's session, the unpaired state and a Testing build without the probe, each screen through `checkMiniAppScreen` |
| `e2e/budget.spec.ts` | project `budget`: the paint budget on a throttled phone |

On 2026-11-18: 8 unit tests in 3 files and 7 Playwright tests in 2 files pass. CI's `mini-apps` job also builds a Development version and checks that it carries the probe ([test-plan.md](../../docs/test-plan.md), section 7.1).
