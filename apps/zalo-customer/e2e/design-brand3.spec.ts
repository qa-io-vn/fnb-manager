import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	checkMiniAppScreen,
	expectFontsBundled,
	expectNoTextOpacity,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	PROGRAMME,
	watchCustomerPage,
} from "./customer-checks";

// Test design (ISTQB) for a themed brand, the synthetic brand-3, which sets every optional colour role, a shape and a
// body size (design spec 8.3). The build is a Development build, in six phone projects: 320, 360 and 412 px wide, light
// and dark, and WebKit as an iPhone. Equivalence partitions: the home (the banner, the cards, the buttons) and the design
// kit screen (every component in each state); decision table of the scheme (light, dark) against the colours drawn.
// Every screen also passes the shared checks and the checks of the handbook: no text with an opacity, prices only inside
// an element marked data-price (the kit shows some, the home none), and fonts only from the app's own origin.

const root = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"packages",
	"zalo-mini",
);
const row = (
	JSON.parse(
		readFileSync(join(root, "config", "synthetic-brands.json"), "utf8"),
	) as {
		mini_apps: {
			brand_key: string;
			kind: string;
			theme: {
				light: Record<string, string>;
				dark: Record<string, string>;
				shape: Record<string, number | string | boolean>;
				type: { body: number };
				wordmark: string;
				tagline_vi: string;
			};
		}[];
	}
).mini_apps.find(
	(app) => app.brand_key === "brand-3" && app.kind === "customer",
);
if (row === undefined)
	throw new Error("brand-3 is not in the synthetic brands");
const THEME = row.theme;

function rgb(hex: string): string {
	const part = (from: number) => Number.parseInt(hex.slice(from, from + 2), 16);
	return `rgb(${part(1)}, ${part(3)}, ${part(5)})`;
}

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

// Chromium with an emulated pixel ratio draws a border of 1.5 px as 1 px, and a phone with the real ratio keeps it. What
// must hold everywhere is the brand's custom property on the page and a drawn width between the default and the brand's.
async function expectBorderToken(
	page: Page,
	element: Locator,
	token: "--card-border" | "--field-border" | "--outline-width",
	width: number,
): Promise<void> {
	expect(
		await page.evaluate(
			(name) =>
				getComputedStyle(document.documentElement)
					.getPropertyValue(name)
					.trim(),
			token,
		),
	).toBe(`${width}px`);
	const drawn = Number.parseFloat(await style(element, "border-top-width"));
	expect(drawn).toBeGreaterThanOrEqual(1);
	expect(drawn).toBeLessThanOrEqual(width);
}

async function palette(page: Page): Promise<Record<string, string>> {
	const dark = await page.evaluate(
		() => matchMedia("(prefers-color-scheme: dark)").matches,
	);
	return dark ? THEME.dark : THEME.light;
}

async function style(locator: Locator, property: string): Promise<string> {
	return locator.evaluate(
		(element, name) => getComputedStyle(element).getPropertyValue(name),
		property,
	);
}

async function expectNoSideways(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

test("the home wears brand-3's colours, in light and in dark", async ({
	page,
}) => {
	await page.goto("./");
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	const colours = await palette(page);
	const banner = page.getByTestId("brand-banner");
	await expect(banner.getByTestId("brand-wordmark")).toHaveText(THEME.wordmark);
	await expect(banner.getByText(THEME.tagline_vi)).toBeVisible();
	expect(await style(banner, "background-color")).toBe(
		rgb(colours.hero as string),
	);
	expect(await style(banner, "color")).toBe(rgb(colours.hero_ink as string));
	expect(await style(page.locator("body"), "background-color")).toBe(
		rgb(colours.surface as string),
	);
	const joinButton = page.getByRole("button", { name: "Tham gia thành viên" });
	expect(await style(joinButton, "background-color")).toBe(
		rgb(colours.accent as string),
	);
	expect(await style(joinButton, "color")).toBe(
		rgb(colours.accent_ink as string),
	);
	await expectNoSideways(page);
	await checkCustomerScreen(page);
	await expectNoTextOpacity(page);
	await expectPricesOnlyWhereAllowed(page, { allowed: false });
	await expectFontsBundled(page);
});

test("the shape and the body size of brand-3 reach the cards, the buttons and the text of the home", async ({
	page,
}) => {
	await page.goto("./");
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	const px = (value: number | string | boolean | undefined) =>
		`${String(value)}px`;
	const card = page.getByTestId("programme");
	expect(await style(card, "border-top-left-radius")).toBe(
		px(THEME.shape.card),
	);
	await expectBorderToken(
		page,
		card,
		"--card-border",
		Number(THEME.shape.border),
	);
	// shadow: false turns the card's shadow off
	expect(await style(card, "box-shadow")).toBe("none");
	// a row of the store list is a card too
	const store = page.getByTestId("store-list").getByRole("button").first();
	expect(await style(store, "border-top-left-radius")).toBe(
		px(THEME.shape.card),
	);
	// the join button is a control
	const joinButton = page.getByRole("button", { name: "Tham gia thành viên" });
	expect(await style(joinButton, "border-top-left-radius")).toBe(
		px(THEME.shape.control),
	);
	// body text is 15 px with the line height of 1.45
	expect(await style(joinButton, "font-size")).toBe(px(THEME.type.body));
	expect(await style(joinButton, "line-height")).toBe(
		`${THEME.type.body * 1.45}px`,
	);
	await checkCustomerScreen(page);
});

test.describe("the design kit screen", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("./?route=/kit");
		await expect(page.getByTestId("kit-probe")).toBeVisible();
	});

	test("shows every component and passes the shared and the handbook's checks", async ({
		page,
	}) => {
		await expectNoSideways(page);
		await checkMiniAppScreen(page);
		await expectNoTextOpacity(page);
		await expectPricesOnlyWhereAllowed(page, { allowed: true });
		await expectFontsBundled(page);
	});

	test("draws buttons with the control radius, the outline colour and the disabled state without an opacity", async ({
		page,
	}) => {
		const colours = await palette(page);
		const secondary = page.locator('[data-variant="secondary"]');
		expect(await style(secondary, "border-top-left-radius")).toBe(
			`${THEME.shape.control}px`,
		);
		expect(await style(secondary, "border-top-width")).toBe(
			`${THEME.shape.outline}px`,
		);
		// the outline is the ink; a danger button's outline is the negative colour
		expect(await style(secondary, "border-top-color")).toBe(
			rgb(colours.ink as string),
		);
		expect(
			await style(page.locator('[data-variant="danger"]'), "border-top-color"),
		).toBe(rgb(colours.negative as string));
		const primary = page.locator('[data-variant="primary"]');
		expect(await style(primary, "background-color")).toBe(
			rgb(colours.accent as string),
		);
		const inverse = page.locator('[data-variant="inverse"]');
		expect(await style(inverse, "background-color")).toBe(
			rgb(colours.inverse as string),
		);
		expect(await style(inverse, "color")).toBe(
			rgb(colours.inverse_ink as string),
		);
		const badge = page.locator('[data-variant="badge"]');
		expect(await style(badge, "background-color")).toBe(
			rgb(colours.badge as string),
		);
		const disabled = page.locator('[data-variant="disabled"]');
		await expect(disabled).toBeDisabled();
		expect(await style(disabled, "background-color")).toBe(
			rgb(colours.surface_sunken as string),
		);
		expect(await style(disabled, "color")).toBe(
			rgb(colours.ink_muted as string),
		);
		expect(await style(disabled, "opacity")).toBe("1");
	});

	test("draws the chips as pills of their tones, and moves the pressed one", async ({
		page,
	}) => {
		const colours = await palette(page);
		const group = page.getByRole("group", { name: "Nhóm mẫu" });
		const first = group.getByRole("button", { name: "Nhóm một" });
		const second = group.getByRole("button", { name: "Nhóm hai" });
		await expect(first).toHaveAttribute("aria-pressed", "true");
		expect(await style(first, "background-color")).toBe(
			rgb(colours.tone_1 as string),
		);
		expect(await style(first, "color")).toBe(rgb(colours.tone_1_ink as string));
		// an idle chip: an outline in the ink on a card
		expect(await style(second, "border-top-width")).toBe(
			`${THEME.shape.outline}px`,
		);
		expect(await style(second, "background-color")).toBe(
			rgb(colours.surface_raised as string),
		);
		await second.click();
		await expect(second).toHaveAttribute("aria-pressed", "true");
		await expect(first).toHaveAttribute("aria-pressed", "false");
		expect(await style(second, "background-color")).toBe(
			rgb(colours.tone_2 as string),
		);
	});

	test("draws the option pills with a field border, and shows a check mark on the chosen ones", async ({
		page,
	}) => {
		const colours = await palette(page);
		const group = page.getByTestId("kit-size");
		const large = group.locator("label", { hasText: "Lớn" });
		const medium = group.locator("label", { hasText: "Vừa" });
		await expectBorderToken(
			page,
			large,
			"--field-border",
			Number(THEME.shape.border),
		);
		expect(await style(large, "border-top-color")).toBe(
			rgb(colours.line_strong as string),
		);
		await expect(medium.locator("svg")).toHaveCount(1);
		await expect(large.locator("svg")).toHaveCount(0);
		await large.click();
		await expect(large.locator("svg")).toHaveCount(1);
		await expect(medium.locator("svg")).toHaveCount(0);
		expect(await style(large, "background-color")).toBe(
			rgb(colours.accent as string),
		);
		// several choices: each can be taken back
		const extras = page.getByTestId("kit-extra");
		const second = extras.getByRole("checkbox", { name: "Mục hai" });
		await expect(second).toBeChecked();
		await second.click({ force: true });
		await expect(second).not.toBeChecked();
	});

	test("steps a quantity within its bounds, with a bin at the smallest value", async ({
		page,
	}) => {
		const count = page.getByTestId("kit-stepper-count");
		await expect(count).toHaveText("2");
		await page.getByTestId("kit-stepper-plus").click();
		await expect(count).toHaveText("3");
		await page.getByTestId("kit-stepper-minus").click();
		await page.getByTestId("kit-stepper-minus").click();
		await expect(count).toHaveText("1");
		// at 1 the minus is a bin
		await expect(page.getByRole("button", { name: "Bỏ mục" })).toBeVisible();
		// a stepper at its largest value cannot go up
		await expect(page.getByTestId("kit-stepper-limit-plus")).toBeDisabled();
		await expect(page.getByTestId("kit-stepper-limit-minus")).toBeDisabled();
	});

	test("shows the status pills with their words and the badge in its colours", async ({
		page,
	}) => {
		const colours = await palette(page);
		const pills = page.getByTestId("kit-pills");
		const badge = pills.locator('[data-tone="badge"]');
		await expect(badge).toHaveText("Mới");
		expect(await style(badge, "background-color")).toBe(
			rgb(colours.badge as string),
		);
		expect(await style(badge, "color")).toBe(rgb(colours.badge_ink as string));
		const negative = pills.locator('[data-tone="negative"]');
		await expect(negative).toHaveText("Đã hủy");
		expect(await style(negative, "background-color")).toBe(
			rgb(colours.negative_soft as string),
		);
		expect(await style(negative, "color")).toBe(rgb(colours.ink as string));
	});

	test("writes every price inside an element marked data-price, with the sign and the spoken text", async ({
		page,
	}) => {
		const prices = page.getByTestId("kit-prices").locator("[data-price]");
		await expect(prices).toHaveCount(4);
		await expect(prices.nth(0).locator("[aria-hidden=true]")).toHaveText(
			"35.000đ",
		);
		await expect(prices.nth(0)).toContainText("35.000 đồng");
		await expect(prices.nth(2).locator("[aria-hidden=true]")).toHaveText(
			"+5.000đ",
		);
		await expect(prices.nth(3).locator("[aria-hidden=true]")).toHaveText(
			"−5.000đ",
		);
		await expect(prices.nth(3)).toContainText("trừ 5.000 đồng");
	});

	test("shows a toast on the inverse colours and takes it away after four seconds", async ({
		page,
	}) => {
		const colours = await palette(page);
		// the clock stands still from here, so the four seconds are the test's to spend, not the machine's
		await page.clock.pauseAt(new Date("2026-11-19T10:10:00+07:00"));
		await page.getByTestId("kit-toast-open").click();
		const toast = page.getByTestId("kit-toast");
		await expect(toast).toHaveText("Đã thêm một mục.");
		await expect(toast).toHaveAttribute("role", "status");
		expect(await style(toast.locator("p"), "background-color")).toBe(
			rgb(colours.inverse as string),
		);
		await page.clock.runFor(3900);
		await expect(toast).toBeVisible();
		await page.clock.runFor(200);
		await expect(toast).toHaveCount(0);
	});

	test("keeps a sticky action bar at the bottom of its card, with the safe area under it", async ({
		page,
	}) => {
		const bar = page.getByTestId("kit-action-bar");
		await expect(bar).toHaveAttribute("data-bottom-bar", "action");
		expect(await style(bar, "position")).toBe("sticky");
	});
});
