import {
	MOCK_CALLS_GLOBAL,
	MOCK_STORAGE_KEYS_GLOBAL,
} from "@fnb/zalo-mini/testing/constants";
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page } from "@playwright/test";

export const SHOP_NOW = new Date("2026-11-19T10:00:00+07:00");
export const PROGRAMME = "Thành viên Quán Mẫu Một";
const INDEXED_DB_GLOBAL = "__CUSTOMER_INDEXED_DB__";

export async function watchCustomerPage(
	page: Page,
	clock: Date | null = SHOP_NOW,
): Promise<void> {
	await watchMiniAppPage(page);
	if (clock !== null) await page.clock.install({ time: clock });
	await page.addInitScript((name) => {
		const touched: string[] = [];
		Object.assign(window, { [name]: touched });
		const descriptor =
			Object.getOwnPropertyDescriptor(window, "indexedDB") ??
			Object.getOwnPropertyDescriptor(Window.prototype, "indexedDB");
		Object.defineProperty(window, "indexedDB", {
			configurable: true,
			get() {
				touched.push("indexedDB");
				return descriptor?.get?.call(window);
			},
		});
	}, INDEXED_DB_GLOBAL);
}

// No price anywhere: the customer app shows none until ordering exists. The shared check, with ordering not allowed.
export async function expectNoPrice(page: Page): Promise<void> {
	await expectPricesOnlyWhereAllowed(page, { allowed: false });
}

export async function checkCustomerScreen(page: Page): Promise<void> {
	await checkMiniAppScreen(page);
	await expectNoPrice(page);
	const indexedDb = await page.evaluate(
		(name) => (window as unknown as Record<string, unknown>)[name],
		INDEXED_DB_GLOBAL,
	);
	expect(indexedDb, "IndexedDB use").toEqual([]);
}

export async function nativeStorageKeys(page: Page): Promise<string[]> {
	return page.evaluate(
		(name) =>
			((window as unknown as Record<string, unknown>)[name] as string[]) ?? [],
		MOCK_STORAGE_KEYS_GLOBAL,
	);
}

export async function sdkCalls(page: Page): Promise<string[]> {
	return page.evaluate((name) => {
		const calls = (window as unknown as Record<string, unknown>)[name];
		return Array.isArray(calls)
			? calls.map((call: { api?: unknown }) => String(call.api))
			: [];
	}, MOCK_CALLS_GLOBAL);
}

export async function sdkCall(
	page: Page,
	api: string,
): Promise<unknown | undefined> {
	return page.evaluate(
		({ name, wanted }) => {
			const calls = (window as unknown as Record<string, unknown>)[name];
			return Array.isArray(calls)
				? calls.find((call: { api?: unknown }) => call.api === wanted)?.args
				: undefined;
		},
		{ name: MOCK_CALLS_GLOBAL, wanted: api },
	);
}

export async function openHome(page: Page, search = ""): Promise<void> {
	await page.goto(`./${search}`);
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
}

export async function openTab(page: Page, name: string): Promise<void> {
	await page.getByRole("navigation").getByText(name, { exact: true }).click();
}
