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

const NOON = new Date("2026-11-19T12:00:00+07:00");
const PINNED = "Lịch vệ sinh máy pha cà phê";
const UNREAD = "Nhắc kiểm kê cuối tháng";
const LINK_TEXT = "www.vidu-bao-tri.vn";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openNotices(page: Page): Promise<void> {
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Thông báo" })
		.click();
	await expect(page.getByTestId("notices-list")).toBeVisible();
}

function card(page: Page, title: string) {
	return page.getByTestId("notice-card").filter({ hasText: title });
}

test("staff see the pinned notice on the home and first in Thông báo, and tap Đã đọc", async ({
	page,
}) => {
	await page.goto("./?role=staff");
	const home = page.getByTestId("home-notices");
	await expect(home.getByTestId("home-pinned")).toHaveCount(1);
	await expect(home.getByTestId("home-pinned")).toContainText(PINNED);
	await expect(home.getByTestId("home-pinned")).toHaveAttribute(
		"data-unread",
		"true",
	);
	await expect(home.getByTestId("home-unread-count")).toHaveText(
		"Bạn có 2 thông báo chưa đọc.",
	);
	await checkMiniAppScreen(page);
	await openNotices(page);
	const cards = page.getByTestId("notice-card");
	await expect(cards).toHaveCount(3);
	await expect(cards.first()).toContainText(PINNED);
	await expect(cards.first()).toHaveAttribute("data-pinned", "true");
	await expect(cards.first().getByTestId("notice-pinned")).toHaveText(
		"Đã ghim",
	);
	await expect(card(page, UNREAD).getByTestId("notice-unread")).toHaveText(
		"Chưa đọc",
	);
	await expect(
		page.getByRole("button", { name: "Soạn thông báo" }),
	).toHaveCount(0);
	await checkMiniAppScreen(page);
	await cards.first().getByRole("button").click();
	const detail = page.getByTestId("notice-detail");
	await expect(detail.getByRole("heading", { level: 1 })).toHaveText(PINNED);
	await expect(detail.getByTestId("notice-body")).toContainText(LINK_TEXT);
	await expect(page.locator("a")).toHaveCount(0);
	await expect(detail.getByTestId("notice-read-rate")).toHaveCount(0);
	await checkScreen(page);
	await expectFeedbackWithin(page, () =>
		detail.getByRole("button", { name: "Đã đọc" }).click(),
	);
	await expect(detail.getByTestId("notice-read-at")).toHaveText(
		"Đã đọc lúc 12:00 ngày 19/11/2026",
	);
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(card(page, PINNED)).toHaveAttribute("data-unread", "false");
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Trang chủ" })
		.click();
	await expect(
		page.getByTestId("home-notices").getByTestId("home-pinned"),
	).toHaveAttribute("data-unread", "false");
	await expect(page.getByTestId("home-unread-count")).toHaveText(
		"Bạn có 1 thông báo chưa đọc.",
	);
});

test("a manager publishes a pinned notice to one store and sees the read rate", async ({
	page,
}) => {
	await page.goto("./?role=manager");
	await openNotices(page);
	await checkScreen(page);
	await page.getByRole("button", { name: "Soạn thông báo" }).click();
	await expect(page.getByTestId("notice-compose")).toBeVisible();
	await page.getByRole("button", { name: "Đăng thông báo" }).click();
	await expect(page.getByTestId("notice-problem-title")).toHaveText(
		"Hãy nhập tiêu đề.",
	);
	await checkScreen(page);
	await page.getByTestId("notice-title").fill("Đổi mật khẩu Wi-Fi");
	await page
		.getByTestId("notice-text")
		.fill("Mật khẩu mới dán ở quầy.\nKhông đọc cho khách.");
	await page.getByRole("checkbox", { name: "Cửa hàng Mẫu 2" }).uncheck();
	await page.getByTestId("notice-pin").selectOption("7");
	await checkScreen(page);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Đăng thông báo" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText(
		"Đã đăng cho 3 người",
	);
	await expectResultModalClosed(page);
	const first = page.getByTestId("notice-card").first();
	await expect(first).toContainText("Đổi mật khẩu Wi-Fi");
	await expect(first).toHaveAttribute("data-pinned", "true");
	await expect(first).toHaveAttribute("data-unread", "false");
	await checkScreen(page);
	await card(page, PINNED).getByRole("button").click();
	await expect(page.getByTestId("notice-rate-value")).toHaveText(
		"2/5 người đã đọc (40 %)",
	);
	await expect(page.getByTestId("unread-reader")).toHaveCount(3);
	await checkScreen(page);
});

test("a store-limited manager sees the readers of their own store only", async ({
	page,
}) => {
	await page.goto("./?role=manager&stores=one");
	await openNotices(page);
	await card(page, PINNED).getByRole("button").click();
	await expect(page.getByTestId("notice-rate-value")).toHaveText(
		"1/3 người đã đọc (33 %)",
	);
	const unread = page.getByTestId("unread-reader");
	await expect(unread).toHaveCount(2);
	await expect(page.getByTestId("unread-readers")).toContainText(
		"Nhân viên Mẫu Bình",
	);
	await expect(page.getByTestId("unread-readers")).not.toContainText(
		"Nhân viên Mẫu Chi",
	);
	await expect(page.getByTestId("unread-readers")).not.toContainText(
		"Nhân viên Mẫu Dũng",
	);
	await checkScreen(page);
});
