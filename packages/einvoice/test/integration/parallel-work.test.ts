import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// einvoice:integration/parallel-work (ADR-069, concurrency): the minute job posts one ticket at a time, but a slow run
// and the next one, or a retried request, may still overlap. Ten connections take the work list of thirty paid orders
// at the same instant: every sale invoice is taken by exactly one of them. Then ten connections report the same
// document's result at once: it is recorded once and the nine others are stale, so no document is ever issued twice
// in the database (and the provider is asked by our id before any second attempt). Runs against the local database
// with the einvoices migration (EINVOICE_INTEGRATION=1 and DATABASE_URL; it passes without checking while the database
// lacks einvoice_job_work); its synthetic tenant is removed afterwards.

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ENABLED = process.env.EINVOICE_INTEGRATION === "1" && DATABASE_URL !== "";
const TENANT = "dddddddd-dddd-4ddd-8ddd-000000029601";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-000000029601";
const STORE = "ffffffff-ffff-4fff-8fff-000000029601";
const BRAND = "bbbbbbbb-bbbb-4bbb-8bbb-000000029601";
const PROVIDER = "aaaaaaaa-aaaa-4aaa-8aaa-000000029601";
const ORDERS = 30;
const PARALLEL = 10;

let sql: Sql;
let ready = false;

async function cleanup(): Promise<void> {
	await sql`delete from public.tenants where id = ${TENANT}`;
}

describe.skipIf(!ENABLED)("parallel e-invoice job runs", () => {
	beforeAll(async () => {
		sql = postgres(DATABASE_URL, {
			max: PARALLEL + 2,
			onnotice: () => undefined,
		});
		const [found] = await sql<
			{ present: boolean }[]
		>`select to_regprocedure('public.einvoice_job_work(integer)') is not null as present`;
		ready = found?.present === true;
		if (!ready) {
			return;
		}
		await cleanup();
		await sql.begin(async (tx) => {
			await tx`insert into public.tenants (id, slug, name) values (${TENANT}, 'einvoice-it-29601', 'E-invoice IT')`;
			await tx`insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) values (${ACCOUNT}, ${TENANT}, 'mock', 'einvoice-it-29601', 'Synthetic')`;
			await tx`insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) values (${STORE}, ${TENANT}, ${ACCOUNT}, 'eit-1', 'eit-1', 'Synthetic store')`;
			await tx`insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) values (${BRAND}, ${TENANT}, 'brand-1', 'Synthetic brand', ${[STORE]}::uuid[])`;
			await tx`insert into public.einvoice_providers (id, tenant_id, brand_id, adapter, mode, secret_name, settings)
				values (${PROVIDER}, ${TENANT}, ${BRAND}, 'mock', 'sandbox', 'EINVOICE_KEY_IT',
				${sql.json({ seller_tax_code: "0312345678", template: "2", series: "C26MAA", vat_rate: "none" })})`;
			await tx`insert into public.orders (tenant_id, brand_id, store_id, source, order_type, table_label, business_date, order_no, status, payment_method,
				subtotal, total, request_id, request_hash, placed_at, accepted_at)
				select ${TENANT}, ${BRAND}, ${STORE}, 'counter', 'table', 'Bàn 1', current_date, n, 'accepted', 'counter',
				29000, 29000, gen_random_uuid(), ${"0".repeat(64)}, now(), now() from generate_series(1, ${ORDERS}) as n`;
			await tx`insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, requested_at, settled_at)
				select o.tenant_id, o.store_id, o.id, 'cash', 29000, 'succeeded', now(), now() from public.orders o where o.tenant_id = ${TENANT}`;
			await tx`update public.orders set payment_status = 'paid', paid_at = now() where tenant_id = ${TENANT}`;
		});
	});

	afterAll(async () => {
		if (ready) {
			await cleanup();
		}
		await sql?.end();
	});

	it("queues one sale invoice per paid order", async () => {
		if (!ready) {
			return;
		}
		const [row] = await sql<
			{ count: number }[]
		>`select count(*)::integer as count from public.e_invoices where tenant_id = ${TENANT} and kind = 'sale' and state = 'queued'`;
		expect(row?.count).toBe(ORDERS);
	});

	it("gives each document to exactly one of ten runs taking work at once", async () => {
		if (!ready) {
			return;
		}
		const answers = await Promise.all(
			Array.from(
				{ length: PARALLEL },
				() =>
					sql<
						{ work: { invoices: { invoice_id: string; claim: string }[] } }[]
					>`select public.einvoice_job_work(50) as work`,
			),
		);
		const taken = answers
			.flatMap(([row]) => row?.work.invoices ?? [])
			.filter((item) => item !== undefined);
		const ours = await sql<
			{ id: string }[]
		>`select id from public.e_invoices where tenant_id = ${TENANT}`;
		const ids = new Set(ours.map((row) => row.id));
		const mine = taken.filter((item) => ids.has(item.invoice_id));
		expect(mine).toHaveLength(ORDERS);
		expect(new Set(mine.map((item) => item.invoice_id)).size).toBe(ORDERS);
		const [issuing] = await sql<
			{ count: number }[]
		>`select count(*)::integer as count from public.e_invoices where tenant_id = ${TENANT} and state = 'issuing' and attempts = 1`;
		expect(issuing?.count).toBe(ORDERS);
	});

	it("records one result of a document reported ten times at once, the nine others stale", async () => {
		if (!ready) {
			return;
		}
		const [document] = await sql<
			{ id: string; claim_token: string; amount: number }[]
		>`
			select id, claim_token, amount::integer as amount from public.e_invoices where tenant_id = ${TENANT} and state = 'issuing' order by id limit 1`;
		expect(document).toBeDefined();
		if (document === undefined) {
			return;
		}
		const request = {
			invoice_id: document.id,
			claim: document.claim_token,
			outcome: "issued",
			provider_ref: `mock-${document.id}`,
			invoice_no: "00000001",
			series: "2C26MAA",
			amount: document.amount,
		};
		const answers = await Promise.all(
			Array.from(
				{ length: PARALLEL },
				() =>
					sql<
						{ answer: { state: string } }[]
					>`select public.einvoice_job_result(${sql.json(request)}) as answer`,
			),
		);
		const states = answers.map(([row]) => row?.answer.state).sort();
		expect(states.filter((state) => state === "issued")).toHaveLength(1);
		expect(states.filter((state) => state === "stale")).toHaveLength(
			PARALLEL - 1,
		);
		const [after] = await sql<
			{ count: number }[]
		>`select count(*)::integer as count from public.e_invoices where order_id = (select order_id from public.e_invoices where id = ${document.id})`;
		expect(after?.count).toBe(1);
	});
});
