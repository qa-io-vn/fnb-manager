import { checkMiniAppScreen } from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page } from "@playwright/test";

export const LOADING_FEEDBACK_MS = 300;
export const RESULT_MODAL_MS = 1500;
export const RESULT_MODAL_SLACK_MS = 400;
export const BUSY_SELECTOR = "[aria-busy=true], [role=status]";

const FEEDBACK_GLOBAL = "__ENTRY_FEEDBACK_MS__";
const MODAL_GLOBAL = "__ENTRY_RESULT_MODAL_MS__";

export async function expectOnePrimaryAction(page: Page): Promise<void> {
	const dialog = page.getByRole("dialog");
	const scope = (await dialog.count()) > 0 ? dialog : page.locator("body");
	const primary = scope.locator("[data-action=primary]:visible");
	await expect(primary, "one primary action on the screen").toHaveCount(1);
}

export async function checkEntryScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

export async function expectFeedbackWithin(
	page: Page,
	act: () => Promise<void>,
	selector: string = BUSY_SELECTOR,
): Promise<number> {
	await page.evaluate(
		({ name, wanted }) => {
			const store = window as unknown as Record<string, unknown>;
			store[name] = new Promise<number>((resolve) => {
				let clickedAt = 0;
				const observer = new MutationObserver(() => {
					if (clickedAt > 0 && document.querySelector(wanted)) {
						observer.disconnect();
						resolve(performance.now() - clickedAt);
					}
				});
				document.addEventListener(
					"click",
					() => {
						clickedAt = performance.now();
						observer.observe(document.body, {
							subtree: true,
							childList: true,
							attributes: true,
						});
					},
					{ capture: true, once: true },
				);
			});
		},
		{ name: FEEDBACK_GLOBAL, wanted: selector },
	);
	await act();
	const elapsed = Number(
		await page.evaluate(
			(name) => (window as unknown as Record<string, Promise<number>>)[name],
			FEEDBACK_GLOBAL,
		),
	);
	expect(elapsed, "loading feedback after the tap, in ms").toBeLessThanOrEqual(
		LOADING_FEEDBACK_MS,
	);
	return elapsed;
}

export async function watchResultModal(page: Page): Promise<void> {
	await page.evaluate((name) => {
		const store = window as unknown as Record<string, unknown>;
		store[name] = new Promise<number>((resolve) => {
			let shownAt = 0;
			const observer = new MutationObserver(() => {
				const open =
					document.querySelector("[data-testid=result-modal]") !== null;
				if (open && shownAt === 0) shownAt = performance.now();
				if (!open && shownAt > 0) {
					observer.disconnect();
					resolve(performance.now() - shownAt);
				}
			});
			observer.observe(document.body, { subtree: true, childList: true });
		});
	}, MODAL_GLOBAL);
}

export async function expectResultModalClosed(page: Page): Promise<number> {
	const openMs = Number(
		await page.evaluate(
			(name) => (window as unknown as Record<string, Promise<number>>)[name],
			MODAL_GLOBAL,
		),
	);
	expect(openMs, "the result modal closes after 1.5 s").toBeGreaterThanOrEqual(
		RESULT_MODAL_MS - 50,
	);
	expect(openMs, "the result modal closes after 1.5 s").toBeLessThanOrEqual(
		RESULT_MODAL_MS + RESULT_MODAL_SLACK_MS,
	);
	return openMs;
}

export async function mockSdkApis(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const calls = (window as unknown as Record<string, unknown>)
			.__ZALO_MOCK_CALLS__;
		return Array.isArray(calls)
			? calls.map((call: { api?: unknown }) => String(call.api))
			: [];
	});
}
