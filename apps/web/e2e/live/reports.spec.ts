import { expect, type Page, test } from "@playwright/test";
import { checkPage, parseExactMoney } from "../support/checks";
import {
	clockAfterSeed,
	isLocalStackConfigured,
	newestSeededDate,
	type SeededClock,
	seededLogin,
	signedInClient,
	visibleStores,
} from "../support/local-stack";
import {
	cards,
	currentKey,
	expectEveryCardSettled,
	headlineExact,
	type ReportKind,
	reportUrl,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

const titles: Record<ReportKind, string> = {
	day: "Báo cáo ngày",
	week: "Báo cáo tuần",
	month: "Báo cáo tháng",
	year: "Báo cáo năm",
};

async function seededClock(): Promise<SeededClock> {
	const client = await signedInClient();
	const stores = await visibleStores(client);
	const timeZone = stores[0]?.timezone ?? "Asia/Ho_Chi_Minh";
	return clockAfterSeed(await newestSeededDate(client), timeZone);
}

async function signIn(page: Page, clock: SeededClock) {
	watchConsoleErrors(page);
	await page.clock.setFixedTime(clock.now);
	await page.goto("/#/dang-nhap");
	await page.getByLabel("E-mail").fill(seededLogin.email);
	await page.getByLabel("Mật khẩu").fill(seededLogin.password);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
	await expect(page.getByTestId("card-yesterday-net_revenue")).toBeVisible();
}

test("the four periodic reports render on the seeded stack", async ({
	page,
}) => {
	const clock = await seededClock();
	await signIn(page, clock);
	for (const kind of ["day", "week", "month", "year"] as const) {
		await page.goto(reportUrl(kind));
		await waitForSettledCards(page);
		await expect(
			page.getByRole("heading", { level: 1, name: titles[kind] }),
		).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(page.locator('[data-state="error"]')).toHaveCount(0);
		await expectEveryCardSettled(page, kind);
	}
	await page.goto(reportUrl("day"));
	await waitForSettledCards(page);
	await checkPage(page);
});

test("Ngày opens on Hôm nay's yesterday with the same net revenue and invoices", async ({
	page,
}) => {
	const clock = await seededClock();
	await signIn(page, clock);
	const net = await headlineExact(
		page.getByTestId("card-yesterday-net_revenue"),
	);
	const invoices = await headlineExact(
		page.getByTestId("card-yesterday-invoices"),
	);
	expect(parseExactMoney(net)).toBeGreaterThan(0);
	await page.goto(reportUrl("day"));
	await waitForSettledCards(page);
	expect(currentKey(page, "day")).toBe(clock.yesterday);
	expect(await headlineExact(page.getByTestId("card-day-net_revenue"))).toBe(
		net,
	);
	expect(await headlineExact(page.getByTestId("card-day-invoices"))).toBe(
		invoices,
	);
});

test("Năm says there is no data from last year on a seven-day seed", async ({
	page,
}) => {
	const clock = await seededClock();
	await signIn(page, clock);
	await page.goto(reportUrl("year"));
	await waitForSettledCards(page);
	test.skip(
		(await cards(page, "year").count()) === 0,
		"Năm has no cards before step 9c builds them",
	);
	await expect(page.getByTestId("report-cards")).toContainText(
		"chưa có dữ liệu năm trước",
	);
});
