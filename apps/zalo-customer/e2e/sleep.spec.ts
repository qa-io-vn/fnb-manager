// Test design (ISTQB, G-36): session-based exploratory charters for a phone that sleeps, turned into repeatable checks
// on the simulator side. Techniques: state transition testing (code fresh -> refreshing -> expired -> new; hold held ->
// expired), error guessing (a phone that wakes offline; two taps in a row on a slow phone) and security testing
// (an expired code or hold code is never shown as usable, nothing is stored on the phone).
//
// How the sleep is made: the page clock is installed at 2026-11-19 10:00 (customer-checks); `page.clock.fastForward`
// jumps forward the way a phone does when it is locked and unlocked later: no timer runs meanwhile and the due timers
// fire once on waking. CPU and network are throttled like a mid-range Android phone with `throttleLikeAMidRangePhone`.
// What this cannot replace: the Zalo runtime and a real mid-range phone (docs/test-plan.md acceptance list, G-36).
import { throttleLikeAMidRangePhone } from "@fnb/zalo-mini/testing/paint-budget";
import { expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	openTab,
	watchCustomerPage,
} from "./customer-checks";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

async function openMemberCode(page: Page, search = ""): Promise<string> {
	await page.goto(`./?member=1&store=mau-1&src=standee${search}`);
	await page
		.getByRole("button", { name: "Mã thành viên tại cửa hàng này" })
		.click();
	const code = page.getByTestId("member-code");
	await expect(code).toHaveText(/^\d{6}$/);
	return (await code.textContent()) ?? "";
}

test("a phone that sleeps for ten minutes with the member code open wakes to a new code, valid for the new moment", async ({
	page,
}) => {
	const first = await openMemberCode(page);
	await page.clock.fastForward(10 * MINUTE);
	const code = page.getByTestId("member-code");
	await expect(code).not.toHaveText(first);
	await expect(code).toHaveText(/^\d{6}$/);
	await expect(page.getByTestId("code-expired")).toHaveCount(0);
	await expect(page.getByTestId("code-countdown")).toHaveText(
		/^Mã đổi sau (60|5\d) giây$/,
	);
	// the validity shown is that of the new code: 10 minutes after the first (10:02:xx), not the first one's
	await expect(page.getByTestId("code-valid-until")).toHaveText(
		/^Dùng được đến 10:1[1-2]:\d\d$/,
	);
	await checkCustomerScreen(page);
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
});

test("a phone that wakes without a signal shows the old code as expired, with a way to get a new one, and never counts down a past moment", async ({
	page,
	context,
}) => {
	const first = await openMemberCode(page, "&net=strict");
	// the fake clock holds back the app's idle preloading of its other screens; on a real phone it has run by now
	await page.clock.runFor(3_000);
	await page.waitForLoadState("networkidle");
	await context.setOffline(true);
	await page.clock.fastForward(10 * MINUTE);
	const card = page.getByTestId("code-card");
	await expect(page.getByTestId("code-expired")).toHaveText("Mã đã hết hạn.");
	await expect(page.getByTestId("member-code")).toHaveText(first);
	await expect(page.getByTestId("member-code")).toHaveClass(/line-through/);
	await expect(page.getByTestId("code-countdown")).toHaveCount(0);
	await expect(
		card.getByText("Mất kết nối mạng. Kiểm tra mạng rồi thử lại."),
	).toBeVisible();
	await checkCustomerScreen(page);
	// the signal comes back: one tap gets a new code and clears the warning
	await context.setOffline(false);
	await page.getByRole("button", { name: "Lấy mã mới" }).click();
	await expect(page.getByTestId("member-code")).not.toHaveText(first);
	await expect(page.getByTestId("code-expired")).toHaveCount(0);
	await expect(page.getByTestId("code-countdown")).toBeVisible();
	await checkCustomerScreen(page);
});

test("a phone that sleeps through the whole 24-hour hold wakes to an ended voucher: no code, no countdown, no negative time", async ({
	page,
}) => {
	await page.goto("./?member=1&vouchers=1&store=mau-1&src=qr");
	await openTab(page, "Thẻ thành viên");
	await page.getByRole("button", { name: "Ví voucher" }).click();
	await page.getByRole("button", { name: "Đổi quà" }).click();
	await page
		.getByTestId("reward")
		.nth(0)
		.getByRole("button", { name: "Đổi quà" })
		.click();
	await page
		.getByRole("dialog", { name: "Đổi Tặng 1 ly cà phê sữa?" })
		.getByRole("button", { name: "Xác nhận đổi" })
		.click();
	await expect(page.getByTestId("voucher-code")).toHaveText(/^[A-Z0-9]{8}$/);
	await expect(page.getByTestId("voucher-countdown")).toBeVisible();

	await page.clock.fastForward(25 * HOUR);

	await expect(page.getByTestId("voucher-state")).toHaveAttribute(
		"data-state",
		"expired",
	);
	await expect(page.getByTestId("voucher-state")).toHaveText(
		"Hết thời gian giữ",
	);
	await expect(page.getByTestId("voucher-code")).toHaveCount(0);
	await expect(page.getByTestId("voucher-qr")).toHaveCount(0);
	await expect(page.getByTestId("voucher-countdown")).toHaveCount(0);
	expect(await page.locator("body").textContent()).not.toMatch(
		/Còn -|-\d:\d\d/,
	);
	await checkCustomerScreen(page);
});

test("a phone that sleeps for ten minutes inside the hold keeps the code and counts the time that passed", async ({
	page,
}) => {
	await page.goto("./?member=1&vouchers=1&store=mau-1&src=qr");
	await openTab(page, "Thẻ thành viên");
	await page.getByRole("button", { name: "Ví voucher" }).click();
	await page.getByRole("button", { name: "Đổi quà" }).click();
	await page
		.getByTestId("reward")
		.nth(0)
		.getByRole("button", { name: "Đổi quà" })
		.click();
	await page
		.getByRole("dialog", { name: "Đổi Tặng 1 ly cà phê sữa?" })
		.getByRole("button", { name: "Xác nhận đổi" })
		.click();
	const voucherCode = page.getByTestId("voucher-code");
	await expect(voucherCode).toHaveText(/^[A-Z0-9]{8}$/);
	const before = (await voucherCode.textContent()) ?? "";
	await page.clock.fastForward(10 * MINUTE);
	await expect(page.getByTestId("voucher-countdown")).toHaveText(
		/^Còn 23:49:\d\d$/,
	);
	await expect(voucherCode).toHaveText(before);
	await expect(page.getByTestId("voucher-state")).toHaveAttribute(
		"data-state",
		"held",
	);
});

test("two quick taps on Confirm on a slow mid-range phone redeem the reward once: the button is busy and disabled while the answer is on its way", async ({
	page,
}) => {
	await throttleLikeAMidRangePhone(page);
	// the stand-in answers after 1.5 seconds, so the second tap lands while the first is still in flight
	await page.goto("./?member=1&vouchers=1&store=mau-1&src=qr&dataDelay=1500");
	await openTab(page, "Thẻ thành viên");
	await page.getByRole("button", { name: "Ví voucher" }).click();
	const vouchers = page.getByTestId("voucher-item");
	await expect(vouchers).toHaveCount(2);
	await page.getByRole("button", { name: "Đổi quà" }).click();
	await page
		.getByTestId("reward")
		.nth(0)
		.getByRole("button", { name: "Đổi quà" })
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Đổi Tặng 1 ly cà phê sữa?",
	});
	await dialog.getByRole("button", { name: "Xác nhận đổi" }).click();
	const busy = dialog.getByRole("button", { name: /Đang đổi/ });
	await expect(busy).toBeDisabled();
	await expect(busy).toHaveAttribute("aria-busy", "true");
	// the second tap, forced through the disabled button, changes nothing
	await busy.click({ force: true });
	await expect(page.getByTestId("voucher-code")).toHaveText(/^[A-Z0-9]{8}$/);
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page.getByRole("button", { name: "Ví voucher" }).click();
	await expect(vouchers).toHaveCount(3);
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("stamp-count")).toHaveText("0/10 dấu");
});
