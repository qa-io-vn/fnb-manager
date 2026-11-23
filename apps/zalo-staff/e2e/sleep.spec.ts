// Test design (ISTQB, G-36): session-based exploratory charters for the staff Mini App on a phone that sleeps, loses its
// signal or is tapped twice on a slow CPU, turned into repeatable checks on the simulator side. Techniques:
// - state transition testing: the counter QR on the standee (fresh -> older than its life -> new), a customer's claim
//   that expires while its form is open on a locked phone, a member code typed and read past its 2-minute window, the
//   home across a long sleep (a re-read on the timer, a re-read on unlock);
// - error guessing: a phone that wakes without a signal (the old QR must not stay on the screen; a check that was
//   typed before the sleep is not sent and not claimed), a reward check whose answer is lost when the signal drops and
//   the phone sleeps, two taps in a row on a slow phone (Kiểm tra and Xác nhận of the drawer count);
// - security testing: an old counter QR, an expired claim or an expired member code is never shown as usable or as
//   accepted, the screens show the same person and their stores after a long sleep, and nothing is stored on the phone
//   beyond what the staff specs already allow (`checkMiniAppScreen` fails on any web storage or cookie use).
//
// How the sleep is made: each test installs the page clock at a chosen time of 2026-11-18 or 2026-11-19 (`startClock`),
// which then runs on; `page.clock.fastForward` jumps forward the way a phone does when it is locked and unlocked later:
// no timer runs meanwhile and the due timers fire once on waking. The signal is cut with `context.setOffline`. CPU and
// network are throttled like a mid-range Android phone with `throttleLikeAMidRangePhone`. The fake clock holds back the
// app's idle preloading of its other screens, so a test that goes offline lets it run first (`settle`), as a phone
// would have done by then.
// What the stand-in does not model, and a real phone or the database tests keep: the stand-in has no 120-second clock
// on a member code (the database function judges the window; the stand-in's expired code is that answer), and its data
// calls never expire a session (the Data API's 401 is covered by `failureOf` in shift/model.test.ts and by "sign in
// again when the API refuses an expired session" in home/home-screen.test.tsx). What this cannot replace: the Zalo
// runtime and a real mid-range phone (docs/test-plan.md acceptance list, G-36).

import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { throttleLikeAMidRangePhone } from "@fnb/zalo-mini/testing/paint-budget";
import { expect, type Page, test } from "@playwright/test";
import { checkEntryScreen } from "./entry-checks";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOON = new Date("2026-11-19T12:00:00+07:00");
const EVENING = new Date("2026-11-18T21:30:00+07:00");
const POS_REWARD = "UD2468";
const EXPIRED_CODE = "135790";
const COUNTER_PAYLOAD = /^fnb-counter:1:Q1:[A-HJ-NP-Z2-9]{12}$/;
const MEMBER_PHONE = "0900001234";

const NOT_SENT =
	"Chưa gửi được vì mạng chập chờn. Kiểm tra kết nối rồi thử lại.";
const OFFLINE =
	"Mất kết nối mạng. Những gì bạn nhập vẫn còn; khi có mạng hãy thử lại.";

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

/** the phone's clock at `time`, running on from there; every test calls it before it opens the app */
async function startClock(page: Page, time: Date = NOON): Promise<void> {
	await page.clock.install({ time });
}

/** the idle preload of the other screens, held back by the fake clock, has run: a phone that then loses its signal can still open them */
async function settle(page: Page): Promise<void> {
	await page.clock.runFor(5_000);
	await expect(page.locator("html")).toHaveAttribute(
		"data-screens-preloaded",
		"true",
	);
}

/** a few more milliseconds of the page's own event loop: whatever the last timer started has been rendered */
async function letThePageSettle(page: Page): Promise<void> {
	await page.evaluate(
		() => new Promise<void>((resolve) => setTimeout(resolve, 100)),
	);
}

const MODAL_SEEN = "__SLEEP_RESULT_MODAL_SEEN__";

/**
 * Starts recording whether the "done" popup is put on the screen from now on. The popup closes itself after 1.5 seconds, so
 * "the popup count is 0" would simply wait for it to close and pass; a claim that never happened needs the record.
 */
async function watchForDoneModal(page: Page): Promise<void> {
	await page.evaluate((name) => {
		const store = window as unknown as Record<string, unknown>;
		const shown = () =>
			document.querySelector("[data-testid=result-modal]") !== null;
		store[name] = shown();
		new MutationObserver(() => {
			if (shown()) store[name] = true;
		}).observe(document.body, { subtree: true, childList: true });
	}, MODAL_SEEN);
}

async function expectNoDoneModalEver(page: Page): Promise<void> {
	const seen = await page.evaluate(
		(name) => (window as unknown as Record<string, unknown>)[name],
		MODAL_SEEN,
	);
	expect(seen, "the done popup was put on the screen").toBe(false);
}

async function openTool(
	page: Page,
	query: string,
	name: string,
): Promise<void> {
	await page.goto(`./?${query}`);
	await page.getByTestId("home-loyalty").getByRole("button", { name }).click();
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

const COUNTER = "Mã quầy";
const REDEEM = "Kiểm tra ưu đãi";
const CHECK_IN = "Ghi nhận khách";

test("a phone left on the standee with the counter QR sleeps for ten minutes and wakes to a new QR, valid for the new moment", async ({
	page,
}) => {
	await startClock(page);
	await openTool(page, "role=staff&storeMode=staff", COUNTER);
	const qr = page.getByTestId("counter-qr");
	await expect(qr).toHaveAttribute("data-payload", COUNTER_PAYLOAD);
	const first = (await qr.getAttribute("data-payload")) ?? "";
	await expect(page.getByTestId("counter-refresh")).toHaveText(
		/^Mã tự làm mới lúc 12:0[01]$/,
	);

	await page.clock.fastForward(10 * MINUTE);

	await expect(qr).not.toHaveAttribute("data-payload", first);
	await expect(qr).toHaveAttribute("data-payload", COUNTER_PAYLOAD);
	// the refresh time is that of the new code (10 minutes on), not the first one's
	await expect(page.getByTestId("counter-refresh")).toHaveText(
		/^Mã tự làm mới lúc 12:1[01]$/,
	);
	await expect(page.getByTestId("counter-claim")).toHaveCount(2);
	// the first QR is nowhere on the screen any more
	expect(await page.locator("body").innerHTML()).not.toContain(first);
	await checkEntryScreen(page);
});

test("a phone that wakes without a signal on the counter QR shows no QR at all, says so with a way to retry, and gets a new QR once the signal is back", async ({
	page,
	context,
}) => {
	await startClock(page);
	await openTool(page, "role=staff&storeMode=staff&net=strict", COUNTER);
	const qr = page.getByTestId("counter-qr");
	await expect(qr).toHaveAttribute("data-payload", COUNTER_PAYLOAD);
	const first = (await qr.getAttribute("data-payload")) ?? "";
	await settle(page);

	await context.setOffline(true);
	await page.clock.fastForward(10 * MINUTE);

	await expect(page.getByTestId("counter-failed")).toHaveText(NOT_SENT);
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE);
	// an old QR is never kept on the screen while the new one cannot be asked for
	await expect(page.getByTestId("counter-qr")).toHaveCount(0);
	await expect(page.getByTestId("counter-claims")).toHaveCount(0);
	expect(await page.locator("body").innerHTML()).not.toContain(first);
	await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
	await checkMiniAppScreen(page);

	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await page.getByRole("button", { name: "Thử lại" }).click();
	await expect(qr).toHaveAttribute("data-payload", COUNTER_PAYLOAD);
	await expect(qr).not.toHaveAttribute("data-payload", first);
	await expect(page.getByTestId("counter-failed")).toHaveCount(0);
	// the list of waiting customers failed with the signal and is read again on its own 15-second poll
	await page.clock.fastForward(15_000);
	await expect(page.getByTestId("counter-claim")).toHaveCount(2);
	await expect(page.getByTestId("counter-claims-failed")).toHaveCount(0);
	await checkEntryScreen(page);
});

test("a customer's claim that expires while its form is open on a sleeping phone is refused as expired, never counted", async ({
	page,
}) => {
	await startClock(page);
	await openTool(page, "role=staff&storeMode=staff", COUNTER);
	await expect(page.getByTestId("counter-claim")).toHaveCount(2);
	await watchForDoneModal(page);
	await page
		.getByRole("button", { name: "Nhập tổng tiền cho hóa đơn HD-0033" })
		.click();
	await page.getByTestId("claim-total").fill("65000");

	// a claim lives 6 hours; the list is not re-read while a form is open, so the form is still there on waking
	await page.clock.fastForward(7 * HOUR);

	await expect(page.getByTestId("claim-total")).toHaveValue("65000");
	await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
	const refused = page.getByTestId("claim-refused");
	await expect(refused).toHaveAttribute("data-refusal", "expired");
	await expect(refused).toHaveText("Yêu cầu của khách đã hết hạn.");
	await expectNoDoneModalEver(page);
	await expect(page.locator("body")).not.toContainText("Đã cộng cho khách");
	await checkEntryScreen(page);
	// the list read again no longer offers the expired claims
	await page.getByRole("button", { name: "Làm mới" }).click();
	await expect(page.getByTestId("claims-empty")).toHaveText(
		"Chưa có khách nào gửi hóa đơn.",
	);
	await expect(page.getByTestId("counter-claim")).toHaveCount(0);
	await checkMiniAppScreen(page);
});

test("a member code typed before the phone slept and sent on waking without a signal is not sent and not claimed; with the signal back it is refused as expired, and no visit is made", async ({
	page,
	context,
}) => {
	await startClock(page);
	await openTool(page, "role=staff&net=strict", CHECK_IN);
	await settle(page);
	await watchForDoneModal(page);
	// the code the customer showed more than 2 minutes ago: the stand-in's answer for a code past its window
	await page.getByTestId("checkin-entry").fill(EXPIRED_CODE);

	await context.setOffline(true);
	await page.clock.fastForward(5 * MINUTE);

	// nothing was sent while the phone slept, and the typed code is still there
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE);
	await expect(page.getByTestId("checkin-entry")).toHaveValue(EXPIRED_CODE);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await expectNoDoneModalEver(page);
	await expect(page.getByTestId("checkin-entry")).toHaveValue(EXPIRED_CODE);
	await expect(
		page.getByRole("button", { name: "Ghi nhận", exact: true }),
	).toBeEnabled();
	await checkEntryScreen(page);

	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	const problem = page.getByTestId("checkin-problem");
	await expect(problem).toHaveAttribute("data-refusal", "code_expired");
	await expect(problem).toHaveText(
		/^Mã đã hết hạn\. Mã chỉ dùng được trong 2 phút/,
	);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await expectNoDoneModalEver(page);
	await checkEntryScreen(page);
	// the member has only the visit of the morning: nothing was recorded by the expired code
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Tra cứu thành viên" })
		.click();
	await page.getByTestId("lookup-phone").fill(MEMBER_PHONE);
	await page.getByRole("button", { name: "Tra cứu" }).click();
	await expect(page.getByTestId("member-phone")).toHaveText("•••• ••• 234");
	await expect(page.getByTestId("visit")).toHaveCount(1);
	await expect(
		page.locator("[data-testid=visit][data-state=pending]"),
	).toHaveCount(0);
});

test("a reward check whose answer is lost when the signal drops and the phone sleeps claims nothing; the retry on waking is the same single verification", async ({
	page,
	context,
}) => {
	await throttleLikeAMidRangePhone(page);
	await startClock(page);
	await openTool(page, "role=staff&net=strict&answerDelay=1500", REDEEM);
	await settle(page);
	await watchForDoneModal(page);
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await expect(
		page.locator("button[type=submit][aria-busy=true]"),
	).toBeDisabled();

	// the server committed the check; the signal drops before the answer arrives and the phone sleeps in the dead zone
	await context.setOffline(true);
	await page.clock.fastForward(10 * MINUTE);

	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT);
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE);
	await expect(page.getByTestId("redeem-result")).toHaveCount(0);
	await expect(page.getByTestId("redeem-instruction")).toHaveCount(0);
	await expectNoDoneModalEver(page);
	await expect(page.getByTestId("redeem-code")).toHaveValue(POS_REWARD);
	await expect(page.getByRole("button", { name: "Kiểm tra" })).toBeEnabled();
	await checkEntryScreen(page);

	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	// the answer is the first check's, made before the sleep (12:0x), not a second check at 12:1x
	await expect(page.getByTestId("redeem-checked-before")).toHaveText(
		/^Bạn đã kiểm tra mã này lúc 12:0\d\. Chỉ áp dụng ưu đãi một lần\.$/,
	);
	await expect(page.getByTestId("redeem-apply")).toHaveText(
		"Thành viên - Tặng 1 ly",
	);
	await expect(page.getByTestId("redeem-refused")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	await checkEntryScreen(page);
});

test("two quick taps on Kiểm tra on a slow mid-range phone check the reward once: the button is busy and disabled while the answer is on its way", async ({
	page,
}) => {
	await throttleLikeAMidRangePhone(page);
	await startClock(page);
	// the stand-in answers after 1.5 seconds, so the second tap lands while the first is still in flight
	await openTool(page, "role=staff&dataDelay=1500", REDEEM);
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	const busy = page.locator("button[type=submit][aria-busy=true]");
	await expect(busy).toBeDisabled();
	await expect(busy).toHaveAttribute("aria-busy", "true");
	// the second tap, forced through the disabled button and sent as a form submit, changes nothing
	await busy.click({ force: true });
	await page.locator("form").dispatchEvent("submit");

	await expect(page.getByTestId("redeem-accepted")).toBeVisible();
	await expect(page.getByTestId("result-modal")).toHaveText(/Mã hợp lệ/);
	// both answers are in by the time the modal closes; a second check would show "checked before"
	await expect(page.getByTestId("result-modal")).toHaveCount(0);
	await letThePageSettle(page);
	await expect(page.getByTestId("redeem-checked-before")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	await expect(page.getByTestId("redeem-apply")).toHaveText(
		"Thành viên - Tặng 1 ly",
	);
	await checkEntryScreen(page);
});

test("two quick taps on Xác nhận of the drawer count on a slow mid-range phone record one count: the button is busy and disabled", async ({
	page,
}) => {
	await throttleLikeAMidRangePhone(page);
	await startClock(page, EVENING);
	await page.goto("./?role=staff&revenue=store_totals&dataDelay=1500");
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Ca làm" })
		.click();
	await page.getByTestId("open-close").click();
	await expect(page.getByTestId("close-count")).toBeVisible();
	await page.getByRole("button", { name: /^Thêm một tờ 500\.000/ }).click();
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("close-confirm")).toBeVisible();
	await page.getByRole("button", { name: "Xác nhận" }).click();
	const busy = page.locator("button[aria-busy=true]");
	await expect(busy).toBeDisabled();
	await expect(busy).toHaveText("Đang ghi nhận…");
	// the second tap, forced through the disabled button, changes nothing
	await busy.click({ force: true });

	await expect(page.getByTestId("close-handover")).toBeVisible();
	// a second count would be the later answer and would say it waits for its shift
	await page.clock.fastForward(3_000);
	await letThePageSettle(page);
	await expect(page.getByTestId("count-recorded")).toHaveText("Đã ghi nhận");
	await expect(page.locator("body")).not.toContainText(
		"Lần đếm sẽ được khớp với ca",
	);
	await expect(page.getByTestId("count-failed")).toHaveCount(0);
	await checkEntryScreen(page);
});

test("a phone that sleeps for hours on the home wakes to the same person and their stores, read again on the timer and on unlock", async ({
	page,
}) => {
	await startClock(page);
	await page.goto("./?role=staff&revenue=store_totals");
	const home = page.getByTestId("home");
	await expect(home).toHaveAttribute("data-status", "ready");
	const greeting = page.getByRole("heading", { level: 1 });
	await expect(greeting).toHaveText("Xin chào, Thành viên thử");
	await expect(page.getByTestId("member-role")).toHaveText("Nhân viên");
	await expect(page.getByTestId("home-store")).toHaveText("Cửa hàng Mẫu 1");
	// the figures are those of 6 minutes before the clock
	await expect(page.getByTestId("home-freshness")).toHaveText(
		"Cập nhật lúc 11:54",
	);

	// unlocked after 3 minutes: shorter than the home's refresh timer, so only the unlock re-reads it
	await page.clock.fastForward(3 * MINUTE);
	await page.evaluate(() =>
		document.dispatchEvent(new Event("visibilitychange")),
	);
	await expect(page.getByTestId("home-freshness")).toHaveText(
		"Cập nhật lúc 11:57",
	);

	// unlocked after 3 hours, past the 1-hour life of the stand-in's session, with no unlock event: the timer re-reads it
	await page.clock.fastForward(3 * HOUR);
	await expect(page.getByTestId("home-freshness")).toHaveText(
		/^Cập nhật lúc 14:5\d$/,
	);
	await expect(home).toHaveAttribute("data-status", "ready");
	await expect(greeting).toHaveText("Xin chào, Thành viên thử");
	await expect(page.getByTestId("member-role")).toHaveText("Nhân viên");
	await expect(page.getByTestId("home-store")).toHaveText("Cửa hàng Mẫu 1");
	await expect(page.getByTestId("store-picker")).toHaveCount(0);
	await expect(page.getByTestId("home-net-revenue")).toHaveText("12,5 tr ₫");
	await checkEntryScreen(page);
});
