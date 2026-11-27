import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createMockMailer,
	createMockProvider,
	emailResultRequest,
	type MockFailure,
	MockLedger,
	readEmailItem,
	readWorkItem,
	resultRequest,
	runEmailItem,
	runWorkItem,
} from "../../src/index.js";

// einvoice:integration/job-e2e (ADR-069, ADR-070; server-level end to end, no screen exists yet): the database and
// the job's own code together, as einvoice-job runs them, with the mock provider and mailer. A counter order paid in
// cash is invoiced; the provider loses the answer to the next order's invoice and the later attempt, asking first,
// records the one it made; the cashier keys a company and the company invoice replaces the sale invoice, then its
// email goes; a manager's partial refund adjusts the company invoice by exactly the refund. Runs against the local
// database with the einvoices migration (EINVOICE_INTEGRATION=1 and DATABASE_URL; it passes without checking while
// the database lacks einvoice_job_work); its synthetic tenant is removed afterwards.

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ENABLED = process.env.EINVOICE_INTEGRATION === "1" && DATABASE_URL !== "";
const TENANT = "dddddddd-dddd-4ddd-8ddd-000000029701";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-000000029701";
const STORE = "ffffffff-ffff-4fff-8fff-000000029701";
const BRAND = "bbbbbbbb-bbbb-4bbb-8bbb-000000029701";
const PROVIDER = "aaaaaaaa-aaaa-4aaa-8aaa-000000029701";
const STAFF = "eeeeeeee-eeee-4eee-8eee-000000029701";
const ORDER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-000000029711";
const ORDER_2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000029712";
const KEY = "synthetic-einvoice-key-e2e";
const ledger = new MockLedger();

let sql: Sql;
let ready = false;

async function cleanup(): Promise<void> {
	await sql`delete from public.tenants where id = ${TENANT}`;
	await sql`delete from auth.users where id = ${STAFF}`;
}

/** One run of the job as einvoice-job does it, at an instant the database is told, for this tenant's documents only. */
async function runJob(
	at: string,
	script: MockFailure[] = [],
): Promise<string[]> {
	const [row] = await sql<
		{ work: { invoices: unknown[]; emails: unknown[] } }[]
	>`
		select app.einvoice_job_work(50, ${at}::timestamptz) as work`;
	const states: string[] = [];
	const provider = createMockProvider({
		secret: KEY,
		mode: "sandbox",
		ledger,
		script,
		clock: () => new Date(at),
	});
	for (const raw of row?.work.invoices ?? []) {
		const item = readWorkItem(raw);
		if (item === null || item.provider.id !== PROVIDER) {
			continue;
		}
		const result = await runWorkItem(item, provider, new Date(at));
		const [answer] = await sql<{ answer: { state: string } }[]>`
			select app.einvoice_job_result(${sql.json(resultRequest(item, result) as never)}, ${at}::timestamptz) as answer`;
		states.push(`${item.kind}:${answer?.answer.state}`);
	}
	const mailer = createMockMailer();
	for (const raw of row?.work.emails ?? []) {
		const item = readEmailItem(raw);
		if (item === null) {
			continue;
		}
		const result = await runEmailItem(item, mailer);
		const [answer] = await sql<{ answer: { state: string } }[]>`
			select app.einvoice_job_result(${sql.json(emailResultRequest(item, result) as never)}, ${at}::timestamptz) as answer`;
		states.push(`email:${answer?.answer.state}`);
	}
	return states;
}

async function documents(order: string): Promise<string> {
	const rows = await sql<{ text: string }[]>`
		select kind || ':' || state || coalesce(':' || amount::bigint, '') as text from public.e_invoices where order_id = ${order}
		order by array_position(array['sale', 'replacement', 'adjustment', 'cancellation'], kind), id`;
	return rows.map((row) => row.text).join(", ");
}

describe.skipIf(!ENABLED)(
	"the e-invoice job end to end with the mock provider",
	() => {
		beforeAll(async () => {
			sql = postgres(DATABASE_URL, { max: 2, onnotice: () => undefined });
			const [found] = await sql<
				{ present: boolean }[]
			>`select to_regprocedure('public.einvoice_job_work(integer)') is not null as present`;
			ready = found?.present === true;
			if (!ready) {
				return;
			}
			await cleanup();
			await sql.begin(async (tx) => {
				await tx`insert into auth.users (id, instance_id, aud, role, email) values (${STAFF}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'einvoice-e2e-9701@example.com')`;
				await tx`insert into public.tenants (id, slug, name) values (${TENANT}, 'einvoice-it-29701', 'E-invoice e2e')`;
				await tx`insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) values (${ACCOUNT}, ${TENANT}, 'mock', 'einvoice-it-29701', 'Synthetic')`;
				await tx`insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) values (${STORE}, ${TENANT}, ${ACCOUNT}, 'eit-2', 'eit-2', 'Synthetic store')`;
				await tx`insert into public.tenant_members (tenant_id, user_id, role, store_ids) values (${TENANT}, ${STAFF}, 'staff', ${[STORE]}::uuid[])`;
				await tx`insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) values (${BRAND}, ${TENANT}, 'brand-1', 'Synthetic brand', ${[STORE]}::uuid[])`;
				await tx`insert into public.einvoice_providers (id, tenant_id, brand_id, adapter, mode, secret_name, settings)
				values (${PROVIDER}, ${TENANT}, ${BRAND}, 'mock', 'sandbox', 'EINVOICE_KEY_IT',
				${sql.json({ seller_tax_code: "0312345678", template: "2", series: "C26MAA", vat_rate: "none" })})`;
				await tx`insert into public.orders (id, tenant_id, brand_id, store_id, source, order_type, table_label, business_date, order_no, status, payment_method,
				subtotal, total, request_id, request_hash, placed_at, accepted_at, created_by)
				values (${ORDER_1}, ${TENANT}, ${BRAND}, ${STORE}, 'counter', 'table', 'Bàn 1', current_date, 1, 'accepted', 'counter', 29000, 29000, gen_random_uuid(), ${"0".repeat(64)}, now(), now(), ${STAFF}),
				       (${ORDER_2}, ${TENANT}, ${BRAND}, ${STORE}, 'counter', 'table', 'Bàn 2', current_date, 2, 'accepted', 'counter', 35000, 35000, gen_random_uuid(), ${"0".repeat(64)}, now(), now(), ${STAFF})`;
				await tx`insert into public.order_lines (tenant_id, store_id, order_id, line_no, item_name, quantity, unit_price, line_total, counts_for_stamps)
				values (${TENANT}, ${STORE}, ${ORDER_1}, 1, 'Cà phê sữa', 1, 29000, 29000, true), (${TENANT}, ${STORE}, ${ORDER_2}, 1, 'Trà đào', 1, 35000, 35000, true)`;
				await tx`insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, requested_at, settled_at)
				select tenant_id, store_id, id, 'cash', total, 'succeeded', now(), now() from public.orders where tenant_id = ${TENANT}`;
				await tx`update public.orders set payment_status = 'paid', paid_at = now() where tenant_id = ${TENANT}`;
			});
		});

		afterAll(async () => {
			if (ready) {
				await cleanup();
			}
			await sql?.end();
		});

		it("invoices a paid order, and recovers a lost answer by asking first without a second invoice", async () => {
			if (!ready) {
				return;
			}
			expect(await documents(ORDER_1)).toBe("sale:queued");
			const lostFirst: MockFailure[] = [
				{ operation: "issue", failure: "timeout", afterWork: true },
			];
			const first = await runJob(new Date().toISOString(), lostFirst);
			expect(first.sort()).toEqual(["sale:failed", "sale:issued"]);
			const later = new Date(Date.now() + 120_000).toISOString();
			expect(await runJob(later)).toEqual(["sale:issued"]);
			expect(await documents(ORDER_1)).toBe("sale:issued:29000");
			expect(await documents(ORDER_2)).toBe("sale:issued:35000");
			expect(
				[...ledger.documents.values()].filter(
					(document) => document.kind === "sale",
				),
			).toHaveLength(2);
		});

		it("replaces the sale invoice with the company invoice the cashier keyed, then sends its email", async () => {
			if (!ready) {
				return;
			}
			const [asked] = await sql.begin(async (tx) => {
				await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: STAFF, role: "authenticated" })}, true)`;
				return await tx<
					{ answer: { state: string } }[]
				>`select app.counter_request_invoice(${ORDER_1}, ${sql.json({
					request_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000029721",
					company: {
						tax_code: "0312345678001",
						company_name: "Công ty TNHH Mẫu",
						address: "12 Đường Số 3",
						email: "ke.toan@example.com",
					},
				})}) as answer`;
			});
			expect(asked?.answer.state).toBe("received");
			const at = new Date(Date.now() + 240_000).toISOString();
			expect(await runJob(at)).toEqual(["replacement:issued"]);
			expect(await documents(ORDER_1)).toBe(
				"sale:replaced:29000, replacement:issued:29000",
			);
			expect(await runJob(at)).toEqual(["email:emailed"]);
			const [request] = await sql<
				{ status: string }[]
			>`select status from public.invoice_requests where order_id = ${ORDER_1}`;
			expect(request?.status).toBe("emailed");
		});

		it("adjusts the company invoice by exactly a manager's partial refund", async () => {
			if (!ready) {
				return;
			}
			await sql`insert into public.order_refunds (tenant_id, store_id, order_id, method, amount, status, reason, requested_at, settled_at)
			values (${TENANT}, ${STORE}, ${ORDER_1}, 'cash', 9000, 'succeeded', 'synthetic', now(), now())`;
			expect(
				await runJob(new Date(Date.now() + 360_000).toISOString()),
			).toEqual(["adjustment:issued"]);
			expect(await documents(ORDER_1)).toBe(
				"sale:replaced:29000, replacement:adjusted:29000, adjustment:issued:-9000",
			);
		});
	},
);
