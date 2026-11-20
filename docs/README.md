# Documentation index

Every public document of the repository, grouped by the reader who needs it, with one line on the question it answers. A document can appear for more than one reader. `node scripts/check-doc-links.mjs` keeps this index complete: a document under `docs/` that is not linked here fails `pnpm verify` and CI's `code` job, and so does a relative link or `#anchor` that does not resolve. Material that names a real shop, a member or a figure lives in `docs/private/`, which is kept on the owner's machines and never committed.

## Start here

| Document | What it answers |
|---|---|
| [status.md](status.md) | What is built and verified, what comes next, and how to continue on another machine |
| [roadmap.md](roadmap.md) | The programme: tracks, phases, deliverables, acceptance criteria and gates |
| [plan.md](plan.md) | How the work is delivered: steps, order, milestones, risks, change control and the open correction requests |
| [glossary.md](glossary.md) | What the Vietnamese interface terms, the domain terms and the technical terms mean |

## Owner

| Document | What it answers |
|---|---|
| [user-guide.md](user-guide.md) | What each screen shows and how to read it, with screenshots from the demo |
| [requirements.md](requirements.md) | What the platform must do, with stable IDs, priorities, statuses and the owner's open actions and questions |
| [decisions.md](decisions.md) | Why the system is built the way it is (the architecture decision records) |
| [go-live.md](go-live.md) | The first cloud deployment, step by step |
| [secrets.md](secrets.md) | Every credential and variable, where it lives and who holds it |
| [manual-data.md](manual-data.md) | What the owner types in because the POS does not know it: item costs, monthly targets and payment fees |
| [strategy.md](strategy.md) | The AI data pack and the plan format the owner's own assistant works with |
| [metrics.md](metrics.md) | The definition of every metric the reports, exports, data pack and digests use |
| [reports/ngay.md](reports/ngay.md) | The daily report Ngày, card by card |
| [reports/tuan.md](reports/tuan.md) | The weekly report Tuần |
| [reports/thang.md](reports/thang.md) | The monthly report Tháng |
| [reports/nam.md](reports/nam.md) | The yearly report Năm |
| [reports/doanh-thu.md](reports/doanh-thu.md) | The thematic report Doanh thu & xu hướng (revenue and its trend) and the shared range rules |
| [reports/gio-ngay.md](reports/gio-ngay.md) | The thematic report Giờ & ngày trong tuần (hours and weekdays) |
| [reports/thuc-don.md](reports/thuc-don.md) | The thematic report Thực đơn (menu) |
| [reports/thanh-toan.md](reports/thanh-toan.md) | The thematic report Thanh toán & tiền mặt (payments and cash) |
| [reports/khuyen-mai.md](reports/khuyen-mai.md) | The thematic report Khuyến mãi & giảm giá (promotions and discounts) |
| [reports/ca-ket-tien.md](reports/ca-ket-tien.md) | The thematic report Ca & két tiền (shifts and the cash drawer) |
| [reports/chat-luong.md](reports/chat-luong.md) | The thematic report Chất lượng dữ liệu (data quality) |
| [reports/so-sanh.md](reports/so-sanh.md) | The thematic report So sánh cửa hàng (store comparison) |
| [reports/cau-van-bao-cao.md](reports/cau-van-bao-cao.md) | The owner's review sheet of every sentence of the periodic reports |
| [reports/cau-van-chu-de.md](reports/cau-van-chu-de.md) | The owner's review sheet of the sentences of the thematic reports and the settings |
| [loyalty/cashier-script.md](loyalty/cashier-script.md) | What a cashier says at the till to attach a customer to the bill |
| [loyalty/sop-them-khach-hang.md](loyalty/sop-them-khach-hang.md) | The one-page till procedure «Thêm khách hàng» |
| [loyalty/receipt-template.md](loyalty/receipt-template.md) | How to set up the POS receipt template so a customer can be identified from the receipt |
| [loyalty/zbs-templates.md](loyalty/zbs-templates.md) | The customer message template drafts and what the owner submits with them |
| [loyalty/join-standee-benchmark.md](loyalty/join-standee-benchmark.md) | What a counter standee for joining the loyalty programme should say, from a benchmark |
| [deep-dives/vietnam-legal-requirements.md](deep-dives/vietnam-legal-requirements.md) | The Vietnamese legal rules that apply: invoices, promotions, personal data, messaging |

## Developer

| Document | What it answers |
|---|---|
| [development.md](development.md) | How to set up a machine, run every check, change the code and the database safely, and hand the work on |
| [architecture.md](architecture.md) | How the system is built: context, containers, packages, data shape, flows and where it runs |
| [schema.md](schema.md) | Every table, column, function and grant of the database |
| [api.md](api.md) | How a client calls the database: sign-in, roles, every public function and its error codes |
| [sync.md](sync.md) | The sync engine and the `fnb` command line |
| [connectors.md](connectors.md) | How a POS connector maps a point-of-sale system to the canonical model |
| [connectors/ipos-fabi.md](connectors/ipos-fabi.md) | The iPOS Fabi connector: the read endpoints it uses and how it maps them |
| [web-app.md](web-app.md) | The web app: routes, the demo mode, data access and the build checks |
| [settings.md](settings.md) | How the settings pages read and write their data, with their errors and audit lines |
| [exports.md](exports.md) | The data exports and how each exported file is proven equal to the database |
| [design-system.md](design-system.md) | The design tokens, components and accessibility rules of the interfaces |
| [security.md](security.md) | The data held, the threats to each surface, the controls and the open security items |
| [deep-dives/fnb-kpi-standards.md](deep-dives/fnb-kpi-standards.md) | The formulas and analysis methods of café and tea-shop KPIs |
| [deep-dives/supabase-platform.md](deep-dives/supabase-platform.md) | What the Supabase plans give, their limits and the multi-tenant security model |
| [deep-dives/github-pages-and-actions.md](deep-dives/github-pages-and-actions.md) | What GitHub Pages and GitHub Actions offer as the hosting and compute layer |
| [deep-dives/ipos-ecosystem-and-crm.md](deep-dives/ipos-ecosystem-and-crm.md) | The iPOS products around Fabi: CRM, vouchers, channels and partner feeds |
| [deep-dives/ipos-loyalty-integration-design.md](deep-dives/ipos-loyalty-integration-design.md) | How loyalty points and coupons connect to real POS purchases |
| [deep-dives/bill-verification-plan.md](deep-dives/bill-verification-plan.md) | Plan: reading the paper bill without the POS so staff-mode earning is accurate and cashier-proof |
| [deep-dives/ipos-qr-reward-research.md](deep-dives/ipos-qr-reward-research.md) | Whether the till can accept a reward QR code from the Zalo app |
| [deep-dives/loyalty-programme-design.md](deep-dives/loyalty-programme-design.md) | The loyalty programme design for tea and coffee shops on Zalo |
| [deep-dives/zalo-chain-loyalty-benchmark.md](deep-dives/zalo-chain-loyalty-benchmark.md) | How Vietnamese chains identify loyalty members at the till |
| [deep-dives/staff-app-on-zalo.md](deep-dives/staff-app-on-zalo.md) | What the internal staff Mini App may do on Zalo |
| [deep-dives/zalo-integration-architecture.md](deep-dives/zalo-integration-architecture.md) | How the two Mini Apps, the Official Account and the backend fit together |
| [deep-dives/zalo-mini-app-platform.md](deep-dives/zalo-mini-app-platform.md) | The Zalo Mini App platform: SDK, permissions, review and limits |
| [deep-dives/zalo-oa-and-messaging.md](deep-dives/zalo-oa-and-messaging.md) | The Zalo Official Account and its messaging rules |
| [deep-dives/zalo-design-and-review-standards.md](deep-dives/zalo-design-and-review-standards.md) | Zalo's Mini App design, review and Official Account content rules |

Each workspace package and app has its README: what it holds, what it exports and how to test it.

| README | What it answers |
|---|---|
| [README.md](../README.md) | The repository's layout, local development and the `fnb` command line |
| [apps/jobs](../apps/jobs/README.md) | The `fnb` command line: its commands, settings and test switches |
| [apps/web](../apps/web/README.md) | The web app's scripts, build checks and end-to-end projects |
| [apps/zalo-staff](../apps/zalo-staff/README.md) | The staff Mini App: build per brand, screens and browser checks |
| [apps/zalo-customer](../apps/zalo-customer/README.md) | The customer Mini App: build per brand, screens and browser checks |
| [packages/core](../packages/core/README.md) | The canonical data model and the shared business rules |
| [packages/connector-core](../packages/connector-core/README.md) | The connector contract, its registry and the conformance suite |
| [packages/connector-mock](../packages/connector-mock/README.md) | The seeded synthetic connector used by tests and the demo |
| [packages/connector-ipos](../packages/connector-ipos/README.md) | The iPOS Fabi client and its adapter |
| [packages/sync](../packages/sync/README.md) | The POS-agnostic sync engine |
| [packages/runner](../packages/runner/README.md) | What the command line and the Edge Function share around the sync engine |
| [packages/metrics](../packages/metrics/README.md) | The typed metric registry |
| [packages/reports](../packages/reports/README.md) | The periodic report models and the report function contract |
| [packages/datapack](../packages/datapack/README.md) | The AI data pack and the plan format |
| [packages/demo-analytics](../packages/demo-analytics/README.md) | The demo's analytics engine and its parity suite |
| [packages/design-tokens](../packages/design-tokens/README.md) | The colour and font tokens of every interface |
| [packages/zalo-mini](../packages/zalo-mini/README.md) | What the two Mini Apps share |

## Tester

| Document | What it answers |
|---|---|
| [test-plan.md](test-plan.md) | The master test plan: risks, levels, environments, commands, the CI pipeline, inventories and traceability |
| [test-gaps.md](test-gaps.md) | The working list of tests that are missing or weak, with their owners and next steps |
| [requirements.md](requirements.md) | Each requirement's acceptance criterion and the tests that verify it |
| [api.md](api.md) | The functions and error codes the database tests exercise |
| [security.md](security.md) | The security controls the security test pack proves |

## Operator

| Document | What it answers |
|---|---|
| [operations.md](operations.md) | The runbook: environments, schedules, health checks, incidents, backups and legal watch |
| [go-live.md](go-live.md) | The first cloud deployment |
| [secrets.md](secrets.md) | Where each secret lives, how it is set and how it is rotated |
| [sync.md](sync.md) | The nightly and incremental sync, its exit codes and the notifier |
| [notifications.md](notifications.md) | The daily digest and the operational alerts: destinations, policies, rules, dispatch paths and what to do when one fails |
| [status.md](status.md) | The state of every phase and the owner actions still open |
