// Test design: state transition and error guessing for the screens that load their own script on first use
// (route-level code splitting, the first-load script budget). A chunk that is not needed for the first screen must
// not be fetched for it, must load when its screen opens, must stay usable offline once loaded, and a chunk that
// cannot be fetched must say so and recover on retry. No personal data is involved: the stand-in member is fictional.
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";

const SHIFT_CHUNK = "**/assets/shift-screen.*";
const PROFILE_CHUNK = "**/assets/profile-screen.*";

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

async function homeReady(page: Page): Promise<void> {
	await expect(page.getByTestId("home")).toHaveAttribute(
		"data-status",
		"ready",
	);
}

async function openTab(page: Page, name: string): Promise<void> {
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name })
		.click();
}

async function screensPreloaded(page: Page): Promise<void> {
	await expect(page.locator("html")).toHaveAttribute(
		"data-screens-preloaded",
		"true",
	);
}

test("the first screen does not fetch the shift or profile screens, and they arrive afterwards", async ({
	page,
}) => {
	const scripts: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith(".js")) scripts.push(request.url());
	});
	await page.goto("./", { waitUntil: "load" });
	await homeReady(page);
	expect(scripts.length).toBeGreaterThan(0);
	expect(
		scripts.filter((url) => /shift-screen|profile-screen/.test(url)),
	).toEqual([]);
	await screensPreloaded(page);
	expect(scripts.some((url) => /shift-screen/.test(url))).toBe(true);
	expect(scripts.some((url) => /profile-screen/.test(url))).toBe(true);
});

test("once the app has loaded, every screen still opens offline, even one never visited", async ({
	page,
	context,
}) => {
	await page.goto("./");
	await homeReady(page);
	await screensPreloaded(page);
	await context.setOffline(true);
	await openTab(page, "Ca làm");
	await expect(page.getByTestId("shift")).toBeVisible();
	await checkMiniAppScreen(page);
	await openTab(page, "Cá nhân");
	await expect(page.getByTestId("profile")).toBeVisible();
	await openTab(page, "Thông báo");
	await expect(page.getByTestId("announcements")).toBeVisible();
	await expect(page.getByTestId("screen-load-failed")).toHaveCount(0);
});

test("a screen whose script cannot be fetched says so, and a retry opens it", async ({
	page,
}) => {
	await page.route(PROFILE_CHUNK, (route) =>
		route.abort("internetdisconnected"),
	);
	await page.goto("./");
	await homeReady(page);
	await openTab(page, "Cá nhân");
	const failed = page.getByTestId("screen-load-failed");
	await expect(failed).toBeVisible();
	await expect(failed.getByRole("alert")).toHaveText(
		"Chưa tải được màn hình này. Kiểm tra kết nối rồi thử lại.",
	);
	// The refused request is logged by the browser on purpose, so the console check is left out here.
	await page.unroute(PROFILE_CHUNK);
	await failed.getByRole("button", { name: "Thử lại" }).click();
	await expect(page.getByTestId("profile")).toBeVisible();
	await expect(failed).toHaveCount(0);
});

test("a missing script for one screen leaves the others working", async ({
	page,
}) => {
	await page.route(SHIFT_CHUNK, (route) => route.abort("internetdisconnected"));
	await page.goto("./");
	await homeReady(page);
	await openTab(page, "Ca làm");
	await expect(page.getByTestId("screen-load-failed")).toBeVisible();
	await openTab(page, "Thông báo");
	await expect(page.getByTestId("announcements")).toBeVisible();
});
