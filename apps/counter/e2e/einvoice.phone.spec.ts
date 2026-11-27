import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { SeededTenant } from "../test/support/seed";
import {
	asMember,
	clearQueue,
	expect,
	expectNoHorizontalScroll,
	nav,
	openShiftFor,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/einvoice-managers (ADR-069; native-till.md 17.6), on the phones (Chromium and WebKit): the managers'
// list of e-invoices that failed, with the counts and the filters, "Thử lại" queueing a given-up document again, the
// badge where the other manager counts show (the Quản lý tab and its card); security: staff reach neither the page
// nor the functions (42501), and the list holds error classes only, never a buyer's data.

const PROVIDER_SETTINGS = {
	seller_tax_code: "0312345678",
	template: "1",
	series: "C26MAA",
	vat_rate: "8",
};

test.beforeEach(async ({ db, seeded }) => {
	await clearQueue(db, seeded);
	await db`delete from public.einvoice_providers where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.store_requests where tenant_id = ${seeded.tenantId}`;
	await db`insert into public.einvoice_providers (tenant_id, brand_id, adapter, mode, secret_name, settings)
		values (${seeded.tenantId}, ${seeded.brandId}, 'mock', 'sandbox', 'EINVOICE_KEY_MOCK', ${db.json(PROVIDER_SETTINGS as never)})`;
	await openShiftFor(db, seeded, seeded.people.staff.id);
});

test.afterEach(async ({ db, seeded }) => {
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.einvoice_providers where tenant_id = ${seeded.tenantId}`;
});

/** A paid counter order whose sale invoice the job gave up on (rejected data), as the job leaves it. */
async function givenUp(
	db: Sql,
	seeded: SeededTenant,
): Promise<{
	readonly order: string;
	readonly displayNo: string;
	readonly invoice: string;
}> {
	const order = await asMember(db, seeded.people.staff.id, async (tx) => {
		const [created] = await tx<
			{
				r: {
					order: {
						id: string;
						version: number;
						total: number;
						display_no: string;
					};
				};
			}[]
		>`
			select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.tea, qty: 1 }],
			} as never)}::jsonb) as r`;
		const made = created?.r.order;
		if (made === undefined) throw new Error("no order");
		await tx`select public.counter_record_payment(${made.id}::uuid, 'cash', ${made.total}, ${made.version})`;
		return made;
	});
	const [invoice] = await db<{ id: string }[]>`
		update public.e_invoices set state = 'failed', attempts = 10, round_attempts = 10, last_error_class = 'rejected_data',
			last_attempt_at = now(), next_attempt_at = null, gave_up_at = now()
		where order_id = ${order.id} and kind = 'sale' returning id`;
	return {
		order: order.id,
		displayNo: order.display_no,
		invoice: invoice?.id ?? "",
	};
}

test("a manager sees the failing e-invoice with its counts and badge, filters the list and sends it again", async ({
	page,
	seeded,
	db,
}) => {
	const failed = await givenUp(db, seeded);
	await signIn(page, seeded.people.manager);
	// the badge where the other manager counts show: the tab and the card
	await expect(nav(page, "manager")).toContainText("1", { timeout: 20_000 });
	await nav(page, "manager").click();
	await expect(page.getByTestId("manager-einvoices-failing")).toHaveText(
		"1 lỗi",
	);
	await page.getByTestId("manager-einvoices").click();
	await expect(page.getByTestId("einvoices-page")).toBeVisible();
	await expect(page.getByTestId("einvoices-count-failing")).toHaveText("1");
	await expect(page.getByTestId("einvoices-count-gaveUp")).toHaveText("1");
	const row = page.locator(
		`[data-testid="einvoice-row"][data-invoice="${failed.invoice}"]`,
	);
	await expect(row).toContainText(`Đơn ${failed.displayNo}`);
	await expect(row).toContainText("Hóa đơn bán lẻ");
	await expect(row.getByTestId("einvoice-row-state")).toHaveText(
		"Đã dừng tự thử",
	);
	await expect(row.getByTestId("einvoice-row-error")).toHaveText(
		"Lỗi: nhà cung cấp từ chối dữ liệu hóa đơn · 10 lần thử",
	);
	await expectNoHorizontalScroll(page);
	// the filters: nothing waiting, the document in all
	await page
		.getByTestId("einvoices-filter")
		.getByRole("button", { name: "Đang chờ" })
		.click();
	await expect(page.getByTestId("einvoices-empty")).toHaveText(
		"Không có hóa đơn nào đang chờ.",
	);
	await page
		.getByTestId("einvoices-filter")
		.getByRole("button", { name: "Tất cả" })
		.click();
	await expect(row).toBeVisible();
	await page
		.getByTestId("einvoices-filter")
		.getByRole("button", { name: "Đang lỗi" })
		.click();
	await row
		.getByRole("button", {
			name: `Gửi lại hóa đơn của đơn ${failed.displayNo}`,
		})
		.click();
	await expect(page.getByTestId("toast")).toContainText(
		`Đã xếp hóa đơn của đơn ${failed.displayNo} để gửi lại.`,
	);
	await expect(page.getByTestId("einvoices-empty")).toHaveText(
		"Không có hóa đơn nào đang lỗi.",
	);
	await expect(page.getByTestId("einvoices-count-pending")).toHaveText("1");
	const [after] = await db<{ state: string; round_attempts: number }[]>`
		select state, round_attempts from public.e_invoices where id = ${failed.invoice}`;
	expect(after).toEqual({ state: "queued", round_attempts: 0 });
	// the list holds error classes only
	const body = (await page.getByTestId("einvoices-page").textContent()) ?? "";
	expect(body).not.toMatch(/@example\.com|MST/);
});

test("staff reach neither the e-invoice page nor its functions (42501)", async ({
	page,
	seeded,
	db,
}) => {
	const failed = await givenUp(db, seeded);
	await signIn(page, seeded.people.staff);
	await expect(nav(page, "manager")).toHaveCount(0);
	await page.goto("/#/quan-ly/hoa-don-dien-tu");
	await expect(page.getByTestId("managers-only")).toBeVisible();
	await expect(page.getByTestId("einvoices-page")).toHaveCount(0);
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select public.manager_einvoices(${seeded.storeA}::uuid, 'failing', 50)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) => tx`select public.manager_retry_einvoice(${failed.invoice}::uuid)`,
		),
	).toBe("42501");
	// the staff member of another store cannot read this store's pill either
	expect(
		await refusalOf(
			db,
			seeded.people.staffB.id,
			(tx) => tx`select public.counter_order_einvoice(${failed.order}::uuid)`,
		),
	).toBe("42501");
	const [still] = await db<{ state: string }[]>`
		select state from public.e_invoices where id = ${failed.invoice}`;
	expect(still?.state).toBe("failed");
});
