import { randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "postgres";

/**
 * Money a manager must settle (ADR-068), made the way the server makes it: a VietQR account of the synthetic tenant
 * (the mock bank adapter in the sandbox, as the payments tests use), a counter order with its VietQR attempt
 * (app.checkout_begin, as checkout-order calls it for the counter) and the bank's news settled by app.checkout_settle,
 * as bank-webhook calls it. Nothing reaches a bank or a provider. The tests remove the rows with dropPaymentRows
 * (an attempt holds its provider, so it goes first).
 */

export const BANK_SETTINGS = {
	bank_bin: "970400",
	bank_name: "Ngân hàng mẫu",
	account_number: "0123456789",
	account_name: "CUA HANG MAU",
	reference_prefix: "FNB",
} as const;

// the alphabet of a reference (ADR-067): no 0, 1, I or O
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A reference of the right shape that nobody issued (40 random bits: a clash is not a concern). */
export function unusedReference(prefix = BANK_SETTINGS.reference_prefix) {
	const bytes = randomBytes(8);
	return `${prefix}${[...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
}

/** A VietQR account of the brand (store null) or of one store, on in the sandbox with the mock adapter. */
export async function vietqrProvider(
	sql: Sql,
	tenantId: string,
	brandId: string,
	storeId: string | null,
): Promise<string> {
	const id = randomUUID();
	await sql`insert into public.payment_providers (id, tenant_id, brand_id, store_id, method, adapter, mode, secret_name, settings)
		values (${id}, ${tenantId}, ${brandId}, ${storeId}, 'vietqr', 'mock', 'sandbox', 'PAYMENT_BANK_SYNTHETIC',
		${sql.json(BANK_SETTINGS as never)})`;
	return id;
}

/** A takeaway counter order keyed by a staff member (app.counter_create_order under the person's claims). */
export async function counterOrderAs(
	sql: Sql,
	userId: string,
	storeId: string,
	sizeId: string,
	qty = 1,
): Promise<{
	readonly id: string;
	readonly total: number;
	readonly display_no: string;
	readonly version: number;
}> {
	return await sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
		const [row] = await tx<
			{
				r: {
					state: string;
					order: {
						id: string;
						total: number;
						display_no: string;
						version: number;
					};
				};
			}[]
		>`select app.counter_create_order(${storeId}::uuid, ${tx.json({
			request_id: randomUUID(),
			type: "takeaway",
			lines: [{ size: sizeId, qty }],
		} as never)}::jsonb) as r`;
		if (row?.r.state !== "placed")
			throw new Error(
				`the counter order was not placed: ${JSON.stringify(row?.r)}`,
			);
		return row.r.order;
	});
}

/** The counter's VietQR attempt for an order (what checkout-order asks for a staff member): its reference. */
export async function counterAttempt(
	sql: Sql,
	userId: string,
	orderId: string,
): Promise<string> {
	const [row] = await sql<
		{ r: { state: string; payment: { reference: string } | null } }[]
	>`select app.checkout_begin(${sql.json({
		user_id: userId,
		order_id: orderId,
		method: "vietqr",
		idempotency_key: `key-pe-${randomUUID().slice(0, 12)}`,
		for: "counter",
	} as never)}::jsonb, now()) as r`;
	if (row?.r.state !== "pending" || row.r.payment === null)
		throw new Error(`no VietQR attempt: ${JSON.stringify(row?.r)}`);
	return row.r.payment.reference;
}

export interface Settled {
	readonly outcome: string;
	readonly reason?: string;
	readonly exception_id?: string | null;
	readonly order_id?: string | null;
}

/** The bank's news of one transfer, settled as bank-webhook settles it. */
export async function settleTransfer(
	sql: Sql,
	provider: string,
	amount: number,
	reference: string | null,
): Promise<Settled> {
	const [row] = await sql<
		{ r: Settled }[]
	>`select app.checkout_settle(${sql.json({
		provider_id: provider,
		provider_ref: `mock:pe-${randomUUID().slice(0, 18)}`,
		amount,
		success: true,
		...(reference === null ? {} : { reference }),
		source: "webhook",
	} as never)}::jsonb, now()) as r`;
	if (row === undefined) throw new Error("no settlement");
	return row.r;
}

/** A transfer whose reference nobody issued: held as unknown_reference at the provider's store (or brand-wide). */
export async function unknownTransfer(
	sql: Sql,
	provider: string,
	amount: number,
): Promise<string> {
	const settled = await settleTransfer(
		sql,
		provider,
		amount,
		unusedReference(),
	);
	if (
		settled.outcome !== "exception" ||
		typeof settled.exception_id !== "string"
	)
		throw new Error(`not held: ${JSON.stringify(settled)}`);
	return settled.exception_id;
}

/** A transfer of another amount for a counter order's attempt: held as amount_differs, linked to the order. */
export async function shortTransfer(
	sql: Sql,
	provider: string,
	userId: string,
	storeId: string,
	sizeId: string,
	short = 1_000,
): Promise<{
	readonly exception: string;
	readonly order: string;
	readonly displayNo: string;
	readonly total: number;
	readonly reference: string;
}> {
	const order = await counterOrderAs(sql, userId, storeId, sizeId);
	const reference = await counterAttempt(sql, userId, order.id);
	const settled = await settleTransfer(
		sql,
		provider,
		order.total - short,
		reference,
	);
	if (
		settled.outcome !== "exception" ||
		typeof settled.exception_id !== "string"
	)
		throw new Error(`not held: ${JSON.stringify(settled)}`);
	return {
		exception: settled.exception_id,
		order: order.id,
		displayNo: order.display_no,
		total: order.total,
		reference,
	};
}

/** Removes the tenant's attempts, exceptions and providers (in that order: an attempt holds its provider). */
export async function dropPaymentRows(
	sql: Sql,
	tenantId: string,
): Promise<void> {
	await sql`delete from app.payment_attempts where tenant_id = ${tenantId}`;
	await sql`delete from public.payment_exceptions where tenant_id = ${tenantId}`;
	await sql`delete from public.payment_providers where tenant_id = ${tenantId}`;
}
