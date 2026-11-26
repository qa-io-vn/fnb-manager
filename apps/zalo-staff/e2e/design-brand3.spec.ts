import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	checkMiniAppScreen,
	expectFontsBundled,
	expectNoTextOpacity,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Test design (ISTQB) for a themed brand in the staff app, the synthetic brand-3, which sets every optional colour role, a
// shape and a body size (design spec 8.3): the staff home in six phone projects (320, 360 and 412 px, light and dark, and
// WebKit). Equivalence partitions: the brand banner, a card, a text field and a button; decision table of the scheme
// (light, dark) against the colours drawn. The home also passes the shared checks and the checks of the handbook: no text
// with an opacity, and fonts only from the app's own origin. The staff app shows no brand art and no price in the
// handbook's sense (revenue figures are staff operations), so those checks are not part of it.

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
).mini_apps.find((app) => app.brand_key === "brand-3" && app.kind === "staff");
if (row === undefined)
	throw new Error("brand-3 is not in the synthetic brands");
const THEME = row.theme;

function rgb(hex: string): string {
	const part = (from: number) => Number.parseInt(hex.slice(from, from + 2), 16);
	return `rgb(${part(1)}, ${part(3)}, ${part(5)})`;
}

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

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

async function homeReady(page: Page): Promise<void> {
	await page.goto("./");
	await expect(page.getByTestId("home")).toHaveAttribute(
		"data-status",
		"ready",
	);
}

test("the home wears brand-3's colours in the banner and the page, in light and in dark", async ({
	page,
}) => {
	await homeReady(page);
	const colours = await palette(page);
	const hero = page.getByTestId("brand-hero");
	await expect(hero.getByTestId("brand-wordmark")).toHaveText(THEME.wordmark);
	await expect(hero.getByText(THEME.tagline_vi)).toBeVisible();
	expect(await style(hero, "background-color")).toBe(
		rgb(colours.hero as string),
	);
	expect(await style(hero, "color")).toBe(rgb(colours.hero_ink as string));
	expect(await style(page.locator("body"), "background-color")).toBe(
		rgb(colours.surface as string),
	);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
	await checkMiniAppScreen(page);
	await expectNoTextOpacity(page);
	await expectFontsBundled(page);
});

test("the shape of brand-3 reaches the cards and the store field, and the field text keeps 16 px", async ({
	page,
}) => {
	await homeReady(page);
	const px = (value: number | string | boolean | undefined) =>
		`${String(value)}px`;
	// a card of the home: the card radius and the border width as a property of the page (a phone draws 1.5 px, an emulated
	// browser snaps it to 1 px)
	const card = page.getByTestId("home-card-yesterday");
	expect(await style(card, "border-top-left-radius")).toBe(
		px(THEME.shape.card),
	);
	expect(
		await page.evaluate(() =>
			getComputedStyle(document.documentElement)
				.getPropertyValue("--card-border")
				.trim(),
		),
	).toBe(px(THEME.shape.border));
	const drawn = Number.parseFloat(await style(card, "border-top-width"));
	expect(drawn).toBeGreaterThanOrEqual(1);
	expect(drawn).toBeLessThanOrEqual(Number(THEME.shape.border));
	// the store field: its own radius, and 16 px text (iOS zooms a focused field below that)
	const field = page.getByLabel("Cửa hàng");
	expect(await style(field, "border-top-left-radius")).toBe(
		px(THEME.shape.field),
	);
	expect(await style(field, "font-size")).toBe("16px");
	// the text of the page is 15 px with a line height of 1.45
	const body = page.getByRole("heading", { name: /^Hôm nay đến/ });
	expect(await style(body, "font-size")).toBe(px(THEME.type.body));
});

test("the home does not scroll sideways at any width, and every target is large enough", async ({
	page,
}) => {
	await homeReady(page);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
	await checkMiniAppScreen(page);
});
