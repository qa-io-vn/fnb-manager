import type { Locator } from "@playwright/test";
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
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/payment-exceptions (Quản lý → Tiền chờ xử lý from Đối soát ngày, ADR-068; acceptance criterion 6, gap 5
// of the test plan's section 10.15), on the tablets at 1280 and 1024 in Chromium and 1280 in WebKit; the money made the
// server's way (the store's VietQR account with the mock adapter; app.checkout_settle as bank-webhook calls it).
// - use case (criterion 6): money the bank reported for no order is not in the day: Đối soát ngày says "1 khoản tiền
//   chờ xử lý, chưa tính vào đối soát →" and leads to the page; once it is settled the line goes;
// - boundary values of the note: 201 characters refused in words under the field (aria-invalid, the focus on it),
//   200 taken and recorded whole; Escape closes the dialog and gives the focus back;
// - state transition by someone else: the owner settles it while the manager confirms; the page says it was settled
//   first and reloads, and the settled row names the owner, who is not on the roster, by the name the server gives;
// - error guessing: a control character in the note is refused before any call;
// - light and dark: the row's words (the receiving account's line among them) keep a contrast of 4.5:1 or more on
//   their background in both schemes.

test.beforeEach(async ({ db, seeded }) => {
	await dropPaymentRows(db, seeded.tenantId);
	await clearQueue(db, seeded);
});

test.afterEach(async ({ db, seeded }) => {
	await dropPaymentRows(db, seeded.tenantId);
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
});

/** The contrast of an element's text on the first opaque background behind it (WCAG's relative luminance). */
async function contrastOf(locator: Locator): Promise<number> {
	return await locator.evaluate((element) => {
		const parse = (text: string) => {
			const match = /rgba?\(([^)]+)\)/.exec(text);
			if (match === null) throw new Error(`a colour not in rgb: ${text}`);
			const parts = (match[1] ?? "")
				.split(/[\s,/]+/)
				.filter((part) => part !== "")
				.map(Number);
			return {
				r: parts[0] ?? 0,
				g: parts[1] ?? 0,
				b: parts[2] ?? 0,
				a: parts[3] ?? 1,
			};
		};
		let node: Element | null = element;
		let background = { r: 255, g: 255, b: 255, a: 1 };
		while (node !== null) {
			const colour = parse(getComputedStyle(node).backgroundColor);
			if (colour.a > 0) {
				background = colour;
				break;
			}
			node = node.parentElement;
		}
		const channel = (value: number) => {
			const v = value / 255;
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		};
		const luminance = (c: { r: number; g: number; b: number }) =>
			0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
		const a = luminance(parse(getComputedStyle(element).color));
		const b = luminance(background);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	});
}

async function expectReadable(row: Locator): Promise<void> {
	for (const testId of [
		"payment-exception-kind",
		"payment-exception-status",
		"payment-exception-method",
		"payment-exception-reference",
		"payment-exception-order",
		"payment-exception-time",
		"payment-exception-account",
	]) {
		expect(
			await contrastOf(row.getByTestId(testId)),
			testId,
		).toBeGreaterThanOrEqual(4.5);
	}
}

test("criterion 6: Đối soát ngày says how much money waits for a manager and leads to it; settled with a 200-character note, the line goes", {
	tag: ["@criterion-6"],
}, async ({ page, seeded, db }) => {
	const provider = await vietqrProvider(
		db,
		seeded.tenantId,
		seeded.brandId,
		seeded.storeA,
	);
	const held = await unknownTransfer(db, provider, 45_000);
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/ca-lam");
	const day = page.getByTestId("reconciliation");
	const line = day.getByTestId("reconciliation-payment-exceptions");
	await expect(line).toHaveText(
		"1 khoản tiền chờ xử lý, chưa tính vào đối soát →",
		{ timeout: 20_000 },
	);
	await expectNoHorizontalScroll(page);
	await line.click();
	await expect(page).toHaveURL(/#\/quan-ly\/tien-cho-xu-ly$/);
	const row = page.locator(
		`[data-testid="payment-exception-row"][data-exception="${held}"]`,
	);
	await expect(row.getByTestId("payment-exception-kind")).toHaveText(
		"Không rõ đơn",
	);
	await expect(row.getByTestId("payment-exception-amount")).toHaveAttribute(
		"data-price",
		"45000",
	);
	const resolve = row.getByRole("button", { name: /^Xử lý khoản 45\.000đ/ });
	// opened from the keyboard, Escape closes the dialog and gives the focus back to the row's button
	await resolve.focus();
	await page.keyboard.press("Enter");
	const dialog = page.getByTestId("resolve-dialog");
	await expect(
		dialog.getByRole("radio", { name: "Đã trả lại khách" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(resolve).toBeFocused();

	await resolve.click();
	await dialog.getByRole("radio", { name: "Bỏ qua, không trả lại" }).check();
	const note = dialog.getByLabel("Ghi chú");
	await note.fill("x".repeat(201));
	await dialog.getByTestId("resolve-next").click();
	await expect(dialog.getByTestId("resolve-note-error")).toHaveText(
		"Ghi chú tối đa 200 ký tự. Đang có 201.",
	);
	await expect(note).toHaveAttribute("aria-invalid", "true");
	await expect(note).toBeFocused();
	await expect(dialog.getByTestId("resolve-confirmation")).toHaveCount(0);
	const text = `Chuyển thử của quán ${"x".repeat(180)}`;
	expect([...text]).toHaveLength(200);
	await note.fill(text);
	await expect(note).toHaveAttribute("aria-invalid", "false");
	await note.press("Enter");
	await expect(dialog.getByTestId("resolve-question")).toHaveText(
		"Ghi khoản 45.000đ là “Bỏ qua, không trả lại”?",
	);
	await expectNoHorizontalScroll(page);
	await dialog.getByTestId("resolve-confirm").click();
	await expect(page.getByTestId("toast")).toContainText(
		"Đã ghi khoản 45.000đ: Bỏ qua, không trả lại.",
	);
	await expect(page.getByTestId("payment-exceptions-empty")).toHaveText(
		"Không có khoản tiền nào chờ xử lý.",
	);
	const [after] = await db<{ status: string; resolution_note: string }[]>`
		select status, resolution_note from public.payment_exceptions where id = ${held}`;
	expect(after).toEqual({ status: "dismissed", resolution_note: text });
	// the day no longer says money waits
	await page.goto("/#/quan-ly/ca-lam");
	await expect(day.getByTestId("reconciliation-revenue")).toBeVisible();
	await expect(line).toHaveCount(0);
});

test("the owner settles it first: the page says so and reloads; a control character is refused before any call; readable in light and dark", {
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
		seeded.sizes.tea,
		9_000,
	);
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/tien-cho-xu-ly");
	const row = page.locator(
		`[data-testid="payment-exception-row"][data-exception="${short.exception}"]`,
	);
	await expect(row.getByTestId("payment-exception-expected")).toContainText(
		"Đơn cần 39.000đ",
	);
	await expectReadable(row);
	const lightBackground = await row.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);

	await row.getByTestId("payment-exception-resolve").click();
	const dialog = page.getByTestId("resolve-dialog");
	await dialog.getByRole("radio", { name: "Đã trả lại khách" }).check();
	await dialog.getByLabel("Ghi chú").fill("Đã chuyển\tlại");
	await dialog.getByTestId("resolve-next").click();
	await expect(dialog.getByTestId("resolve-note-error")).toHaveText(
		"Ghi chú chỉ một dòng, không chứa ký tự điều khiển.",
	);
	await expect(dialog.getByTestId("resolve-confirmation")).toHaveCount(0);
	await dialog.getByLabel("Ghi chú").fill("Đã chuyển lại 30.000đ");
	await dialog.getByTestId("resolve-next").click();
	await expect(dialog.getByTestId("resolve-confirm")).toBeEnabled();

	// meanwhile the owner settles it on another device
	const owner = await asMember(db, seeded.people.owner.id, async (tx) => {
		const [answer] = await tx<{ r: { state: string } }[]>`
			select public.manager_resolve_payment_exception(${short.exception}::uuid, 'dismissed', 'Khách để lại cho quán') as r`;
		return answer?.r.state;
	});
	expect(owner).toBe("dismissed");
	await dialog.getByTestId("resolve-confirm").click();
	await expect(page.getByTestId("payment-exceptions-message")).toHaveText(
		"Khoản này đã được xử lý trước đó: Đã bỏ qua. Danh sách đã được tải lại.",
	);
	await expect(dialog).toHaveCount(0);
	await expect(row).toHaveCount(0);
	const [kept] = await db<{ status: string; resolution_note: string }[]>`
		select status, resolution_note from public.payment_exceptions where id = ${short.exception}`;
	expect(kept).toEqual({
		status: "dismissed",
		resolution_note: "Khách để lại cho quán",
	});
	await page
		.getByTestId("payment-exceptions-filter")
		.getByRole("button", { name: "Đã xử lý" })
		.click();
	await expect(row.getByTestId("payment-exception-resolution")).toContainText(
		`Đã bỏ qua · ${seeded.people.owner.name} · `,
	);
	await expect(row.getByTestId("payment-exception-note")).toHaveText(
		"Ghi chú: Khách để lại cho quán",
	);
	await expectReadable(row);

	// dark: the tokens change and the words stay readable
	await page.emulateMedia({ colorScheme: "dark" });
	await expect
		.poll(() =>
			row.evaluate((element) => getComputedStyle(element).backgroundColor),
		)
		.not.toBe(lightBackground);
	await expectReadable(row);
	expect(
		await contrastOf(row.getByTestId("payment-exception-note")),
	).toBeGreaterThanOrEqual(4.5);
	await expectNoHorizontalScroll(page);
});
