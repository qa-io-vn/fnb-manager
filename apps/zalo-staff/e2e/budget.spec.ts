import {
	measurePaint,
	paintBudgetProblems,
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
