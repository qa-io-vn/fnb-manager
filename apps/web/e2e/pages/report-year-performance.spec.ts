import { expect, type Page, test } from "@playwright/test";
import { cardIds, expectEveryCardSettled } from "../support/reports";

const PERFORMANCE_BUDGET_MS = 8_000;
const CPU_SLOWDOWN = 4;
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

test("the production build's Năm settles within 8 s on a CPU four times slower", async ({
	page,
}, testInfo) => {
	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
	try {
		await page.goto(YEAR_REPORT, { waitUntil: "commit" });
		const elapsed = await settledMilliseconds(page, cardIds.year.length);
		testInfo.annotations.push({
			type: "Năm settle time at 4× CPU slowdown",
			description: `${elapsed} ms`,
		});
		console.info(
			`Năm settled in ${elapsed} ms at ${CPU_SLOWDOWN}× CPU slowdown`,
		);
		expect(elapsed).toBeLessThanOrEqual(PERFORMANCE_BUDGET_MS);
	} finally {
		await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
		await session.detach();
	}
	await expectEveryCardSettled(page, "year");
});
