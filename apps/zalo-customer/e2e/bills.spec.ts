// Test design for the staff-mode loyalty screens of the customer Mini App, end to end in the demo world with the
// mocked Zalo SDK (bill verification without the POS, path E):
// - state transitions of a staff-recorded bill: waiting -> confirmed (the right total), -> queued (another total,
//   sent to a manager), -> reversed ("Không đúng");
// - the counter claim with the stand-in camera: a fresh code confirms at once (auto approval of a small total),
//   the same code again is refused as used (replay), a stale code as expired, and a text that is not a counter
//   QR is never sent;
// - the receipt claim at a staff-mode store is refused with staff_mode and points to the counter QR;
// - security: the staff total and the phone digits are never on screen or in the address.
// The member, stores, bills and codes are fictional demo data.
import { expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	openHome,
	openTab,
	watchCustomerPage,
} from "./customer-checks";

const BILL_NO = "HD0457";
const STAFF_TOTAL = /85[.,\s]?000/;
const LIVE_QR = "fnb-counter:1:mau-1:K7M2Q9TXH3N7";
const STALE_QR = "fnb-counter:1:mau-1:P4R8W3HNT6Y2";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

async function expectNoStaffTotalOrPhone(page: Page): Promise<void> {
	// the masked phone of the card (last three digits only) is allowed; anything longer is not
	const text = ((await page.locator("body").textContent()) ?? "").replace(
		/•••• ••• 789/g,
		"",
	);
	expect(text).not.toMatch(STAFF_TOTAL);
	expect(text).not.toMatch(/\b0?9\d{8}\b|\+84/);
	expect(page.url()).not.toMatch(/85000|total|phone/i);
}

async function openBills(page: Page, search: string) {
	await openHome(page, search);
	const prompt = page.getByTestId("bills-prompt");
	await expect(prompt).toHaveText(/Bạn có 1 hóa đơn cần xác nhận\./);
	await prompt.getByRole("button", { name: "Xác nhận hóa đơn" }).click();
	const card = page.getByTestId("bills-to-confirm");
	await expect(card.getByTestId("bill-to-confirm")).toContainText(
		`Hóa đơn ${BILL_NO}`,
	);
	return card;
}

test("a bill confirmed with the total the customer paid earns at once", async ({
	page,
}) => {
	const card = await openBills(page, "?member=1&bill=1");
	await expectNoStaffTotalOrPhone(page);
	await checkCustomerScreen(page);
	await card.getByTestId("bill-total").fill("85000");
	await expect(card.getByTestId("bill-total")).toHaveValue("85.000");
	await card.getByTestId("bill-confirm").click();
	await expect(card.getByTestId("bill-result")).toHaveText(
		`Đã xác nhận hóa đơn ${BILL_NO}. Điểm đã được cộng vào thẻ.`,
	);
	await expect(card.getByTestId("bill-to-confirm")).toHaveCount(0);
	const latest = page.getByTestId("history-item").first();
	await expect(latest).toHaveAttribute("data-state", "confirmed");
	await expect(latest).toContainText("Qua hóa đơn nhân viên ghi nhận");
	await expectNoStaffTotalOrPhone(page);
	await checkCustomerScreen(page);
});

test("a different total goes to a manager without showing the store's total", async ({
	page,
}) => {
	const card = await openBills(page, "?member=1&bill=1");
	await card.getByTestId("bill-total").fill("58000");
	await card.getByTestId("bill-confirm").click();
	await expect(card.getByTestId("bill-result")).toHaveText(
		`Tổng tiền bạn nhập cho hóa đơn ${BILL_NO} chưa khớp với cửa hàng ghi nhận. Quản lý cửa hàng sẽ kiểm tra, điểm được cộng khi hóa đơn đúng.`,
	);
	await expect(page.getByTestId("history-item").first()).toHaveAttribute(
		"data-state",
		"pending",
	);
	await expectNoStaffTotalOrPhone(page);
	await checkCustomerScreen(page);
});

test("“Không đúng” asks once more, then reverses the bill", async ({
	page,
}) => {
	const card = await openBills(page, "?member=1&bill=1");
	await card.getByTestId("bill-dispute").click();
	await expect(card.getByTestId("bill-dispute-ask")).toContainText(
		`Hóa đơn ${BILL_NO} không phải của bạn?`,
	);
	await checkCustomerScreen(page);
	await card.getByRole("button", { name: "Đúng, không phải của tôi" }).click();
	await expect(card.getByTestId("bill-result")).toHaveText(
		`Đã ghi nhận hóa đơn ${BILL_NO} không phải của bạn. Điểm của hóa đơn này đã được hủy và cửa hàng sẽ kiểm tra.`,
	);
	await expect(page.getByTestId("history-item").first()).toHaveAttribute(
		"data-state",
		"reversed",
	);
	await checkCustomerScreen(page);
});

test("a counter claim with the stand-in camera earns at once, and the same code again is refused", async ({
	page,
}) => {
	await openHome(page, "?member=1&staff=1");
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await page
		.getByTestId("claim-counter-entry")
		.getByRole("button", { name: "Quét mã tại quầy" })
		.click();
	await expect(
		page.getByRole("heading", { name: "Quét mã tại quầy" }),
	).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByTestId("counter-scan-button").click();
	const form = page.getByTestId("counter-form");
	await expect(form.getByTestId("counter-store")).toHaveText(
		"Đã quét mã tại quầy của Cửa hàng Mẫu 1",
	);
	await form.getByTestId("counter-bill-no").fill("HD0600");
	await form.getByTestId("counter-total").fill("45000");
	await checkCustomerScreen(page);
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	const result = page.getByTestId("counter-result");
	await expect(result).toHaveAttribute("data-state", "confirmed");
	await expect(result.getByTestId("counter-earned")).toHaveText(
		"+1 dấu · +45 điểm",
	);
	await checkCustomerScreen(page);
	await result.getByRole("button", { name: "Quét mã khác" }).click();
	await page.getByTestId("counter-scan-button").click();
	await form.getByTestId("counter-bill-no").fill("HD0601");
	await form.getByTestId("counter-total").fill("45000");
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(result).toHaveAttribute("data-refusal", "code_used");
	await expect(result.getByTestId("counter-result-body")).toHaveText(
		"Bạn đã dùng mã này rồi. Mỗi mã chỉ dùng được một lần, hãy quét mã mới.",
	);
	await expect(result.getByRole("button", { name: "Quét lại" })).toBeVisible();
	await expectNoStaffTotalOrPhone(page);
});

test("a lost answer on Xác nhận hóa đơn: the retry shows the first outcome, not already answered (G-92)", async ({
	page,
}) => {
	const card = await openBills(page, "?member=1&bill=1&net=lost-once");
	await card.getByTestId("bill-total").fill("85000");
	await card.getByTestId("bill-confirm").click();
	await expect(card.getByRole("alert")).toHaveText(
		"Mất kết nối mạng. Kiểm tra mạng rồi thử lại.",
	);
	await expect(card.getByTestId("bill-result")).toHaveCount(0);
	await checkCustomerScreen(page);
	await card.getByTestId("bill-confirm").click();
	await expect(card.getByTestId("bill-result")).toHaveText(
		`Đã xác nhận hóa đơn ${BILL_NO}. Điểm đã được cộng vào thẻ.`,
	);
	await expect(page.getByTestId("history-item").first()).toHaveAttribute(
		"data-state",
		"confirmed",
	);
	await expectNoStaffTotalOrPhone(page);
	await checkCustomerScreen(page);
});

test("a lost answer on a counter claim: the retry shows the first outcome, and the wallet lists the claim (G-92)", async ({
	page,
}) => {
	await openHome(page, "?member=1&staff=1&net=lost-once");
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await page
		.getByTestId("claim-counter-entry")
		.getByRole("button", { name: "Quét mã tại quầy" })
		.click();
	await page.getByTestId("counter-scan-button").click();
	const form = page.getByTestId("counter-form");
	await form.getByTestId("counter-bill-no").fill("HD0620");
	await form.getByTestId("counter-total").fill("150000");
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(form.getByRole("alert")).toHaveText(
		"Mất kết nối mạng. Kiểm tra mạng rồi thử lại.",
	);
	await checkCustomerScreen(page);
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	const result = page.getByTestId("counter-result");
	await expect(result).toHaveAttribute("data-state", "awaiting_staff");
	await expect(result).not.toHaveAttribute("data-refusal", "code_used");
	await openTab(page, "Thẻ thành viên");
	const claims = page.getByTestId("counter-claims");
	await expect(
		claims.getByRole("heading", { name: "Hóa đơn gửi tại quầy" }),
	).toBeVisible();
	const item = claims.getByTestId("counter-claim-item");
	await expect(item).toHaveCount(1);
	await expect(item).toHaveAttribute("data-state", "awaiting_staff");
	await expect(item).toContainText("Hóa đơn HD0620");
	await expect(item).toContainText("Chờ nhân viên đối chiếu");
	await expect(item.getByTestId("counter-claim-deadline")).toHaveText(
		/^Nhân viên đối chiếu trước \d\d:\d\d \d\d\/\d\d\/\d{4}$/,
	);
	expect((await page.locator("body").textContent()) ?? "").not.toMatch(
		/150[.,\s]?000/,
	);
	await checkCustomerScreen(page);
});

test("the wallet's counter claims in English (G-92)", async ({ page }) => {
	await openHome(page, "?member=1&staff=1&lang=en");
	await page.getByRole("button", { name: "Earn from a receipt" }).click();
	await page
		.getByTestId("claim-counter-entry")
		.getByRole("button", { name: "Scan the counter code" })
		.click();
	await page.getByTestId("counter-scan-button").click();
	const form = page.getByTestId("counter-form");
	await form.getByTestId("counter-bill-no").fill("HD0621");
	await form.getByTestId("counter-total").fill("150000");
	await form.getByRole("button", { name: "Send the bill" }).click();
	await expect(page.getByTestId("counter-result")).toHaveAttribute(
		"data-state",
		"awaiting_staff",
	);
	await openTab(page, "Member card");
	const claims = page.getByTestId("counter-claims");
	await expect(
		claims.getByRole("heading", { name: "Bills sent at the counter" }),
	).toBeVisible();
	await expect(claims.getByTestId("counter-claim-item")).toContainText(
		"Waiting for staff",
	);
	await checkCustomerScreen(page);
});

test("a stale counter code is refused as expired, and a text that is not one is never sent", async ({
	page,
}) => {
	await openHome(
		page,
		`?member=1&staff=1&scanCode=${encodeURIComponent(STALE_QR)}`,
	);
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await page
		.getByTestId("claim-counter-entry")
		.getByRole("button", { name: "Quét mã tại quầy" })
		.click();
	await page.getByTestId("counter-scan-button").click();
	const form = page.getByTestId("counter-form");
	await form.getByTestId("counter-bill-no").fill("HD0602");
	await form.getByTestId("counter-total").fill("45000");
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	const result = page.getByTestId("counter-result");
	await expect(result).toHaveAttribute("data-refusal", "code_expired");
	await expect(result.getByTestId("counter-result-body")).toHaveText(
		"Mã tại quầy đã hết hạn. Hãy quét mã mới trên màn hình của nhân viên.",
	);
	await checkCustomerScreen(page);

	await openHome(
		page,
		`?member=1&staff=1&scanCode=${encodeURIComponent(`${LIVE_QR.slice(0, -1)}`)}`,
	);
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await page
		.getByTestId("claim-counter-entry")
		.getByRole("button", { name: "Quét mã tại quầy" })
		.click();
	await page.getByTestId("counter-scan-button").click();
	await expect(page.getByTestId("counter-notice")).toHaveText(
		"Đây không phải mã tại quầy. Hãy quét mã QR trên màn hình của nhân viên thu ngân.",
	);
	await expect(page.getByTestId("counter-form")).toHaveCount(0);
	await checkCustomerScreen(page);
});

test("a receipt claim at a staff-mode store is refused and points to the counter code", async ({
	page,
}) => {
	await openHome(page, "?member=1&staff=1");
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	const form = page.getByTestId("claim-form");
	await form.getByTestId("claim-store").selectOption("mau-1");
	await expect(form.getByTestId("claim-staff-store")).toContainText(
		"Cửa hàng này ghi nhận điểm qua nhân viên.",
	);
	await form.getByTestId("claim-receipt").fill("1001");
	await form.getByTestId("claim-amount").fill("85000");
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	const result = page.getByTestId("claim-result");
	await expect(result).toHaveAttribute("data-state", "rejected");
	await expect(result).toContainText(
		"Cửa hàng này ghi nhận điểm qua nhân viên, không qua hóa đơn bạn gửi. Hãy quét mã tại quầy để nhận điểm.",
	);
	await checkCustomerScreen(page);
	await result.getByRole("button", { name: "Quét mã tại quầy" }).click();
	await expect(page.getByTestId("counter-claim")).toBeVisible();
});
