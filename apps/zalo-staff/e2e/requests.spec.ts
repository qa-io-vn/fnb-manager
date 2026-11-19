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

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

function requestsCard(page: Page) {
	return page.getByTestId("home-requests");
}

test("staff send a request and see it waiting next to the decided ones", async ({
	page,
}) => {
	await page.goto("./?role=staff");
	await expect(requestsCard(page).getByTestId("home-approvals")).toHaveCount(0);
	await requestsCard(page).getByRole("button", { name: "Gửi yêu cầu" }).click();
	await expect(page.getByTestId("ask-kinds")).toBeVisible();
	await checkScreen(page);
	await page.getByRole("button", { name: "Gửi", exact: true }).click();
	await expect(page.getByTestId("ask-problem-kind")).toHaveText(
		"Hãy chọn loại yêu cầu.",
	);
	await expect(page.getByTestId("ask-problem-empty")).toHaveText(
		"Hãy ghi nội dung yêu cầu.",
	);
	await page.getByRole("radio", { name: "Mua hàng cho cửa hàng" }).check();
	await page.getByTestId("ask-details").fill("Mua 3 cuộn giấy in hóa đơn.");
	await checkScreen(page);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Gửi", exact: true }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText(
		"Đã gửi yêu cầu cho quản lý",
	);
	await expectResultModalClosed(page);
	const requests = page.getByTestId("own-request");
	await expect(requests).toHaveCount(3);
	await expect(requests.first()).toHaveAttribute("data-status", "pending");
	await expect(requests.first()).toContainText("Mua 3 cuộn giấy in hóa đơn.");
	await expect(requests.first().getByTestId("request-status")).toHaveText(
		"Chờ duyệt",
	);
	const refused = page.locator(
		"[data-testid=own-request][data-status=refused]",
	);
	await expect(refused.getByTestId("refusal-reason")).toHaveText(
		"Lý do từ chối: Cần ghi rõ giờ và số hóa đơn.",
	);
	await checkScreen(page);
});

test("a manager sees the pending count, approves one and refuses one with a reason", async ({
	page,
}) => {
	await page.goto("./?role=manager");
	await expect(requestsCard(page).getByTestId("home-pending-count")).toHaveText(
		"3 yêu cầu chờ duyệt",
	);
	await checkMiniAppScreen(page);
	await requestsCard(page)
		.getByRole("button", { name: "Mở hàng chờ duyệt" })
		.click();
	const cards = page.getByTestId("approval-card");
	await expect(cards).toHaveCount(3);
	await expect(cards.first()).toContainText("Xin đổi ca chiều thứ Sáu");
	await checkScreen(page);
	await cards.first().getByRole("button").click();
	await expect(page.getByTestId("approval-detail")).toBeVisible();
	await checkScreen(page);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Duyệt", exact: true }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText("Đã duyệt yêu cầu");
	await expectResultModalClosed(page);
	await expect(cards).toHaveCount(2);
	await cards.first().getByRole("button").click();
	await page.getByRole("button", { name: "Từ chối", exact: true }).click();
	await page.getByRole("button", { name: "Từ chối yêu cầu" }).click();
	await expect(page.getByTestId("refusal-problem")).toHaveText(
		"Hãy ghi lý do từ chối.",
	);
	await checkScreen(page);
	await page.getByTestId("refusal-input").fill("Tuần này đủ người làm.");
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Từ chối yêu cầu" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText(
		"Đã từ chối yêu cầu",
	);
	await expectResultModalClosed(page);
	await expect(cards).toHaveCount(1);
	await checkScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(requestsCard(page).getByTestId("home-pending-count")).toHaveText(
		"1 yêu cầu chờ duyệt",
	);
});
