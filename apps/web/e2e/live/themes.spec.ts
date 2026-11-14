import { expect, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	clockAfterSeed,
	isLocalStackConfigured,
	newestSeededDate,
	type SeededClock,
	seededLogin,
	signedInClient,
	visibleStores,
} from "../support/local-stack";
import { watchConsoleErrors } from "../support/reports";
import {
	expectEveryThemeCardSettled,
	themeCard,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

const titles = {
	revenue: "Doanh thu & xu hướng",
	hours: "Giờ & ngày trong tuần",
} as const;

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
}

test("the revenue and hours themes render on the seeded stack through the SQL functions", async ({
	page,
}) => {
	const clock = await seededClock();
	await signIn(page, clock);
	for (const kind of ["revenue", "hours"] as const) {
		await page.goto(themeUrl(kind, "range=7d"));
		await waitForSettledThemeCards(page);
		await expect(
			page.getByRole("heading", { level: 1, name: titles[kind] }),
		).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expectEveryThemeCardSettled(page, kind);
	}
	await expect(
		themeCard(page, "hours", "heatmap").getByTestId("headline"),
	).toHaveText(/\d/);
	await checkPage(page);
});
