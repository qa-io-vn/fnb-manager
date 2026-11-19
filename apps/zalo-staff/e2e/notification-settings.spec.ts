import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { mockSdkApis } from "./entry-checks";

const NOON = new Date("2026-11-19T12:00:00+07:00");

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function openSettings(page: Page, query: string): Promise<void> {
	await page.goto(`./${query}`);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Cá nhân" })
		.click();
	const section = page.getByTestId("profile-notifications");
	await expect(section).toBeVisible();
	await checkMiniAppScreen(page);
	await section.getByRole("button", { name: "Cài đặt nhận thông báo" }).click();
	await expect(page.getByTestId("destination-list")).toBeVisible();
}

test("staff see their destination, follow the OA after its purpose, and what is not ready yet", async ({
	page,
}) => {
	await openSettings(page, "?role=staff");
	const destination = page.getByTestId("destination");
	await expect(destination).toHaveCount(1);
	await expect(destination).toContainText("Zalo Bot");
	await expect(destination.getByTestId("destination-state")).toHaveText(
		"Đang nhận",
	);
	for (const id of ["bot-not-ready", "mute-not-ready", "stop-not-ready"])
		await expect(page.getByTestId(id)).toContainText("Chưa sẵn sàng");
	const follow = page.getByTestId("notify-follow");
	await expect(follow.getByTestId("follow-purpose")).toHaveText(
		"Theo dõi OA để nhận tin vận hành ngay trong Zalo.",
	);
	expect(await mockSdkApis(page)).not.toContain("followOA");
	await checkMiniAppScreen(page);
	await follow.getByRole("button", { name: "Theo dõi OA" }).click();
	await expect(follow.getByTestId("follow-done")).toHaveText(
		"Bạn đã theo dõi OA.",
	);
	expect(await mockSdkApis(page)).toContain("followOA");
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByTestId("profile")).toBeVisible();
});

test("refusing the follow changes nothing else", async ({ page }) => {
	await openSettings(page, "?role=staff&follow=refused");
	const follow = page.getByTestId("notify-follow");
	await follow.getByRole("button", { name: "Theo dõi OA" }).click();
	await expect(follow.getByTestId("follow-refused")).toContainText(
		"Bạn chưa theo dõi OA.",
	);
	await expect(
		follow.getByRole("button", { name: "Theo dõi OA" }),
	).toBeEnabled();
	await expect(
		page.getByTestId("destination").getByTestId("destination-state"),
	).toHaveText("Đang nhận");
	await checkMiniAppScreen(page);
});
