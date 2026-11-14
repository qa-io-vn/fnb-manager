import { expect, test } from "@playwright/test";
import {
	checkPage,
	expectHorizontallyInside,
	expectLastColumnReachable,
	expectNoSeriousAxeViolations,
	expectPageNeverScrollsSideways,
	PHONE_WIDTH,
	parseExactMoney,
	waitForCharts,
} from "../support/checks";
import {
	expectNoConsoleErrors,
	reportUrl,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";

const middayInHoChiMinhCity = new Date("2026-11-04T05:30:00.000Z");
const FOCUS_STEPS = 60;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(middayInHoChiMinhCity);
});

test("the demo opens without login and says it shows sample numbers", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => requests.push(request.url()));
	watchConsoleErrors(page);
	await page.goto("/");
	const banner = page.getByTestId("demo-banner");
	await expect(banner).toContainText(
		"Bản demo: đây là số liệu mẫu, không phải của một cửa hàng thật.",
	);
	await expect(banner).toContainText(
		"Demo: these are sample numbers, not a real shop.",
	);
	await expect(page.getByTestId("freshness-badge")).toHaveText("dữ liệu mẫu");
	await expect(
		page.getByTestId("section-today").getByTestId("verified-badge"),
	).toHaveText("dữ liệu mẫu");
	await expect(
		page.getByRole("button", { name: "Thoát bản demo" }),
	).toHaveCount(0);
	await waitForCharts(page);
	await expect(
		page.getByTestId("echarts").locator("svg").first(),
	).toBeVisible();
	expectNoConsoleErrors(page);
	const origin = new URL(page.url()).origin;
	expect(
		requests.filter(
			(url) => !url.startsWith(origin) && !url.startsWith("data:"),
		),
	).toEqual([]);
});

test("Hôm nay shows non-zero demo numbers for today and yesterday", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("section-today")).toContainText("12:30");
	for (const day of ["today", "yesterday"]) {
		for (const metric of ["net_revenue", "avg_ticket"]) {
			const exact = await page
				.getByTestId(`card-${day}-${metric}`)
				.getByTestId("headline")
				.getAttribute("data-exact");
			expect(parseExactMoney(exact), `${day} ${metric}`).toBeGreaterThan(0);
		}
		const invoices = await page
			.getByTestId(`card-${day}-invoices`)
			.getByTestId("headline")
			.textContent();
		expect(Number(invoices?.replace(/\D/g, "")), day).toBeGreaterThan(0);
	}
	await expect(
		page.getByTestId("card-today-items").getByRole("table"),
	).toBeVisible();
	await expect(page.getByTestId("card-today-payments")).toContainText(
		"tiền mặt cần đếm",
	);
});

test("the language toggle switches the demo to English and back", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "EN" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Today" }),
	).toBeVisible();
	await expect(page.getByTestId("freshness-badge")).toHaveText("sample data");
	await expect(
		page.getByRole("navigation", { name: "Main navigation" }),
	).toContainText("Reports");
	await page.reload();
	await expect(
		page.getByRole("heading", { level: 1, name: "Today" }),
	).toBeVisible();
	await page.getByRole("button", { name: "VI" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
});

test("keyboard focus is never hidden under the sticky top bar on a phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: PHONE_WIDTH, height: 700 });
	await page.goto(reportUrl("day"));
	await waitForSettledCards(page);
	const covered: string[] = [];
	const presses = [
		...Array<string>(FOCUS_STEPS).fill("Tab"),
		...Array<string>(FOCUS_STEPS).fill("Shift+Tab"),
	];
	for (const key of presses) {
		await page.keyboard.press(key);
		const verdict = await page.evaluate(() => {
			const focused = document.activeElement;
			const header = document.querySelector("header");
			if (!(focused instanceof HTMLElement) || header === null) return null;
			if (header.contains(focused)) return null;
			const box = focused.getBoundingClientRect();
			if (box.width === 0 || box.height === 0) return null;
			const inset = Math.min(2, box.width / 4, box.height / 4);
			const points = [
				[box.left + box.width / 2, box.top + box.height / 2],
				[box.left + inset, box.top + inset],
				[box.right - inset, box.top + inset],
				[box.left + inset, box.bottom - inset],
				[box.right - inset, box.bottom - inset],
			];
			const hiddenEverywhere = points.every(([x, y]) => {
				const topmost = document.elementFromPoint(x ?? 0, y ?? 0);
				return topmost !== null && header.contains(topmost);
			});
			return hiddenEverywhere
				? `${focused.tagName} ${focused.textContent?.trim().slice(0, 40) ?? ""}`
				: null;
		});
		if (verdict !== null) covered.push(verdict);
	}
	expect(covered).toEqual([]);
});

test("the design catalogue passes axe and fits a 360 px phone, its popover open too", async ({
	page,
}) => {
	await page.goto("/#/thiet-ke");
	await expect(
		page.getByRole("heading", { level: 1, name: "Thành phần giao diện" }),
	).toBeVisible();
	await checkPage(page);
	await page.getByTestId("catalogue-popover").click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expectNoSeriousAxeViolations(page);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("catalogue-popover")).toBeFocused();
});

test("a store chart on a 360 px phone names every store under its bar", async ({
	page,
}) => {
	await page.setViewportSize({ width: PHONE_WIDTH, height: 800 });
	await page.goto("/");
	const chart = page
		.getByTestId("card-today-net_revenue")
		.getByTestId("echarts");
	await chart.scrollIntoViewIfNeeded();
	await expect(chart.locator("svg")).toBeVisible();
	const labels = (await chart.locator("svg text").allTextContents())
		.join(" ")
		.replace(/\s+/g, " ");
	expect(labels).toContain("mẫu 1");
	expect(labels).toContain("mẫu 2");
});

test("Hôm nay passes axe and fits a 360 px phone", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("card-yesterday-net_revenue")).toBeVisible();
	await waitForCharts(page);
	await checkPage(page);
});

for (const hash of [
	"#/chu-de/doanh-thu",
	"#/ke-hoach",
	"#/cai-dat/cua-hang",
	"#/xuat-du-lieu",
]) {
	test(`the placeholder page ${hash} passes axe and fits a 360 px phone`, async ({
		page,
	}) => {
		await page.goto(`/${hash}`);
		await expect(page.getByTestId("placeholder-phase")).toBeVisible();
		await checkPage(page);
	});
}

test("at 360 px the store table on Hôm nay scrolls inside its card up to Chênh lệch", async ({
	page,
}) => {
	await page.setViewportSize({ width: PHONE_WIDTH, height: 800 });
	await page.goto("/");
	const card = page.getByTestId("card-today-net_revenue");
	const tableScroll = card.getByTestId("table-scroll");
	await expect(tableScroll).toHaveAttribute("data-overflowing", "true");
	await expect(tableScroll.getByTestId("table-scroll-hint")).toBeVisible();
	await expectHorizontallyInside(tableScroll, card);
	const storeHeader = tableScroll.getByRole("columnheader", {
		name: "Cửa hàng",
	});
	const changeHeader = tableScroll.getByRole("columnheader", {
		name: "Chênh lệch",
	});
	await tableScroll.hover();
	await page.mouse.wheel(600, 0);
	await expect(tableScroll).toHaveAttribute("data-scrolled", "true");
	await expectLastColumnReachable(page, tableScroll);
	await expectHorizontallyInside(changeHeader, tableScroll);
	await expectHorizontallyInside(storeHeader, tableScroll);
	const lastChange = tableScroll.getByRole("cell").last();
	await expect(lastChange).toContainText("%");
	await expectHorizontallyInside(lastChange, tableScroll);
	await expectPageNeverScrollsSideways(page);
});

test("printing keeps the cards black on white and drops navigation, banners and buttons", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	const card = page.getByTestId("card-today-net_revenue");
	await expect(card).toBeVisible();
	await waitForCharts(page);
	await page.emulateMedia({ media: "print", colorScheme: "dark" });
	await expect(page.getByTestId("bottom-navigation")).toBeHidden();
	await expect(page.getByTestId("demo-banner")).toBeHidden();
	await expect(page.getByRole("button", { name: "Tải CSV" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "EN" })).toHaveCount(0);
	await expect(
		card.getByRole("columnheader", { name: "Chênh lệch" }),
	).toBeVisible();
	const colours = await card.evaluate((element) => ({
		page: getComputedStyle(document.body).backgroundColor,
		card: getComputedStyle(element).backgroundColor,
		text: getComputedStyle(element).color,
	}));
	expect(colours).toEqual({
		page: "rgb(255, 255, 255)",
		card: "rgb(255, 255, 255)",
		text: "rgb(0, 0, 0)",
	});
	const chart = card.getByTestId("echarts").locator("svg");
	await expect(chart).toBeVisible();
	await expect(chart.locator("text").first()).toHaveAttribute(
		"fill",
		/#000000|#333333/,
	);
	await page.emulateMedia({ media: "screen", colorScheme: "light" });
	await expect(page.getByTestId("demo-banner")).toBeVisible();
});

test("the favicon and the web app manifest resolve at the root base path", async ({
	page,
	request,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("card-today-net_revenue")).toBeVisible();
	const linked = await page
		.locator(
			'link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
		)
		.evaluateAll((links) =>
			links.map((link) => new URL((link as HTMLLinkElement).href).pathname),
		);
	expect(linked).toEqual([
		"/favicon.ico",
		"/favicon.svg",
		"/apple-touch-icon.png",
		"/manifest.webmanifest",
	]);
	for (const path of linked) {
		expect((await request.get(path)).status(), path).toBe(200);
	}
});

test("the login route is not offered when no backend is configured", async ({
	page,
}) => {
	await page.goto("/#/dang-nhap");
	await expect(page).toHaveURL(/#\/$/);
	await expect(page.getByTestId("demo-banner")).toBeVisible();
});
