// Test design: performance efficiency testing (ISTQB non-functional) with boundary values on volume.
// A synthetic tenant with 50,000 invoices (and 100,000 lines), 5,000 members and about 200,000 ledger rows is built inside one
// transaction that is rolled back at the end, so nothing is left behind. Each call is timed alone, the cold run first.
// Opt in with PERF_BUDGETS=1 and a local DATABASE_URL (section 5.3 of docs/test-plan.md); normal runs skip it.
// test-gaps G-13, risk PR-10.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { createPostgresClient } from "../../src/postgres/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED =
	process.env.PERF_BUDGETS === "1" &&
	Boolean(DATABASE_URL) &&
	/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DATABASE_URL ?? "");

// Generous budgets in milliseconds; the design targets of test-gaps G-13 are noted beside them.
const BUDGET_MS = {
	reconcile_loyalty: 5_000, // one store-day, target 2 s
	recognise_rail_events: 2_000, // one store-day, target 2 s
	loyalty_members_page_last_page: 1_000, // 100 rows at the last keyset page, target 300 ms
	customer_wallet_typical: 500, // a member with about 40 ledger rows
	customer_wallet_long_ledger: 3_000, // a member with over 2,000 ledger rows; the history is cut at 100
	member_share_by_shift_92_days: 3_000, // the longest range allowed
} as const;

// Written to the error stream too, so the numbers show in the run output even when the reporter hides logs of passing tests.
function report(line: string): void {
	process.stderr.write(`${line}
`);
}

const ROLLBACK = "perf-rollback";
const MEMBERS = 5_000;
const INVOICES = 50_000;

interface Timing {
	name: string;
	runs: number[];
}

function summary(timing: Timing): string {
	const sorted = [...timing.runs].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
	return `${timing.name}: cold ${timing.runs[0]?.toFixed(0)} ms, median ${median.toFixed(0)} ms, max ${Math.max(...timing.runs).toFixed(0)} ms over ${timing.runs.length} run(s)`;
}

async function time(
	name: string,
	runs: number,
	call: () => Promise<unknown>,
): Promise<Timing> {
	const timing: Timing = { name, runs: [] };
	for (let index = 0; index < runs; index += 1) {
		const started = performance.now();
		await call();
		timing.runs.push(performance.now() - started);
	}
	return timing;
}

async function build(tx: Sql): Promise<{
	tenant: string;
	store: string;
	day: string;
	owner: string;
	customerLogin: string;
	customer: string;
	typicalLogin: string;
	typicalCustomer: string;
	ledgerRows: number;
}> {
	const [ids] = await tx<
		{
			t: string;
			s: string;
			own: string;
			login: string;
			login2: string;
			day: string;
		}[]
	>`
		select gen_random_uuid()::text as t, gen_random_uuid()::text as s, gen_random_uuid()::text as own, gen_random_uuid()::text as login, gen_random_uuid()::text as login2,
			to_char(current_date - 1, 'YYYY-MM-DD') as day
	`;
	if (ids === undefined) {
		throw new Error("no ids");
	}
	const slug = `perf-loyalty-${randomUUID().slice(0, 8)}`;
	await tx.unsafe(
		`
		create temp table px on commit drop as
		select '${ids.t}'::uuid t, gen_random_uuid() a, '${ids.s}'::uuid s, gen_random_uuid() prog, gen_random_uuid() b, '${ids.own}'::uuid own, '${ids.login}'::uuid login, '${ids.login2}'::uuid login2, gen_random_uuid() zapp, '${ids.day}'::date last_day;
		insert into auth.users (id, instance_id, aud, role, email)
		select own, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'perf-owner-' || left(own::text, 8) || '@example.com' from px
		union all
		select login, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'perf-customer-' || left(login::text, 8) || '@example.com' from px
		union all
		select login2, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'perf-customer-' || left(login2::text, 8) || '@example.com' from px;
		insert into public.tenants (id, slug, name, country_code) select t, '${slug}', 'Perf loyalty fixture', 'VN' from px;
		insert into public.tenant_members (tenant_id, user_id, role, store_ids) select t, own, 'owner', null from px;
		insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select a, t, 'mock', 'perf-account', 'Synthetic account' from px;
		insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select s, t, a, 'perf-1', 'Synthetic store' from px;
		insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select b, t, 'brand-1', 'Synthetic brand', array[s] from px;
		insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select zapp, t, b, 'synthetic-perf-app', 'ZALO_APP_SECRET_BRAND_1', 'active' from px;
		insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
		select prog, t, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from px;
		create temp table pc on commit drop as select n, gen_random_uuid() cid, gen_random_uuid() mid from generate_series(1, ${MEMBERS}) n;
		insert into public.customers (id, tenant_id, phone, name)
		select cid, (select t from px), '09' || lpad((10000000 + n)::text, 8, '0'), null from pc;
		insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
		select mid, (select t from px), (select prog from px), cid, 'mini_app', now() - make_interval(mins => n), (select b from px) from pc;
		insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
		select (select t from px), (select zapp from px), 'perfuser1', (select login from px), cid from pc where n = 1;
		insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
		select (select t from px), (select zapp from px), 'perfuser2', (select login2 from px), cid from pc where n = 2;
		insert into public.shifts (tenant_id, store_id, external_id, opened_at, closed_at)
		select (select t from px), (select s from px), 'perf-sh-' || (d * 3 + k),
			((select last_day from px) - d)::timestamp at time zone 'Asia/Ho_Chi_Minh' + make_interval(hours => 6 + 5 * k),
			((select last_day from px) - d)::timestamp at time zone 'Asia/Ho_Chi_Minh' + make_interval(hours => 10 + 5 * k)
		from generate_series(0, 91) d cross join generate_series(0, 2) k;
		insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, shift_external_id, customer_phone, customer_id, gross_amount, net_amount, paid_amount, status)
		select (select t from px), (select s from px), (select a from px), 'perf-' || g.n, lpad((g.n % 5000)::text, 6, '0'),
			((select last_day from px) - (g.n % 92))::timestamp at time zone 'Asia/Ho_Chi_Minh' + make_interval(secs => (g.n % 600) * 100 + 21600),
			(select last_day from px) - (g.n % 92), 'perf-sh-' || ((g.n % 92) * 3 + g.n % 3),
			case when g.n % 5 < 2 then c.phone end, case when g.n % 5 < 2 then c.id end, 80000, 80000, 80000, 'completed'
		from generate_series(1, ${INVOICES}) g (n)
		join pc on pc.n = (g.n % ${MEMBERS}) + 1
		join public.customers c on c.id = pc.cid;
		insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, gross_amount, discount_amount, net_amount)
		select tenant_id, store_id, id, 'l' || k, 'item', 'ITEM-' || k, 'ITEM-' || k, 40000, 0, 40000
		from public.invoices cross join generate_series(1, 2) k where tenant_id = (select t from px);
		insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path, occurred_at)
		select i.tenant_id, (select prog from px), m.id, i.store_id, 'earn', 1, 8, i.id, i.business_date, 'A', i.sold_at
		from public.invoices i join public.memberships m on m.customer_id = i.customer_id
		where i.tenant_id = (select t from px) and i.customer_id is not null and i.business_date < (select last_day from px) - 1;
		insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, reason, occurred_at)
		select (select t from px), (select prog from px), pc.mid, 'adjust', 0, 1, 'synthetic volume', now() - make_interval(mins => g.n)
		from generate_series(1, 182000) g (n) join pc on pc.n = (g.n % ${MEMBERS}) + 1;
		insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, reason, occurred_at)
		select (select t from px), (select prog from px), pc.mid, 'adjust', 0, 1, 'synthetic long ledger', now() - make_interval(secs => g.n)
		from generate_series(1, 2000) g (n) join pc on pc.n = 1;
		analyze public.invoices, public.invoice_lines, public.loyalty_ledger, public.memberships, public.customers, public.shifts;
		`,
	);
	const [counts] = await tx<
		{
			ledger: string;
			invoices: string;
			members: string;
			customer: string;
			typical: string;
		}[]
	>`
		select
			(select count(*) from public.loyalty_ledger where tenant_id = ${ids.t}::uuid)::text as ledger,
			(select count(*) from public.invoices where tenant_id = ${ids.t}::uuid)::text as invoices,
			(select count(*) from public.memberships where tenant_id = ${ids.t}::uuid)::text as members,
			(select customer_id::text from app.customer_logins where user_id = ${ids.login}::uuid) as customer,
			(select customer_id::text from app.customer_logins where user_id = ${ids.login2}::uuid) as typical
	`;
	expect(Number(counts?.invoices)).toBe(INVOICES);
	expect(Number(counts?.members)).toBe(MEMBERS);
	expect(Number(counts?.ledger)).toBeGreaterThanOrEqual(200_000);
	return {
		tenant: ids.t,
		store: ids.s,
		day: ids.day,
		owner: ids.own,
		customerLogin: ids.login,
		customer: counts?.customer ?? "",
		typicalLogin: ids.login2,
		typicalCustomer: counts?.typical ?? "",
		ledgerRows: Number(counts?.ledger),
	};
}

describe.skipIf(!ENABLED)(
	"loyalty time budgets on a realistic volume (PERF_BUDGETS=1)",
	() => {
		it("reconciliation, rail recognition, the member page, the wallet and the share by shift stay inside their budgets", async () => {
			const sql = createPostgresClient(DATABASE_URL ?? "", {
				maxConnections: 1,
				applicationName: "perf-loyalty-timings",
			});
			const timings: Timing[] = [];
			const started = performance.now();
			try {
				await sql
					.begin(async (tx) => {
						const fixture = await build(tx as unknown as Sql);
						const built = performance.now() - started;
						report(
							`perf fixture: ${INVOICES} invoices, ${MEMBERS} members, ${fixture.ledgerRows} ledger rows built in ${(built / 1000).toFixed(1)} s`,
						);
						// service-side jobs, one store-day each, cold
						timings.push(
							await time(
								"reconcile_loyalty (1 store-day)",
								1,
								() =>
									tx`select app.reconcile_loyalty(${fixture.tenant}::uuid, ${fixture.day}::date, ${fixture.day}::date, now())`,
							),
						);
						timings.push(
							await time(
								"recognise_rail_events (1 store-day)",
								1,
								() =>
									tx`select app.recognise_rail_events(${fixture.tenant}::uuid, ${fixture.day}::date, ${fixture.day}::date, now())`,
							),
						);
						// reads as the owner
						await tx.unsafe("set local role authenticated");
						await tx.unsafe(
							"select set_config('request.jwt.claims', $1, true)",
							[JSON.stringify({ sub: fixture.owner, role: "authenticated" })],
						);
						let after: string | null = null;
						let lastRows = 0;
						for (let page = 0; page < MEMBERS / 100 - 1; page += 1) {
							const rows: { page_key: string }[] = await tx`
								select page_key from public.loyalty_members_page(null, ${after}, 100, null)
							`;
							after = rows.at(-1)?.page_key ?? null;
							lastRows = rows.length;
						}
						expect(lastRows).toBe(100);
						let finalRows = 0;
						timings.push(
							await time(
								"loyalty_members_page (last keyset page of 100)",
								3,
								async () => {
									const rows = await tx`
									select page_key from public.loyalty_members_page(null, ${after}, 100, null)
								`;
									finalRows = rows.length;
								},
							),
						);
						expect(finalRows).toBe(100);
						timings.push(
							await time("member_share_by_shift (92 days)", 3, async () => {
								const rows = await tx`
									select * from public.member_share_by_shift(array[${fixture.store}::uuid], (${fixture.day}::date - 91), ${fixture.day}::date)
								`;
								expect(rows.length).toBeGreaterThan(200);
							}),
						);
						// the wallet as a customer: a typical member, then the member with the longest ledger
						const wallet = async (
							login: string,
							customer: string,
							name: string,
						) => {
							await tx.unsafe("reset role");
							await tx.unsafe("set local role authenticated");
							await tx.unsafe(
								"select set_config('request.jwt.claims', $1, true)",
								[
									JSON.stringify({
										sub: login,
										role: "authenticated",
										app_metadata: {
											kind: "customer",
											tenant_id: fixture.tenant,
											customer_id: customer,
										},
									}),
								],
							);
							timings.push(
								await time(name, 3, async () => {
									const [row] =
										await tx`select public.customer_wallet() as wallet`;
									expect(row?.wallet).toBeTruthy();
								}),
							);
						};
						await wallet(
							fixture.typicalLogin,
							fixture.typicalCustomer,
							"customer_wallet typical (about 40 ledger rows)",
						);
						await wallet(
							fixture.customerLogin,
							fixture.customer,
							"customer_wallet long ledger (2,000+ rows)",
						);
						await tx.unsafe("reset role");
						throw new Error(ROLLBACK);
					})
					.catch((error: unknown) => {
						if (!(error instanceof Error) || error.message !== ROLLBACK) {
							throw error;
						}
					});
			} finally {
				await sql.end({ timeout: 5 });
			}
			for (const timing of timings) {
				report(`perf ${summary(timing)}`);
			}
			const worst = (name: string) =>
				Math.max(
					...(timings.find((timing) => timing.name.startsWith(name))?.runs ?? [
						Number.POSITIVE_INFINITY,
					]),
				);
			expect(worst("reconcile_loyalty")).toBeLessThan(
				BUDGET_MS.reconcile_loyalty,
			);
			expect(worst("recognise_rail_events")).toBeLessThan(
				BUDGET_MS.recognise_rail_events,
			);
			expect(worst("loyalty_members_page")).toBeLessThan(
				BUDGET_MS.loyalty_members_page_last_page,
			);
			expect(worst("customer_wallet typical")).toBeLessThan(
				BUDGET_MS.customer_wallet_typical,
			);
			expect(worst("customer_wallet long")).toBeLessThan(
				BUDGET_MS.customer_wallet_long_ledger,
			);
			expect(worst("member_share_by_shift")).toBeLessThan(
				BUDGET_MS.member_share_by_shift_92_days,
			);
		}, 600_000);
	},
);
