import { checkPage } from "../support/checks";
import { expect, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import { expectCurrentSettingsPage, openSettings } from "../support/settings";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Bản tin lists 14 digests newest first with their delivery, the correction, a link to Ngày, and stays accessible", async ({
	page,
}) => {
	await openSettings(page, "ban-tin");
	await expectCurrentSettingsPage(page, "Bản tin");
	const cards = page.getByTestId("digest-card");
	await expect(cards).toHaveCount(14);
	const dates = await cards.evaluateAll((items) =>
		items.map((item) => item.getAttribute("data-date") ?? ""),
	);
	expect([...dates].sort().reverse()).toEqual(dates);
	await expect(page.getByTestId("digest-corrected")).toHaveCount(1);
	await expect(page.getByTestId("digest-correction-text")).toContainText(
		"Đính chính",
	);
	await expect(cards.first().getByTestId("digest-delivery")).toContainText(
		"đã gửi",
	);
	const text = cards.first().getByTestId("digest-text");
	await expect(text).toContainText("Doanh thu thuần");
	expect(await text.evaluate((node) => node.children.length)).toBe(0);
	await checkPage(page);
	const first = dates[0] ?? "";
	await cards.first().getByTestId("digest-open-day").click();
	await expect(page).toHaveURL((url) => url.hash.startsWith(`#/bao-cao/ngay?date=${first}`));
	await page.goBack();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(page.locator("body")).not.toContainText("settings.digest.");
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
