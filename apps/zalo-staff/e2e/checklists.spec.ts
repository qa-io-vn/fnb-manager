import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import {
	expectFeedbackWithin,
	expectOnePrimaryAction,
	expectResultModalClosed,
	mockSdkApis,
	watchResultModal,
} from "./entry-checks";
import {
	MAX_LONG_SIDE,
	MAX_PHOTO_BYTES,
	type SyntheticPhoto,
	shownPhoto,
	sidewaysPhoto,
	takePhotoWith,
} from "./photo-fixture";

const MORNING = new Date("2026-11-18T08:30:00+07:00");
let photo: SyntheticPhoto;

test.beforeAll(async ({ browser }) => {
	photo = await sidewaysPhoto(browser);
});

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(MORNING);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openShifts(page: Page, query = ""): Promise<void> {
	await page.goto(`./${query}`);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Ca làm" })
		.click();
	await expect(page.getByTestId("shift-board")).toBeVisible();
}

function item(page: Page, label: string) {
	return page.getByTestId("checklist-item").filter({ hasText: label });
}

test("the checklist due opens from the home and runs to its end with a resized, upright photo", async ({
	page,
}) => {
	await page.goto("./?role=staff");
	const card = page.getByTestId("home-card-checklist");
	await expect(card).toContainText("Mở ca");
	await expect(card).toContainText("Chưa bắt đầu");
	await checkMiniAppScreen(page);
	await card.getByRole("button", { name: "Mở danh sách" }).click();
	const state = page.getByTestId("checklist-run-state");
	await expect(state).toHaveAttribute("data-access", "edit");
	await expect(page.getByTestId("checklist-progress")).toHaveText(
		/Đã xong 0\/4 việc/,
	);
	await checkScreen(page);

	const counter = item(page, "Lau quầy, bàn ghế khu khách");
	await counter.getByRole("checkbox").click();
	await expect(counter.getByTestId("item-block")).toHaveText(
		"Cần chụp ảnh trước khi đánh dấu đã làm.",
	);
	await expect(
		counter.getByText(/Máy ảnh chỉ mở khi bạn chạm Chụp ảnh/),
	).toBeVisible();
	await takePhotoWith(
		page,
		counter.getByRole("button", { name: "Chụp ảnh" }),
		photo,
	);
	await expect(counter.getByRole("checkbox")).toBeChecked();
	const shown = await shownPhoto(counter.getByTestId("photo-preview"));
	expect(photo.buffer.length).toBeGreaterThan(MAX_PHOTO_BYTES);
	expect(shown.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
	expect(Math.max(shown.width, shown.height)).toBe(MAX_LONG_SIDE);
	expect(shown).toMatchObject({
		width: 960,
		height: 1280,
		naturalWidth: 960,
		naturalHeight: 1280,
	});

	const fridge = item(page, "Nhiệt độ tủ mát");
	await fridge.getByLabel("Số đo (°C)").fill("4,5");
	await fridge.getByRole("checkbox").click();
	await expect(fridge.getByRole("checkbox")).toBeChecked();
	await item(page, "Bật máy pha cà phê").getByRole("checkbox").click();
	await expect(page.getByTestId("checklist-progress")).toHaveText(
		/Đã xong 3\/4 việc/,
	);
	await checkScreen(page);

	await page.getByRole("button", { name: "Hoàn thành" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("Còn 1 việc chưa đánh dấu.");
	await checkScreen(page);
	await watchResultModal(page);
	await dialog.getByRole("button", { name: "Vẫn hoàn thành" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã hoàn thành danh sách/,
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("shift-board")).toBeVisible();
	const opening = page
		.getByTestId("checklist-card")
		.filter({ hasText: "Mở ca" })
		.first();
	await expect(opening.getByTestId("checklist-state")).toHaveText(
		/^Đã xong lúc \d{2}:\d{2}$/,
	);
	await checkScreen(page);

	await opening.getByRole("button", { name: "Xem: Mở ca" }).click();
	await expect(state).toHaveAttribute("data-access", "finished");
	for (const box of await page.getByRole("checkbox").all())
		await expect(box).toBeDisabled();
	await expect(page.getByRole("button", { name: "Chụp lại" })).toHaveCount(0);
	await checkScreen(page);
	expect(await mockSdkApis(page)).toContain("chooseImage");
});

test("loading feedback shows within 300 ms when a checklist opens and while its photo uploads", async ({
	page,
}) => {
	await openShifts(page, "?role=staff&dataDelay=800");
	await expect(page.getByTestId("checklist-card").first()).toBeVisible();
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Bắt đầu: Mở ca" }).click(),
	);
	const counter = item(page, "Lau quầy, bàn ghế khu khách");
	await expect(counter).toBeVisible();
	const chooser = page.waitForEvent("filechooser");
	await expectFeedbackWithin(page, () =>
		counter.getByRole("button", { name: "Chụp ảnh" }).click(),
	);
	await (await chooser).setFiles(photo);
	await expect(
		counter.getByRole("progressbar", { name: "Tiến độ tải ảnh" }),
	).toBeVisible();
	await expect(counter.getByRole("checkbox")).toBeChecked();
});

test("refusing the camera leaves the item open with a hint and the rest usable", async ({
	page,
}) => {
	await openShifts(page, "?role=staff&camera=refused");
	await page.getByRole("button", { name: "Bắt đầu: Mở ca" }).click();
	const counter = item(page, "Lau quầy, bàn ghế khu khách");
	await counter.getByRole("button", { name: "Chụp ảnh" }).click();
	await expect(counter.getByTestId("camera-refused")).toContainText(
		"Bạn chưa cho phép dùng máy ảnh nên mục này vẫn để mở",
	);
	await expect(counter.getByRole("checkbox")).not.toBeChecked();
	await item(page, "Bật máy pha cà phê").getByRole("checkbox").click();
	await expect(page.getByTestId("checklist-progress")).toHaveText(
		/Đã xong 1\/4 việc/,
	);
	await checkScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Cá nhân" })
		.click();
	await expect(page.getByTestId("profile")).toBeVisible();
	await checkMiniAppScreen(page);
	expect(await mockSdkApis(page)).toContain("chooseImage");
});

test("a failed upload says so and the retry sends the same photo", async ({
	page,
}) => {
	await openShifts(page, "?role=staff&upload=fail-once");
	await page.getByRole("button", { name: "Bắt đầu: Mở ca" }).click();
	const counter = item(page, "Lau quầy, bàn ghế khu khách");
	await takePhotoWith(
		page,
		counter.getByRole("button", { name: "Chụp ảnh" }),
		photo,
	);
	await expect(counter.getByTestId("upload-failed")).toContainText(
		"Ảnh chưa tải lên được.",
	);
	await checkScreen(page);
	await counter.getByRole("button", { name: "Thử lại" }).click();
	await expect(counter.getByRole("checkbox")).toBeChecked();
	await expect(counter.getByTestId("upload-failed")).toHaveCount(0);
});

test("someone else's open run is shown read-only, and Đóng ca becomes the primary action", async ({
	page,
}) => {
	await openShifts(page, "?role=staff&checklist=taken");
	const opening = page
		.getByTestId("checklist-card")
		.filter({ hasText: "Mở ca" })
		.first();
	await expect(opening.getByTestId("checklist-state")).toHaveText(
		"Người khác đang làm",
	);
	await expect(page.locator("[data-action=primary]")).toHaveText("Đóng ca");
	await checkScreen(page);
	await opening.getByRole("button", { name: "Xem: Mở ca" }).click();
	await expect(page.getByTestId("checklist-run-state")).toHaveAttribute(
		"data-access",
		"other",
	);
	await checkScreen(page);
});

test("English follows Zalo's language on the Ca làm tab", async ({ page }) => {
	await page.goto("./?lang=en&role=staff");
	await page
		.getByRole("navigation", { name: "Main navigation" })
		.getByRole("button", { name: "Shifts" })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Shifts" }),
	).toBeVisible();
	await expect(page.getByTestId("shift-phase")).toHaveText("Now: Opening");
	await checkScreen(page);
});
