import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPostgresClient, isLocalDatabaseUrl } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	evaluate,
	type LoyaltyFieldsInput,
	renderReport,
} from "../../src/live/loyalty-fields.js";
import {
	readLoyaltyFields,
	readLoyaltyFieldsReadOnly,
} from "../../src/live/loyalty-fields-queries.js";

// G-11 on the local stack: the read-only loyalty fields check against the real
// SQL. ISTQB: component integration (the reader's SQL on the real schema) and
// system testing of the script (a child process on the local database), with
// security testing (no identifier in the output). The fixture is written inside
// one transaction that is always rolled back, so nothing stays behind and a
// concurrent pgTAP run never sees it. The tests make no POS or Zalo call.

const DATABASE_URL = process.env.DATABASE_URL;
const LOCAL = DATABASE_URL !== undefined && isLocalDatabaseUrl(DATABASE_URL);
const SCRIPT = fileURLToPath(
	new URL("../../bin/loyalty-fields.mjs", import.meta.url),
);

const PHONE_SHAPE = /0\d{9}/;
const UUID_SHAPE =
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FIXED_LABELS =
	/^(loyalty-fields|store-\d+|entry-\d+|pos_payment_discount|crm_code_pool|crm_callback|none|other|pass|fail|stale_entry|no_store_in_scope)$/;

class Rollback extends Error {}

const SUFFIX = randomBytes(4).toString("hex");
const SLUG = `lf-it-${SUFFIX}`;
const BRAND = `Synthetic Brand ${SUFFIX}`;
const DISCOUNT = `Synthetic Free Drink ${SUFFIX}`;
const PHONES = [1, 2, 3, 4].map((n) => `0900000${String(100 + n)}`);
const VOUCHER = `SYNTHV${SUFFIX.toUpperCase()}`;

function synthetic(letter: string): string {
	return `${letter.repeat(8)}-${letter.repeat(4)}-4${letter.repeat(3)}-8${letter.repeat(3)}-${randomBytes(6).toString("hex")}`;
}

interface Fixture {
	readonly sensitive: readonly string[];
}

interface InvoiceSpec {
	readonly store: string;
	readonly external: string;
	readonly daysAgo: number;
	readonly receipt: string | null;
	readonly phone?: string | undefined;
	readonly customer?: string | undefined;
	readonly voucher?: string | undefined;
	readonly discount?: string | undefined;
	readonly status?: "completed" | "voided";
	readonly promoLine?: boolean;
}

async function build(tx: Sql, boundaryDays: number): Promise<Fixture> {
	const tenant = synthetic("d");
	const account = synthetic("c");
	const stores = {
		a: synthetic("a"),
		b: synthetic("b"),
		c: synthetic("c"),
		d: synthetic("d"),
	};
	const customer = synthetic("e");
	const names = {
		a: `Synthetic Store Alpha ${SUFFIX}`,
		b: `Synthetic Store Beta ${SUFFIX}`,
		c: `Synthetic Store Gamma ${SUFFIX}`,
		d: `Synthetic Store Delta ${SUFFIX}`,
	};
	await tx`
		insert into public.tenants (id, slug, name, country_code)
		values (${tenant}, ${SLUG}, ${BRAND}, 'VN')
	`;
	await tx`
		insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
		values (${account}, ${tenant}, 'mock', ${`lf-${SUFFIX}`}, 'Synthetic account')
	`;
	for (const key of ["a", "b", "c", "d"] as const) {
		await tx`
			insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
			values (${stores[key]}, ${tenant}, ${account}, ${`lf-${key}-${SUFFIX}`}, ${names[key]})
		`;
	}
	const rails = [
		["a", "pos_payment_discount"],
		["b", "pos_payment_discount"],
		["c", "crm_code_pool"],
	] as const;
	for (const [key, rail] of rails) {
		await tx`
			insert into public.coupon_rails (tenant_id, store_id, rail, active_from)
			values (${tenant}, ${stores[key]}, ${rail}::public.coupon_rail, now() - interval '40 days')
		`;
		await tx`
			insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, pos_discount_name, einvoice_display)
			values (${tenant}, ${stores[key]}, 'free-drink', ${DISCOUNT}, 'discount')
		`;
	}
	await tx`
		insert into public.customers (id, tenant_id, phone, name)
		values (${customer}, ${tenant}, ${PHONES[3] ?? ""}, ${`Synthetic Customer ${SUFFIX}`})
	`;

	async function invoice(spec: InvoiceSpec): Promise<void> {
		const [row] = await tx<{ id: string }[]>`
			insert into public.invoices (
				tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date,
				customer_phone, customer_id, voucher_code, bill_discount_name, bill_discount_amount, status
			)
			values (
				${tenant}, ${stores[spec.store as keyof typeof stores]}, ${account}, ${spec.external}, ${spec.receipt},
				now() - make_interval(days => ${spec.daysAgo}::int), current_date - ${spec.daysAgo}::int,
				${spec.phone ?? null}, ${spec.customer ?? null}, ${spec.voucher ?? null},
				${spec.discount ?? null}, ${spec.discount ? 1000 : 0}, ${spec.status ?? "completed"}::public.invoice_status
			)
			returning id
		`;
		if (spec.promoLine) {
			await tx`
				insert into public.invoice_lines (
					tenant_id, store_id, invoice_id, external_id, line_kind, item_name, gross_amount,
					discount_amount, net_amount, promotion_external_id
				)
				values (
					${tenant}, ${stores[spec.store as keyof typeof stores]}, ${row?.id ?? ""}, 'l1', 'item', 'Synthetic item',
					30000, 30000, 0, 'PROMO-1'
				)
			`;
		}
	}

	// Store alpha: the window's edges (29 days in, 30 days out), a voided bill,
	// a mapped entry 13 days ago written in another case with stray blanks.
	await invoice({
		store: "a",
		external: "a1",
		daysAgo: 0,
		receipt: "R-1",
		phone: PHONES[0],
		voucher: VOUCHER,
		promoLine: true,
	});
	await invoice({
		store: "a",
		external: "a2",
		daysAgo: 13,
		receipt: "R-2",
		discount: `  ${DISCOUNT.toUpperCase()} `,
	});
	await invoice({
		store: "a",
		external: "a3",
		daysAgo: 29,
		receipt: "R-3",
		customer,
	});
	await invoice({
		store: "a",
		external: "a4",
		daysAgo: 30,
		receipt: "R-4",
		phone: PHONES[1],
	});
	await invoice({
		store: "a",
		external: "a5",
		daysAgo: 0,
		receipt: "R-5",
		phone: PHONES[2],
		status: "voided",
	});
	// Store beta: its mapped entry last appeared `boundaryDays` ago.
	await invoice({
		store: "b",
		external: "b1",
		daysAgo: boundaryDays,
		receipt: "R-1",
		discount: DISCOUNT,
	});
	// Store gamma: a code rail; the same entry never appeared and may not fail.
	await invoice({ store: "c", external: "c1", daysAgo: 0, receipt: "R-1" });
	// Store delta: no rail; one repeated receipt number on one day, one missing.
	await invoice({ store: "d", external: "d1", daysAgo: 1, receipt: "R-9" });
	await invoice({ store: "d", external: "d2", daysAgo: 1, receipt: "R-9" });
	await invoice({ store: "d", external: "d3", daysAgo: 1, receipt: null });
	await invoice({ store: "d", external: "d4", daysAgo: 2, receipt: "R-9" });

	return {
		sensitive: [
			BRAND,
			SLUG,
			DISCOUNT,
			VOUCHER,
			tenant,
			account,
			customer,
			`lf-${SUFFIX}`,
			...Object.values(stores),
			...Object.values(names),
			...(["a", "b", "c", "d"] as const).map((key) => `lf-${key}-${SUFFIX}`),
			...PHONES,
			`Synthetic Customer ${SUFFIX}`,
		],
	};
}

async function inFixture<T>(
	sql: Sql,
	boundaryDays: number,
	readOnly: boolean,
	work: (tx: Sql, fixture: Fixture) => Promise<T>,
): Promise<T> {
	let result: T | undefined;
	try {
		await sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			const fixture = await build(tx, boundaryDays);
			if (readOnly) {
				await tx`set transaction read only`;
			}
			result = await work(tx, fixture);
			throw new Rollback();
		});
	} catch (error) {
		if (!(error instanceof Rollback)) {
			throw error;
		}
	}
	return result as T;
}

function leaks(text: string, sensitive: readonly string[]): boolean {
	const lower = text.toLowerCase();
	return sensitive.some((value) => lower.includes(value.toLowerCase()));
}

describe.skipIf(!LOCAL)(
	"the loyalty fields check against the local database",
	() => {
		let sql: Sql;

		beforeAll(() => {
			sql = createPostgresClient(DATABASE_URL ?? "", {
				maxConnections: 2,
				applicationName: "it-loyalty-fields",
			});
		});

		afterAll(async () => {
			await sql.end({ timeout: 5 });
		});

		async function evaluateFixture(boundaryDays: number) {
			return inFixture(sql, boundaryDays, true, async (tx, fixture) => {
				const input: LoyaltyFieldsInput = await readLoyaltyFields(tx, {
					tenantSlug: SLUG,
				});
				const evaluation = evaluate(input);
				return {
					input,
					evaluation,
					lines: renderReport(evaluation),
					fixture,
				};
			});
		}

		it("counts each field per store over the last 30 business days (system test on a synthetic tenant)", async () => {
			const { evaluation } = await evaluateFixture(14);
			expect(evaluation.stores.map((line) => line.store)).toEqual([
				"store-1",
				"store-2",
				"store-3",
				"store-4",
			]);
			const [alpha, beta, gamma, delta] = evaluation.stores;
			// Day 29 is in, day 30 is out; the voided bill is counted apart.
			expect(alpha).toMatchObject({
				rail: "pos_payment_discount",
				invoices: 3,
				voided: 1,
				with_phone: 1,
				with_phone_pct: 33.3,
				with_customer_id: 1,
				with_voucher_code: 1,
				with_discount_entry: 1,
				with_zero_price_line: 1,
				receipt_missing: 0,
				receipt_duplicate_groups: 0,
				receipt_numbers_unique: true,
				rail_entries: 1,
				stale_entries: 0,
			});
			expect(beta).toMatchObject({
				invoices: 1,
				with_discount_entry: 1,
				with_phone: 0,
				stale_entries: 1,
			});
			expect(gamma).toMatchObject({
				rail: "crm_code_pool",
				invoices: 1,
				with_discount_entry: 0,
				rail_entries: 0,
			});
			expect(delta).toMatchObject({
				rail: "none",
				invoices: 4,
				receipt_missing: 1,
				receipt_duplicate_groups: 1,
				receipt_numbers_unique: false,
			});
		});

		it("a mapped entry last seen 14 days ago fails the check, 13 days ago passes it (boundary value analysis in SQL)", async () => {
			const at14 = await evaluateFixture(14);
			expect(at14.evaluation.pass).toBe(false);
			expect(at14.evaluation.reason).toBe("stale_entry");
			expect(at14.evaluation.entries).toEqual([
				{
					store: "store-1",
					entry: "entry-1",
					quiet_days: 13,
					seen_in_window: true,
					stale: false,
				},
				{
					store: "store-2",
					entry: "entry-1",
					quiet_days: 14,
					seen_in_window: true,
					stale: true,
				},
			]);
			const at13 = await evaluateFixture(13);
			expect(at13.evaluation.pass).toBe(true);
			expect(at13.evaluation.entries.map((line) => line.quiet_days)).toEqual([
				13, 13,
			]);
			// Only the discount rail's stores are judged: the code rail store
			// has the same entry and never saw it.
			expect(at13.evaluation.entries.map((line) => line.store)).toEqual([
				"store-1",
				"store-2",
			]);
		});

		it("prints no phone, customer id, voucher code, discount name, store or brand name (security test)", async () => {
			const { lines, fixture } = await evaluateFixture(14);
			const text = lines.join("\n");
			expect(PHONE_SHAPE.test(text)).toBe(false);
			expect(UUID_SHAPE.test(text)).toBe(false);
			expect(leaks(text, fixture.sensitive)).toBe(false);
			for (const line of lines) {
				for (const value of Object.values(
					JSON.parse(line) as Record<string, unknown>,
				)) {
					if (typeof value === "string") {
						expect(FIXED_LABELS.test(value)).toBe(true);
					}
				}
			}
		});

		it("refuses to read outside a read-only transaction (negative case)", async () => {
			await expect(
				inFixture(sql, 14, false, (tx) =>
					readLoyaltyFields(tx, { tenantSlug: SLUG }),
				),
			).rejects.toThrow(/read-only transaction/);
		});

		it("a tenant slug that matches nothing is an empty scope that fails with its own reason (negative case)", async () => {
			const input = await readLoyaltyFieldsReadOnly(sql, {
				tenantSlug: `no-such-${SUFFIX}`,
			});
			expect(input.stores).toEqual([]);
			expect(evaluate(input).reason).toBe("no_store_in_scope");
		});

		it("the script refuses to run without DATABASE_URL and prints nothing to stdout (negative case)", () => {
			const environment = { ...process.env };
			environment.DATABASE_URL = "";
			environment.LIVE_TENANT = "";
			const run = spawnSync(process.execPath, [SCRIPT], {
				env: environment,
				encoding: "utf8",
				timeout: 60_000,
			});
			expect(run.status).toBe(2);
			expect(run.stdout).toBe("");
			expect(run.stderr).toMatch(/DATABASE_URL is not set/);
		});

		it("the script runs on the whole local database, changes nothing and prints no identifier of it (system and security test)", async () => {
			const tables = [
				"tenants",
				"stores",
				"invoices",
				"invoice_lines",
				"coupon_rails",
				"coupon_rail_rewards",
			];
			const count = async () => {
				const counts: number[] = [];
				for (const table of tables) {
					const [row] = await sql.unsafe<{ n: number }[]>(
						`select count(*)::int as n from public.${table}`,
					);
					counts.push(row?.n ?? -1);
				}
				return counts;
			};
			const before = await count();
			const identifiers = await sql<{ value: string }[]>`
				select distinct value from (
					select customer_phone as value from public.invoices
					union select voucher_code from public.invoices
					union select voucher_name from public.invoices
					union select bill_discount_name from public.invoices
					union select customer_name from public.invoices
					union select receipt_no from public.invoices
					union select customer_id::text from public.invoices
					union select external_id from public.invoices
					union select phone from public.customers
					union select name from public.customers
					union select slug from public.tenants
					union select name from public.tenants
					union select id::text from public.tenants
					union select name from public.stores
					union select code from public.stores
					union select external_id from public.stores
					union select address from public.stores
					union select id::text from public.stores
					union select display_name from public.pos_accounts
					union select account_key from public.pos_accounts
					union select pos_discount_name from public.coupon_rail_rewards
					union select pos_free_item_external_id from public.coupon_rail_rewards
				) found
				where value is not null and char_length(value) >= 6
			`;
			const environment = { ...process.env };
			environment.DATABASE_URL = DATABASE_URL ?? "";
			delete environment.LIVE_TENANT;
			const run = spawnSync(process.execPath, [SCRIPT], {
				env: environment,
				encoding: "utf8",
				timeout: 120_000,
			});
			const after = await count();

			expect([0, 1]).toContain(run.status);
			const lines = run.stdout.split("\n").filter((line) => line !== "");
			expect(lines.length).toBeGreaterThan(2);
			const objects = lines.map(
				(line) => JSON.parse(line) as Record<string, unknown>,
			);
			expect(objects.every((object) => object.check === "loyalty-fields")).toBe(
				true,
			);
			expect(objects.at(-1)).toHaveProperty("result");
			expect(objects.filter((object) => "with_phone" in object).length).toBe(
				objects[0]?.stores,
			);
			// Nothing but counts, booleans and fixed labels.
			for (const object of objects) {
				for (const value of Object.values(object)) {
					if (typeof value === "string") {
						expect(FIXED_LABELS.test(value)).toBe(true);
					} else {
						expect(["number", "boolean"]).toContain(typeof value);
					}
				}
			}
			const output = `${run.stdout}\n${run.stderr}`;
			expect(PHONE_SHAPE.test(output)).toBe(false);
			expect(UUID_SHAPE.test(output)).toBe(false);
			expect(
				leaks(
					output,
					identifiers
						.map((row) => row.value)
						.filter((value) => !FIXED_LABELS.test(value)),
				),
			).toBe(false);
			expect(after).toEqual(before);
		});
	},
);
