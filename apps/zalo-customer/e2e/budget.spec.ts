import {
	measurePaint,
	measureScreenPaint,
	paintBudgetProblems,
	screenPaintProblems,
	throttleLikeAMidRangePhone,
} from "@fnb/zalo-mini/testing/paint-budget";
import { expect, type Page, test } from "@playwright/test";
import { PROGRAMME } from "./customer-checks";

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

// Test design (ISTQB, G-38), a performance efficiency test with a use-case scenario: the paint budget for the screens
// after joining, one case per screen (the wallet, the rewards screen, its list) and one for the wallet's worst case, the
// first tap before its script is preloaded. The limit's boundary values (2,499 ms passes, 2,500 ms fails, no paint
// recorded fails) are unit-tested in zalo-mini:unit/budget. The browser reports a largest contentful paint for
// the page load only, so the wallet and the rewards list, which the app opens itself, are read as the time from the tap
// to the second frame after their content is in the page (`measureScreenPaint`), with the same throttling and the same
// 2.5 s limit as the first screens. The whole flow runs throttled, from a visitor's first screen through the consent to
// the wallet, so each screen is measured with the scripts and data a real tap would find.
test("the wallet and the rewards list, opened after joining, paint within budget on a throttled phone", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await throttleLikeAMidRangePhone(page);
	await page.goto("./", { waitUntil: "load" });
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await page.getByRole("button", { name: "Tham gia thành viên" }).click();
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await page.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Tham gia" }).click();
	await expect(
		page.getByRole("heading", { name: "Chào mừng bạn!" }),
	).toBeVisible();

	const wallet = await measureScreenPaint(
		page,
		"[data-testid=member-card]",
		() => page.getByRole("button", { name: "Bỏ qua" }).click(),
	);
	await expect(page.getByTestId("member-card")).toBeVisible();
	await expect(page.getByTestId("stamp-count")).toHaveText("1/10 dấu");
	test.info().annotations.push({
		type: "paint",
		description: `wallet after joining: ${Math.round(wallet)} ms after the tap`,
	});
	expect(screenPaintProblems(wallet)).toEqual([]);

	// the visitor joined without a store link, so the rewards screen first asks for a store, then lists its rewards
	const rewardsScreen = await measureScreenPaint(
		page,
		"[data-testid=reward-store-picker]",
		() => page.getByRole("button", { name: "Đổi quà" }).click(),
	);
	test.info().annotations.push({
		type: "paint",
		description: `rewards screen after joining: ${Math.round(rewardsScreen)} ms after the tap`,
	});
	expect(screenPaintProblems(rewardsScreen)).toEqual([]);
	const rewardsList = await measureScreenPaint(
		page,
		"[data-testid=rewards]",
		() => page.getByTestId("reward-store-picker").selectOption("mau-1"),
		"change",
	);
	await expect(page.getByTestId("rewards")).toBeVisible();
	test.info().annotations.push({
		type: "paint",
		description: `rewards list after joining: ${Math.round(rewardsList)} ms after choosing the store`,
	});
	expect(screenPaintProblems(rewardsList)).toEqual([]);
});

// The worst case of the wallet: a member taps the card tab straight after the first screen, before the idle preload has
// fetched the wallet's script, so the tap itself loads it over the throttled network.
test("a member's first tap on the wallet, before its script is preloaded, paints within budget", async ({
	page,
}) => {
	await throttleLikeAMidRangePhone(page);
	await page.goto("./?member=1", { waitUntil: "load" });
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	const preloaded = await page
		.locator("html")
		.getAttribute("data-screens-preloaded");
	const wallet = await measureScreenPaint(
		page,
		"[data-testid=member-card]",
		() =>
			page
				.getByRole("navigation")
				.getByText("Thẻ thành viên", { exact: true })
				.click(),
	);
	await expect(page.getByTestId("member-card")).toBeVisible();
	test.info().annotations.push({
		type: "paint",
		description: `wallet, first tap (script preloaded before the tap: ${preloaded === "true"}): ${Math.round(wallet)} ms after the tap`,
	});
	expect(screenPaintProblems(wallet)).toEqual([]);
});
