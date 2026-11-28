import type { Page } from "@playwright/test";
import type { Sql } from "postgres";
import {
	BANK_SETTINGS,
	bankTransfer,
	dropPaymentRows,
	vietqrProvider,
} from "../test/support/payment-exceptions";
import { BREAD } from "../test/support/seed";
import { clearQueue, expect, nav, signIn, test } from "./support/fixtures";

// counter:e2e/vietqr (Q01 "Thu tiền", the VietQR tab; ADR-067, ADR-068) on the tablets at 1280 and 1024 in Chromium and
// 1280 in WebKit, on the real stack: the store's VietQR account is a provider row with the mock bank adapter in the
// sandbox, seeded by the test; the tablet opens its code through the real checkout-order (`for: "counter"`, served by
// the e2e stack with PAYMENTS_MOCK=on); the bank's news is settled by app.checkout_settle exactly as bank-webhook
// settles a verified post (the transaction id, the amount, the reference-shaped words of the transfer's text). Nothing
// reaches a bank. Each test removes its attempts, exceptions, provider and orders.
// - use case (criterion 1): a walk-in's code shows the exact amount and the reference, in words and inside the EMVCo
//   payload; the order stays unpaid while the bank says nothing, and turns paid ("Đã nhận tiền", the paid state) only
//   when the bank reports the exact amount;
// - equivalence partitions of the transfer (criterion 3): the exact amount pays; 1,000 less pays nothing, the tablet
//   keeps waiting and the money waits for a manager in Quản lý → Tiền chờ xử lý with the order, the reference, both
//   amounts and the account that received it;
// - state transitions of the attempt (criterion 3): pending → closed and reopened (the same code, no second attempt) →
//   expired on the tablet and the server → a transfer after it is held as late, never applied → "Tạo mã mới" (a new
//   reference) → paid by the new code.

test.beforeEach(async ({ db, seeded, page }) => {
	await dropPaymentRows(db, seeded.tenantId);
	await clearQueue(db, seeded);
	await db`update public.menu_store_items set sold_out_until = null where tenant_id = ${seeded.tenantId}`;
	await page.addInitScript(() => {
		window.print = () => undefined;
	});
});

test.afterEach(async ({ db, seeded }) => {
	await dropPaymentRows(db, seeded.tenantId);
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
});

/** Two polls of the order (every 2 seconds while the code is shown) and a margin. */
const TWO_POLLS_MS = 4_500;

interface Attempt {
	readonly reference: string;
	readonly order_id: string;
	readonly amount: number;
	readonly status: string;
}

/** The tenant's VietQR attempts as the server holds them, oldest first. */
async function attemptsOf(db: Sql, tenantId: string): Promise<Attempt[]> {
	return await db<Attempt[]>`
		select a.reference, a.order_id::text as order_id, p.amount::int as amount, p.status::text as status
		from app.payment_attempts a join public.order_payments p on p.id = a.payment_id
		where a.tenant_id = ${tenantId} order by a.created_at, a.reference`;
}

async function orderOf(
	db: Sql,
	orderId: string,
): Promise<{ readonly payment_status: string; readonly display_no: string }> {
	const [row] = await db<{ payment_status: string; display_no: string }[]>`
		select payment_status::text as payment_status, '#' || lpad(order_no::text, 3, '0') as display_no
		from public.orders where id = ${orderId}`;
	if (row === undefined) throw new Error("no such order");
	return row;
}

/** The fields of an EMVCo payload or template: a two-digit id, a two-digit length, the value. */
function emv(payload: string): Map<string, string> {
	const fields = new Map<string, string>();
	let at = 0;
	while (at + 4 <= payload.length) {
		const id = payload.slice(at, at + 2);
		const length = Number(payload.slice(at + 2, at + 4));
		fields.set(id, payload.slice(at + 4, at + 4 + length));
		at += 4 + length;
	}
	return fields;
}

/** A walk-in's banana bread keyed at the counter, takeaway, then "Thu tiền" → VietQR. */
async function keyAndOpenQr(page: Page): Promise<void> {
	await page.getByTestId("new-counter-order").click();
	await page
		.locator('[data-testid="menu-tile"][data-item="Bánh chuối"]')
		.click();
	await page.getByTestId("type-takeaway").click();
	await expect(page.getByTestId("ticket-total")).toContainText("25.000đ");
	await page.getByTestId("create-pay").click();
	await page.getByTestId("pay-vietqr").click();
	await expect(page.getByTestId("vietqr")).toBeVisible();
}

test("criterion 1: the counter's VietQR shows the exact amount and reference, and the order turns paid only when the bank confirms", {
	tag: ["@criterion-1"],
}, async ({ page, seeded, db }) => {
	const provider = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeA,
	);
	await signIn(page, seeded.people.staff);
	await keyAndOpenQr(page);
	// one attempt on the server, for the order's total, with its reference
	const attempts = await attemptsOf(db, seeded.tenantId);
	expect(attempts).toHaveLength(1);
	const [attempt] = attempts as [Attempt];
	expect(attempt).toMatchObject({ amount: BREAD, status: "pending" });
	expect(attempt.reference).toMatch(/^FNB[2-9A-HJ-NP-Z]{8}$/);
	// the tablet shows them in words
	await expect(page.getByTestId("vietqr")).toHaveAttribute(
		"data-reference",
		attempt.reference,
	);
	await expect(page.getByTestId("vietqr-reference")).toHaveText(
		attempt.reference,
	);
	await expect(page.getByTestId("vietqr-amount")).toHaveAttribute(
		"data-price",
		String(BREAD),
	);
	await expect(page.getByTestId("vietqr-account")).toHaveText(
		`${BANK_SETTINGS.account_number} · ${BANK_SETTINGS.account_name}`,
	);
	await expect(page.getByTestId("vietqr-sandbox")).toBeVisible();
	await expect(page.getByTestId("vietqr-countdown")).toHaveText(
		/^Mã còn 1[45]:\d\d$/,
	);
	// and the code itself carries the same: the account, VND, the exact amount (54) and the reference (62/08)
	const payload =
		(await page.getByTestId("vietqr-code").getAttribute("data-payload")) ?? "";
	expect(payload).toMatch(/^000201/);
	const fields = emv(payload);
	expect(fields.get("54")).toBe(String(BREAD));
	expect(emv(fields.get("62") ?? "").get("08")).toBe(attempt.reference);
	expect(fields.get("38")).toContain(BANK_SETTINGS.account_number);
	expect(fields.get("53")).toBe("704");
	// while the bank says nothing the tablet waits and the order stays unpaid, poll after poll
	await expect(page.getByTestId("vietqr-waiting")).toHaveText(
		"Chờ khách chuyển khoản…",
	);
	await page.waitForTimeout(TWO_POLLS_MS);
	await expect(page.getByTestId("vietqr-paid")).toHaveCount(0);
	expect((await orderOf(db, attempt.order_id)).payment_status).toBe("unpaid");
	// the bank reports the exact amount with the reference in the transfer's text
	const settled = await bankTransfer(db, provider, BREAD, [attempt.reference]);
	expect(settled.outcome).toBe("confirmed");
	await expect(page.getByTestId("vietqr-paid")).toContainText("Đã nhận tiền", {
		timeout: 10_000,
	});
	await expect(page.getByTestId("create-done")).toBeVisible();
	// paid once, by the bank's transfer
	expect((await orderOf(db, attempt.order_id)).payment_status).toBe("paid");
	const payments = await db<
		{ method: string; amount: number; provider_ref: string | null }[]
	>`select method::text as method, amount::int as amount, provider_ref from public.order_payments
		where order_id = ${attempt.order_id} and status = 'succeeded'`;
	expect(payments).toHaveLength(1);
	expect(payments[0]).toMatchObject({ method: "vietqr", amount: BREAD });
	expect(payments[0]?.provider_ref).toMatch(/^mock:e2e-/);
});

test("criterion 3: a transfer of another amount pays nothing; the tablet keeps waiting and the money waits for a manager in Tiền chờ xử lý", {
	tag: ["@criterion-3"],
}, async ({ page, seeded, db }) => {
	const provider = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeA,
	);
	await signIn(page, seeded.people.staff);
	await keyAndOpenQr(page);
	const [attempt] = (await attemptsOf(db, seeded.tenantId)) as [Attempt];
	// the customer transfers 1,000 less than the order
	const held = await bankTransfer(db, provider, BREAD - 1_000, [
		attempt.reference,
	]);
	expect(held).toMatchObject({
		outcome: "exception",
		reason: "amount_differs",
	});
	await page.waitForTimeout(TWO_POLLS_MS);
	await expect(page.getByTestId("vietqr-paid")).toHaveCount(0);
	await expect(page.getByTestId("vietqr-waiting")).toBeVisible();
	const order = await orderOf(db, attempt.order_id);
	expect(order.payment_status).toBe("unpaid");
	expect((await attemptsOf(db, seeded.tenantId))[0]?.status).toBe("pending");
	// the cashier closes the dialog: the order waits in the queue, unpaid
	await page.getByTestId("pay-qr-close").click();
	await expect(page.getByTestId("payment-dialog")).toHaveCount(0);
	// the manager finds the money in Quản lý → Tiền chờ xử lý
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/tien-cho-xu-ly");
	const row = page.locator(
		`[data-testid="payment-exception-row"][data-exception="${held.exception_id}"]`,
	);
	await expect(row).toHaveAttribute("data-status", "open");
	await expect(row).toHaveAttribute("data-reason", "amount_differs");
	await expect(row.getByTestId("payment-exception-kind")).toHaveText(
		"Sai số tiền",
	);
	await expect(row.getByTestId("payment-exception-amount")).toHaveAttribute(
		"data-price",
		String(BREAD - 1_000),
	);
	await expect(row.getByTestId("payment-exception-expected")).toContainText(
		"Đơn cần 25.000đ",
	);
	await expect(row.getByTestId("payment-exception-reference")).toHaveText(
		`Mã ${attempt.reference}`,
	);
	await expect(row.getByTestId("payment-exception-order")).toHaveText(
		`Đơn ${order.display_no}`,
	);
	await expect(row.getByTestId("payment-exception-account")).toHaveText(
		`Tiền vào ${BANK_SETTINGS.bank_name} ···${BANK_SETTINGS.account_number.slice(-4)} (tài khoản của cửa hàng)`,
	);
	await expect(row.getByTestId("payment-exception-resolve")).toBeVisible();
});

test("criterion 3: the code expires: reopened it is the same code, then a transfer after the window is held and a new code pays", {
	tag: ["@criterion-3"],
}, async ({ page, seeded, db }) => {
	const provider = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeA,
	);
	await signIn(page, seeded.people.staff);
	await keyAndOpenQr(page);
	const [first] = (await attemptsOf(db, seeded.tenantId)) as [Attempt];
	// closing the dialog leaves the code running; the order waits in the queue
	await page.getByTestId("pay-qr-close").click();
	await expect(page.getByTestId("payment-dialog")).toHaveCount(0);
	// near the end of the window (the server's clock moved on, as 15 minutes would), "Thu tiền" from the queue opens the
	// same code with the time it has left, never a second attempt
	await db`update app.payment_attempts set expires_at = now() + interval '15 seconds' where reference = ${first.reference}`;
	await nav(page, "orders").click();
	await page
		.locator(`[data-testid="order-card"][data-order-id="${first.order_id}"]`)
		.getByTestId("card-pay")
		.click();
	await page.getByTestId("pay-vietqr").click();
	await expect(page.getByTestId("vietqr")).toHaveAttribute(
		"data-reference",
		first.reference,
	);
	const countdown = page.getByTestId("vietqr-countdown");
	await expect(countdown).toHaveText(/^Mã còn 00:\d\d$/);
	expect(await attemptsOf(db, seeded.tenantId)).toHaveLength(1);
	// the window ends: the code fades and says so
	await expect(countdown).toHaveText("Mã đã hết hạn.", { timeout: 30_000 });
	await expect(countdown).toHaveAttribute("data-expired", "true");
	// a transfer after the window pays nothing: held as late for a manager
	const late = await bankTransfer(db, provider, BREAD, [first.reference]);
	expect(late).toMatchObject({ outcome: "exception", reason: "late" });
	await page.waitForTimeout(TWO_POLLS_MS);
	await expect(page.getByTestId("vietqr-paid")).toHaveCount(0);
	expect((await orderOf(db, first.order_id)).payment_status).toBe("unpaid");
	// "Tạo mã mới": a new attempt with a new reference and a full window
	await page.getByTestId("vietqr-new").click();
	await expect(page.getByTestId("vietqr")).not.toHaveAttribute(
		"data-reference",
		first.reference,
	);
	const attempts = await attemptsOf(db, seeded.tenantId);
	expect(attempts).toHaveLength(2);
	const second = attempts.find(
		(attempt) => attempt.reference !== first.reference,
	);
	expect(second).toMatchObject({ order_id: first.order_id, status: "pending" });
	await expect(page.getByTestId("vietqr")).toHaveAttribute(
		"data-reference",
		second?.reference ?? "",
	);
	await expect(countdown).toHaveText(/^Mã còn 1[45]:\d\d$/);
	// the new code pays
	const paid = await bankTransfer(db, provider, BREAD, [
		second?.reference ?? "",
	]);
	expect(paid.outcome).toBe("confirmed");
	await expect(page.getByTestId("vietqr-paid")).toContainText("Đã nhận tiền", {
		timeout: 10_000,
	});
	expect((await orderOf(db, first.order_id)).payment_status).toBe("paid");
	// the late money stays with the manager, not on the order
	const held = await db<{ reason: string; status: string; amount: number }[]>`
		select reason, status, amount::int as amount from public.payment_exceptions where order_id = ${first.order_id}`;
	expect(held).toEqual([{ reason: "late", status: "open", amount: BREAD }]);
});
