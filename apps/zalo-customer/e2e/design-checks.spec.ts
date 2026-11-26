import {
	expectFontsBundled,
	expectNoTextOpacity,
	expectPricesOnlyWhereAllowed,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";

// Test design (ISTQB) for the design checks of the brand handbook (spec 7.8), each run on a page made for it: a case that
// must pass and the cases that must fail, so that a check that stops checking is noticed. Equivalence partitions per
// check; the opacity check at its boundary (1, 0.99), through an ancestor and through a colour's alpha.

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

async function show(page: Page, body: string): Promise<void> {
	await page.route("**/check-page.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>check</title></head><body>${body}</body></html>`,
		}),
	);
	await page.goto("./check-page.html");
}

async function fails(check: Promise<void>, message: RegExp): Promise<void> {
	await expect(check).rejects.toThrow(message);
}

test.describe("expectPricesOnlyWhereAllowed", () => {
	test("accepts a price inside a marked element, with its spoken text, where prices are allowed", async ({
		page,
	}) => {
		await show(
			page,
			'<p><span data-price="35000"><span aria-hidden="true">35.000đ</span><span>35.000 đồng</span></span></p>',
		);
		await expectPricesOnlyWhereAllowed(page, { allowed: true });
	});

	test("refuses any marked price where none is allowed", async ({ page }) => {
		await show(page, '<p><span data-price="35000">35.000đ</span></p>');
		await fails(
			expectPricesOnlyWhereAllowed(page, { allowed: false }),
			/elements marked data-price where none is allowed/,
		);
	});

	test("refuses a price outside a marked element, allowed or not", async ({
		page,
	}) => {
		for (const text of [
			"35.000đ",
			"35.000 đồng",
			"35k",
			"VND 35000",
			"₫35.000",
		]) {
			await show(page, `<p>Bạc xỉu ${text}</p>`);
			await fails(
				expectPricesOnlyWhereAllowed(page, { allowed: true }),
				/prices outside an element marked data-price/,
			);
			await fails(
				expectPricesOnlyWhereAllowed(page, { allowed: false }),
				/prices outside an element marked data-price/,
			);
		}
	});

	test("accepts a page without a price, whatever is allowed, and counts, times, dates and phone numbers are no prices", async ({
		page,
	}) => {
		await show(
			page,
			"<p>2 món · 07:00–23:00 · 26/11/2026 · 0912 345 678 · còn 6 ly nữa · 5km · 3 đơn mới</p>",
		);
		await expectPricesOnlyWhereAllowed(page, { allowed: true });
		await expectPricesOnlyWhereAllowed(page, { allowed: false });
	});
});

test.describe("expectNoTextOpacity", () => {
	test("accepts text at full opacity in a solid colour", async ({ page }) => {
		await show(
			page,
			'<p style="color:#231a2b;opacity:1">Chữ đủ đậm</p><p style="color:rgb(35 26 43 / 1)">Cũng đủ đậm</p>',
		);
		await expectNoTextOpacity(page);
	});

	test("refuses text with an opacity of its own, the one just below 1 included", async ({
		page,
	}) => {
		for (const opacity of ["0.5", "0.99", "0.6"]) {
			await show(page, `<p style="opacity:${opacity}">Chữ mờ</p>`);
			await fails(expectNoTextOpacity(page), /Chữ mờ/);
		}
	});

	test("refuses text that is faint through an ancestor, and through the alpha of its colour", async ({
		page,
	}) => {
		await show(page, '<div style="opacity:0.7"><p>Chữ trong hộp mờ</p></div>');
		await fails(expectNoTextOpacity(page), /Chữ trong hộp mờ/);
		await show(page, '<p style="color:rgba(0,0,0,0.5)">Chữ trong suốt</p>');
		await fails(expectNoTextOpacity(page), /Chữ trong suốt/);
		await show(page, '<p style="color:rgb(0 0 0 / 40%)">Chữ phần trăm</p>');
		await fails(expectNoTextOpacity(page), /Chữ phần trăm/);
	});

	test("leaves a faint picture and hidden text alone", async ({ page }) => {
		await show(
			page,
			'<svg style="opacity:0.4" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg><p style="opacity:0.2;display:none">ẩn</p><p style="opacity:0.2;visibility:hidden">tàng hình</p><p>Chữ rõ</p>',
		);
		await expectNoTextOpacity(page);
	});
});

test.describe("expectFontsBundled", () => {
	const FONT = Buffer.from([0, 1, 0, 0]);

	test("accepts a page that asks for no font, and one whose font comes from its own origin", async ({
		page,
	}) => {
		await show(page, "<p>Không có phông</p>");
		await expectFontsBundled(page);
		await page.route("**/bundled.woff2", (route) =>
			route.fulfill({ contentType: "font/woff2", body: FONT }),
		);
		await show(
			page,
			'<style>@font-face{font-family:Bundled;src:url(/bundled.woff2) format("woff2")}</style><p style="font-family:Bundled">Phông của app</p>',
		);
		await page.evaluate(() =>
			document.fonts.load("16px Bundled").catch(() => undefined),
		);
		await expectFontsBundled(page);
	});

	test("refuses a font file from another origin", async ({ page }) => {
		await page.route("https://fonts.example.com/**", (route) =>
			route.fulfill({ contentType: "font/woff2", body: FONT }),
		);
		await show(
			page,
			'<style>@font-face{font-family:Remote;src:url(https://fonts.example.com/a.woff2) format("woff2")}</style><p style="font-family:Remote">Phông từ nơi khác</p>',
		);
		await page.evaluate(() =>
			document.fonts.load("16px Remote").catch(() => undefined),
		);
		await fails(expectFontsBundled(page), /font files from another origin/);
	});
});
