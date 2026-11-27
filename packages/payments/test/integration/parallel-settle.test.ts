import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// payments:integration/parallel-settle (ADR-068, security): a bank service and Zalo may post the same notification
// several times at once. Twenty connections settle the same transfer in parallel, then twenty other transfers of the
// same reference: one payment is applied, every repeat answers replayed, every other transfer goes to the manager
// queue as a duplicate, and the order is paid once. Runs against the local database with the online_payments
// migration (PAYMENTS_INTEGRATION=1 and DATABASE_URL); its tenant is removed afterwards.

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ENABLED = process.env.PAYMENTS_INTEGRATION === "1" && DATABASE_URL !== "";
const TENANT = "dddddddd-dddd-4ddd-8ddd-000000029501";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-000000029501";
const STORE = "ffffffff-ffff-4fff-8fff-000000029501";
const BRAND = "bbbbbbbb-bbbb-4bbb-8bbb-000000029501";
const PROVIDER = "aaaaaaaa-aaaa-4aaa-8aaa-000000029501";
const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-000000029502";
const PAYMENT = "aaaaaaaa-aaaa-4aaa-8aaa-000000029503";
const REFERENCE = "FNB7K2M9Q4T";
const PARALLEL = 20;

let sql: Sql;
let ready = false;

async function cleanup(): Promise<void> {
	await sql`delete from app.payment_attempts where tenant_id = ${TENANT}`;
	await sql`delete from public.payment_exceptions where tenant_id = ${TENANT}`;
	await sql`delete from public.tenants where id = ${TENANT}`;
}

describe.skipIf(!ENABLED)("parallel settlements", () => {
	beforeAll(async () => {
		sql = postgres(DATABASE_URL, {
			max: PARALLEL + 2,
			onnotice: () => undefined,
		});
		const [found] = await sql<
			{ present: boolean }[]
		>`select to_regprocedure('public.checkout_settle(jsonb)') is not null as present`;
		ready = found?.present === true;
		if (!ready) {
			return;
		}
		await cleanup();
		await sql.begin(async (tx) => {
			await tx`insert into public.tenants (id, slug, name) values (${TENANT}, 'payments-it-29501', 'Payments IT')`;
			await tx`insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) values (${ACCOUNT}, ${TENANT}, 'mock', 'payments-it-29501', 'Synthetic')`;
			await tx`insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) values (${STORE}, ${TENANT}, ${ACCOUNT}, 'pit-1', 'pit-1', 'Synthetic store')`;
			await tx`insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) values (${BRAND}, ${TENANT}, 'brand-1', 'Synthetic brand', ${[STORE]}::uuid[])`;
			await tx`insert into public.payment_providers (id, tenant_id, brand_id, method, adapter, mode, secret_name, settings)
				values (${PROVIDER}, ${TENANT}, ${BRAND}, 'vietqr', 'mock', 'sandbox', 'PAYMENT_BANK_IT',
				${sql.json({ bank_bin: "970400", bank_name: "Ngân hàng mẫu", account_number: "0123456789", account_name: "CUA HANG MAU", reference_prefix: "FNB" })})`;
			await tx`insert into public.orders (id, tenant_id, brand_id, store_id, source, order_type, table_label, business_date, status, payment_method,
				subtotal, total, request_id, request_hash, placed_at, payment_due_at)
				values (${ORDER}, ${TENANT}, ${BRAND}, ${STORE}, 'app', 'table', 'Bàn 1', current_date, 'awaiting_payment', 'vietqr',
				64000, 64000, gen_random_uuid(), ${"0".repeat(64)}, now(), now() + interval '15 minutes')`;
			await tx`insert into public.order_payments (id, tenant_id, store_id, order_id, method, amount, status, provider, idempotency_key, requested_at)
				values (${PAYMENT}, ${TENANT}, ${STORE}, ${ORDER}, 'vietqr', 64000, 'pending', 'vietqr', 'key-it-29501', now())`;
			await tx`insert into app.payment_attempts (payment_id, tenant_id, store_id, order_id, provider_id, adapter, mode, reference, actor, expires_at, created_at)
				values (${PAYMENT}, ${TENANT}, ${STORE}, ${ORDER}, ${PROVIDER}, 'mock', 'sandbox', ${REFERENCE}, 'customer', now() + interval '15 minutes', now())`;
		});
	});

	afterAll(async () => {
		if (ready) {
			await cleanup();
		}
		await sql?.end();
	});

	const settle = (ref: string) =>
		sql<
			{ answer: { outcome: string; reason?: string } }[]
		>`select public.checkout_settle(${sql.json({
			provider_id: PROVIDER,
			provider_ref: ref,
			candidates: [REFERENCE],
			amount: 64000,
			success: true,
			source: "webhook",
		})}) as answer`.then((rows) => rows[0]?.answer);

	it("applies one transfer once however many times it arrives at the same instant", async () => {
		if (!ready) {
			return;
		}
		const outcomes = await Promise.all(
			Array.from({ length: PARALLEL }, () => settle("mock:it-same")),
		);
		expect(
			outcomes.filter((answer) => answer?.outcome === "confirmed"),
		).toHaveLength(1);
		expect(
			outcomes.filter((answer) => answer?.outcome === "replayed"),
		).toHaveLength(PARALLEL - 1);
	});

	it("keeps every other transfer of the paid order for a manager, never paying twice", async () => {
		if (!ready) {
			return;
		}
		const outcomes = await Promise.all(
			Array.from({ length: PARALLEL }, (_, index) =>
				settle(`mock:it-other-${index}`),
			),
		);
		expect(
			outcomes.every(
				(answer) =>
					answer?.outcome === "exception" && answer.reason === "duplicate",
			),
		).toBe(true);
		const [order] = await sql<
			{ payment_status: string; status: string }[]
		>`select payment_status, status from public.orders where id = ${ORDER}`;
		expect(order).toEqual({ payment_status: "paid", status: "accepted" });
		const [counts] = await sql<{ succeeded: number; exceptions: number }[]>`
			select (select count(*)::int from public.order_payments where order_id = ${ORDER} and status = 'succeeded') as succeeded,
			       (select count(*)::int from public.payment_exceptions where order_id = ${ORDER}) as exceptions`;
		expect(counts).toEqual({ succeeded: 1, exceptions: PARALLEL });
	});
});
