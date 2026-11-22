import type { Page } from "@playwright/test";

export const MAX_LCP_MS = 2500;
export const MAX_LOAD_MS = 1500;
export const CPU_SLOWDOWN = 4;

export const MOBILE_NETWORK = {
	offline: false,
	latency: 150,
	downloadThroughput: Math.round((1638.4 * 1024) / 8),
	uploadThroughput: Math.round((750 * 1024) / 8),
} as const;

export interface PaintMeasurement {
	readonly lcpMs: number;
	readonly loadMs: number;
}

export interface PaintLimits {
	readonly maxLcpMs?: number;
	readonly maxLoadMs?: number;
}

export function paintBudgetProblems(
	measured: PaintMeasurement,
	limits: PaintLimits = {},
): string[] {
	const maxLcpMs = limits.maxLcpMs ?? MAX_LCP_MS;
	const maxLoadMs = limits.maxLoadMs ?? MAX_LOAD_MS;
	const problems: string[] = [];
	if (!Number.isFinite(measured.lcpMs) || measured.lcpMs <= 0) {
		problems.push("no largest contentful paint was recorded");
	} else if (measured.lcpMs >= maxLcpMs) {
		problems.push(
			`largest contentful paint took ${Math.round(measured.lcpMs)} ms, budget under ${maxLcpMs} ms`,
		);
	}
	if (!Number.isFinite(measured.loadMs) || measured.loadMs <= 0) {
		problems.push("no page load was recorded");
	} else if (measured.loadMs >= maxLoadMs) {
		problems.push(
			`the page load took ${Math.round(measured.loadMs)} ms, budget under ${maxLoadMs} ms`,
		);
	}
	return problems;
}

export async function throttleLikeAMidRangePhone(page: Page): Promise<void> {
	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
	await session.send("Network.enable");
	await session.send("Network.setCacheDisabled", { cacheDisabled: true });
	await session.send("Network.emulateNetworkConditions", MOBILE_NETWORK);
}

export async function measurePaint(page: Page): Promise<PaintMeasurement> {
	return page.evaluate(
		() =>
			new Promise<PaintMeasurement>((resolve) => {
				let lcpMs = Number.NaN;
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) lcpMs = entry.startTime;
				});
				observer.observe({ type: "largest-contentful-paint", buffered: true });
				setTimeout(() => {
					observer.disconnect();
					const [navigation] = performance.getEntriesByType(
						"navigation",
					) as PerformanceNavigationTiming[];
					resolve({ lcpMs, loadMs: navigation?.loadEventEnd ?? Number.NaN });
				}, 250);
			}),
	);
}

export function screenPaintProblems(
	paintMs: number,
	limits: PaintLimits = {},
): string[] {
	const maxLcpMs = limits.maxLcpMs ?? MAX_LCP_MS;
	if (!Number.isFinite(paintMs) || paintMs <= 0)
		return ["no paint of the screen was recorded"];
	return paintMs >= maxLcpMs
		? [
				`the screen took ${Math.round(paintMs)} ms to paint after the tap, budget under ${maxLcpMs} ms`,
			]
		: [];
}

const SCREEN_PAINT_GLOBAL = "__SCREEN_PAINT_MS__";
const SCREEN_PAINT_WAIT_MS = 20_000;

/**
 * The paint budget for a screen the app opens itself. The browser reports a largest contentful paint for the page load
 * only (it stops at the first tap), so for a screen reached by a tap this is the same limit read as the time from the
 * tap to the second animation frame after the screen's content (`readySelector`) is in the page, under whatever
 * throttling the page has. `open` makes the one tap (`trigger` is `change` when it picks an option of a list, which fires
 * no click); it is the page's first such event after this call. NaN when the content
 * did not show within 20 seconds of the tap.
 */
export async function measureScreenPaint(
	page: Page,
	readySelector: string,
	open: () => Promise<unknown>,
	trigger: "click" | "change" = "click",
): Promise<number> {
	await page.evaluate(
		({ name, wanted, wait, event }) => {
			const store = window as unknown as Record<string, unknown>;
			store[name] = new Promise<number>((resolve) => {
				document.addEventListener(
					event,
					() => {
						const tapped = performance.now();
						window.setTimeout(() => resolve(Number.NaN), wait);
						const settle = () =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() =>
									resolve(performance.now() - tapped),
								),
							);
						if (document.querySelector(wanted) !== null) {
							settle();
							return;
						}
						const observer = new MutationObserver(() => {
							if (document.querySelector(wanted) === null) return;
							observer.disconnect();
							settle();
						});
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
		{
			name: SCREEN_PAINT_GLOBAL,
			wanted: readySelector,
			wait: SCREEN_PAINT_WAIT_MS,
			event: trigger,
		},
	);
	await open();
	return Number(
		await page.evaluate(
			(name) => (window as unknown as Record<string, Promise<number>>)[name],
			SCREEN_PAINT_GLOBAL,
		),
	);
}
