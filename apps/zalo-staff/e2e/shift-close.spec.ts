import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import {
	expectFeedbackWithin,
	expectOnePrimaryAction,
	expectResultModalClosed,
	watchResultModal,
} from "./entry-checks";

const EVENING = new Date("2026-11-18T21:30:00+07:00");
const NBSP = " ";

function money(text: string): string {
	return text.replace(" ", NBSP);
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(EVENING);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openClose(page: Page, query: string): Promise<void> {
	await page.goto(`./${query}`);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Ca làm" })
		.click();
	await expect(page.getByTestId("shift-board")).toHaveAttribute(
		"data-phase",
		"closing",
	);
	await expect(page.locator("[data-action=primary]")).toHaveAccessibleName(
		"Bắt đầu: Đóng ca",
	);
	await checkScreen(page);
	await page.getByTestId("open-close").click();
	await expect(page.getByTestId("close-count")).toBeVisible();
}

async function enterTotal(page: Page, total: string): Promise<void> {
	await page.getByRole("button", { name: "Nhập tổng" }).click();
	await page.getByTestId("count-total").fill(total);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await page.getByRole("button", { name: "Xác nhận" }).click();
	await expect(page.getByTestId("close-handover")).toBeVisible();
}

test("staff count the drawer by note, see only Đã ghi nhận, and hand over to the next shift", async ({
	page,
}) => {
	await openClose(page, "?role=staff&revenue=store_totals");
	await checkScreen(page);
	const more = (face: string) =>
		page.getByRole("button", { name: new RegExp(`^Thêm một tờ ${face}`) });
	for (let i = 0; i < 4; i += 1) await more("500\\.000").click();
	await more("200\\.000").click();
	await page.getByLabel(/^Số tờ 100\.000/).fill("2");
	const total = page.getByTestId("running-total");
	await expect(total).toHaveAttribute("data-amount", "2400000");
	await expect(total).toContainText(money("2.400.000 ₫"));
	await checkScreen(page);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("confirm-amount")).toContainText(
		money("2.400.000 ₫"),
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Xác nhận" }).click();
	const outcome = page.getByTestId("count-outcome");
	await expect(outcome).toContainText("Đã ghi nhận");
	await expect(outcome).not.toContainText("₫");
	await expect(page.getByTestId("count-difference")).toHaveCount(0);
	await checkScreen(page);
	await page.getByLabel("Cho ca").selectOption({ label: "Ca 2" });
	await page
		.getByTestId("handover-note")
		.fill("Máy pha đã vệ sinh.\nCòn 3 hộp sữa.");
	await watchResultModal(page);
	await page.getByRole("button", { name: "Gửi bàn giao" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã đóng ca/);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("handover-state")).toHaveText(
		"Đã gửi bàn giao",
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Về Ca làm" }).click();
	await expect(page.getByTestId("close-counted")).toHaveText(
		/^Đã đếm tiền lúc \d{2}:\d{2}$/,
	);
	await expect(
		page.getByTestId("handover").filter({ hasText: "Còn 3 hộp sữa." }),
	).toContainText("Của bạn");
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Trang chủ" })
		.click();
	await expect(page.getByTestId("home-close-state")).toHaveText(
		/^Đã đếm tiền lúc \d{2}:\d{2}$/,
	);
});

test("staff at the all level see their count's difference", async ({
	page,
}) => {
	await openClose(page, "?role=staff&revenue=all");
	await enterTotal(page, "2.480.000");
	await expect(page.getByTestId("count-difference")).toHaveText(
		money("−20.000 ₫"),
	);
	await expect(page.getByTestId("count-threshold")).toHaveText("Trong ngưỡng");
	await checkScreen(page);
});

test("a manager sees the difference over the threshold, the shifts as Ca n, and reopens a count for a recount", async ({
	page,
}) => {
	await openClose(page, "?role=manager");
	await enterTotal(page, "2.380.000");
	await expect(page.getByTestId("count-outcome")).toContainText(
		"Chênh lệch Ca 1",
	);
	await expect(page.getByTestId("count-difference")).toHaveText(
		money("−120.000 ₫"),
	);
	await expect(page.getByTestId("count-threshold")).toHaveText("Vượt ngưỡng");
	await page.getByRole("button", { name: "Bỏ qua bàn giao" }).click();
	await page.getByRole("button", { name: "Về Ca làm" }).click();
	const panel = page.getByTestId("panel-cash");
	const shifts = panel.getByTestId("cash-shift");
	await expect(shifts).toHaveCount(3);
	await expect(shifts.first()).toContainText("Ca 1 · 18/11/2026");
	await expect(shifts.nth(1)).toContainText("Ca 2 · 17/11/2026");
	await expect(shifts.first().getByTestId("cash-state")).toHaveText(
		"Vượt ngưỡng",
	);
	await checkScreen(page);
	await shifts
		.first()
		.getByRole("button", { name: "Mở lại để đếm lại" })
		.click();
	await checkScreen(page);
	await watchResultModal(page);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Mở lại" })
		.click();
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã mở lại để đếm lại/,
	);
	await expectResultModalClosed(page);
	await expect(shifts.first().getByTestId("cash-state")).toHaveText("Chưa đếm");
	await page.getByTestId("open-close").click();
	await expect(page.getByTestId("recount")).toContainText(
		"Quản lý đã mở lại lần đếm",
	);
	await checkScreen(page);
	await enterTotal(page, "2.500.000");
	await expect(page.getByTestId("count-threshold")).toHaveText("Trong ngưỡng");
});

test("loading feedback shows within 300 ms on Xác nhận and on Gửi bàn giao", async ({
	page,
}) => {
	await openClose(page, "?role=staff&dataDelay=800");
	await page.getByRole("button", { name: /^Thêm một tờ 500\.000/ }).click();
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Xác nhận" }).click(),
	);
	await expect(page.getByTestId("close-handover")).toBeVisible();
	await page.getByTestId("handover-note").fill("Không có gì đặc biệt.");
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Gửi bàn giao" }).click(),
	);
	await expect(page.getByTestId("close-done")).toBeVisible();
});
