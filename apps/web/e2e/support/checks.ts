import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const PHONE_WIDTH = 360;
const BOX_TOLERANCE_PX = 1;

export async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page })
		.withTags([
			"wcag2a",
			"wcag2aa",
			"wcag21a",
			"wcag21aa",
			"wcag22a",
			"wcag22aa",
			"best-practice",
		])
		.analyze();
	const serious = results.violations
		.filter(
			(violation) =>
				violation.impact === "serious" || violation.impact === "critical",
		)
		.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
		}));
	expect(serious).toEqual([]);
}

export async function expectPageNeverScrollsSideways(
	page: Page,
): Promise<void> {
	const sideways = await page.evaluate(() => {
		const root = document.documentElement;
		const top = window.scrollY;
		window.scrollTo({ left: root.scrollWidth, top, behavior: "instant" });
		const reachedLeft = window.scrollX;
		window.scrollTo({ left: 0, top, behavior: "instant" });
		return {
			scrollWidth: root.scrollWidth,
			clientWidth: root.clientWidth,
			reachedLeft,
		};
	});
	expect(sideways.scrollWidth).toBeLessThanOrEqual(sideways.clientWidth);
	expect(sideways.reachedLeft).toBe(0);
}

export async function expectNoHorizontalScrollOnPhone(
	page: Page,
): Promise<void> {
	const original = page.viewportSize();
	await page.setViewportSize({ width: PHONE_WIDTH, height: 800 });
	await page.waitForTimeout(300);
	await expectPageNeverScrollsSideways(page);
	if (original) await page.setViewportSize(original);
}

async function boxOf(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error("the element has no layout box");
	return box;
}

export async function expectHorizontallyInside(
	inner: Locator,
	outer: Locator,
): Promise<void> {
	const innerBox = await boxOf(inner);
	const outerBox = await boxOf(outer);
	expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - BOX_TOLERANCE_PX);
	expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(
		outerBox.x + outerBox.width + BOX_TOLERANCE_PX,
	);
}

export async function expectLastColumnReachable(
	page: Page,
	tableScroll: Locator,
): Promise<void> {
	const headers = tableScroll.locator("thead th");
	const last = headers.last();
	await tableScroll.evaluate((element) => {
		const scroller = element.firstElementChild;
		if (scroller instanceof HTMLElement)
			scroller.scrollLeft = scroller.scrollWidth;
	});
	await expect(tableScroll.getByTestId("table-scroll-hint")).toHaveCount(0);
	await expectHorizontallyInside(last, tableScroll);
	if ((await headers.count()) > 1) {
		const firstBox = await boxOf(headers.first());
		const lastBox = await boxOf(last);
		expect(lastBox.x).toBeGreaterThanOrEqual(
			firstBox.x + firstBox.width - BOX_TOLERANCE_PX,
		);
	}
	await expect(tableScroll.getByTestId("table-scroll-hint")).toHaveCount(0);
	await expectPageNeverScrollsSideways(page);
}

export async function expectEveryTableReachableOnPhone(
	page: Page,
): Promise<void> {
	const tables = page.getByTestId("table-scroll");
	const count = await tables.count();
	for (let index = 0; index < count; index++) {
		const table = tables.nth(index);
		if (await table.isVisible()) await expectLastColumnReachable(page, table);
	}
}

export async function checkPage(page: Page): Promise<void> {
	await expectNoSeriousAxeViolations(page);
	await expectNoHorizontalScrollOnPhone(page);
	await page.setViewportSize({ width: PHONE_WIDTH, height: 800 });
	await page.waitForTimeout(300);
	await expectEveryTableReachableOnPhone(page);
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "dark" });
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "light" });
	await page.setViewportSize({ width: 1280, height: 800 });
}

function chartsStillComing(): number {
	const inViewport = (element: Element) => {
		const box = element.getBoundingClientRect();
		return (
			box.bottom > 0 &&
			box.top < window.innerHeight &&
			box.right > 0 &&
			box.left < window.innerWidth
		);
	};
	const placeholders = [
		...document.querySelectorAll('[data-testid="chart-placeholder"]'),
	].filter(inViewport).length;
	const loading = [...document.querySelectorAll("figure")].filter((figure) =>
		/Đang tải biểu đồ|Loading chart/.test(figure.textContent ?? ""),
	).length;
	return placeholders + loading;
}

export async function waitForCharts(page: Page): Promise<void> {
	await expect.poll(() => page.evaluate(chartsStillComing)).toBe(0);
}

export function parseExactMoney(text: string | null): number {
	return Number((text ?? "").replace(/[^\d-]/g, ""));
}
