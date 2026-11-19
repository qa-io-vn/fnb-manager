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

async function openQueue(page: Page, query: string): Promise<void> {
	await page.goto(`./${query}`);
	const card = page.getByTestId("home-loyalty");
	await expect(card.getByTestId("home-loyalty-queue-count")).toHaveText(
		"3 việc cần xử lý",
	);
	await expect(card.getByTestId("home-loyalty-queue-overdue")).toHaveText(
		"1 khiếu nại quá 48 giờ",
	);
	await card.getByRole("button", { name: "Mở hàng chờ" }).click();
	await expect(page.getByTestId("queue-list")).toBeVisible();
}

function queueCard(page: Page, kind: string) {
	return page.locator(`[data-testid=queue-card][data-kind=${kind}]`);
}

async function settle(
	page: Page,
	option: string | RegExp,
	reason: string,
): Promise<void> {
	await page.getByRole("radio", { name: option }).check();
	await page.getByTestId("queue-reason").fill(reason);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Xác nhận" }).click(),
	);
}

test("a manager sees the overdue dispute first and picks the invoice of an unclear match", async ({
	page,
}) => {
	await openQueue(page, "");
	await expect(page.getByTestId("queue-card")).toHaveCount(3);
	const first = page.getByTestId("queue-card").first();
	await expect(first).toHaveAttribute("data-kind", "dispute");
	await expect(first.getByTestId("queue-overdue")).toHaveText(
		"Quá 48 giờ (50 giờ)",
	);
	await expect(first).toContainText("Khách •••• ••• 678");
	await checkScreen(page);
	await queueCard(page, "match")
		.getByRole("button", { name: /^Xử lý/ })
		.click();
	await expect(page.getByTestId("queue-item")).toBeVisible();
	await page.getByRole("button", { name: "Xác nhận" }).click();
	await expect(page.getByTestId("queue-problem-choice")).toBeVisible();
	await expect(page.getByTestId("queue-problem-reason")).toHaveText(
		"Hãy ghi lý do.",
	);
	await checkScreen(page);
	await settle(page, /HD-0013/, "Giờ in hóa đơn khớp với lúc ghi nhận.");
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã chọn hóa đơn/);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("queue-card")).toHaveCount(2);
	await expect(queueCard(page, "match")).toHaveCount(0);
	await checkScreen(page);
});

test("a manager accepts a dispute with an adjustment and refuses an adjustment request, each with a reason", async ({
	page,
}) => {
	await openQueue(page, "?role=owner");
	await queueCard(page, "dispute")
		.getByRole("button", { name: /^Xử lý/ })
		.click();
	await page.getByRole("radio", { name: "Chấp nhận và điều chỉnh" }).check();
	await expect(page.getByTestId("queue-stamps")).toHaveValue("1");
	await checkScreen(page);
	await settle(
		page,
		"Chấp nhận và điều chỉnh",
		"Đã đối chiếu hóa đơn trên máy POS.",
	);
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã duyệt/);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("queue-card")).toHaveCount(2);
	await queueCard(page, "adjustment")
		.getByRole("button", { name: /^Xử lý/ })
		.click();
	await settle(page, "Từ chối", "Không có hóa đơn nào lúc trưa.");
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã từ chối/);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("queue-card")).toHaveCount(1);
	await checkScreen(page);
});

test("staff get no queue and see the outcome of their own requests", async ({
	page,
}) => {
	await page.goto("./?role=staff");
	const card = page.getByTestId("home-loyalty");
	await expect(card).toBeVisible();
	await expect(card.getByTestId("home-loyalty-queue")).toHaveCount(0);
	await expect(card.getByRole("button", { name: "Mở hàng chờ" })).toHaveCount(
		0,
	);
	await card.getByRole("button", { name: "Yêu cầu của tôi" }).click();
	const requests = page.getByTestId("my-request");
	await expect(requests).toHaveCount(2);
	await expect(requests.first()).toContainText("Đã duyệt");
	await expect(requests.nth(1)).toContainText("Bị từ chối");
	await expect(requests.nth(1).getByTestId("decision-reason")).toHaveText(
		"Lý do: Hóa đơn đó đã được tích ở cửa hàng khác.",
	);
	await checkMiniAppScreen(page);
});

test("a staff adjustment above the threshold waits for a manager and shows in Yêu cầu của tôi", async ({
	page,
}) => {
	await page.goto("./?role=staff");
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Tra cứu thành viên" })
		.click();
	await page.getByTestId("lookup-phone").fill("0900005678");
	await page.getByRole("button", { name: "Tra cứu" }).click();
	await page.getByRole("button", { name: "Điều chỉnh" }).click();
	await page.getByTestId("request-stamps").fill("3");
	await expect(page.getByTestId("request-needs-manager")).toHaveText(
		"Vượt ngưỡng nên sẽ chờ quản lý duyệt.",
	);
	await page.getByTestId("request-reason").fill("Máy POS lỗi, khách mua 3 ly.");
	await checkScreen(page);
	await watchResultModal(page);
	await page.getByRole("button", { name: "Gửi" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã gửi quản lý duyệt/,
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("member-card")).toBeVisible();
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Yêu cầu của tôi" })
		.click();
	const latest = page.getByTestId("my-request").first();
	await expect(latest).toHaveAttribute("data-state", "pending");
	await expect(latest).toContainText("Chờ quản lý");
	await expect(latest).toContainText("Khách •••• ••• 678");
	await checkMiniAppScreen(page);
});
