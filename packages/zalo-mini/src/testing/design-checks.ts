import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
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
}

const watched = new WeakMap<Page, PageRecord>();

export async function watchMiniAppPage(page: Page): Promise<void> {
	const record: PageRecord = { errors: [] };
	watched.set(page, record);
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

export async function checkMiniAppScreen(page: Page): Promise<void> {
	const record = watched.get(page);
	if (!record) {
		throw new Error("call watchMiniAppPage(page) before the page opens");
	}
	await expectAtMostFourBottomTabs(page);
	await expectTargetsAtLeast44(page);
	await expectNoOutboundLinks(page);
	await expectNoExternalOpenCalls(page);
	await expectNoWebStorage(page);
	await expectNoSeriousAxeViolations(page);
	expect(record.errors, "console errors").toEqual([]);
}
