import { expect, type Page, test } from "@playwright/test";
import { checkPage, parseExactMoney, waitForCharts } from "../support/checks";
import {
	clockAfterSeed,
	expectedDayTotals,
	isLocalStackConfigured,
	matchedStoreIds,
	newestSeededDate,
	type SeededClock,
	seededLogin,
	signedInClient,
	visibleStores,
} from "../support/local-stack";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

async function seededScene() {
	const client = await signedInClient();
	const stores = await visibleStores(client);
	const timeZone = stores[0]?.timezone ?? "Asia/Ho_Chi_Minh";
	const clock = clockAfterSeed(await newestSeededDate(client), timeZone);
	return { client, stores, clock };
}

async function signIn(page: Page, clock?: SeededClock) {
	if (clock) await page.clock.setFixedTime(clock.now);
	await page.goto("/#/dang-nhap");
	await page.getByLabel("E-mail").fill(seededLogin.email);
	await page.getByLabel("Mật khẩu").fill(seededLogin.password);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
	await expect(page.getByTestId("card-yesterday-net_revenue")).toBeVisible();
}

async function yesterdayNumbers(page: Page) {
	const net = page
		.getByTestId("card-yesterday-net_revenue")
		.getByTestId("headline");
	const invoices = page
		.getByTestId("card-yesterday-invoices")
		.getByTestId("headline");
	const average = page
		.getByTestId("card-yesterday-avg_ticket")
		.getByTestId("headline");
	return {
		net: parseExactMoney(await net.getAttribute("data-exact")),
		invoices: Number((await invoices.textContent())?.replace(/\D/g, "")),
		average: parseExactMoney(await average.getAttribute("data-exact")),
	};
}

test("Hôm nay shows yesterday's seeded numbers for all stores", async ({
	page,
}) => {
	const { client, stores, clock } = await seededScene();
	const expected = await expectedDayTotals(
		client,
		stores.map((store) => store.id),
		clock.yesterday,
	);
	expect(expected.invoices).toBeGreaterThan(0);
	const matched = await matchedStoreIds(client, clock.yesterday);
	const everyStoreMatched = stores.every((store) => matched.has(store.id));

	await signIn(page, clock);
	await expect(page).toHaveTitle("Hôm nay · FNB Manager");
	await expect(page.getByTestId("freshness-badge")).toContainText(
		"cập nhật lúc",
	);
	const shown = await yesterdayNumbers(page);
	expect(shown.net).toBe(expected.net);
	expect(shown.invoices).toBe(expected.invoices);
	expect(shown.average).toBe(Math.round(expected.net / expected.invoices));
	await expect(
		page.getByTestId("section-yesterday").getByTestId("verified-badge"),
	).toHaveText(everyStoreMatched ? "đã đối soát" : "chưa đối soát");
	await waitForCharts(page);
	await checkPage(page);
});

test("switching to one store shows that store's numbers and verification", async ({
	page,
}) => {
	const { client, stores, clock } = await seededScene();
	const matched = await matchedStoreIds(client, clock.yesterday);
	const chosen = stores.find((store) => matched.has(store.id));
	if (!chosen) throw new Error("the seed has no matched store yesterday");
	expect(stores.some((store) => !matched.has(store.id))).toBe(true);
	const expected = await expectedDayTotals(
		client,
		[chosen.id],
		clock.yesterday,
	);

	await signIn(page, clock);
	const yesterdayBadge = page
		.getByTestId("section-yesterday")
		.getByTestId("verified-badge");
	await expect(yesterdayBadge).toHaveText("chưa đối soát");
	await page.getByTestId("store-select").click();
	await expect(page.getByRole("checkbox", { name: chosen.name })).toBeChecked();
	for (const other of stores.filter((store) => store.id !== chosen.id)) {
		await page.getByRole("checkbox", { name: other.name }).uncheck();
	}
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("store-select")).toBeFocused();
	await expect(page.getByTestId("store-select")).toContainText(chosen.name);
	await expect(yesterdayBadge).toHaveText("đã đối soát");
	await expect
		.poll(async () => (await yesterdayNumbers(page)).net)
		.toBe(expected.net);
	expect((await yesterdayNumbers(page)).invoices).toBe(expected.invoices);
	await page.reload();
	await expect(page.getByTestId("store-select")).toContainText(chosen.name);
	await expect(page.getByTestId("card-yesterday-net_revenue")).toBeVisible();
	await page.getByTestId("store-select").click();
	await page.getByRole("checkbox", { name: "Tất cả" }).check();
	await expect(page.getByTestId("store-select")).toContainText("Tất cả");
});

test("the language toggle switches the visible strings", async ({ page }) => {
	await signIn(page);
	await page.getByRole("button", { name: "EN" }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(
		page.getByRole("heading", { level: 1, name: "Today" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
	await expect(page.getByText("Net revenue").first()).toBeVisible();
	await expect(page.getByText("Doanh thu thuần")).toHaveCount(0);
	await page.getByRole("button", { name: "VI" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
});

test("placeholder pages say what is coming and in which phase", async ({
	page,
}) => {
	await signIn(page);
	const pages = [
		{ hash: "#/ke-hoach", title: "Kế hoạch", phase: "11b" },
		{ hash: "#/cai-dat/cua-hang", title: "Cài đặt", phase: "10b, 12" },
		{ hash: "#/xuat-du-lieu", title: "Xuất dữ liệu", phase: "11a" },
	];
	for (const placeholder of pages) {
		await page.goto(`/${placeholder.hash}`);
		await expect(
			page.getByRole("heading", { level: 1, name: placeholder.title }),
		).toBeVisible();
		await expect(page.getByTestId("placeholder-phase")).toContainText(
			placeholder.phase,
		);
		await expect(page.getByTestId("period-picker")).toBeVisible();
		await checkPage(page);
	}
});

test("signing out returns to the login page", async ({ page }) => {
	await signIn(page);
	await page.getByRole("button", { name: "Đăng xuất" }).click();
	await expect(page).toHaveURL(/#\/dang-nhap$/);
	await page.goto("/");
	await expect(page).toHaveURL(/#\/dang-nhap$/);
});
