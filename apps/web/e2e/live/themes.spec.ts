import { expect, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	clockAfterSeed,
	isLocalStackConfigured,
	newestSeededDate,
	type SeededClock,
	seededLogin,
	shiftDate,
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
	menu: "Thực đơn",
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

test("the revenue, hours and menu themes render on the seeded stack through the SQL functions", async ({
	page,
}) => {
	const clock = await seededClock();
	await signIn(page, clock);
	for (const kind of ["revenue", "hours", "menu"] as const) {
		await page.goto(themeUrl(kind, "range=7d"));
		await waitForSettledThemeCards(page);
		await expect(
			page.getByRole("heading", { level: 1, name: titles[kind] }),
		).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expectEveryThemeCardSettled(page, kind);
	}
	await expect(
		themeCard(page, "menu", "margins").getByTestId("headline"),
	).toHaveText(/\d/);
	await page.goto(themeUrl("hours", "range=7d"));
	await waitForSettledThemeCards(page);
	await expect(
		themeCard(page, "hours", "heatmap").getByTestId("headline"),
	).toHaveText(/\d/);
	await checkPage(page);
});

test("Giờ & ngày opens each seeded store from a dated deep link and shows its RevPASH with the store's seats", async ({
	page,
}) => {
	const client = await signedInClient();
	const { data, error } = await client
		.from("stores")
		.select("id,seat_count")
		.order("name");
	if (error) throw error;
	const stores = data as { id: string; seat_count: number | null }[];
	expect(stores.length).toBeGreaterThan(1);
	const clock = await seededClock();
	await signIn(page, clock);
	const to = shiftDate(clock.yesterday, -3);
	const from = shiftDate(to, -19);
	for (const store of stores) {
		expect(store.seat_count).not.toBeNull();
		await page.goto(
			themeUrl("hours", `from=${from}&to=${to}&store=${store.id}`),
		);
		await waitForSettledThemeCards(page);
		await expect(page).toHaveURL(new RegExp(`from=${from}`));
		await expect(page).toHaveURL(new RegExp(`to=${to}`));
		await expect(page).toHaveURL(new RegExp(`store=${store.id}`));
		const productivity = themeCard(page, "hours", "productivity");
		await expect(productivity.getByTestId("card-notice")).toHaveCount(0);
		await expect(productivity).toContainText("(RevPASH)");
		await expect(productivity).toContainText(`${store.seat_count} ghế`);
	}
});
