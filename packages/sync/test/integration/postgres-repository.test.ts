import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SyncEngine, storeWindowLockKey } from "../../src/index.js";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "../../src/postgres/index.js";
import { createFakeConnector } from "../support/fake-connector.js";
import { itemLine, sale, totalsFor } from "../support/sales.js";

const DATABASE_URL = process.env.DATABASE_URL;
const WINDOW = { fromDate: "2026-11-01", toDate: "2026-11-02" };

async function scenario(): Promise<void> {
	const sql = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 2 });
	const slug = `it-repo-${randomUUID().slice(0, 8)}`;
	try {
		const [tenant] = await sql<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, 'Repository test') returning id
		`;
		if (!tenant) {
			throw new Error("tenant insert failed");
		}
		const repository = new PostgresSyncRepository(sql);
		const account = await repository.upsertAccount({
			tenant_id: tenant.id,
			connector: "fake",
			account_key: "repo-test",
			display_name: "Repository test",
		});
		const sales = [
			sale("T-1", "2026-11-01T02:00:00.000Z", "2026-11-01", {
				customerPhone: "0900000000",
				voucherCode: "VC-1",
				voucherAmount: 5_000,
				netAmount: 40_000,
				grossAmount: 45_000,
				paidAmount: 40_000,
			}),
			sale("T-2", "2026-11-01T03:00:00.000Z", "2026-11-01", {
				netAmount: 60_000,
			}),
			sale("T-3", "2026-11-02T04:00:00.000Z", "2026-11-02"),
		];
		const connector = createFakeConnector({
			stores: [
				{
					externalId: "STORE-1",
					name: "Cửa hàng",
					timezone: "Asia/Ho_Chi_Minh",
					dayStartMinutes: 0,
					currency: "VND",
				},
			],
			sales,
			totals: totalsFor(sales),
			adjustments: [
				{
					kind: "line_removed",
					saleExternalId: "T-3",
					lineExternalId: "X",
					quantity: 1,
					occurredAt: new Date("2026-11-02T04:10:00.000Z"),
					amount: 10_000,
					raw: { removed: true },
				},
			],
		});
		const engine = new SyncEngine({
			repository,
			connector,
			calls: { sleep: async () => undefined },
		});
		await engine.syncMasterData(account);
		const stores = await repository.listStores(account.id);
		expect(stores.map((store) => store.external_id)).toEqual(["STORE-1"]);
		const first = await engine.syncWindow(account, stores, WINDOW, "backfill");
		expect(first.checks).toEqual({ available: true, matched: 2, unmatched: 0 });
		const second = await engine.syncWindow(account, stores, WINDOW, "nightly");
		expect(Object.values(second.tables).every((count) => count === 0)).toBe(
			true,
		);

		connector.data.sales = [
			sale("T-1", "2026-11-01T02:00:00.000Z", "2026-11-01", {
				customerPhone: "0900000000",
				voucherCode: "VC-1",
				voucherAmount: 5_000,
				grossAmount: 90_000,
				netAmount: 85_000,
				paidAmount: 85_000,
				raw: { id: "T-1", revision: 2 },
				lines: [
					itemLine("T-1-L1", {
						quantity: 2,
						grossAmount: 90_000,
						netAmount: 90_000,
					}),
				],
			}),
			sales[2],
		].filter((entry) => entry !== undefined);
		connector.data.totals = totalsFor(connector.data.sales);
		const third = await engine.syncWindow(account, stores, WINDOW, "nightly");
		expect(third.stores[0]).toMatchObject({ updated: 1, edited: 1, voided: 1 });
		expect(third.checks.unmatched).toBe(0);

		const invoices = await sql<
			{
				external_id: string;
				status: string;
				net_amount: string;
				customer_phone: string | null;
				voucher_code: string | null;
			}[]
		>`
			select external_id, status::text as status, net_amount::text as net_amount, customer_phone, voucher_code
			from public.invoices where tenant_id = ${tenant.id} order by external_id
		`;
		expect(invoices).toEqual([
			{
				external_id: "T-1",
				status: "edited",
				net_amount: "85000.00",
				customer_phone: "0900000000",
				voucher_code: "VC-1",
			},
			{
				external_id: "T-2",
				status: "voided",
				net_amount: "60000.00",
				customer_phone: null,
				voucher_code: null,
			},
			{
				external_id: "T-3",
				status: "edited",
				net_amount: "45000.00",
				customer_phone: null,
				voucher_code: null,
			},
		]);
		const events = await sql<
			{
				invoice_external_id: string;
				kind: string;
				source: string;
				amount: string;
				linked: boolean;
			}[]
		>`
			select invoice_external_id, kind::text as kind, source, amount::text as amount, invoice_id is not null as linked
			from public.invoice_events where tenant_id = ${tenant.id} order by invoice_external_id, kind
		`;
		expect(events).toEqual([
			{
				invoice_external_id: "T-1",
				kind: "edited",
				source: "resync_diff",
				amount: "45000.00",
				linked: true,
			},
			{
				invoice_external_id: "T-2",
				kind: "voided",
				source: "resync_diff",
				amount: "60000.00",
				linked: true,
			},
			{
				invoice_external_id: "T-3",
				kind: "line_removed",
				source: "pos_report",
				amount: "10000.00",
				linked: true,
			},
		]);
		const lines = await sql<{ quantity: string }[]>`
			select l.quantity::text as quantity from public.invoice_lines l
			join public.invoices i on i.id = l.invoice_id
			where i.tenant_id = ${tenant.id} and i.external_id = 'T-1'
		`;
		expect(lines).toEqual([{ quantity: "2.000" }]);
		const records = await sql<
			{ business_date: string; external_id: string; record: unknown }[]
		>`
			select p.business_date::text as business_date, entry::jsonb ->> 'external_id' as external_id, entry::jsonb as record
			from public.sale_payloads p
			cross join lateral string_to_table(p.payload, E'\n') as entry
			where p.tenant_id = ${tenant.id}
			order by 1, 2
		`;
		expect(records.map((row) => [row.business_date, row.external_id])).toEqual([
			["2026-11-01", "T-1"],
			["2026-11-01", "T-2"],
			["2026-11-02", "T-3"],
		]);
		expect(records[0]?.record).toEqual({
			external_id: "T-1",
			invoice: { id: "T-1", revision: 2 },
			lines: { "T-1-L1": { line: "T-1-L1" } },
			payments: { "1": null },
		});
		expect(records[1]?.record).toMatchObject({ invoice: { id: "T-2" } });
		const [rowPayloads] = await sql<{ count: number }[]>`
			select ((select count(*) from public.invoices where tenant_id = ${tenant.id} and raw is not null)
				+ (select count(*) from public.invoice_lines where tenant_id = ${tenant.id} and raw is not null)
				+ (select count(*) from public.invoice_payments where tenant_id = ${tenant.id} and raw is not null))::int as count
		`;
		expect(rowPayloads?.count).toBe(0);
		const fourth = await engine.syncWindow(account, stores, WINDOW, "nightly");
		expect(Object.values(fourth.tables).every((count) => count === 0)).toBe(
			true,
		);
		const runs = await sql<{ status: string }[]>`
			select status::text as status from public.sync_runs where tenant_id = ${tenant.id}
		`;
		expect(runs.every((run) => run.status === "succeeded")).toBe(true);
		const [token] = await sql<{ count: number }[]>`
			select count(*)::int as count from public.pos_account_tokens where pos_account_id = ${account.id}
		`;
		expect(token?.count).toBe(0);
		await repository.writeToken(account.id, {
			token: "token-value",
			expires_at: "2026-12-01T00:00:00.000Z",
		});
		expect(await repository.readToken(account.id)).toEqual({
			token: "token-value",
			expires_at: "2026-12-01T00:00:00.000Z",
		});
	} finally {
		await sql`delete from public.tenants where slug = ${slug}`;
		await sql.end({ timeout: 5 });
	}
}

async function overlapScenario(): Promise<void> {
	const admin = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 2 });
	const first = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 2 });
	const second = createPostgresClient(DATABASE_URL ?? "", {
		maxConnections: 2,
	});
	const slug = `it-overlap-${randomUUID().slice(0, 8)}`;
	try {
		const [tenant] = await admin<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, 'Overlap test') returning id
		`;
		if (!tenant) {
			throw new Error("tenant insert failed");
		}
		const repository = new PostgresSyncRepository(first);
		const account = await repository.upsertAccount({
			tenant_id: tenant.id,
			connector: "fake",
			account_key: "overlap-test",
			display_name: "Overlap test",
		});
		const sales = [
			sale("A", "2026-11-01T02:00:00.000Z", "2026-11-01", {
				customerName: "a\u0000b",
				raw: { "n\u0000ote": "x\u0000y" },
			}),
			sale("B", "2026-11-01T03:00:00.000Z", "2026-11-01"),
			sale("C", "2026-11-01T04:00:00.000Z", "2026-11-01"),
		];
		const connector = createFakeConnector({
			stores: [
				{
					externalId: "STORE-1",
					name: "Cửa hàng",
					timezone: "Asia/Ho_Chi_Minh",
					dayStartMinutes: 0,
					currency: "VND",
				},
			],
			sales,
			totals: totalsFor(sales),
		});
		const engineOn = (repositoryFor: PostgresSyncRepository, offset: number) =>
			new SyncEngine({
				repository: repositoryFor,
				connector,
				now: () => new Date(Date.UTC(2026, 10, 5, 3, 0, offset)),
				calls: { sleep: async () => undefined },
			});
		await engineOn(repository, 0).syncMasterData(account);
		const stores = await repository.listStores(account.id);
		await engineOn(repository, 0).syncWindow(
			account,
			stores,
			WINDOW,
			"backfill",
		);
		const [stored] = await admin<{ customer_name: string; raw: unknown }[]>`
			select customer_name, raw from public.invoices
			where tenant_id = ${tenant.id} and external_id = 'A'
		`;
		expect(stored).toMatchObject({ customer_name: "ab", raw: null });
		const [storedPayload] = await admin<{ record: unknown }[]>`
			select entry::jsonb as record
			from public.sale_payloads p
			cross join lateral string_to_table(p.payload, E'\n') as entry
			where p.tenant_id = ${tenant.id} and entry::jsonb ->> 'external_id' = 'A'
		`;
		expect(storedPayload?.record).toMatchObject({ invoice: { note: "xy" } });

		connector.data.sales = [
			sales[0],
			sale("C", "2026-11-01T04:00:00.000Z", "2026-11-01", {
				netAmount: 70_000,
				raw: { id: "C", revision: 2 },
			}),
		].filter((entry) => entry !== undefined);
		connector.data.totals = totalsFor(connector.data.sales);
		const fetchSales = connector.fetchSales.bind(connector);
		connector.fetchSales = async function* (store, window, context) {
			await new Promise((resolve) => setTimeout(resolve, 300));
			yield* fetchSales(store, window, context);
		};
		await Promise.all([
			engineOn(repository, 1).syncWindow(account, stores, WINDOW, "nightly"),
			engineOn(new PostgresSyncRepository(second), 2).syncWindow(
				account,
				stores,
				WINDOW,
				"manual",
			),
		]);
		const events = await admin<{ event: string }[]>`
			select invoice_external_id || ':' || kind::text as event
			from public.invoice_events where tenant_id = ${tenant.id}
			order by 1
		`;
		expect(events.map((row) => row.event)).toEqual(["B:voided", "C:edited"]);
		const payloads = await admin<{ external_id: string; invoice: unknown }[]>`
			select entry::jsonb ->> 'external_id' as external_id, entry::jsonb -> 'invoice' as invoice
			from public.sale_payloads p
			cross join lateral string_to_table(p.payload, E'\n') as entry
			where p.tenant_id = ${tenant.id}
			order by 1
		`;
		expect(payloads).toEqual([
			{ external_id: "A", invoice: { note: "xy" } },
			{ external_id: "B", invoice: { id: "B" } },
			{ external_id: "C", invoice: { id: "C", revision: 2 } },
		]);
		const store = stores[0];
		if (!store) {
			throw new Error("no store was discovered");
		}
		const key = storeWindowLockKey(store.id);
		const [probe] = await admin<{ free: boolean }[]>`
			select case when pg_try_advisory_lock(${key}::int8)
				then pg_advisory_unlock(${key}::int8) else false end as free
		`;
		expect(probe?.free).toBe(true);
	} finally {
		await admin`delete from public.tenants where slug = ${slug}`;
		await Promise.all(
			[admin, first, second].map((client) => client.end({ timeout: 5 })),
		);
	}
}

async function retryAfterReset(work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		console.warn(
			`repository scenario failed once, retrying after a possible reset: ${String(error)}`,
		);
		await new Promise((resolve) => setTimeout(resolve, 45_000));
		await work();
	}
}

describe.skipIf(!DATABASE_URL)(
	"PostgresSyncRepository on the local stack",
	() => {
		it("applies edits, voids and adjustments transactionally and idempotently", async () => {
			await retryAfterReset(scenario);
		}, 180_000);

		it("serialises overlapping runs on one store and stores text with NUL characters", async () => {
			await retryAfterReset(overlapScenario);
		}, 180_000);
	},
);
