import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { PRICE_PATTERN } from "../format/index";
import { EXTERNAL_OPEN_APIS, MOCK_CALLS_GLOBAL } from "./constants";

export const MINI_APP_VIEWPORT = { width: 360, height: 800 } as const;
export const MIN_TARGET_PX = 44;
export const MAX_BOTTOM_TABS = 4;

const WINDOW_OPEN_GLOBAL = "__MINI_APP_WINDOW_OPEN__";
const WEB_STORAGE_GLOBAL = "__MINI_APP_WEB_STORAGE__";
const TARGET_SELECTOR = [
	"a[href]",
	"button",
	"input:not([type=hidden])",
	"select",
	"textarea",
	"summary",
	"[role=button]",
	"[role=link]",
	"[role=tab]",
	"[role=checkbox]",
	"[role=switch]",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

interface PageRecord {
	readonly errors: string[];
	/** The address of every font file the page asked for. */
	readonly fonts: string[];
	styleChecks: number;
}

const watched = new WeakMap<Page, PageRecord>();

export async function watchMiniAppPage(page: Page): Promise<void> {
	const record: PageRecord = { errors: [], fonts: [], styleChecks: 0 };
	watched.set(page, record);
	page.on("response", (response) => {
		if (response.request().resourceType() === "font") {
			record.fonts.push(response.url());
		}
	});
	page.on("console", (message) => {
		if (message.type() === "error") record.errors.push(message.text());
	});
	page.on("pageerror", (error) => {
		record.errors.push(error.message);
	});
	await page.addInitScript(
		({ windowOpenGlobal, webStorageGlobal }) => {
			const opened: string[] = [];
			const touched: string[] = [];
			Object.assign(window, {
				[windowOpenGlobal]: opened,
				[webStorageGlobal]: touched,
			});
			window.open = (url) => {
				opened.push(String(url ?? ""));
				return null;
			};
			for (const name of ["localStorage", "sessionStorage"] as const) {
				const descriptor =
					Object.getOwnPropertyDescriptor(window, name) ??
					Object.getOwnPropertyDescriptor(Window.prototype, name);
				Object.defineProperty(window, name, {
					configurable: true,
					get() {
						touched.push(name);
						return descriptor?.get?.call(window);
					},
				});
			}
			const cookie = Object.getOwnPropertyDescriptor(
				Document.prototype,
				"cookie",
			);
			Object.defineProperty(document, "cookie", {
				configurable: true,
				get() {
					touched.push("cookie");
					return cookie?.get?.call(document) ?? "";
				},
				set(value: string) {
					touched.push("cookie");
					cookie?.set?.call(document, value);
				},
			});
		},
		{
			windowOpenGlobal: WINDOW_OPEN_GLOBAL,
			webStorageGlobal: WEB_STORAGE_GLOBAL,
		},
	);
}

export async function expectAtMostFourBottomTabs(page: Page): Promise<void> {
	const tabs = await page.locator(".zaui-bottom-navigation-item").count();
	expect(tabs, "bottom navigation tabs").toBeLessThanOrEqual(MAX_BOTTOM_TABS);
}

export async function expectTargetsAtLeast44(page: Page): Promise<void> {
	const small = await page.evaluate(
		({ selector, minimum }) =>
			[...document.querySelectorAll(selector)].flatMap((element) => {
				const box = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				if (
					box.width === 0 ||
					box.height === 0 ||
					style.visibility === "hidden" ||
					style.display === "none"
				) {
					return [];
				}
				if (box.width >= minimum && box.height >= minimum) return [];
				const name =
					element.getAttribute("aria-label") ??
					element.textContent?.trim().slice(0, 40) ??
					"";
				return [
					`${element.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`,
				];
			}),
		{ selector: TARGET_SELECTOR, minimum: MIN_TARGET_PX },
	);
	expect(small, "targets smaller than 44 x 44 CSS px").toEqual([]);
}

export async function expectNoOutboundLinks(page: Page): Promise<void> {
	const outbound = await page.evaluate(() =>
		[...document.querySelectorAll("a[href], area[href], form[action]")]
			.map((element) => {
				const raw =
					element.getAttribute("href") ?? element.getAttribute("action") ?? "";
				const target = element.getAttribute("target");
				const url = new URL(raw, location.href);
				const sameDocument = url.origin === location.origin;
				return sameDocument && target !== "_blank" ? null : raw;
			})
			.filter((href): href is string => href !== null),
	);
	expect(outbound, "outbound links").toEqual([]);
}

export async function expectNoExternalOpenCalls(page: Page): Promise<void> {
	const opened = await page.evaluate(
		({ callsGlobal, windowOpenGlobal, apis }) => {
			const calls = (window as unknown as Record<string, unknown>)[callsGlobal];
			const sdkCalls = Array.isArray(calls)
				? calls
						.map((call: { api?: unknown }) => String(call.api))
						.filter((api) => apis.includes(api))
				: [];
			const windowCalls = (window as unknown as Record<string, unknown>)[
				windowOpenGlobal
			];
			return [
				...sdkCalls,
				...(Array.isArray(windowCalls)
					? windowCalls.map(() => "window.open")
					: []),
			];
		},
		{
			callsGlobal: MOCK_CALLS_GLOBAL,
			windowOpenGlobal: WINDOW_OPEN_GLOBAL,
			apis: [...EXTERNAL_OPEN_APIS],
		},
	);
	expect(opened, "external-open calls").toEqual([]);
}

export async function expectNoWebStorage(page: Page): Promise<void> {
	const touched = await page.evaluate(
		(name) => (window as unknown as Record<string, unknown>)[name],
		WEB_STORAGE_GLOBAL,
	);
	expect(touched, "LocalStorage, SessionStorage or cookie use").toEqual([]);
}

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
	expect(serious, "serious or critical axe violations").toEqual([]);
}

// The look of a screen that must not change: for every drawn element, its four corner radii, its four border widths,
// its box shadow and, for text, its font size and line height. A refactor of the shape and type tokens (an unthemed
// build and a brand without a shape must look as before) is checked by comparing these signatures with a baseline made
// before it. Colours are left out on purpose: the same signatures hold in light and in dark.
export async function styleSignatures(
	page: Page,
): Promise<Record<string, number>> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const ready = document.fonts?.ready ?? Promise.resolve();
				void ready.then(() =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			}),
	);
	return page.evaluate(() => {
		const corner = (style: CSSStyleDeclaration) => {
			const radii = [
				style.borderTopLeftRadius,
				style.borderTopRightRadius,
				style.borderBottomRightRadius,
				style.borderBottomLeftRadius,
			];
			return radii.every((radius) => radius === radii[0])
				? `r${radii[0]}`
				: `r${radii.join("/")}`;
		};
		const edges = (style: CSSStyleDeclaration) => {
			const widths = [
				style.borderTopWidth,
				style.borderRightWidth,
				style.borderBottomWidth,
				style.borderLeftWidth,
			];
			return widths.every((width) => width === widths[0])
				? `b${widths[0]}`
				: `b${widths.join("/")}`;
		};
		// a layer whose colour is fully transparent draws nothing: Tailwind's shadow utilities list four of them
		// before the real shadow, and a plain box-shadow lists none, so they are left out
		const shadows = (style: CSSStyleDeclaration) =>
			style.boxShadow
				.split(/,\s(?=rgba?\()/)
				.filter((layer) => !/^rgba\(\d+, \d+, \d+, 0\)/.test(layer))
				.filter((layer) => layer !== "none")
				.join(", ");
		const forms = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON"]);
		const counts: Record<string, number> = {};
		for (const element of document.body.querySelectorAll("*")) {
			if (element.getClientRects().length === 0) continue;
			const style = getComputedStyle(element);
			const hasText = [...element.childNodes].some(
				(node) =>
					node.nodeType === Node.TEXT_NODE &&
					(node.textContent ?? "").trim() !== "",
			);
			const shadow = shadows(style);
			const parts = [
				corner(style),
				edges(style),
				shadow === "" ? "" : `s${shadow}`,
				hasText || forms.has(element.tagName)
					? `t${style.fontSize}/${style.lineHeight}`
					: "",
			];
			// an element with nothing to record (square, borderless, no shadow, no text) adds nothing
			if (
				parts[0] === "r0px" &&
				parts[1] === "b0px" &&
				!parts[2] &&
				!parts[3]
			) {
				continue;
			}
			const signature = parts.filter((part) => part !== "").join(" ");
			counts[signature] = (counts[signature] ?? 0) + 1;
		}
		return counts;
	});
}

interface StyleBaseline {
	signatures: string[];
	/** per screen: the index of each signature in `signatures` and how many elements had it */
	screens: Record<string, Record<string, number>>;
}

const STYLE_PROJECTS = new Set(["phone-light", "design-light"]);

function readStyleBaseline(file: string): StyleBaseline {
	return existsSync(file)
		? (JSON.parse(readFileSync(file, "utf8")) as StyleBaseline)
		: { signatures: [], screens: {} };
}

/**
 * Compares the screen on show with its baseline (MINI_APP_STYLE_BASELINE names the file; MINI_APP_STYLE_MODE=write
 * records it instead). Only the light projects take part, and a screen is named by its test and the order of the check
 * in it. Without the variable, nothing happens. A look that must change on purpose is recorded again with the mode.
 */
export async function checkStyleBaseline(page: Page): Promise<void> {
	const file = process.env.MINI_APP_STYLE_BASELINE;
	const record = watched.get(page);
	if (!file || !record) return;
	const info = test.info();
	if (!STYLE_PROJECTS.has(info.project.name)) return;
	record.styleChecks += 1;
	const screen = [
		info.project.name,
		relative(info.project.testDir, info.file).replaceAll("\\", "/"),
		...info.titlePath.slice(1),
		`#${record.styleChecks}`,
	].join(" > ");
	const current = await styleSignatures(page);
	const baseline = readStyleBaseline(file);
	if (process.env.MINI_APP_STYLE_MODE === "write") {
		const indexed: Record<string, number> = {};
		for (const [signature, count] of Object.entries(current)) {
			let index = baseline.signatures.indexOf(signature);
			if (index < 0) {
				baseline.signatures.push(signature);
				index = baseline.signatures.length - 1;
			}
			indexed[String(index)] = count;
		}
		baseline.screens[screen] = indexed;
		writeFileSync(file, `${JSON.stringify(baseline, null, "\t")}\n`);
		return;
	}
	const expected = baseline.screens[screen];
	if (expected === undefined) {
		throw new Error(
			`no style baseline for "${screen}": record it with MINI_APP_STYLE_MODE=write`,
		);
	}
	const before: Record<string, number> = {};
	for (const [index, count] of Object.entries(expected)) {
		before[baseline.signatures[Number(index)] as string] = count;
	}
	const changes: string[] = [];
	for (const signature of new Set([
		...Object.keys(before),
		...Object.keys(current),
	])) {
		const was = before[signature] ?? 0;
		const now = current[signature] ?? 0;
		if (was !== now) changes.push(`${was} -> ${now}: ${signature}`);
	}
	expect(changes, `the look of "${screen}" changed`).toEqual([]);
}

// Where a price may be (design spec 5.2, 7.8). Every text that looks like a price must sit inside an element marked
// data-price, which PriceText makes; and a screen of a build or a route without ordering must hold no such element.
export async function expectPricesOnlyWhereAllowed(
	page: Page,
	options: { readonly allowed: boolean },
): Promise<void> {
	const found = await page.evaluate(
		({ source, flags }) => {
			const pattern = new RegExp(source, flags);
			const unmarked: string[] = [];
			const walker = document.createTreeWalker(
				document.body,
				NodeFilter.SHOW_TEXT,
			);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = (node.textContent ?? "").trim();
				if (text === "" || !pattern.test(text)) continue;
				if (node.parentElement?.closest("[data-price]") === null) {
					unmarked.push(text.slice(0, 60));
				}
			}
			return {
				unmarked,
				marked: document.querySelectorAll("[data-price]").length,
			};
		},
		{ source: PRICE_PATTERN.source, flags: PRICE_PATTERN.flags },
	);
	expect(found.unmarked, "prices outside an element marked data-price").toEqual(
		[],
	);
	if (!options.allowed) {
		expect(
			found.marked,
			"elements marked data-price where none is allowed",
		).toBe(0);
	}
}

// No text may be drawn thinner than the ink it was given (the handbook: no opacity on text; a disabled or sold-out
// state is written in the muted ink with a word). The effective opacity is the product of the element's and its
// ancestors', and a colour with an alpha below 1 counts too.
export async function expectNoTextOpacity(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
	const faint = await page.evaluate(() => {
		const alphaOf = (color: string): number => {
			const slash = /\/\s*([\d.]+%?)\s*\)$/.exec(color);
			if (slash?.[1] !== undefined) {
				return slash[1].endsWith("%")
					? Number.parseFloat(slash[1]) / 100
					: Number.parseFloat(slash[1]);
			}
			const rgba = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color);
			return rgba?.[1] === undefined ? 1 : Number.parseFloat(rgba[1]);
		};
		const found: string[] = [];
		for (const element of document.body.querySelectorAll("*")) {
			const own = [...element.childNodes]
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => (node.textContent ?? "").trim())
				.join(" ")
				.trim();
			if (own === "" || element.getClientRects().length === 0) continue;
			const style = getComputedStyle(element);
			if (style.visibility === "hidden") continue;
			let opacity = 1;
			for (
				let at: Element | null = element;
				at !== null;
				at = at.parentElement
			) {
				opacity *= Number.parseFloat(getComputedStyle(at).opacity);
			}
			const alpha = alphaOf(style.color);
			if (opacity < 1 || alpha < 1) {
				found.push(
					`"${own.slice(0, 40)}" opacity ${opacity.toFixed(2)} colour alpha ${alpha}`,
				);
			}
		}
		return found;
	});
	expect(faint, "text drawn with an opacity or an alpha below 1").toEqual([]);
}

// The fonts of a brand come with the app (design spec 2.6, 7.5): every font file the page asked for is served from the
// page's own origin, so nothing is fetched from Google or any other host.
export async function expectFontsBundled(page: Page): Promise<void> {
	const record = watched.get(page);
	if (!record) {
		throw new Error("call watchMiniAppPage(page) before the page opens");
	}
	await page.evaluate(() => document.fonts?.ready);
	const own = new URL(page.url()).origin;
	const foreign = record.fonts.filter((url) => new URL(url).origin !== own);
	expect(foreign, "font files from another origin").toEqual([]);
}

export async function checkMiniAppScreen(page: Page): Promise<void> {
	const record = watched.get(page);
	if (!record) {
		throw new Error("call watchMiniAppPage(page) before the page opens");
	}
	await checkStyleBaseline(page);
	await expectAtMostFourBottomTabs(page);
	await expectTargetsAtLeast44(page);
	await expectNoOutboundLinks(page);
	await expectNoExternalOpenCalls(page);
	await expectNoWebStorage(page);
	await expectNoSeriousAxeViolations(page);
	expect(record.errors, "console errors").toEqual([]);
}
