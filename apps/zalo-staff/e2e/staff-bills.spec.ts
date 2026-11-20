// Test design (ISTQB): end-to-end state transition tests of loyalty in staff mode (no POS) on the built app with the
// stand-in Zalo SDK and the demo client (`?storeMode=staff` puts Cửa hàng Mẫu 1 in staff mode with self claims):
// a bill recorded from a stand-in scan waits for the customer; the counter QR shows and a counter claim is answered
// blind; a manager approves a queued bill and fails a random audit; a reward is confirmed in staff mode and voided by a
// manager. Decision table role x action: staff never see Hoàn tác, Duyệt hóa đơn or Hủy ưu đãi. Security: no full phone
// on any screen and the customer's total never shown to staff. All members and phones are fictional.
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import {
	expectOnePrimaryAction,
	expectResultModalClosed,
	watchResultModal,
} from "./entry-checks";

const NOON = new Date("2026-11-19T12:00:00+07:00");
const FULL_PHONES = /0900001234|0900005678|0900003333|0900004444/;
const POS_REWARD = "UD2468";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function home(page: Page, role: "staff" | "manager"): Promise<void> {
	await page.goto(`./?role=${role}&storeMode=staff`);
	await expect(
		page
			.getByTestId("home-loyalty")
			.getByRole("button", { name: "Ghi hóa đơn" }),
	).toBeVisible();
}

async function openFromHome(page: Page, name: string): Promise<void> {
	await page.getByTestId("home-loyalty").getByRole("button", { name }).click();
}

async function noFullPhone(page: Page): Promise<void> {
	await expect(page.locator("body")).not.toContainText(FULL_PHONES);
}

test("staff record a scanned bill that waits for the customer, and see no manager action", async ({
	page,
}) => {
	await home(page, "staff");
	const card = page.getByTestId("home-loyalty");
	await expect(card.getByTestId("home-bill-queue")).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: "Ghi nhận khách" }),
	).toHaveCount(0);
	await checkScreen(page);
	await openFromHome(page, "Ghi hóa đơn");
	await expect(
		page.getByRole("heading", { level: 1, name: "Ghi hóa đơn" }),
	).toBeVisible();
	await expect(page.getByTestId("bills-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
	await checkScreen(page);
	await page.getByTestId("scan").click();
	await expect(page.getByTestId("bill-scanned")).toBeVisible();
	await expect(page.getByTestId("bill-code")).toHaveValue("246810");
	await page.getByTestId("bill-no").fill("HD-0040");
	await page.getByTestId("bill-total").fill("185.000");
	await watchResultModal(page);
	await page.getByRole("button", { name: "Ghi hóa đơn" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã ghi hóa đơn/);
	await expectResultModalClosed(page);
	const result = page.getByTestId("bill-result");
	await expect(result).toHaveAttribute("data-state", "awaiting_customer");
	await expect(page.getByTestId("bill-confirm-by")).toHaveText(
		"Khách xác nhận trước 12:00 ngày 20/11/2026",
	);
	await expect(page.getByTestId("bill-member")).toHaveText(
		"Khách •••• ••• 234",
	);
	await expect(
		page.locator("[data-testid=recent-bill][data-bill-no=HD-0040]"),
	).toHaveAttribute("data-state", "awaiting_customer");
	await expect(page.getByRole("button", { name: /^Hoàn tác/ })).toHaveCount(0);
	await noFullPhone(page);
	await checkScreen(page);
});

test("the counter QR shows and a counter claim is answered with the total read blind", async ({
	page,
}) => {
	await home(page, "staff");
	await openFromHome(page, "Mã quầy");
	const qr = page.getByTestId("counter-qr");
	await expect(qr).toBeVisible();
	await expect(qr).toHaveAttribute(
		"data-payload",
		/^fnb-counter:1:Q1:[A-HJ-NP-Z2-9]{12}$/,
	);
	await expect(page.getByTestId("counter-claim")).toHaveCount(2);
	await expect(page.locator("body")).not.toContainText(/65[.,\s]?000/);
	await checkScreen(page);
	await page
		.getByRole("button", { name: "Nhập tổng tiền cho hóa đơn HD-0033" })
		.click();
	await expect(page.getByTestId("claim-blind")).toBeVisible();
	await expect(page.locator("body")).not.toContainText(/65[.,\s]?000/);
	await page.getByTestId("claim-total").fill("65000");
	await checkScreen(page);
	await watchResultModal(page);
	await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã cộng cho khách/,
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("counter-claim")).toHaveCount(1);
	await noFullPhone(page);
	await checkScreen(page);
});

test("a manager approves a queued bill and fails a random audit", async ({
	page,
}) => {
	await home(page, "manager");
	const row = page.getByTestId("home-bill-queue");
	await expect(row.getByTestId("home-bill-queue-count")).toHaveText(
		"3 việc cần duyệt",
	);
	await row.getByRole("button", { name: "Mở duyệt hóa đơn" }).click();
	await expect(page.getByTestId("bill-queue-body")).toHaveAttribute(
		"data-status",
		"ready",
	);
	await expect(page.getByTestId("queued-bill")).toHaveCount(2);
	const over = page.locator("[data-testid=queued-bill][data-bill-no=HD-0027]");
	await expect(over.getByTestId("staff-total")).toHaveText(
		/^Nhân viên nhập: 1\.250\.000\s₫$/,
	);
	await checkScreen(page);
	await over.getByRole("button", { name: "Xử lý hóa đơn HD-0027" }).click();
	await page
		.getByTestId("bill-decide-reason")
		.fill("Đã đối chiếu hóa đơn giấy");
	await checkScreen(page);
	await watchResultModal(page);
	await page.getByRole("button", { name: "Duyệt", exact: true }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã duyệt hóa đơn/);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("queued-bill")).toHaveCount(1);
	await page.getByRole("button", { name: "Kiểm tra hóa đơn HD-0019" }).click();
	await page.getByTestId("audit-note").fill("Tổng tiền trên hóa đơn giấy khác");
	await watchResultModal(page);
	await page.getByRole("button", { name: "Không đạt" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã ghi kết quả: không đạt/,
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("bill-audit")).toHaveCount(0);
	await noFullPhone(page);
	await checkScreen(page);
});

test("a reward is confirmed at once in staff mode and voided by a manager", async ({
	page,
}) => {
	await home(page, "manager");
	await openFromHome(page, "Kiểm tra ưu đãi");
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	const confirm = page.getByRole("button", { name: "Xác nhận đã dùng" });
	await expect(confirm).toBeVisible();
	await expect(page.getByTestId("result-modal")).toHaveCount(0, {
		timeout: 3000,
	});
	await checkScreen(page);
	await confirm.click();
	const confirmed = page.getByTestId("redeem-confirmed");
	await expect(confirmed.getByTestId("redeem-confirmed-discount")).toHaveText(
		"Thành viên - Tặng 1 ly",
	);
	await expect(page.getByTestId("redeem-void-until")).toHaveText(
		"Quản lý có thể hủy ưu đãi đến 20:00 ngày 19/11/2026.",
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Hủy ưu đãi" }).click();
	await page.getByTestId("redeem-void-reason").fill("Khách đổi ý, không dùng");
	await page.getByRole("button", { name: "Xác nhận hủy" }).click();
	await expect(page.getByTestId("redeem-voided")).toHaveText(
		"Đã hủy ưu đãi. Dấu hoặc điểm đã trả lại cho khách.",
	);
	await checkScreen(page);
});

test("staff confirm a reward but cannot void it, and the review screen stays closed to them", async ({
	page,
}) => {
	await home(page, "staff");
	await openFromHome(page, "Kiểm tra ưu đãi");
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await page.getByRole("button", { name: "Xác nhận đã dùng" }).click();
	await expect(page.getByTestId("redeem-confirmed")).toBeVisible();
	await expect(page.getByRole("button", { name: "Hủy ưu đãi" })).toHaveCount(0);
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByTestId("home-loyalty")).toBeVisible();
	await expect(page.getByTestId("home-bill-queue")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /Duyệt hóa đơn/ })).toHaveCount(
		0,
	);
});

test("Ghi nhận khách at a staff-mode store says so and opens Ghi hóa đơn there", async ({
	page,
}) => {
	await page.goto("./?role=manager&storeMode=staff");
	await expect(page.getByTestId("home-loyalty")).toBeVisible();
	await page
		.getByLabel("Cửa hàng", { exact: true })
		.first()
		.selectOption({ label: "Cửa hàng Mẫu 2" });
	await openFromHome(page, "Ghi nhận khách");
	await expect(page.getByTestId("checkin-entry")).toBeVisible();
	await page
		.getByTestId("loyalty-store-picker")
		.selectOption({ label: "Cửa hàng Mẫu 1" });
	await page.getByTestId("checkin-entry").fill("0900001234");
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	const problem = page.getByTestId("checkin-problem");
	await expect(problem).toHaveAttribute("data-refusal", "staff_mode");
	await expect(problem).toHaveText(
		"Cửa hàng này ghi hóa đơn tay thay cho máy POS. Hãy dùng Ghi hóa đơn để cộng dấu và điểm cho khách.",
	);
	await checkScreen(page);
	await page.getByTestId("checkin-to-bills").click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Ghi hóa đơn" }),
	).toBeVisible();
	await expect(page.getByTestId("loyalty-store-picker")).toHaveValue(
		"00000000-0000-4000-8000-0000000005a1",
	);
	await expect(page.getByTestId("bill-code")).toBeVisible();
});
