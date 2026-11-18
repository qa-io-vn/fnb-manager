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
