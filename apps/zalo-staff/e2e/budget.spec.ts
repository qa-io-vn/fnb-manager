import {
	measurePaint,
	measureScreenPaint,
	paintBudgetProblems,
	screenPaintProblems,
	throttleLikeAMidRangePhone,
} from "@fnb/zalo-mini/testing/paint-budget";
import { expect, test } from "@playwright/test";

test("the first screen paints and loads within budget on a throttled phone", async ({
	page,
}) => {
	await throttleLikeAMidRangePhone(page);
	await page.goto("./", { waitUntil: "load" });
	await expect(page.getByTestId("home")).toHaveAttribute(
		"data-status",
		"ready",
	);
	const measured = await measurePaint(page);
	test.info().annotations.push({
		type: "paint",
		description: `LCP ${Math.round(measured.lcpMs)} ms, load ${Math.round(measured.loadMs)} ms`,
	});
	expect(paintBudgetProblems(measured)).toEqual([]);
});

// Test design (ISTQB, G-38), a performance efficiency test of one use case: Ghi nhận khách is the screen staff open
// most often after the home. The limit's boundary values (2,499 ms passes, 2,500 ms fails, no paint recorded fails) are
// unit-tested in zalo-mini:unit/budget. The browser reports a largest
// contentful paint for the page load only, so a screen the app opens itself is read as the time from the tap to the
// second frame after its content is in the page (`measureScreenPaint`), with the same throttling and the same 2.5 s
// limit as the first screen. The tap is the first one after the home's loyalty card shows, as a member of staff would.
test("Ghi nhận khách paints within budget on a throttled phone", async ({
	page,
}) => {
	await throttleLikeAMidRangePhone(page);
	await page.goto("./?role=staff", { waitUntil: "load" });
	const card = page.getByTestId("home-loyalty");
	await expect(card).toBeVisible();
	const preloaded = await page
		.locator("html")
		.getAttribute("data-screens-preloaded");
	const checkIn = await measureScreenPaint(
		page,
		"[data-testid=checkin-entry]",
		() => card.getByRole("button", { name: "Ghi nhận khách" }).click(),
	);
	await expect(page.getByTestId("checkin-entry")).toBeVisible();
	await expect(
		page.getByRole("heading", { level: 1, name: "Ghi nhận khách" }),
	).toBeVisible();
	test.info().annotations.push({
		type: "paint",
		description: `Ghi nhận khách (screens preloaded before the tap: ${preloaded === "true"}): ${Math.round(checkIn)} ms after the tap`,
	});
	expect(screenPaintProblems(checkIn)).toEqual([]);
});
