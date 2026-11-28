import {
	dropPaymentRows,
	shortTransfer,
	unknownTransfer,
	vietqrProvider,
} from "../test/support/payment-exceptions";
import {
	asMember,
	clearQueue,
	expect,
	expectNoHorizontalScroll,
	nav,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/payment-exceptions-managers (Quản lý → Tiền chờ xử lý, ADR-068; acceptance criterion 6, gap 5 of the
// test plan's section 10.15), on the phones (Chromium and WebKit). The money is made the server's way: the store's
// VietQR account with the mock adapter, a counter order's attempt (app.checkout_begin) and the bank's news settled by
// app.checkout_settle as bank-webhook calls it.
// - use case: a transfer 1,000 short and one with a reference nobody issued wait for the manager: the count on the
//   Quản lý tab and on the section's card, each row with its provider, kind in words, amount and the order's, reference,
//   order and time; "Xử lý" asks the way and a note, confirms, and records it once; the badge goes down; "Đã xử lý"
//   shows the resolution, who and when, and the note written as text; the order's link opens the order;
// - security: staff reach neither the page nor the functions (42501), and the manager of store A cannot read or settle
//   store B's money (IDOR); markup in a note is text.

test.beforeEach(async ({ db, seeded }) => {
	await dropPaymentRows(db, seeded.tenantId);
	await clearQueue(db, seeded);
	await db`delete from public.store_requests where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.einvoice_providers where tenant_id = ${seeded.tenantId}`;
});

test.afterEach(async ({ db, seeded }) => {
	await dropPaymentRows(db, seeded.tenantId);
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
});

test("criterion 6: a manager sees the money held for the store, settles a short transfer after confirming, and finds it settled", {
	tag: ["@criterion-6"],
}, async ({ page, seeded, db }) => {
	const provider = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeA,
	);
	const short = await shortTransfer(
		db,
		provider,
		seeded.people.staff.id,
		seeded.storeA,
		seeded.sizes.coffeeM,
	);
	const unknown = await unknownTransfer(db, provider, 50_000);

	await signIn(page, seeded.people.manager);
	// the count where the other manager counts show: the tab and the section's card
	await expect(nav(page, "manager")).toContainText("2", { timeout: 20_000 });
	await nav(page, "manager").click();
	await expect(page.getByTestId("manager-paymentExceptions-open")).toHaveText(
		"2 chờ xử lý",
	);
	await page.getByTestId("manager-paymentExceptions").click();
	await expect(page.getByTestId("payment-exceptions-page")).toBeVisible();
	await expect(page.getByTestId("payment-exceptions-open")).toHaveText("2");
	const row = page.locator(
		`[data-testid="payment-exception-row"][data-exception="${short.exception}"]`,
	);
	await expect(row.getByTestId("payment-exception-kind")).toHaveText(
		"Sai số tiền",
	);
	await expect(row.getByTestId("payment-exception-amount")).toHaveAttribute(
		"data-price",
		"28000",
	);
	await expect(row.getByTestId("payment-exception-expected")).toContainText(
		"Đơn cần 29.000đ",
	);
	await expect(row.getByTestId("payment-exception-method")).toHaveText(
		"VietQR",
	);
	await expect(row.getByTestId("payment-exception-reference")).toHaveText(
		`Mã ${short.reference}`,
	);
	await expect(row.getByTestId("payment-exception-order")).toHaveText(
		`Đơn ${short.displayNo}`,
	);
	await expect(row.getByTestId("payment-exception-time")).toContainText(
		"Nhận lúc ",
	);
	const other = page.locator(
		`[data-testid="payment-exception-row"][data-exception="${unknown}"]`,
	);
	await expect(other.getByTestId("payment-exception-kind")).toHaveText(
		"Không rõ đơn",
	);
	await expect(other.getByTestId("payment-exception-order")).toHaveText(
		"Chưa gắn đơn nào",
	);
	await expectNoHorizontalScroll(page);

	// Xử lý: the way and a note, then a confirmation; one call
	await row.getByTestId("payment-exception-resolve").click();
	const dialog = page.getByTestId("resolve-dialog");
	await expect(dialog.getByTestId("resolve-refunded")).toBeFocused();
	await dialog.getByTestId("resolve-next").click();
	await expect(dialog.getByTestId("resolve-choice-error")).toHaveText(
		"Chọn một cách xử lý.",
	);
	await dialog.getByRole("radio", { name: "Đã trả lại khách" }).check();
	await dialog.getByTestId("resolve-note").fill("<b>Đã chuyển lại 28.000đ</b>");
	await dialog.getByTestId("resolve-next").click();
	await expect(dialog.getByTestId("resolve-question")).toHaveText(
		"Ghi khoản 28.000đ là “Đã trả lại khách”?",
	);
	await expect(dialog.getByTestId("resolve-question")).toBeFocused();
	await expectNoHorizontalScroll(page);
	const [before] = await db<{ status: string }[]>`
		select status from public.payment_exceptions where id = ${short.exception}`;
	expect(before?.status).toBe("open");
	await dialog.getByTestId("resolve-confirm").click();
	await expect(page.getByTestId("toast")).toContainText(
		"Đã ghi khoản 28.000đ: Đã trả lại khách.",
	);
	await expect(dialog).toHaveCount(0);
	await expect(row).toHaveCount(0);
	await expect(page.getByTestId("payment-exceptions-open")).toHaveText("1");
	const [after] = await db<
		{ status: string; resolved_by: string; resolution_note: string }[]
	>`select status, resolved_by::text, resolution_note from public.payment_exceptions where id = ${short.exception}`;
	expect(after).toEqual({
		status: "refunded",
		resolved_by: seeded.people.manager.id,
		resolution_note: "<b>Đã chuyển lại 28.000đ</b>",
	});

	// Đã xử lý: the resolution, who and when, the note as text
	await page
		.getByTestId("payment-exceptions-filter")
		.getByRole("button", { name: "Đã xử lý" })
		.click();
	const settled = page.locator(
		`[data-testid="payment-exception-row"][data-exception="${short.exception}"]`,
	);
	await expect(settled).toHaveAttribute("data-status", "refunded");
	await expect(
		settled.getByTestId("payment-exception-resolution"),
	).toContainText(`Đã trả lại khách · ${seeded.people.manager.name} · `);
	await expect(settled.getByTestId("payment-exception-note")).toHaveText(
		"Ghi chú: <b>Đã chuyển lại 28.000đ</b>",
	);
	await expect(settled.locator("b")).toHaveCount(0);
	await expect(settled.getByTestId("payment-exception-resolve")).toHaveCount(0);
	await expectNoHorizontalScroll(page);
	// the order's link opens the order
	await settled.getByTestId("payment-exception-order").click();
	await expect(page).toHaveURL(new RegExp(`#/don/${short.order}$`));
	await expect(page.getByTestId("order-detail")).toBeVisible();
	// the badge counts what is still open
	await nav(page, "manager").click();
	await expect(page.getByTestId("manager-paymentExceptions-open")).toHaveText(
		"1 chờ xử lý",
	);
});

test("staff reach neither the page nor its functions; the manager of store A cannot touch store B's money (IDOR)", async ({
	page,
	seeded,
	db,
}) => {
	const providerA = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeA,
	);
	const providerB = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeB,
	);
	const atA = await unknownTransfer(db, providerA, 40_000);
	const atB = await unknownTransfer(db, providerB, 41_000);

	await signIn(page, seeded.people.staff);
	await expect(nav(page, "manager")).toHaveCount(0);
	await page.goto("/#/quan-ly/tien-cho-xu-ly");
	await expect(page.getByTestId("managers-only")).toBeVisible();
	await expect(page.getByTestId("payment-exceptions-page")).toHaveCount(0);
	const refused: readonly [
		string,
		string,
		(tx: typeof db) => PromiseLike<unknown>,
	][] = [
		[
			"staff list store A",
			seeded.people.staff.id,
			(tx) =>
				tx`select public.manager_payment_exceptions(${seeded.storeA}::uuid, 'open', 50)`,
		],
		[
			"staff settle store A's",
			seeded.people.staff.id,
			(tx) =>
				tx`select public.manager_resolve_payment_exception(${atA}::uuid, 'refunded', 'Đã chuyển lại')`,
		],
		[
			"manager of A lists store B",
			seeded.people.manager.id,
			(tx) =>
				tx`select public.manager_payment_exceptions(${seeded.storeB}::uuid, null, 50)`,
		],
		[
			"manager of A settles store B's",
			seeded.people.manager.id,
			(tx) =>
				tx`select public.manager_resolve_payment_exception(${atB}::uuid, 'dismissed', 'Không phải của quán')`,
		],
	];
	for (const [label, person, run] of refused) {
		expect(await refusalOf(db, person, run), label).toBe("42501");
	}
	// the manager reads store A's, never store B's
	const seen = await asMember(db, seeded.people.manager.id, async (tx) => {
		const [row] = await tx<{ r: { exceptions: { id: string }[] } }[]>`
			select public.manager_payment_exceptions(${seeded.storeA}::uuid, null, 50) as r`;
		return row?.r.exceptions.map((entry) => entry.id) ?? [];
	});
	expect(seen).toContain(atA);
	expect(seen).not.toContain(atB);
	const rows = await db<{ id: string; status: string }[]>`
		select id::text, status from public.payment_exceptions where id in (${atA}, ${atB}) order by id`;
	expect(rows.map((row) => row.status)).toEqual(["open", "open"]);
});
