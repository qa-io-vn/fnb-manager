import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SyncEngine } from "../../src/index.js";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "../../src/postgres/index.js";
import { createFakeConnector } from "../support/fake-connector.js";
import { sale, totalsFor } from "../support/sales.js";

// G-05. ISTQB technique: state transition (member, erased, new evidence from the POS, joined again). A synthetic
// customer is erased on a deletion request, then the same phone comes back with a later sync and the nightly re-pull.
// Nothing may be re-linked, nothing re-identified; a re-join starts clean. Gated on a database URL like its neighbour;
// it creates one it-erase- tenant and removes it at the end. Synthetic phone, no POS and no Zalo.
const DATABASE_URL = process.env.DATABASE_URL;
const PHONE = "0900000501";
const WINDOW = { fromDate: "2026-11-17", toDate: "2026-11-18" };
const SYNTHETIC_NAME = "Synthetic Till Name";

interface Counts {
	customers: number;
	memberships: number;
	ledger: number;
	checkins: number;
	claims: number;
	queue: number;
	refusals: number;
	messages: number;
}

async function scenario(): Promise<void> {
	const sql = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 2 });
	const slug = `it-erase-${randomUUID().slice(0, 8)}`;
	try {
		const [tenant] = await sql<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, 'Erasure resync test') returning id
		`;
		if (!tenant) throw new Error("tenant insert failed");
		const tenantId = tenant.id;
		const repository = new PostgresSyncRepository(sql);
		const account = await repository.upsertAccount({
			tenant_id: tenantId,
			connector: "fake",
			account_key: "erase-test",
			display_name: "Erasure test",
		});
		const withPhone = (id: string, at: string, day: string, net = 45_000) =>
			sale(id, at, day, {
				customerPhone: PHONE,
				customerName: SYNTHETIC_NAME,
				netAmount: net,
				grossAmount: net,
				paidAmount: net,
			});
		const sales = [
			withPhone("E-1", "2026-11-17T02:00:00.000Z", "2026-11-17"),
			sale("E-2", "2026-11-17T03:00:00.000Z", "2026-11-17"),
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
		const engine = new SyncEngine({
			repository,
			connector,
			calls: { sleep: async () => undefined },
		});
		await engine.syncMasterData(account);
		const stores = await repository.listStores(account.id);
		const storeId = stores[0]?.id;
		if (storeId === undefined) throw new Error("no store");
		await engine.syncWindow(account, stores, WINDOW, "backfill");

		const phones = async (): Promise<Record<string, string | null>> => {
			const rows = await sql<
				{
					external_id: string;
					customer_phone: string | null;
					customer_name: string | null;
				}[]
			>`
				select external_id, customer_phone, customer_name
				from public.invoices where tenant_id = ${tenantId} order by external_id
			`;
			return Object.fromEntries(
				rows.map((row) => [
					row.external_id,
					row.customer_phone === null && row.customer_name === null
						? null
						: `${row.customer_phone}|${row.customer_name}`,
				]),
			);
		};
		const counts = async (): Promise<Counts> => {
			const [row] = await sql<Counts[]>`
				select
					(select count(*)::int from public.customers where tenant_id = ${tenantId}) as customers,
					(select count(*)::int from public.memberships where tenant_id = ${tenantId}) as memberships,
					(select count(*)::int from public.loyalty_ledger where tenant_id = ${tenantId}) as ledger,
					(select count(*)::int from public.pending_checkins where tenant_id = ${tenantId}) as checkins,
					(select count(*)::int from public.receipt_claims where tenant_id = ${tenantId}) as claims,
					(select count(*)::int from public.loyalty_queue where tenant_id = ${tenantId}) as queue,
					(select count(*)::int from public.loyalty_refusals where tenant_id = ${tenantId}) as refusals,
					(select count(*)::int from public.outbound_messages where tenant_id = ${tenantId}) as messages
			`;
			if (!row) throw new Error("no counts");
			return row;
		};
		const reconcile = async (at: Date): Promise<void> => {
			await sql`select app.reconcile_loyalty(${tenantId}, ${"2026-11-01"}::date, ${"2026-11-19"}::date, ${at})`;
			await sql`select app.loyalty_nightly(${tenantId}, ${at})`;
		};

		// a member whose invoice earned on path A
		await sql`
			insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
			values (${tenantId}, 'Synthetic programme', '2026-11-01', 'below_threshold', 'active')
		`;
		const [customer] = await sql<{ id: string }[]>`
			select app.loyalty_customer_for_phone(${tenantId}, ${PHONE}, ${new Date("2026-11-16T01:00:00Z")}) as id
		`;
		if (!customer) throw new Error("no customer");
		await sql`
			select app.loyalty_join(${tenantId}, ${customer.id}, 'mini_app', ${storeId}, null, null, ${new Date("2026-11-16T02:00:00Z")})
		`;
		await reconcile(new Date("2026-11-17T12:00:00Z"));
		const before = await counts();
		expect(before.memberships).toBe(1);
		expect(before.ledger).toBeGreaterThanOrEqual(2);
		expect(await phones()).toEqual({
			"E-1": `${PHONE}|${SYNTHETIC_NAME}`,
			"E-2": null,
		});

		// the owner erases the customer on their request
		const [request] = await sql<{ id: string }[]>`
			insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type, received_at)
			values (${tenantId}, 'customer', ${customer.id}, 'synthetic-contact', 'deletion', ${new Date("2026-11-18T01:00:00Z")})
			returning id
		`;
		if (!request) throw new Error("no request");
		await sql`select app.dsr_erase_customer(${request.id}, null, ${new Date("2026-11-18T02:00:00Z")})`;
		expect(await counts()).toEqual({
			customers: 0,
			memberships: 0,
			ledger: 0,
			checkins: 0,
			claims: 0,
			queue: 0,
			refusals: 0,
			messages: 0,
		});
		expect(await phones()).toEqual({ "E-1": null, "E-2": null });

		// a later sync of the same day (the invoice changed at the till) and a new sale with the same phone
		connector.data.sales = [
			withPhone("E-1", "2026-11-17T02:00:00.000Z", "2026-11-17", 50_000),
			sales[1] as (typeof sales)[number],
			withPhone("E-3", "2026-11-18T04:00:00.000Z", "2026-11-18"),
		];
		connector.data.totals = totalsFor(connector.data.sales);
		const resync = await engine.syncWindow(account, stores, WINDOW, "nightly");
		expect(resync.stores[0]?.updated).toBeGreaterThanOrEqual(1);
		expect(await phones()).toEqual({ "E-1": null, "E-2": null, "E-3": null });
		const [kept] = await sql<{ net: string }[]>`
			select net_amount::text as net from public.invoices where tenant_id = ${tenantId} and external_id = 'E-1'
		`;
		expect(kept?.net).toBe("50000.00");

		// the nightly re-pull of the same window changes nothing and brings no phone
		await engine.syncWindow(account, stores, WINDOW, "nightly");
		expect(await phones()).toEqual({ "E-1": null, "E-2": null, "E-3": null });

		// the reconciliation and the nightly job create nothing for the erased phone
		await reconcile(new Date("2026-11-19T01:00:00Z"));
		expect(await counts()).toEqual({
			customers: 0,
			memberships: 0,
			ledger: 0,
			checkins: 0,
			claims: 0,
			queue: 0,
			refusals: 0,
			messages: 0,
		});

		// the same phone joins again: a new membership with the welcome stamps and no earlier ledger row
		const [again] = await sql<{ id: string }[]>`
			select app.loyalty_customer_for_phone(${tenantId}, ${PHONE}, ${new Date("2026-11-19T02:00:00Z")}) as id
		`;
		expect(again?.id).toBeDefined();
		expect(again?.id).not.toBe(customer.id);
		await sql`
			select app.loyalty_join(${tenantId}, ${again?.id ?? null}, 'mini_app', ${storeId}, null, null, ${new Date("2026-11-19T02:01:00Z")})
		`;
		const ledger = await sql<
			{ entry_kind: string; reason: string | null; stamps: number }[]
		>`
			select entry_kind::text, reason, stamp_delta::int as stamps from public.loyalty_ledger where tenant_id = ${tenantId}
		`;
		expect(ledger).toEqual([
			{ entry_kind: "adjust", reason: "welcome", stamps: expect.any(Number) },
		]);
		const [remembered] = await sql<{ n: number }[]>`
			select count(*)::int as n from app.erased_phones where tenant_id = ${tenantId}
		`;
		expect(remembered?.n).toBe(1);

		// the old invoices stay blank when the re-pull brings the phone again; a sale after the re-join carries it
		connector.data.sales = [
			...connector.data.sales,
			withPhone("E-4", "2026-11-19T04:00:00.000Z", "2026-11-19"),
		];
		connector.data.totals = totalsFor(connector.data.sales);
		await engine.syncWindow(
			account,
			stores,
			{ fromDate: "2026-11-17", toDate: "2026-11-19" },
			"nightly",
		);
		expect(await phones()).toEqual({
			"E-1": null,
			"E-2": null,
			"E-3": null,
			"E-4": `${PHONE}|${SYNTHETIC_NAME}`,
		});
	} finally {
		await sql`delete from public.tenants where slug = ${slug}`;
		await sql.end({ timeout: 5 });
	}
}

describe.skipIf(!DATABASE_URL)(
	"an erased customer's phone and the sync",
	() => {
		it("is not re-linked or re-identified by later syncs, and a re-join starts clean", async () => {
			await scenario();
		}, 60_000);
	},
);
