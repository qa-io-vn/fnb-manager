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
import {
	MAX_PHOTO_BYTES,
	type SyntheticPhoto,
	shownPhoto,
	sidewaysPhoto,
	takePhotoWith,
} from "./photo-fixture";

const NOON = new Date("2026-11-18T12:00:00+07:00");
let photo: SyntheticPhoto;

test.beforeAll(async ({ browser }) => {
	photo = await sidewaysPhoto(browser);
});

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openShifts(page: Page, query: string): Promise<void> {
	await page.goto(`./${query}`);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Ca làm" })
		.click();
	await expect(page.getByTestId("shift-board")).toBeVisible();
}

test("staff report a stock-out with a resized photo, reminded not to write personal details", async ({
	page,
}) => {
	await openShifts(page, "?role=staff");
	await expect(page.getByTestId("incident")).toHaveCount(2);
	await expect(page.getByRole("button", { name: "Đã xem" })).toHaveCount(0);
	await page.getByRole("button", { name: "Báo hết hàng" }).click();
	await expect(page.getByTestId("report-form")).toBeVisible();
	await expect(page.getByTestId("privacy-reminder")).toHaveText(
		/^Không ghi thông tin cá nhân như số điện thoại, số giấy tờ/,
	);
	await expect(page.getByLabel("Loại")).toHaveValue("khac");
	await checkScreen(page);
	await page.getByTestId("report-description").fill("Hết từ trưa, cần 2 túi.");
	await page.getByRole("button", { name: "Gửi báo cáo" }).click();
	await expect(
		page.getByText("Hãy ghi món hoặc nguyên liệu đã hết."),
	).toBeVisible();
	await checkScreen(page);
	await page.getByTestId("report-item").fill("Trân châu đen");
	await takePhotoWith(
		page,
		page.getByRole("button", { name: "Thêm ảnh" }),
		photo,
	);
	const shown = await shownPhoto(page.getByTestId("photo-preview"));
	expect(shown.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
	expect(shown).toMatchObject({ naturalWidth: 960, naturalHeight: 1280 });
	await checkScreen(page);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Gửi báo cáo" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã gửi báo cáo/);
	await expectResultModalClosed(page);
	const mine = page
		.getByTestId("incident")
		.filter({ hasText: "Trân châu đen" });
	await expect(mine).toContainText("Hết hàng");
	await expect(mine).toContainText("Của bạn");
	await expect(mine).toContainText("Mới");
	await checkScreen(page);
});

test("refusing the camera still lets the report go without a photo", async ({
	page,
}) => {
	await openShifts(page, "?role=staff&camera=refused");
	await page.getByRole("button", { name: "Báo sự cố" }).click();
	await page.getByRole("button", { name: "Thêm ảnh" }).click();
	await expect(page.getByTestId("camera-refused")).toContainText(
		"Bạn vẫn gửi được báo cáo không kèm ảnh.",
	);
	await page
		.getByTestId("report-description")
		.fill("Bóng đèn khu quầy bị chập chờn.");
	await page.getByRole("button", { name: "Gửi báo cáo" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã gửi báo cáo/);
	await expect(page.getByTestId("shift-board")).toBeVisible();
	await checkScreen(page);
});

test("a manager marks a report seen, then resolved, and a handover seen", async ({
	page,
}) => {
	await openShifts(page, "?role=manager");
	const open = page
		.getByTestId("incident")
		.and(page.locator("[data-state=open]"));
	await expect(open).toHaveCount(1);
	await checkScreen(page);
	await watchResultModal(page);
	await open.getByRole("button", { name: "Đã xem" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã xem báo cáo/);
	await expectResultModalClosed(page);
	await expect(
		page.locator("[data-testid=incident][data-state=seen]"),
	).toHaveCount(2);
	await page
		.locator("[data-testid=incident][data-state=seen]")
		.first()
		.getByRole("button", { name: "Đã xử lý" })
		.click();
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã đánh dấu đã xử lý/,
	);
	await expect(page.getByTestId("incident")).toHaveCount(1);
	const handover = page.getByTestId("handover").first();
	await expect(handover).toContainText("Ca 1 → Ca 2");
	await expect(handover).toContainText("Chưa xem");
	await handover.getByRole("button", { name: "Đã xem" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(/Đã xem bàn giao/);
	await expect(handover).toHaveAttribute("data-state", "seen");
	await checkScreen(page);
});
