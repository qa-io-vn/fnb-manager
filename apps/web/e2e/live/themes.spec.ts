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
import {
	expectNoConsoleErrors,
	expectShiftsLabelledByNumber,
	watchConsoleErrors,
} from "../support/reports";
import {
	createRewardsFixture,
	FREE_ITEM_REWARD,
	PERCENT_REWARD,
	retireActiveRewards,
	seedRedemptions,
} from "../support/rewards-fixture";
import { createSettingsFixture } from "../support/settings-fixture";
import {
	expectEveryThemeCardSettled,
	shiftNumberedCardIds,
	themeCard,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

const SEEDED_SHIFT_NAMES = /Shift \d/;

const titles = {
	revenue: "Doanh thu & xu hướng",
	hours: "Giờ & ngày trong tuần",
	menu: "Thực đơn",
	payments: "Thanh toán & tiền mặt",
	promotions: "Khuyến mãi & giảm giá",
	shifts: "Ca & két tiền",
	stores: "So sánh cửa hàng",
	quality: "Chất lượng dữ liệu",
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

test("the eight thematic reports render on the seeded stack through the SQL functions", async ({
	page,
}) => {
	const clock = await seededClock();
	await signIn(page, clock);
	for (const kind of [
		"revenue",
		"hours",
		"menu",
		"payments",
		"promotions",
		"shifts",
		"stores",
		"quality",
	] as const) {
		await page.goto(themeUrl(kind, "range=7d"));
		await waitForSettledThemeCards(page);
		await expect(
			page.getByRole("heading", { level: 1, name: titles[kind] }),
		).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expectEveryThemeCardSettled(page, kind);
		if (kind === "menu") {
			await expect(
				themeCard(page, "menu", "margins").getByTestId("headline"),
			).toHaveText(/\d/);
		}
		if (kind === "shifts") {
			for (const id of shiftNumberedCardIds) {
				await expectShiftsLabelledByNumber(
					page,
					`card-shifts-${id}`,
					SEEDED_SHIFT_NAMES,
				);
			}
			const cashiers = themeCard(page, "shifts", "cashiers");
			await expect(cashiers).not.toContainText("@");
			await expect(cashiers).not.toContainText(SEEDED_SHIFT_NAMES);
		}
		if (kind === "stores") {
			const kpis = themeCard(page, "stores", "kpis");
			await expect(kpis.getByTestId("headline")).toHaveText(/\d/);
			await expect(kpis.locator("tbody tr").last()).toContainText(
				"Tất cả cửa hàng",
			);
			await expect(kpis).not.toContainText("chưa thiết lập");
		}
	}
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

test("Chất lượng dữ liệu flags the seeded coffee store, whose e-invoices are not registered, and links to Cửa hàng to record the status", async ({
	page,
}) => {
	const client = await signedInClient();
	const { data, error } = await client
		.from("stores")
		.select("id,code,name,e_invoice_status")
		.order("name");
	if (error) throw error;
	const stores = data as {
		id: string;
		code: string | null;
		name: string;
		e_invoice_status: string;
	}[];
	const coffee = stores.find((store) => store.code === "COF");
	expect(coffee?.e_invoice_status).toBe("not_configured");
	const clock = await seededClock();
	await signIn(page, clock);
	await page.goto(themeUrl("quality", "range=28d"));
	await waitForSettledThemeCards(page);
	await expectEveryThemeCardSettled(page, "quality");
	const compliance = themeCard(page, "quality", "compliance");
	const findings = compliance.getByRole("table", {
		name: "Việc cần làm theo cửa hàng",
		exact: true,
	});
	await expect(
		findings
			.locator("tbody tr")
			.filter({ hasText: coffee?.name ?? "COF" })
			.filter({ hasText: "Chưa đăng ký hóa đơn điện tử" }),
	).toHaveCount(1);
	for (const store of stores.filter(
		(entry) => entry.e_invoice_status === "configured",
	)) {
		await expect(
			findings
				.locator("tbody tr")
				.filter({ hasText: store.name })
				.filter({ hasText: "hóa đơn điện tử" }),
		).toHaveCount(0);
	}
	const action = compliance
		.getByTestId("card-notice")
		.getByRole("link", { name: "Ghi trạng thái hóa đơn điện tử" });
	await expect(action).toHaveAttribute("href", /#\/cai-dat\/cua-hang$/);
	const modifiers = themeCard(page, "quality", "modifiers").getByRole("table", {
		name: "Dòng món và dòng tùy chọn theo cửa hàng",
		exact: true,
	});
	const modifierRows = await modifiers.locator("tbody tr").all();
	expect(modifierRows.length).toBeGreaterThan(0);
	for (const row of modifierRows) {
		await expect(row.locator("td").nth(4)).toHaveText("0");
	}
	await action.click();
	await expect(page).toHaveURL(/#\/cai-dat\/cua-hang$/);
	await expect(page.getByTestId("store-page")).toBeVisible();
});

interface SummaryRow {
	readonly store_id: string;
	readonly coupon_name: string;
	readonly redemptions: number;
	readonly confirmed: number;
	readonly held: number;
	readonly reward_cost_amount: number | string;
	readonly member_invoices: number;
}

test("Khuyến mãi shows the member rewards redeemed on a fixture tenant exactly as redemption_summary counts them for the same stores and range", async ({
	page,
}) => {
	const fixture = await createSettingsFixture();
	try {
		const rewards = await createRewardsFixture(fixture);
		await seedRedemptions(fixture, rewards);
		const to = rewards.day;
		const from = shiftDate(to, -27);
		const owner = await fixture.clientAs("owner");
		const { data, error } = await owner.rpc("redemption_summary", {
			store_ids: [...fixture.storeIds],
			from_date: from,
			to_date: to,
		});
		await owner.auth.signOut();
		if (error) throw error;
		const rows = data as SummaryRow[];
		expect(rows.map((row) => [row.coupon_name, row.redemptions])).toEqual([
			[PERCENT_REWARD.name, 2],
			[FREE_ITEM_REWARD.name, 1],
		]);
		const cost = rows.reduce(
			(sum, row) => sum + Number(row.reward_cost_amount),
			0,
		);
		expect(cost).toBe(11_000);
		watchConsoleErrors(page);
		await fixture.signIn(page, "owner");
		await page.goto(themeUrl("promotions", `from=${from}&to=${to}`));
		await waitForSettledThemeCards(page);
		await expectEveryThemeCardSettled(page, "promotions");
		const card = themeCard(page, "promotions", "redemptions");
		await expect(card.getByTestId("headline")).toHaveText(/^11\.000\s?₫$/);
		await expect(card.getByTestId("comparison-chip")).toHaveCount(1);
		await expect(card.getByTestId("sentence")).toContainText(
			"khách đổi 3 lượt ưu đãi; 2 lượt đã dùng trên hóa đơn với chi phí 11.000",
		);
		await expect(card.getByTestId("sentence")).toContainText(
			`Được đổi nhiều nhất là ${PERCENT_REWARD.name} (Giảm theo phần trăm): 2 lượt.`,
		);
		const table = card.getByRole("table", {
			name: "Lượt đổi theo ưu đãi và cửa hàng",
			exact: true,
		});
		await expect(table.locator("tbody tr")).toHaveCount(rows.length);
		for (const row of rows) {
			await expect(
				table.locator("tbody tr").filter({ hasText: row.coupon_name }),
			).toContainText(String(row.redemptions));
		}
		await card.getByTestId("headline").scrollIntoViewIfNeeded();
		await expect(card.getByTestId("echarts")).toHaveCount(1);
		await checkPage(page);
		expectNoConsoleErrors(page);
	} finally {
		try {
			await retireActiveRewards(fixture);
		} finally {
			await fixture.teardown();
		}
	}
});
