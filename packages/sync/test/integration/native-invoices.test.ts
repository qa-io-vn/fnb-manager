import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "../../src/postgres/index.js";

// A store on the native till holds two kinds of invoices: the POS's, under the store's own account, and its native
// orders', under the tenant's native account (supabase migration native_sales_facts). The sync compares and changes
// only the POS's; this proves it against the local stack with a synthetic tenant it removes afterwards.

const DATABASE_URL = process.env.DATABASE_URL;
const DAY = "2026-11-01";
const RANGE = { from: DAY, to: DAY };

async function scenario(): Promise<void> {
	const sql = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 2 });
	const slug = `it-native-${randomUUID().slice(0, 8)}`;
	try {
		const [tenant] = await sql<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, 'Native invoices test') returning id
		`;
		if (!tenant) {
			throw new Error("tenant insert failed");
		}
		const [pos] = await sql<{ id: string }[]>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenant.id}, 'fake', 'native-test-pos', 'Synthetic POS') returning id
		`;
		const [native] = await sql<{ id: string }[]>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenant.id}, 'native', 'native', 'Native till') returning id
		`;
		if (!pos || !native) {
			throw new Error("account insert failed");
		}
		const [store] = await sql<{ id: string }[]>`
			insert into public.stores (tenant_id, pos_account_id, external_id, code, name)
			values (${tenant.id}, ${pos.id}, 'NATIVE-TEST-1', 'nt-1', 'Synthetic store') returning id
		`;
		if (!store) {
			throw new Error("store insert failed");
		}
		const invoice = async (
			account: string,
			externalId: string,
			net: number,
			status: string,
		): Promise<string> => {
			const [row] = await sql<{ id: string }[]>`
				insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, shift_external_id,
					gross_amount, net_amount, paid_amount, status)
				values (${tenant.id}, ${store.id}, ${account}, ${externalId}, ${`${DAY}T03:00:00.000Z`}, ${DAY}, 'SHIFT-1',
					${net}, ${net}, ${net}, ${status}::public.invoice_status)
				returning id
			`;
			if (!row) {
				throw new Error("invoice insert failed");
			}
			await sql`
				insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
				values (${tenant.id}, ${store.id}, ${row.id}, 1, ${DAY}, 'cash', ${net})
			`;
			return row.id;
		};
		await invoice(pos.id, "POS-1", 50_000, "completed");
		await invoice(
			native.id,
			"native-00000000-0000-4000-8000-000000000001",
			29_000,
			"completed",
		);
		const repository = new PostgresSyncRepository(sql);

		// The control totals and the shift payments count only the POS's invoice.
		expect(await repository.localDayTotals(store.id, RANGE)).toEqual([
			{ business_date: DAY, invoice_count: 1, net_amount: "50000.00" },
		]);
		expect(
			await repository.shiftPaymentTotals(store.id, RANGE, ["SHIFT-1"]),
		).toEqual([
			{
				shift_external_id: "SHIFT-1",
				payment_method_external_id: "cash",
				amount: "50000.00",
			},
		]);

		// The window the sync compares with the POS holds only the POS's invoice, even when asked for a native id.
		const window = await repository.loadStoreWindow(store.id, RANGE, [
			"native-00000000-0000-4000-8000-000000000001",
		]);
		expect(window.invoices.map((row) => row.external_id)).toEqual(["POS-1"]);

		// A status change and an event reported for a native external id leave the native invoice untouched.
		await repository.applyAdjustments({
			tenant_id: tenant.id,
			store_id: store.id,
			status_changes: [
				{
					external_id: "native-00000000-0000-4000-8000-000000000001",
					status: "voided",
					from: ["completed"],
				},
			],
			events: [],
		});
		const [nativeRow] = await sql<{ status: string }[]>`
			select status::text as status from public.invoices
			where store_id = ${store.id} and external_id = 'native-00000000-0000-4000-8000-000000000001'
		`;
		expect(nativeRow?.status).toBe("completed");
	} finally {
		await sql`delete from public.tenants where slug = ${slug}`;
		await sql.end({ timeout: 5 });
	}
}

describe.skipIf(!DATABASE_URL)("native invoices beside the POS's", () => {
	it("are left out of the sync's comparisons and changes", async () => {
		await scenario();
	}, 60_000);
});
