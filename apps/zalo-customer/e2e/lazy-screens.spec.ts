// Test design: state transition and error guessing for the screens that load their own script on first use
// (route-level code splitting, the first-load script budget). The first screen must not fetch the wallet, join or
// claim scripts, the other screens must arrive afterwards so they open offline, and a script that cannot be fetched
// must say so and open on retry. The demo member is fictional.
import { expect, test } from "@playwright/test";
import { openHome, openTab, watchCustomerPage } from "./customer-checks";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

test("the first screen does not fetch the wallet screens, and they arrive afterwards", async ({
	page,
}) => {
	const scripts: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith(".js")) scripts.push(request.url());
	});
	await page.goto("./?member=1", { waitUntil: "load" });
	expect(scripts.length).toBeGreaterThan(0);
	expect(scripts.filter((url) => /wallet-screen|join-flow/.test(url))).toEqual(
		[],
	);
	await expect(page.locator("html")).toHaveAttribute(
		"data-screens-preloaded",
		"true",
	);
	expect(scripts.some((url) => /wallet-screen/.test(url))).toBe(true);
});

test("a screen whose script cannot be fetched says so, and a retry opens it", async ({
	page,
}) => {
	await page.route("**/assets/wallet-screen.*", (route) =>
		route.abort("internetdisconnected"),
	);
	await openHome(page, "?member=1");
	await openTab(page, "Thẻ thành viên");
	const failed = page.getByTestId("screen-load-failed");
	await expect(failed).toBeVisible();
	await expect(failed.getByRole("alert")).toHaveText(
		"Mất kết nối mạng. Kiểm tra mạng rồi thử lại.",
	);
	// The refused request is logged by the browser on purpose, so the console check is left out here.
	await page.unroute("**/assets/wallet-screen.*");
	await failed.getByRole("button", { name: "Thử lại" }).click();
	await expect(page.getByTestId("member-card")).toBeVisible();
	await expect(failed).toHaveCount(0);
});
