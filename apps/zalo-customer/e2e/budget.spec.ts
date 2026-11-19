import {
	measurePaint,
	paintBudgetProblems,
	throttleLikeAMidRangePhone,
} from "@fnb/zalo-mini/testing/paint-budget";
import { expect, type Page, test } from "@playwright/test";

async function measureFirstScreen(
	page: Page,
	path: string,
	heading: string,
): Promise<string[]> {
	await throttleLikeAMidRangePhone(page);
	await page.goto(path, { waitUntil: "load" });
	await expect(page.getByRole("heading", { name: heading })).toBeVisible();
	const measured = await measurePaint(page);
	test.info().annotations.push({
		type: "paint",
		description: `${path}: LCP ${Math.round(measured.lcpMs)} ms, load ${Math.round(measured.loadMs)} ms`,
	});
	return paintBudgetProblems(measured);
}

test("the first screen paints and loads within budget on a throttled phone", async ({
	page,
}) => {
	expect(
		await measureFirstScreen(page, "./", "Thành viên Quán Mẫu Một"),
	).toEqual([]);
});

test("a standee's store page, the first screen of a scan, paints and loads within budget", async ({
	page,
}) => {
	expect(
		await measureFirstScreen(
			page,
			"./?store=mau-1&src=standee",
			"Cửa hàng Mẫu 1",
		),
	).toEqual([]);
});
