// Test design: performance (time behaviour, ISO 25010) against NFR-PERF-06: the heaviest report settles within 8 s on a CPU
// four times slower than the test machine.
//
// The throttle is relative to the runner's own CPU, and the runners differ: one sample of the unchanged build measured
// from 3.8 s to 8.3 s across CI and Regression runs (the Regression runner also hosts the whole local Supabase stack). Other
// load on the runner only ever adds time, so the check takes up to three cold loads, each in a new browser context with an
// empty cache, and judges the fastest. A slower build raises every sample and still fails.
import type { Browser, BrowserContextOptions } from "@playwright/test";
import { expect, type Page, test } from "../support/policy-test";
import { cardIds, expectEveryCardSettled } from "../support/reports";

const PERFORMANCE_BUDGET_MS = 8_000;
const CPU_SLOWDOWN = 4;
const MAX_SAMPLES = 3;
const YEAR_REPORT = "./#/bao-cao/nam";

async function settledMilliseconds(page: Page, cardCount: number) {
	const handle = await page.waitForFunction(
		(expected) => {
			const root = document.querySelector('[data-testid="report-cards"]');
			if (root === null) return false;
			const settled =
				root.querySelectorAll('[data-testid^="card-year-"]').length ===
					expected && root.querySelectorAll('[aria-busy="true"]').length === 0;
			return settled ? performance.now() : false;
		},
		cardCount,
		{ polling: 50, timeout: 60_000 },
	);
	return Math.round(Number(await handle.jsonValue()));
}

async function coldLoadMilliseconds(
	browser: Browser,
	options: BrowserContextOptions,
): Promise<number> {
	const context = await browser.newContext(options);
	try {
		const page = await context.newPage();
		const session = await context.newCDPSession(page);
		await session.send("Emulation.setCPUThrottlingRate", {
			rate: CPU_SLOWDOWN,
		});
		await page.goto(YEAR_REPORT, { waitUntil: "commit" });
		return await settledMilliseconds(page, cardIds.year.length);
	} finally {
		await context.close();
	}
}

test("the production build's Năm settles within 8 s on a CPU four times slower", async ({
	browser,
	page,
	baseURL,
	locale,
	timezoneId,
	viewport,
}, testInfo) => {
	test.setTimeout(MAX_SAMPLES * 60_000);
	const options: BrowserContextOptions = {
		...(baseURL === undefined ? {} : { baseURL }),
		...(locale === undefined ? {} : { locale }),
		...(timezoneId === undefined ? {} : { timezoneId }),
		viewport,
	};
	const samples: number[] = [];
	while (
		samples.length < MAX_SAMPLES &&
		!samples.some((elapsed) => elapsed <= PERFORMANCE_BUDGET_MS)
	) {
		samples.push(await coldLoadMilliseconds(browser, options));
	}
	const fastest = Math.min(...samples);
	testInfo.annotations.push({
		type: "Năm settle time at 4× CPU slowdown",
		description: `${samples.join(", ")} ms`,
	});
	console.info(
		`Năm settled in ${samples.join(", ")} ms at ${CPU_SLOWDOWN}× CPU slowdown (fastest ${fastest} ms)`,
	);
	expect(
		fastest,
		`the fastest of ${samples.length} cold loads of Năm at ${CPU_SLOWDOWN}× CPU slowdown`,
	).toBeLessThanOrEqual(PERFORMANCE_BUDGET_MS);

	await page.goto(YEAR_REPORT);
	await expectEveryCardSettled(page, "year");
});
