import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { placeCustomerOrder, seedCustomer, TEA } from "../test/support/seed";
import {
	asMember,
	clearQueue,
	expect,
	expectNoHorizontalScroll,
	openShiftFor,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/einvoice (Q01 with ADR-069 and ADR-070; native-till.md 17.6), on the tablets at 1280 and 1024 in
// Chromium and 1280 in WebKit, the mock provider on (the e-invoice job is off locally, so the test moves a document as
// the job would):
// - use case: a walk-in order with "Hóa đơn công ty" on the ticket (the form's checks, its errors linked to their
//   fields, the company held), paid in cash; the payment-confirmed state shows "Đang xuất…" and the company request;
// - state transitions of the pill on the order detail: Đang xuất… → Chưa xuất được (the job retries) → Đã xuất with
//   the number; it follows the order without a reload;
// - the company row of a paid counter order (an invalid tax code blocks it, the server records it once with who keyed
//   it); none for an order of the app (its customer asks in the app);
// - security: markup and a CRLF are refused before any call; no tax code in the address or a console line.

const PROVIDER_SETTINGS = {
	seller_tax_code: "0312345678",
	template: "1",
	series: "C26MAA",
	vat_rate: "8",
};
const TAX = "0312345678";
const COMPANY = "Công ty TNHH Mẫu Quầy";
const ADDRESS = "12 Đường Mẫu, Quận 1";
const EMAIL = "ketoan@example.com";

type Db = Parameters<typeof seedCustomer>[0];
type Seeded = Parameters<typeof seedCustomer>[1];

test.beforeEach(async ({ db, seeded, page }) => {
	await clearQueue(db, seeded);
	await db`update public.menu_store_items set sold_out_until = null where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.einvoice_providers where tenant_id = ${seeded.tenantId}`;
	await db`insert into public.einvoice_providers (tenant_id, brand_id, adapter, mode, secret_name, settings)
		values (${seeded.tenantId}, ${seeded.brandId}, 'mock', 'sandbox', 'EINVOICE_KEY_MOCK', ${db.json(PROVIDER_SETTINGS as never)})`;
	await openShiftFor(db, seeded, seeded.people.staff.id);
	await page.addInitScript(() => {
		window.print = () => undefined;
	});
});

test.afterEach(async ({ db, seeded }) => {
	// the provider goes with its documents; the other suites run without e-invoicing
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.einvoice_providers where tenant_id = ${seeded.tenantId}`;
});

/** A counter order paid in cash by the staff member, as the tablet does it. */
async function paidCounterOrder(db: Db, seeded: Seeded): Promise<string> {
	return await asMember(db, seeded.people.staff.id, async (tx) => {
		const [created] = await tx<
			{ r: { order: { id: string; version: number; total: number } } }[]
		>`
			select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.tea, qty: 1 }],
			} as never)}::jsonb) as r`;
		const order = created?.r.order;
		if (order === undefined) throw new Error("no order");
		await tx`select public.counter_record_payment(${order.id}::uuid, 'cash', ${order.total}, ${order.version})`;
		return order.id;
	});
}

function watchConsole(page: Page): string[] {
	const lines: string[] = [];
	page.on("console", (message) => lines.push(message.text()));
	return lines;
}

test("Q01: Hóa đơn công ty on the ticket, checked and held, then paid: Đang xuất… and the request in the paid state", async ({
	page,
	seeded,
	db,
}) => {
	const console = watchConsole(page);
	await signIn(page, seeded.people.staff);
	await page.getByTestId("new-counter-order").click();
	await page.getByTestId("type-takeaway").click();
	await page.locator('[data-testid="menu-tile"][data-item="Trà đào"]').click();
	await page.getByTestId("ticket-company-open").click();
	const dialog = page.getByTestId("company-dialog");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("company-tax_code")).toBeFocused();
	// nothing typed: every field says why, linked to it, and the tax code takes the focus back
	await page.getByTestId("company-submit").click();
	for (const name of ["tax_code", "company_name", "address", "email"]) {
		const input = page.getByTestId(`company-${name}`);
		await expect(input).toHaveAttribute("aria-invalid", "true");
		const error = page.getByTestId(`company-${name}-error`);
		const id = await error.getAttribute("id");
		expect(
			(await input.getAttribute("aria-describedby"))?.split(" "),
		).toContain(id);
	}
	await expect(page.getByTestId("company-tax_code")).toBeFocused();
	await expect(page.getByTestId("company-message")).toHaveText(
		"Còn 4 ô chưa đúng.",
	);
	// BVA: 9 digits, then markup and a CRLF refused before any call
	await page.getByTestId("company-tax_code").fill("031234567");
	await page
		.getByTestId("company-company_name")
		.fill("<script>alert(1)</script>");
	await page.getByTestId("company-address").fill("{{ constructor }}");
	await page
		.getByTestId("company-email")
		.fill("ketoan@example.com\r\nBcc: x@example.com");
	await page.getByTestId("company-submit").click();
	await expect(page.getByTestId("company-tax_code-error")).toHaveText(
		"Mã số thuế gồm 10 hoặc 13 số. Đang nhập 9 số.",
	);
	await expect(page.getByTestId("company-company_name-error")).toHaveText(
		"Không dùng các ký tự < > { }.",
	);
	await expect(page.getByTestId("company-address-error")).toHaveText(
		"Không dùng các ký tự < > { }.",
	);
	await expect(page.getByTestId("company-email")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expectNoHorizontalScroll(page);
	// 13 bare digits, a name with Vietnamese marks: held for the ticket
	await page.getByTestId("company-tax_code").fill(`${TAX}001`);
	await page.getByTestId("company-company_name").fill(COMPANY);
	await page.getByTestId("company-address").fill(ADDRESS);
	await page.getByTestId("company-email").fill(EMAIL);
	await page.getByTestId("company-submit").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("ticket-company-name")).toHaveText(
		`${COMPANY} · MST ${TAX}-001`,
	);
	const [none] = await db<{ count: number }[]>`
		select count(*)::int as count from public.invoice_requests where tenant_id = ${seeded.tenantId}`;
	expect(none?.count).toBe(0);
	await expectNoHorizontalScroll(page);

	await page.getByTestId("create-pay").click();
	await page.getByTestId(`pay-quick-${TEA}`).click();
	await page.getByTestId("pay-submit").click();
	const done = page.getByTestId("create-done");
	await expect(done).toBeVisible();
	const card = page.getByTestId("create-done-einvoice");
	await expect(card.getByTestId("einvoice-pill")).toHaveText("Đang xuất…");
	await expect(card.getByTestId("einvoice-line")).toHaveText(
		"Hóa đơn được xuất ngay sau khi nhận tiền.",
	);
	await expect(card.getByTestId("einvoice-company")).toContainText(
		`${COMPANY} · MST ${TAX}-001`,
	);
	await expect(card.getByTestId("einvoice-company")).toContainText(
		"Đã nhận yêu cầu",
	);
	await expectNoHorizontalScroll(page);
	const [request] = await db<
		{ tax_code: string; source: string; requested_by: string; status: string }[]
	>`
		select tax_code, source, requested_by, status from public.invoice_requests where tenant_id = ${seeded.tenantId}`;
	expect(request).toEqual({
		tax_code: `${TAX}-001`,
		source: "counter",
		requested_by: seeded.people.staff.id,
		status: "received",
	});
	expect(page.url()).not.toContain(TAX);
	expect(
		console.filter((line) => line.includes(TAX) || line.includes("ketoan@")),
	).toEqual([]);
});

test("Q01: the pill follows the order: Đang xuất…, Chưa xuất được while the job retries, then Đã xuất with the number", async ({
	page,
	seeded,
	db,
}) => {
	const orderId = await paidCounterOrder(db, seeded);
	await signIn(page, seeded.people.staff);
	await page.goto(`/#/don/${orderId}`);
	const card = page.getByTestId("einvoice-card");
	await expect(card.getByTestId("einvoice-pill")).toHaveText("Đang xuất…");
	await expect(card).toHaveAttribute("data-state", "pending");
	await expectNoHorizontalScroll(page);
	// the job's first attempt fails; it will try again
	await db`update public.e_invoices set state = 'failed', attempts = 1, round_attempts = 1, last_error_class = 'timeout',
		last_attempt_at = now(), next_attempt_at = now() + interval '1 minute'
		where order_id = ${orderId} and kind = 'sale'`;
	await expect(card.getByTestId("einvoice-pill")).toHaveText("Chưa xuất được", {
		timeout: 25_000,
	});
	await expect(card.getByTestId("einvoice-line")).toHaveText(
		"Hệ thống tự thử lại, đơn vẫn hoàn tất.",
	);
	await expect(card.getByTestId("einvoice-pill")).toHaveAttribute(
		"data-tone",
		"warning",
	);
	// then the provider makes it
	await db`update public.e_invoices set state = 'issued', mode = 'sandbox', provider_ref = 'mock-1', invoice_no = '000127',
		invoice_series = 'C26MAA', lookup_code = 'TC000127', amount = ${TEA}, issued_at = now(), next_attempt_at = null,
		last_error_class = null, settled_at = now()
		where order_id = ${orderId} and kind = 'sale'`;
	await expect(card.getByTestId("einvoice-pill")).toHaveText("Đã xuất", {
		timeout: 25_000,
	});
	await expect(card.getByTestId("einvoice-line")).toContainText("Số 000127");
	await expect(card.getByTestId("einvoice-lookup")).toHaveText(
		"Mã tra cứu TC000127",
	);
});

test("Q01: the company row of a paid counter order checks the tax code and records the request once; an app order has none", async ({
	page,
	seeded,
	db,
}) => {
	const orderId = await paidCounterOrder(db, seeded);
	await signIn(page, seeded.people.staff);
	await page.goto(`/#/don/${orderId}`);
	await page.getByTestId("company-open").click();
	await page.getByTestId("company-tax_code").fill("03123456");
	await page.getByTestId("company-company_name").fill(COMPANY);
	await page.getByTestId("company-address").fill(ADDRESS);
	await page.getByTestId("company-email").fill(EMAIL);
	await page.getByTestId("company-submit").click();
	await expect(page.getByTestId("company-tax_code-error")).toHaveText(
		"Mã số thuế gồm 10 hoặc 13 số. Đang nhập 8 số.",
	);
	await expect(page.getByTestId("company-tax_code")).toBeFocused();
	await page.getByTestId("company-tax_code").fill(TAX);
	await page.getByTestId("company-submit").dblclick();
	await expect(page.getByTestId("toast")).toContainText(
		"Đã ghi yêu cầu hóa đơn công ty",
	);
	const card = page.getByTestId("einvoice-card");
	await expect(card.getByTestId("einvoice-company")).toContainText(
		`${COMPANY} · MST ${TAX}`,
	);
	await expect(page.getByTestId("company-open")).toHaveCount(0);
	const rows = await db<{ count: number }[]>`
		select count(*)::int as count from public.invoice_requests where order_id = ${orderId}`;
	expect(rows[0]?.count).toBe(1);

	// an order of the app: no company row at the counter
	const customer = await seedCustomer(db, seeded);
	const placed = await placeCustomerOrder(db, seeded, customer, {
		table: seeded.tables.t1,
		lines: [{ size: seeded.sizes.tea, qty: 1 }],
		expectedTotal: TEA,
	});
	const appOrder = placed.order?.id ?? "";
	await asMember(db, seeded.people.staff.id, async (tx) => {
		const [row] = await tx<{ version: number }[]>`
			select version from public.orders where id = ${appOrder}`;
		await tx`select public.counter_record_payment(${appOrder}::uuid, 'cash', ${TEA}, ${row?.version ?? 0})`;
	});
	await page.goto(`/#/don/${appOrder}`);
	await expect(
		page.getByTestId("einvoice-card").getByTestId("einvoice-pill"),
	).toHaveText("Đang xuất…");
	await expect(page.getByTestId("company-open")).toHaveCount(0);
	await expectNoHorizontalScroll(page);
});
