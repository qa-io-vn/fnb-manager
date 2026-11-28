import {
	checkMiniAppScreen,
	expectNoTextOpacity,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

// Test design (ISTQB) for the route chrome and the bars at the bottom (design spec 6.0, 6.1, 7.4), on a Development build of
// the synthetic brand-3 in the b3 phone projects (320, 360 and 412 px, light and dark, WebKit). The design kit screens
// stand in for the screens of the next steps: /kit-tabs is a tab route, /kit-flow the same screen as a flow route with a
// sticky action bar, and ?strip=1 puts a strip above the tab bar. Decision table of the route (tab or flow) against the
// strip: which bars show and what the page leaves room for. Use case: a keyboard user tabs through a page with two bars
// stacked at the bottom, and no control they reach may be hidden behind a bar (WCAG 2.4.11, focus not obscured).

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

const BARS = "[data-bottom-bar], .zaui-bottom-navigation";

interface Reached {
	readonly name: string;
	readonly inBar: boolean;
	readonly obscuredBy: string | null;
}

// Presses Tab from the top of the page and reports what each press reached and whether a bar covers it
async function tabThrough(page: Page, presses: number): Promise<Reached[]> {
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur(),
	);
	const reached: Reached[] = [];
	for (let press = 0; press < presses; press += 1) {
		await page.keyboard.press("Tab");
		// WebKit scrolls the focused control into view a frame after the key press; measuring at once found a stepper
		// button still under the tab bar in about one run of three. Two frames let the scroll land, as a person sees it.
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		);
		const now = await page.evaluate((selector) => {
			const element = document.activeElement as HTMLElement | null;
			if (element === null || element === document.body) return null;
			const box = element.getBoundingClientRect();
			const name =
				element.getAttribute("aria-label") ??
				element.textContent?.trim().slice(0, 40) ??
				element.tagName;
			const inBar = element.closest(selector) !== null;
			const covering = [...document.querySelectorAll(selector)]
				.filter((bar) => bar.getClientRects().length > 0)
				.find((bar) => {
					const rect = bar.getBoundingClientRect();
					return (
						rect.height > 0 &&
						box.bottom > rect.top &&
						box.top < rect.bottom &&
						box.right > rect.left &&
						box.left < rect.right
					);
				});
			return {
				name,
				inBar,
				obscuredBy:
					!inBar && covering !== undefined
						? (covering.getAttribute("data-bottom-bar") ?? "tab bar")
						: null,
			};
		}, BARS);
		if (now === null) break;
		reached.push(now);
	}
	return reached;
}

async function box(page: Page, selector: string) {
	const found = await page.locator(selector).first().boundingBox();
	if (found === null) throw new Error(`${selector} has no box on screen`);
	return found;
}

test("a tab route with a strip shows two bars: the strip sits on the tab bar and the page leaves room for both", async ({
	page,
}) => {
	await page.goto("./?route=/kit-tabs&strip=1");
	await expect(page.getByTestId("kit-probe")).toBeVisible();
	const shell = page.getByTestId("shell");
	await expect(shell).toHaveAttribute("data-chrome", "tabs");
	await expect(shell).toHaveAttribute("data-bottom-bars", "2");
	await expect(page.getByTestId("above-tabs")).toBeVisible();
	const strip = await box(page, '[data-bottom-bar="strip"]');
	const tabs = await box(page, ".zaui-bottom-navigation-content");
	// the strip rests on the tab bar, with no gap and no overlap
	expect(Math.abs(strip.y + strip.height - tabs.y)).toBeLessThanOrEqual(1.5);
	// the page is padded by both, and the document scrolls clear of both
	const room = await page.evaluate(() => ({
		padding: Number.parseFloat(
			getComputedStyle(document.querySelector("main") as Element).paddingBottom,
		),
		scroll: Number.parseFloat(
			getComputedStyle(document.documentElement).scrollPaddingBottom,
		),
	}));
	expect(room.padding).toBeGreaterThanOrEqual(strip.height + tabs.height - 1.5);
	expect(room.scroll).toBeGreaterThanOrEqual(strip.height + tabs.height - 1.5);
	await checkMiniAppScreen(page);
	await expectNoTextOpacity(page);
});

test("tabbing through a page with two bars never leaves a control under one", async ({
	page,
}) => {
	await page.goto("./?route=/kit-tabs&strip=1");
	await expect(page.getByTestId("kit-probe")).toBeVisible();
	const reached = await tabThrough(page, 90);
	// the whole page was crossed (the kit screen has seventeen stops), and the bars themselves were reached too
	expect(reached.filter((step) => !step.inBar).length).toBeGreaterThan(14);
	expect(reached.some((step) => step.name === "Xem" && step.inBar)).toBe(true);
	expect(reached.some((step) => step.name === "Tài khoản" && step.inBar)).toBe(
		true,
	);
	expect(
		reached.filter((step) => step.obscuredBy !== null),
		"controls hidden behind a bar",
	).toEqual([]);
});

test("a flow route hides the tab bar and the strip, and leaves the bottom to the screen's own bar", async ({
	page,
}) => {
	await page.goto("./?route=/kit-flow&strip=1");
	await expect(page.getByTestId("kit-probe")).toBeVisible();
	const shell = page.getByTestId("shell");
	await expect(shell).toHaveAttribute("data-chrome", "flow");
	await expect(page.locator(".zaui-bottom-navigation")).toHaveCount(0);
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await expect(page.getByTestId("above-tabs")).toHaveCount(0);
	// one bar: the screen's sticky action bar, which sits in the page and takes no padding of its own
	await expect(shell).toHaveAttribute("data-bottom-bars", "1");
	const room = await page.evaluate(() => ({
		padding: getComputedStyle(document.querySelector("main") as Element)
			.paddingBottom,
		scroll: Number.parseFloat(
			getComputedStyle(document.documentElement).scrollPaddingBottom,
		),
	}));
	expect(room.padding).toBe("0px");
	const bar = await box(page, '[data-bottom-bar="action"]');
	expect(room.scroll).toBeGreaterThanOrEqual(bar.height - 1.5);
	await checkMiniAppScreen(page);
});

test("tabbing through a flow screen never leaves a control under its sticky action bar", async ({
	page,
}) => {
	await page.goto("./?route=/kit-flow");
	await expect(page.getByTestId("kit-probe")).toBeVisible();
	const reached = await tabThrough(page, 90);
	expect(reached.filter((step) => !step.inBar).length).toBeGreaterThan(14);
	expect(
		reached.filter((step) => step.obscuredBy !== null),
		"controls hidden behind the action bar",
	).toEqual([]);
});

test("the tab-through check does see a control under a bar: a page without the shell's focus handling hides one", async ({
	page,
}) => {
	// a control check that cannot fail proves nothing: a browser does not scroll a control that is already inside the
	// viewport, so a bar covering the lower part of the screen hides the buttons under it unless the page takes care
	const buttons = Array.from(
		{ length: 8 },
		(_, i) =>
			`<button style="display:block;min-height:44px;width:200px">Nút ${i + 1}</button>`,
	).join("");
	await page.route("**/bar-page.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>bar</title></head><body style="margin:0">${buttons}<div data-bottom-bar="cover" style="position:fixed;left:0;right:0;bottom:0;height:70vh;background:#ccc"></div></body></html>`,
		}),
	);
	await page.goto("./bar-page.html");
	const reached = await tabThrough(page, 12);
	expect(reached.length).toBeGreaterThanOrEqual(8);
	expect(
		reached.filter((step) => step.obscuredBy === "cover").length,
		"controls under the bar",
	).toBeGreaterThan(0);
});

test("a tab route without a strip shows the tab bar alone", async ({
	page,
}) => {
	await page.goto("./?route=/kit-tabs");
	await expect(page.getByTestId("kit-probe")).toBeVisible();
	await expect(page.getByTestId("shell")).toHaveAttribute(
		"data-bottom-bars",
		"1",
	);
	await expect(page.getByTestId("above-tabs")).toHaveCount(0);
	await expect(page.locator(".zaui-bottom-navigation")).toBeVisible();
});

test.describe("a count on a tab", () => {
	const account = (page: Page) =>
		page.locator(".zaui-bottom-navigation-item", { hasText: "Tài khoản" });

	test("shows the count on the tab's icon and says it to a screen reader", async ({
		page,
	}) => {
		await page.goto("./?badge=3");
		await expect(
			page.getByRole("heading", { name: "Thành viên Quán Mẫu Một" }),
		).toBeVisible();
		const badge = account(page).getByTestId("tab-badge");
		await expect(badge).toHaveText("3");
		await expect(badge).toHaveAttribute("aria-hidden", "true");
		await expect(account(page)).toContainText("3 mới");
		// the other tabs have none, and the tab's label is still its own text
		await expect(page.getByTestId("tab-badge")).toHaveCount(1);
		await expect(
			page.getByRole("navigation").getByText("Tài khoản", { exact: true }),
		).toBeVisible();
		await checkMiniAppScreen(page);
		await expectNoTextOpacity(page);
	});

	test("writes 99+ for a count above 99, and no badge for none, zero or a bad count", async ({
		page,
	}) => {
		await page.goto("./?badge=150");
		await expect(account(page).getByTestId("tab-badge")).toHaveText("99+");
		for (const query of ["", "?badge=0", "?badge=-2", "?badge=abc"]) {
			await page.goto(`./${query}`);
			await expect(
				page.getByRole("heading", { name: "Thành viên Quán Mẫu Một" }),
			).toBeVisible();
			await expect(page.getByTestId("tab-badge")).toHaveCount(0);
		}
	});

	test("keeps the badge when the tab is opened", async ({ page }) => {
		await page.goto("./?badge=2");
		await account(page).click();
		await expect(page.getByTestId("tab-badge")).toHaveText("2");
	});
});
