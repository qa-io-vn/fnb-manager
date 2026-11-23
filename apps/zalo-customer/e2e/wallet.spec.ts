import { expect, test } from "@playwright/test";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	openHome,
	openTab,
	watchCustomerPage,
} from "./customer-checks";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

test("the wallet shows the card, stamps, points, tier, expiry and the history states", async ({
	page,
}) => {
	await openHome(page, "?member=1");
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("card-name")).toHaveText("Khách thử");
	await expect(page.getByTestId("card-phone")).toHaveText("•••• ••• 789");
	await expect(page.getByTestId("card-purchases")).toHaveText("Số lần mua: 2");
	await expect(page.getByTestId("stamp-count")).toHaveText("3/10 dấu");
	await expect(
		page.getByRole("img", {
			name: "3 trên 10 dấu, 1 dấu đang chờ xác nhận",
		}),
	).toBeVisible();
	await expect(page.getByTestId("points-balance")).toHaveText("105");
	// ADR-047: the notice names the last valid day, a date and never a time.
	await expect(page.getByTestId("points-expiring")).toHaveText(
		/^45 điểm có hạn đến hết ngày \d{2}\/\d{2}\/\d{4}$/,
	);
	await expect(page.getByTestId("tier")).toHaveText(
		"Hạng Thành viên. Còn 395 điểm để lên hạng Bạc.",
	);
	const states = page.getByTestId("history-item");
	await expect(states).toHaveCount(5);
	expect(
		await states.evaluateAll((items) =>
			items.map((item) => item.getAttribute("data-state")),
		),
	).toEqual(["pending", "confirmed", "reversed", "confirmed", "confirmed"]);
	await expect(states.first()).toContainText("Đang chờ xác nhận");
	await checkCustomerScreen(page);
});

test("the member code is bound to the linked store and refreshes every 60 seconds", async ({
	page,
}) => {
	await page.goto("./?member=1&store=mau-1&src=standee");
	await page
		.getByRole("button", { name: "Mã thành viên tại cửa hàng này" })
		.click();
	const code = page.getByTestId("member-code");
	await expect(code).toHaveText(/^\d{6}$/);
	const first = (await code.textContent()) ?? "";
	await expect(page.getByTestId("code-store")).toHaveText("Cửa hàng Mẫu 1");
	await expect(page.getByTestId("member-qr")).toBeVisible();
	await expect(page.getByTestId("code-valid-until")).toHaveText(
		/^Dùng được đến 10:02:0\d$/,
	);
	await expect(page.getByTestId("code-countdown")).toHaveText(
		/^Mã đổi sau (60|5\d) giây$/,
	);
	await checkCustomerScreen(page);
	await page.clock.fastForward(30_000);
	await expect(page.getByTestId("code-countdown")).toHaveText(
		/^Mã đổi sau (30|2\d) giây$/,
	);
	await page.clock.fastForward(31_000);
	await expect(code).not.toHaveText(first);
	await expect(page.getByTestId("code-valid-until")).toHaveText(
		/^Dùng được đến 10:03:\d\d$/,
	);
	await page.getByTestId("code-store-picker").selectOption("mau-2");
	await expect(page.getByTestId("code-store")).toHaveText("Cửa hàng Mẫu 2");
	await checkCustomerScreen(page);
});

test("a receipt claim is validated, sent and credited, within the day's limit", async ({
	page,
}) => {
	await openHome(page, "?member=1&claims=2");
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	const form = page.getByTestId("claim-form");
	await expect(form.getByTestId("claim-date")).toHaveValue("2026-11-19");
	await expect(form.getByTestId("claims-left")).toHaveText(
		"Hôm nay bạn còn 1 lần gửi hóa đơn.",
	);
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(form.getByText("Hãy chọn cửa hàng.")).toBeVisible();
	await expect(form.getByText("Hãy nhập số hóa đơn.")).toBeVisible();
	await checkCustomerScreen(page);
	await form.getByTestId("claim-store").selectOption("mau-1");
	await form.getByTestId("claim-receipt").fill("1001");
	await form.getByTestId("claim-amount").fill("85000");
	await expect(form.getByTestId("claim-amount")).toHaveValue("85.000");
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	const result = page.getByTestId("claim-result");
	await expect(result).toHaveAttribute("data-state", "matched");
	await expect(page.getByTestId("claims-left-after")).toContainText(
		"Hôm nay bạn đã gửi đủ số hóa đơn cho phép.",
	);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Xem thẻ thành viên" }).click();
	await expect(page.getByTestId("stamp-count")).toHaveText("4/10 dấu");
	await expect(page.getByTestId("claim-item")).toContainText("Đã cộng điểm");
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
	await checkCustomerScreen(page);
});

test("at a store that restarts its receipt numbers each day, a number not starting with the chosen day gets a gentle warning, never a block", async ({
	page,
}) => {
	await openHome(page, "?member=1");
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	const form = page.getByTestId("claim-form");
	await form.getByTestId("claim-store").selectOption("mau-2");
	const receipt = form.getByTestId("claim-receipt");
	const warning = form.getByTestId("claim-receipt-day");
	await receipt.fill("1001");
	await expect(warning).toHaveCount(0);
	await receipt.press("Tab");
	await expect(warning).toHaveText(
		"Số hóa đơn ở cửa hàng này bắt đầu bằng ngày trong tháng (19 cho ngày đã chọn). Hãy xem lại số hóa đơn hoặc ngày trên hóa đơn. Bạn vẫn gửi được.",
	);
	await expect(receipt).toHaveAttribute("aria-invalid", "false");
	await checkCustomerScreen(page);
	await receipt.fill("190042");
	await expect(warning).toHaveCount(0);
	await form.getByTestId("claim-date").selectOption("2026-11-18");
	await expect(warning).toHaveAttribute("data-day", "18");
	await receipt.fill("180042");
	await expect(warning).toHaveCount(0);
	await form.getByTestId("claim-amount").fill("42000");
	await form.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"matched",
	);
	await page.getByRole("button", { name: "Gửi hóa đơn khác" }).click();
	const again = page.getByTestId("claim-form");
	await again.getByTestId("claim-store").selectOption("mau-2");
	await again.getByTestId("claim-receipt").fill("0042");
	await again.getByTestId("claim-amount").fill("30000");
	await again.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	await checkCustomerScreen(page);
});

test("the receipt-day warning speaks English and stays away from a store that numbers by year", async ({
	page,
}) => {
	await page.goto("./?member=1&lang=en&store=mau-2");
	await page
		.getByRole("button", { name: "Earn from a receipt" })
		.first()
		.click();
	const form = page.getByTestId("claim-form");
	await expect(form.getByTestId("claim-store")).toHaveValue("mau-2");
	await form.getByTestId("claim-receipt").fill("4321");
	await form.getByTestId("claim-receipt").press("Tab");
	await expect(form.getByTestId("claim-receipt-day")).toHaveText(
		"Receipt numbers at this store start with the day of the month (19 for the date you chose). Check the receipt number or the date on the receipt. You can still send it.",
	);
	await checkCustomerScreen(page);
	await form.getByTestId("claim-store").selectOption("mau-1");
	await expect(form.getByTestId("claim-receipt-day")).toHaveCount(0);
});

test("a reward is redeemed with a confirmation of its cost, its code counts down, and used and returned vouchers say so", async ({
	page,
}) => {
	await page.goto("./?member=1&vouchers=1&store=mau-1&src=qr");
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 1" }),
	).toBeVisible();
	await openTab(page, "Thẻ thành viên");
	await page.getByRole("button", { name: "Ví voucher" }).click();
	const vouchers = page.getByTestId("voucher-item");
	await expect(vouchers).toHaveCount(2);
	await expect(vouchers.nth(0)).toHaveAttribute("data-state", "returned");
	await expect(vouchers.nth(0)).toContainText("Đã hoàn lại");
	await expect(vouchers.nth(0)).toContainText(
		"Mã chưa được dùng nên 3 dấu đã được hoàn lại vào thẻ của bạn.",
	);
	await expect(vouchers.nth(1)).toHaveAttribute("data-state", "used");
	await expect(vouchers.nth(1)).toContainText("Đã dùng");
	await checkCustomerScreen(page);

	await page.getByRole("button", { name: "Đổi quà" }).click();
	await expect(page.getByTestId("reward-store-picker")).toHaveValue("mau-1");
	const rewards = page.getByTestId("reward");
	await expect(rewards).toHaveCount(4);
	await expect(rewards.nth(1).getByTestId("reward-state")).toHaveText(
		"Bạn đã đổi quà này đủ số lần cho phép.",
	);
	await expect(rewards.nth(3).getByTestId("reward-state")).toHaveText(
		"Cần thêm 2 dấu để đổi.",
	);
	await expect(
		rewards.nth(3).getByRole("button", { name: "Đổi quà" }),
	).toBeDisabled();
	await checkCustomerScreen(page);
	await rewards.nth(0).getByRole("button", { name: "Đổi quà" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Đổi Tặng 1 ly cà phê sữa?",
	});
	await expect(dialog.getByTestId("redeem-cost")).toHaveText(
		"Bạn dùng 3 dấu để đổi quà này tại Cửa hàng Mẫu 1.",
	);
	await checkCustomerScreen(page);
	await dialog.getByRole("button", { name: "Xác nhận đổi" }).click();
	await expect(page.getByTestId("voucher-code")).toHaveText(/^[A-Z0-9]{8}$/);
	await expect(page.getByTestId("voucher-qr")).toBeVisible();
	await expect(page.getByTestId("voucher-countdown")).toHaveText(
		/^Còn (24:00:00|23:59:5\d)$/,
	);
	await checkCustomerScreen(page);
	await page.clock.fastForward(90_000);
	await expect(page.getByTestId("voucher-countdown")).toHaveText(
		/^Còn 23:58:(2\d|30)$/,
	);
	await page.getByRole("button", { name: "Ví voucher" }).click();
	await expect(vouchers).toHaveCount(3);
	await expect(vouchers.first()).toHaveAttribute("data-state", "held");
	await checkCustomerScreen(page);
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("stamp-count")).toHaveText("0/10 dấu");
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
});
