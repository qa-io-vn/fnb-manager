import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn } from "../../src/lib/business-dates";
import { createFormatters } from "../../src/lib/format";
import { createSupabaseManualSource } from "../../src/settings/manual/supabase-manual-source";
import { writeCodeOf } from "../../src/settings/source";
import { createSupabaseSettingsSource } from "../../src/settings/supabase-settings-source";
import {
	clockAfterSeed,
	isLocalStackConfigured,
	shiftDate,
} from "../support/local-stack";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	reportUrl,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";
import { openSettings, saveSettings, settingsNav } from "../support/settings";
import {
	createSettingsFixture,
	openFixtureDatabase,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";
import {
	themeCard,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const FIRST_DAY = "2023-01-01";

let fixture: SettingsFixture | undefined;
const clients: SupabaseClient[] = [];

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

async function clientAs(role: SettingsRole): Promise<SupabaseClient> {
	const client = await created().clientAs(role);
	clients.push(client);
	return client;
}

async function refusal(write: Promise<unknown>): Promise<string> {
	return write.then(
		() => "saved",
		(error: unknown) => writeCodeOf(error),
	);
}

test.beforeAll(async () => {
	fixture = await createSettingsFixture();
});

test.afterAll(async () => {
	for (const client of clients) await client.auth.signOut();
	await fixture?.teardown();
});

const FIRST_STORE_NAME = "Cửa hàng thử 1";
const WHOLE_HISTORY = "Áp dụng cho toàn bộ lịch sử bán.";
const KEEPS_EARLIER = "Từ ngày này trở đi; các ngày trước giữ giá vốn cũ.";
const NO_RELOAD_MARKER = "costsSameDocument";
const FIVE_COSTS = [
	{ id: "ITEM-1", name: "Trà sữa", cost: 12_000 },
	{ id: "ITEM-2", name: "Trà đào", cost: 14_000 },
	{ id: "ITEM-4", name: "Bánh flan", cost: 7_000 },
	{ id: "ITEM-5", name: "Hạt hướng dương", cost: 5_000 },
	{ id: "ITEM-6", name: "Món chưa phân loại", cost: 9_000 },
] as const;
const UNCOSTED_DRINK = "Cà phê";

function storeToday(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Ho_Chi_Minh",
	}).format(new Date());
}

function shownDate(isoDate: string): string {
	return isoDate.split("-").reverse().join("/");
}

function money(amount: number): RegExp {
	const grouped = new Intl.NumberFormat("vi-VN").format(amount);
	return new RegExp(`(?<![\\d.])${grouped.replaceAll(".", "\\.")}\\s₫`);
}

function exactly(pattern: RegExp): RegExp {
	return new RegExp(`^${pattern.source}$`);
}

async function inFixtureDatabase(
	run: (sql: ReturnType<typeof openFixtureDatabase>) => Promise<unknown>,
): Promise<void> {
	const sql = openFixtureDatabase();
	try {
		await run(sql);
	} finally {
		await sql.end();
	}
}

function mainNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Điều hướng chính" });
}

function costRow(page: Page, itemId: string): Locator {
	return page.locator(`[data-testid="cost-row"][data-item="${itemId}"]`);
}

function costField(row: Locator): Locator {
	return row.getByLabel("Giá vốn mới", { exact: true });
}

function dateField(row: Locator): Locator {
	return row.getByLabel("Áp dụng từ ngày", { exact: true });
}

function scopeField(page: Page): Locator {
	return page.getByLabel("Áp dụng cho", { exact: true });
}

async function expectCostsListed(page: Page): Promise<void> {
	await expect(page.getByTestId("costs-form")).toHaveAttribute(
		"data-sales",
		"ready",
	);
}

async function markThisDocument(page: Page): Promise<void> {
	await page.evaluate(
		(marker) => Reflect.set(window, marker, true),
		NO_RELOAD_MARKER,
	);
}

async function expectSameDocument(page: Page): Promise<void> {
	expect(
		await page.evaluate(
			(marker) => Reflect.get(window, marker),
			NO_RELOAD_MARKER,
		),
	).toBe(true);
}

async function openMenuThroughTheApp(page: Page): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Chủ đề" }).click();
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: "Thực đơn" })
		.click();
	await expect(page).toHaveURL(/#\/chu-de\/thuc-don/);
	await waitForSettledThemeCards(page);
}

async function openCostsThroughTheApp(page: Page): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Cài đặt" }).click();
	await settingsNav(page)
		.getByRole("link", { name: "Dữ liệu nhập tay" })
		.click();
	await expectCostsListed(page);
}

function marginsTable(page: Page): Locator {
	return themeCard(page, "menu", "margins").getByRole("table", {
		name: "Biên lợi nhuận các món có giá vốn",
		exact: true,
	});
}

async function marginCell(
	page: Page,
	item: string,
	column: string,
): Promise<string> {
	const table = marginsTable(page);
	const headers = (await table.locator("thead th").allTextContents()).map(
		(text) => text.replace(/[↑↓↕]/g, "").trim(),
	);
	const index = headers.indexOf(column);
	expect(index, column).toBeGreaterThan(0);
	const row = itemRow(table, page, item);
	await expect(row).toHaveCount(1);
	return ((await row.locator("td").nth(index).textContent()) ?? "").trim();
}

function itemRow(table: Locator, page: Page, item: string): Locator {
	return table.locator("tbody tr").filter({
		has: page.locator("td:first-child", { hasText: new RegExp(`^${item}$`) }),
	});
}

function matrixRow(page: Page, item: string): Locator {
	return itemRow(
		themeCard(page, "menu", "menu_matrix").getByRole("table", {
			name: "Xếp loại từng món theo vai trò",
			exact: true,
		}),
		page,
		item,
	);
}

test.describe("Giá vốn in the browser", () => {
	test.beforeAll(async () => {
		const { tenantId, accountId, sales } = created();
		await inFixtureDatabase(async (sql) => {
			await sql`
				insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
				values
					(${tenantId}, ${accountId}, 'TYPE-DRINK', 'drink'),
					(${tenantId}, ${accountId}, 'TYPE-SNACK', 'snack')
			`;
			await sql`select app.refresh_analytics(${tenantId}::uuid, ${sales.from}::date, ${sales.to}::date)`;
		});
	});

	test.afterAll(async () => {
		const { tenantId, sales } = created();
		await inFixtureDatabase(async (sql) => {
			await sql`delete from public.item_costs where tenant_id = ${tenantId}`;
			await sql`delete from public.item_type_roles where tenant_id = ${tenantId}`;
			await sql`select app.refresh_analytics(${tenantId}::uuid, ${sales.from}::date, ${sales.to}::date)`;
		});
	});

	test("five costs for store 1 entered with their default date 01/01/2023 put exactly those five items on Thực đơn's margin card, the drinks staying tạm tính, and a later cost leaves the earlier days at the earlier cost", async ({
		page,
	}) => {
		const { tenantId, storeIds } = created();
		watchConsoleErrors(page);
		await created().signIn(page, "owner");
		await page.goto(themeUrl("menu", `store=${storeIds[0]}`));
		await waitForSettledThemeCards(page);
		await markThisDocument(page);
		const margins = themeCard(page, "menu", "margins");
		await expect(margins.getByTestId("card-notice")).toContainText(
			"Nhập giá vốn để xem biên lợi nhuận của từng món.",
		);
		await expect(matrixRow(page, UNCOSTED_DRINK)).toContainText("tạm tính");
		await margins.getByRole("link", { name: "Nhập giá vốn" }).click();
		await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=gia-von/);
		await expectCostsListed(page);
		await scopeField(page).selectOption({ label: FIRST_STORE_NAME });
		for (const { id, cost } of FIVE_COSTS) {
			const row = costRow(page, id);
			await expect(row.getByTestId("cost-current")).toHaveText(
				"Chưa có giá vốn.",
			);
			await expect(dateField(row)).toHaveValue(FIRST_DAY);
			await expect(dateField(row)).toHaveAccessibleDescription(WHOLE_HISTORY);
			await costField(row).fill(String(cost));
		}
		await saveSettings(page.getByTestId("settings-save-bar"));
		for (const { id, cost } of FIVE_COSTS) {
			const current = costRow(page, id).getByTestId("cost-current");
			await expect(current).toContainText(money(cost));
			await expect(current).toContainText("từ 01/01/2023");
			await expect(
				costRow(page, id).getByTestId("settings-audit-line").first(),
			).toContainText("Bạn sửa lần cuối");
		}

		await openMenuThroughTheApp(page);
		await expect(page).toHaveURL(new RegExp(`store=${storeIds[0]}`));
		await expect(marginsTable(page).locator("tbody tr")).toHaveCount(5);
		expect(
			(
				await marginsTable(page)
					.locator("tbody tr td:first-child")
					.allTextContents()
			)
				.map((text) => text.trim())
				.sort(),
		).toEqual(FIVE_COSTS.map((item) => item.name).sort());
		for (const { name, cost } of FIVE_COSTS) {
			expect(await marginCell(page, name, "Giá vốn mỗi món")).toMatch(
				exactly(money(cost)),
			);
		}
		await expect(matrixRow(page, UNCOSTED_DRINK)).toContainText("tạm tính");
		await expect(matrixRow(page, "Trà sữa")).toContainText("tạm tính");
		await expect(matrixRow(page, "Bánh flan")).not.toContainText("tạm tính");

		await openCostsThroughTheApp(page);
		await scopeField(page).selectOption({ label: FIRST_STORE_NAME });
		const milkTea = costRow(page, "ITEM-1");
		const today = storeToday();
		await expect(dateField(milkTea)).toHaveValue(today);
		await expect(dateField(milkTea)).toHaveAccessibleDescription(KEEPS_EARLIER);
		await costField(milkTea).fill("20000");
		await saveSettings(page.getByTestId("settings-save-bar"));
		await expect(milkTea.getByTestId("cost-current")).toContainText(
			money(20_000),
		);
		await expect(milkTea.getByTestId("cost-current")).toContainText(
			`từ ${shownDate(today)}`,
		);
		await expect(milkTea.getByTestId("cost-history-toggle")).toHaveText(
			"Lịch sử giá vốn (2)",
		);
		await openMenuThroughTheApp(page);
		expect(await marginCell(page, "Trà sữa", "Giá vốn mỗi món")).toMatch(
			exactly(money(12_000)),
		);
		await expectSameDocument(page);
		const owner = createSupabaseManualSource(await clientAs("owner"));
		expect(
			(await owner.itemCosts(tenantId))
				.filter((row) => row.itemExternalId === "ITEM-1")
				.map((row) => [row.storeId, row.costAmount, row.effectiveFrom]),
		).toEqual([
			[storeIds[0], 12_000, FIRST_DAY],
			[storeIds[0], 20_000, today],
		]);
		expectNoConsoleErrors(page);
	});

	test("a store-limited manager saves costs for their store and reads the costs for all stores without a control", async ({
		page,
	}) => {
		const { tenantId, storeIds } = created();
		const owner = createSupabaseManualSource(await clientAs("owner"));
		await owner.saveItemCosts(tenantId, [
			{
				storeId: null,
				itemExternalId: "ITEM-3",
				costAmount: 10_000,
				effectiveFrom: FIRST_DAY,
			},
		]);
		watchConsoleErrors(page);
		await created().signIn(page, "store-manager");
		await openSettings(page, "du-lieu-nhap-tay", "tab=gia-von");
		await expectCostsListed(page);
		await expect(scopeField(page)).toHaveValue(storeIds[0]);
		await expect(scopeField(page).locator("option")).toHaveText([
			"Tất cả cửa hàng",
			FIRST_STORE_NAME,
		]);
		const coffee = costRow(page, "ITEM-3");
		await expect(coffee.getByTestId("cost-current")).toContainText(
			"theo Tất cả cửa hàng",
		);
		await expect(dateField(coffee)).toHaveValue(storeToday());
		await expect(dateField(coffee)).toHaveAccessibleDescription(
			"Từ ngày này trở đi; các ngày trước giữ giá vốn chung.",
		);
		await costField(coffee).fill("11000");
		await saveSettings(page.getByTestId("settings-save-bar"));
		await expect(coffee.getByTestId("cost-current")).not.toContainText(
			"theo Tất cả cửa hàng",
		);
		await expect(coffee.getByTestId("cost-current")).toContainText(
			money(11_000),
		);
		await scopeField(page).selectOption("all");
		await expect(page.getByTestId("settings-read-only")).toContainText(
			"Giá vốn cho tất cả cửa hàng chỉ chủ hoặc quản lý xem được tất cả cửa hàng mới sửa được",
		);
		const shared = costRow(page, "ITEM-3");
		await expect(shared.getByTestId("cost-current")).toContainText(
			money(10_000),
		);
		await expect(costField(shared)).toHaveCount(0);
		await shared.getByTestId("cost-history-toggle").click();
		await expect(shared.getByTestId("cost-history-row")).toHaveCount(1);
		await expect(shared.getByTestId("cost-delete")).toHaveCount(0);
		await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
		const rows = (await owner.itemCosts(tenantId)).filter(
			(row) => row.itemExternalId === "ITEM-3",
		);
		expect(rows.map((row) => [row.storeId, row.costAmount])).toEqual([
			[null, 10_000],
			[storeIds[0], 11_000],
		]);
		expect(rows[1]?.audit?.author).toEqual({ kind: "member", role: "manager" });
		expectNoConsoleErrors(page);
	});

	test("a small CSV import goes through the real tables in one save, a lower-case store code and a blank first date included, and its refused rows write nothing", async ({
		page,
	}) => {
		const { tenantId, storeIds } = created();
		const owner = createSupabaseManualSource(await clientAs("owner"));
		const before = await owner.itemCosts(tenantId);
		watchConsoleErrors(page);
		await created().signIn(page, "owner");
		await openSettings(page, "du-lieu-nhap-tay", "tab=gia-von");
		await expectCostsListed(page);
		await expect(scopeField(page)).toHaveValue("all");
		const file = [
			"﻿ma_mon,ten_mon,size,ma_cua_hang,gia_von,tu_ngay",
			"ITEM-5,Hạt hướng dương,,,6.000,2024-01-01",
			"ITEM-2,Trà đào,, e2 ,15000,",
			"NOPE-1,Không có,,,1000,",
			'ITEM-6,Món chưa phân loại,,,"8333,33",',
		].join("\r\n");
		const choosing = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Nhập từ CSV" }).click();
		await (await choosing).setFiles({
			name: "gia-von-thu.csv",
			mimeType: "text/csv",
			buffer: Buffer.from(file),
		});
		const preview = page.getByTestId("cost-import-preview");
		await expect(preview.getByTestId("cost-import-row")).toHaveCount(4);
		expect(
			await preview
				.getByTestId("cost-import-row")
				.evaluateAll((rows) =>
					rows.map((row) => row.getAttribute("data-outcome")),
				),
		).toEqual(["ok", "ok", "unknown_item", "invalid_cost"]);
		await expect(
			preview.getByTestId("cost-import-row-values").nth(1),
		).toHaveText(/^Cửa hàng thử 2 · 15\.000\s₫ · từ 01\/01\/2023$/);
		await preview.getByRole("button", { name: "Lưu 2 dòng" }).click();
		await expect(page.getByTestId("cost-import-saved")).toHaveText(
			"Đã lưu 2 giá vốn từ tệp gia-von-thu.csv.",
		);
		const after = await owner.itemCosts(tenantId);
		const added = after.filter(
			(row) => !before.some((earlier) => earlier.id === row.id),
		);
		expect(
			added
				.map((row) => [
					row.storeId,
					row.itemExternalId,
					row.costAmount,
					row.effectiveFrom,
				])
				.sort(),
		).toEqual(
			[
				[null, "ITEM-5", 6_000, "2024-01-01"],
				[storeIds[1], "ITEM-2", 15_000, FIRST_DAY],
			].sort(),
		);
		expect(after).toHaveLength(before.length + 2);
		expect(added.every((row) => row.audit?.author.kind === "you")).toBe(true);
		expectNoConsoleErrors(page);
	});
});

test("a tenant-wide cost and a store cost of one item and date are two rows, and saving a scope again updates its row", async () => {
	const { tenantId, storeIds } = created();
	const manual = createSupabaseManualSource(await clientAs("owner"));
	const tenantWide = {
		storeId: null,
		itemExternalId: "ITEM-1",
		costAmount: 10_000,
		effectiveFrom: FIRST_DAY,
	};
	await manual.saveItemCosts(tenantId, [
		tenantWide,
		{ ...tenantWide, storeId: storeIds[0], costAmount: 12_000 },
	]);
	const [saved] = await manual.saveItemCosts(tenantId, [
		{ ...tenantWide, costAmount: 11_000 },
	]);
	expect(saved?.audit?.author).toEqual({ kind: "you" });
	const rows = (await manual.itemCosts(tenantId)).filter(
		(row) => row.itemExternalId === "ITEM-1",
	);
	expect(rows.map((row) => [row.storeId, row.costAmount])).toEqual([
		[null, 11_000],
		[storeIds[0], 12_000],
	]);
	expect(rows.every((row) => row.audit !== null)).toBe(true);
});

test("a save holding one refused row writes none of its rows", async () => {
	const { tenantId } = created();
	const manual = createSupabaseManualSource(await clientAs("owner"));
	const before = await manual.itemCosts(tenantId);
	expect(
		await refusal(
			manual.saveItemCosts(tenantId, [
				{
					storeId: null,
					itemExternalId: "ITEM-2",
					costAmount: 9_000,
					effectiveFrom: FIRST_DAY,
				},
				{
					storeId: null,
					itemExternalId: "ITEM-3",
					costAmount: 10_000_000_000_000,
					effectiveFrom: FIRST_DAY,
				},
			]),
		),
	).toBe("invalid");
	expect(await manual.itemCosts(tenantId)).toEqual(before);
});

test("fee rates resolve the tenant-wide key the same way, and a store-limited manager writes only their own store's rows", async () => {
	const { tenantId, storeIds } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	const rate = {
		storeId: null,
		paymentMethodExternalId: "WALLET",
		feePct: 1.1,
		fixedFeeAmount: 0,
		effectiveFrom: FIRST_DAY,
	};
	await owner.saveFeeRates(tenantId, [rate]);
	await owner.saveFeeRates(tenantId, [{ ...rate, feePct: 1.3 }]);
	expect(
		(await owner.feeRates(tenantId)).map((row) => [row.storeId, row.feePct]),
	).toEqual([[null, 1.3]]);

	const limited = createSupabaseManualSource(await clientAs("store-manager"));
	const cost = {
		storeId: null,
		itemExternalId: "ITEM-4",
		costAmount: 5_000,
		effectiveFrom: FIRST_DAY,
	};
	expect(await refusal(limited.saveItemCosts(tenantId, [cost]))).toBe(
		"forbidden",
	);
	expect(
		await refusal(
			limited.saveItemCosts(tenantId, [{ ...cost, storeId: storeIds[1] }]),
		),
	).toBe("forbidden");
	expect(
		await refusal(
			limited.saveItemCosts(tenantId, [{ ...cost, storeId: storeIds[0] }]),
		),
	).toBe("saved");
});

test("store and tenant profiles: a duplicate code, the owner-only opening hours and an invalid span come back as their codes", async () => {
	const { tenantId, storeIds } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	const manager = createSupabaseSettingsSource(await clientAs("manager"));
	const stores = await owner.storeProfiles(tenantId);
	expect(stores.map((store) => store.code).sort()).toEqual(["E1", "E2"]);
	const saved = await owner.updateStoreProfile(tenantId, storeIds[0], {
		seatCount: 30,
		eInvoiceStatus: "configured",
	});
	expect(saved).toMatchObject({
		seatCount: 30,
		eInvoiceStatus: "configured",
		audit: { author: { kind: "you" } },
	});
	const duplicate = await owner
		.updateStoreProfile(tenantId, storeIds[1], { code: "E1" })
		.catch((error: unknown) => error);
	expect(duplicate).toMatchObject({
		code: "duplicate",
		constraint: "stores_code_unique_in_tenant",
	});
	expect(
		await refusal(
			manager.updateStoreProfile(tenantId, storeIds[0], {
				openingHours: { mon: [["07:00", "22:00"]] },
			}),
		),
	).toBe("forbidden");
	expect(
		await refusal(
			manager.updateStoreProfile(tenantId, storeIds[0], { seatCount: 32 }),
		),
	).toBe("saved");
	const invalid = await owner
		.updateStoreProfile(tenantId, storeIds[0], {
			openingHours: { mon: [["25:00", "22:00"]] },
		})
		.catch((error: unknown) => error);
	expect(invalid).toMatchObject({
		code: "invalid",
		constraint: "stores_opening_hours_valid",
	});
	expect(
		await owner.updateTenantProfile(tenantId, { defaultLanguage: "en" }),
	).toMatchObject({
		defaultLanguage: "en",
		audit: { author: { kind: "you" } },
	});
	expect(
		await refusal(
			manager.updateTenantProfile(tenantId, { legalForm: "enterprise" }),
		),
	).toBe("forbidden");
	expect(
		await owner.updateTenantProfile(tenantId, { defaultLanguage: "vi" }),
	).toMatchObject({ defaultLanguage: "vi" });
});

test("category and payment-kind overrides are saved, read back over the POS values and cleared", async () => {
	const { tenantId, accountId } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	await owner.saveCategoryOverrides(tenantId, [
		{
			posAccountId: accountId,
			itemExternalId: "ITEM-6",
			itemTypeExternalId: "TYPE-SNACK",
		},
	]);
	await owner.saveKindOverrides(tenantId, [
		{
			posAccountId: accountId,
			paymentMethodExternalId: "WALLET",
			kind: "ewallet",
		},
	]);
	const item = (await owner.items(tenantId)).find(
		(entry) => entry.itemExternalId === "ITEM-6",
	);
	expect(item).toMatchObject({
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "TYPE-SNACK",
		audit: { author: { kind: "you" } },
	});
	const wallet = (await owner.paymentMethods(tenantId)).find(
		(entry) => entry.externalId === "WALLET",
	);
	expect(wallet).toMatchObject({
		posKind: "other",
		overrideKind: "ewallet",
		kind: "ewallet",
	});
	await owner.saveCategoryOverrides(tenantId, [
		{
			posAccountId: accountId,
			itemExternalId: "ITEM-6",
			itemTypeExternalId: null,
		},
	]);
	await owner.saveKindOverrides(tenantId, [
		{ posAccountId: accountId, paymentMethodExternalId: "WALLET", kind: null },
	]);
	expect(
		(await owner.items(tenantId)).find(
			(entry) => entry.itemExternalId === "ITEM-6",
		)?.overrideItemTypeExternalId,
	).toBeNull();
	expect(
		(await owner.paymentMethods(tenantId)).find(
			(entry) => entry.externalId === "WALLET",
		),
	).toMatchObject({ overrideKind: null, kind: "other" });
});

test("a custom holiday is added once, read in its year beside the national days, and deleted", async () => {
	const { tenantId } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	const viewer = createSupabaseSettingsSource(await clientAs("viewer"));
	const added = await owner.addHoliday(tenantId, {
		holidayDate: "2026-03-09",
		name: "Nghỉ riêng của chuỗi",
	});
	expect(added).toMatchObject({ custom: true, kind: "custom" });
	expect(
		await refusal(
			owner.addHoliday(tenantId, {
				holidayDate: "2026-03-09",
				name: "Nghỉ riêng của chuỗi",
			}),
		),
	).toBe("duplicate");
	const year = await viewer.holidays(tenantId, 2026);
	expect(year.some((day) => !day.custom)).toBe(true);
	expect(year.filter((day) => day.custom).map((day) => day.id)).toEqual([
		added.id,
	]);
	expect(await refusal(viewer.deleteHoliday(tenantId, added.id))).toBe(
		"forbidden",
	);
	await owner.deleteHoliday(tenantId, added.id);
	expect(
		(await owner.holidays(tenantId, 2026)).filter((day) => day.custom),
	).toEqual([]);
});

test("a legal draft is published and retired through the functions, and a published text is frozen", async () => {
	const { tenantId } = created();
	const owner = createSupabaseManualSource(await clientAs("owner"));
	const manager = createSupabaseManualSource(await clientAs("manager"));
	const draft = await owner.saveLegalDraft(tenantId, {
		kind: "privacy_notice",
		language: "vi",
		version: "privacy-notice-2026-11",
		title: "Thông báo bảo mật",
		bodyMarkdown: "## Mục đích xử lý dữ liệu",
	});
	expect(draft).toMatchObject({ status: "draft", publishedAt: null });
	expect(await refusal(manager.publishLegalDocument(tenantId, draft.id))).toBe(
		"forbidden",
	);
	await owner.publishLegalDocument(tenantId, draft.id);
	expect(
		await refusal(
			owner.saveLegalDraft(tenantId, {
				id: draft.id,
				kind: "privacy_notice",
				language: "vi",
				version: draft.version,
				title: "Sửa sau khi công bố",
				bodyMarkdown: draft.bodyMarkdown,
			}),
		),
	).toBe("frozen");
	expect(await refusal(owner.deleteLegalDraft(tenantId, draft.id))).toBe(
		"frozen",
	);
	await owner.retireLegalDocument(tenantId, draft.id);
	const [retired] = await owner.legalDocuments(tenantId);
	expect(retired).toMatchObject({ status: "retired" });
	expect(retired?.publishedAt).not.toBeNull();
	expect(retired?.retiredAt).not.toBeNull();
});

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const RULES_FIRST = "data-protection-rules-e2e-1";
const RULES_NEXT = "data-protection-rules-e2e-2";
const CONSENT_VERSION = "loyalty-consent-text-e2e-1";

function shownInstant(iso: string | null): string {
	if (iso === null) throw new Error("the database set no date");
	const formatters = createFormatters({
		currencyCode: "VND",
		uiLocale: "vi-VN",
		timeZone: TIME_ZONE,
		unitLabels: { million: "tr", billion: "tỷ" },
	});
	const instant = new Date(iso);
	return `${formatters.date(todayIn(TIME_ZONE, instant))} lúc ${formatters.time(instant)}`;
}

async function openLegal(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await created().signIn(page, role);
	await openSettings(page, "phap-ly");
	await expect(
		page.getByRole("heading", { level: 2, name: "Pháp lý", exact: true }),
	).toBeVisible();
}

function legalGroup(page: Page, kind: string, language = "vi"): Locator {
	return page.locator(
		`[data-testid="legal-group"][data-kind="${kind}"][data-language="${language}"]`,
	);
}

function legalVersion(scope: Locator, version: string): Locator {
	return scope.locator(
		`[data-testid="legal-version"][data-version="${version}"]`,
	);
}

test("the database refuses a text inserted as published, a status set by hand and a change once published, and publishing the next version retires the one in force in the same call", async () => {
	const { tenantId } = created();
	const client = await clientAs("owner");
	const owner = createSupabaseManualSource(client);
	const text = {
		kind: "data_protection_rules" as const,
		language: "vi" as const,
		title: "Quy định bảo vệ thông tin",
		bodyMarkdown: "## Liên hệ",
	};
	const insertedAsPublished = await client.from("legal_documents").insert({
		tenant_id: tenantId,
		kind: text.kind,
		language: text.language,
		version: RULES_FIRST,
		title: text.title,
		body_markdown: text.bodyMarkdown,
		status: "published",
		published_at: new Date().toISOString(),
	});
	expect(insertedAsPublished.error?.code).toBe("42501");
	const first = await owner.saveLegalDraft(tenantId, {
		...text,
		version: RULES_FIRST,
	});
	const statusByHand = await client
		.from("legal_documents")
		.update({ status: "published" })
		.eq("id", first.id);
	expect(statusByHand.error?.code).toBe("42501");
	await owner.publishLegalDocument(tenantId, first.id);
	const changedOncePublished = await client
		.from("legal_documents")
		.update({ title: "Sửa sau khi công bố" })
		.eq("id", first.id);
	expect(changedOncePublished.error?.code).toBe("55000");
	const next = await owner.saveLegalDraft(tenantId, {
		...text,
		version: RULES_NEXT,
	});
	await owner.publishLegalDocument(tenantId, next.id);
	expect(await refusal(owner.publishLegalDocument(tenantId, next.id))).toBe(
		"invalid",
	);
	expect(await refusal(owner.retireLegalDocument(tenantId, first.id))).toBe(
		"invalid",
	);
	const rules = (await owner.legalDocuments(tenantId)).filter(
		(row) => row.kind === "data_protection_rules",
	);
	const retired = rules.find((row) => row.version === RULES_FIRST);
	const published = rules.find((row) => row.version === RULES_NEXT);
	expect(retired).toMatchObject({ status: "retired", title: text.title });
	expect(published).toMatchObject({ status: "published", retiredAt: null });
	expect(retired?.retiredAt).not.toBeNull();
	expect(retired?.retiredAt).toBe(published?.publishedAt);
});

test("the owner drafts from the skeleton, publishes and retires through the Pháp lý page, which shows the database's dates", async ({
	page,
}) => {
	const { tenantId } = created();
	const owner = createSupabaseManualSource(await clientAs("owner"));
	await openLegal(page, "owner");
	const terms = legalGroup(page, "mini_app_terms");
	await expect(terms.getByTestId("legal-current")).toHaveText(
		"Chưa có bản đang áp dụng.",
	);
	await terms.getByTestId("legal-new").click();
	const editor = terms.getByTestId("legal-editor");
	const version = await editor.getByLabel("Mã phiên bản").inputValue();
	expect(version).toMatch(/^mini-app-terms-\d{4}-\d{2}$/);
	await editor.getByLabel("Tiêu đề").fill("Điều khoản Mini App");
	await editor.getByRole("button", { name: "Tạo bản nháp từ khung" }).click();
	await editor.getByRole("button", { name: "Lưu bản nháp" }).click();
	await expect(editor.getByTestId("legal-editor-status")).toHaveText(
		"Đã lưu bản nháp.",
	);
	await editor.getByRole("button", { name: "Đóng" }).click();
	const row = legalVersion(terms, version);
	await expect(row.getByTestId("settings-audit-line")).toContainText(
		"Bạn sửa lần cuối",
	);
	await row.getByRole("button", { name: `Công bố ${version}` }).click();
	await row
		.getByTestId("legal-confirm")
		.getByRole("button", { name: "Công bố" })
		.click();
	await expect(terms.getByTestId("legal-group-status")).toHaveText(
		`Đã công bố ${version}.`,
	);
	const stored = (await owner.legalDocuments(tenantId)).find(
		(document) => document.version === version,
	);
	expect(stored).toMatchObject({ status: "published", retiredAt: null });
	await expect(terms.getByTestId("legal-current")).toHaveText(
		`Đang áp dụng: ${version}, công bố ${shownInstant(stored?.publishedAt ?? null)}.`,
	);
	await expect(row.getByTestId("legal-edit")).toHaveCount(0);
	await row.getByRole("button", { name: `Ngừng áp dụng ${version}` }).click();
	await row
		.getByTestId("legal-confirm")
		.getByRole("button", { name: "Ngừng áp dụng" })
		.click();
	await expect(row.getByTestId("legal-status")).toHaveText("Đã ngừng áp dụng");
	const retired = (await owner.legalDocuments(tenantId)).find(
		(document) => document.version === version,
	);
	expect(retired?.status).toBe("retired");
	await expect(row.getByTestId("legal-retired-at")).toHaveText(
		shownInstant(retired?.retiredAt ?? null),
	);
	expectNoConsoleErrors(page);
});

test("a manager reads the legal texts with the reason and no write control", async ({
	page,
}) => {
	const { tenantId } = created();
	const owner = createSupabaseManualSource(await clientAs("owner"));
	const consent = await owner.saveLegalDraft(tenantId, {
		kind: "loyalty_consent_text",
		language: "vi",
		version: CONSENT_VERSION,
		title: "Nội dung đồng ý tích điểm",
		bodyMarkdown: "## Mục đích xử lý dữ liệu",
	});
	await owner.publishLegalDocument(tenantId, consent.id);
	await openLegal(page, "manager");
	await expect(page.getByTestId("settings-read-only")).toHaveText(
		"Chỉ chủ xem được tất cả cửa hàng mới soạn, công bố hay ngừng áp dụng được văn bản pháp lý; bạn đang xem ở chế độ chỉ đọc.",
	);
	const loyalty = legalGroup(page, "loyalty_consent_text");
	const published = legalVersion(loyalty, CONSENT_VERSION);
	await expect(published.getByTestId("legal-status")).toHaveText(
		"Đang áp dụng",
	);
	await expect(page.getByTestId("legal-new")).toHaveCount(0);
	await expect(page.getByTestId("legal-publish")).toHaveCount(0);
	await expect(page.getByTestId("legal-retire")).toHaveCount(0);
	await expect(published.getByRole("button")).toHaveCount(1);
	expectNoConsoleErrors(page);
});

const CATCH_UP_DONE = "Đã cập nhật xong số liệu theo thay đổi cài đặt.";
const PARTNER_WALLET = "Ví đối tác";
const MONTH_TARGET = 9_000_000;
const STORE_TIME_ZONE = "Asia/Ho_Chi_Minh";

function monthOfDate(isoDate: string): string {
	return `${isoDate.slice(0, 7)}-01`;
}

function daysLeftFrom(today: string): number {
	const [year, month, day] = today.split("-").map(Number) as [
		number,
		number,
		number,
	];
	return new Date(Date.UTC(year, month, 0)).getUTCDate() - day + 1;
}

function targetMonthRow(page: Page, monthStart: string): Locator {
	return page.locator(
		`[data-testid="target-month"][data-month="${monthStart}"]`,
	);
}

function feeRow(page: Page, methodId: string): Locator {
	return page.locator(`[data-testid="fee-row"][data-method="${methodId}"]`);
}

async function openThemeThroughTheApp(page: Page, tab: string): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Chủ đề" }).click();
	await page.getByTestId("theme-tabs").getByRole("link", { name: tab }).click();
	await waitForSettledThemeCards(page);
}

test.describe("Mục tiêu and Phí thanh toán in the browser", () => {
	test.beforeAll(async () => {
		const { tenantId } = created();
		await inFixtureDatabase(async (sql) => {
			await sql`update public.tenants set default_language = 'vi' where id = ${tenantId}`;
			await sql`delete from public.payment_fee_rates where tenant_id = ${tenantId}`;
			await sql`delete from public.targets where tenant_id = ${tenantId}`;
			await sql`
				insert into public.invoice_payments (
					tenant_id, store_id, invoice_id, business_date,
					payment_method_external_id, payment_method_name, amount
				)
				select
					i.tenant_id, i.store_id, i.id, i.business_date,
					i.primary_payment_method_external_id, i.primary_payment_method_name, i.paid_amount
				from public.invoices i
				where i.tenant_id = ${tenantId}
			`;
			await sql`select app.refresh_analytics(${tenantId}::uuid, ${FIRST_DAY}::date, current_date + 1)`;
		});
	});

	test.afterAll(async () => {
		const { tenantId, sales } = created();
		await inFixtureDatabase(async (sql) => {
			await sql`delete from public.targets where tenant_id = ${tenantId}`;
			await sql`delete from public.payment_fee_rates where tenant_id = ${tenantId}`;
			await sql`delete from public.invoice_payments where tenant_id = ${tenantId}`;
			await sql`select app.refresh_analytics(${tenantId}::uuid, ${sales.from}::date, ${sales.to}::date)`;
		});
	});

	test("with Tháng open for store 1, a monthly target saved on Mục tiêu and its link back show the target progress, the amount still needed each day and both forecasts against the target", async ({
		page,
	}) => {
		const { tenantId, storeIds } = created();
		const realToday = storeToday();
		const pinned = realToday.endsWith("-01")
			? shiftDate(realToday, -1)
			: realToday;
		const clock = clockAfterSeed(shiftDate(pinned, -1), STORE_TIME_ZONE);
		const today = clock.today;
		const monthStart = monthOfDate(today);
		const monthKey = today.slice(0, 7);
		watchConsoleErrors(page);
		await page.clock.setFixedTime(clock.now);
		await created().signIn(page, "owner");
		await page.goto(reportUrl("month", `store=${storeIds[0]}`));
		await waitForSettledCards(page);
		await markThisDocument(page);
		const before = page.getByTestId("card-month-target_progress");
		await expect(before.getByTestId("headline")).toHaveText("—");
		const notice = before.getByTestId("card-notice");
		await expect(notice).toContainText(FIRST_STORE_NAME);
		await notice.getByRole("link", { name: "Đặt mục tiêu tháng" }).click();
		await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=muc-tieu/);
		await expect(page.getByLabel("Cửa hàng", { exact: true })).toHaveValue(
			storeIds[0],
		);
		const current = targetMonthRow(page, monthStart);
		await expect(current).toHaveAttribute("data-current", "true");
		await expect(current.getByTestId("target-saved")).toHaveText(
			"Chưa đặt mục tiêu.",
		);
		await expect(current.getByTestId("target-pace")).toHaveAttribute(
			"data-status",
			"ready",
		);
		await current
			.getByLabel(/^Mục tiêu doanh thu thuần cho tháng /)
			.fill(String(MONTH_TARGET));
		await saveSettings(page.getByTestId("settings-save-bar"));
		await expect(current.getByTestId("target-saved")).toHaveText(
			exactly(new RegExp(`Mục tiêu: ${money(MONTH_TARGET).source}`)),
		);
		await expect(
			current.getByTestId("settings-audit-line").first(),
		).toContainText("Bạn sửa lần cuối");
		await expect(current.getByTestId("target-pace-net")).toContainText(
			"mục tiêu",
		);
		await current
			.getByRole("link", { name: "Xem tiến độ trong Báo cáo tháng" })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`#/bao-cao/thang\\?month=${monthKey}&store=${storeIds[0]}$`),
		);
		await waitForSettledCards(page);
		const progress = page.getByTestId("card-month-target_progress");
		await expect(progress.getByTestId("card-notice")).toHaveCount(0);
		await expect(progress.getByTestId("headline")).toHaveText(/\d.*%/);
		await expect(progress.getByTestId("sentence")).toContainText("cần thêm");
		await expect(progress.getByTestId("sentence")).toContainText(
			`mỗi ngày trong ${daysLeftFrom(today)} ngày còn lại`,
		);
		const chips = progress.getByTestId("comparison-chip");
		await expect(chips).toHaveCount(2);
		await expect(chips.filter({ hasText: "so với mục tiêu" })).toHaveCount(2);
		await expectSameDocument(page);
		const owner = createSupabaseManualSource(await clientAs("owner"));
		expect(
			(await owner.targets(tenantId)).map((row) => [
				row.storeId,
				row.periodKind,
				row.periodStart,
				row.netTargetAmount,
			]),
		).toEqual([[storeIds[0], "month", monthStart, MONTH_TARGET]]);
		expectNoConsoleErrors(page);
	});

	test("a 21 % fee is refused, and a fee rate saved on Phí thanh toán starts the catch-up and, once it has finished, brings the fee estimate to Thanh toán", async ({
		page,
	}) => {
		const { tenantId } = created();
		watchConsoleErrors(page);
		await created().signIn(page, "owner");
		await markThisDocument(page);
		await openThemeThroughTheApp(page, "Thanh toán & tiền mặt");
		const fees = themeCard(page, "payments", "fees");
		await expect(fees.getByTestId("headline")).toHaveText("—");
		await fees.getByTestId("card-notice").getByRole("link").click();
		await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=phi/);
		await expect(scopeField(page)).toHaveValue("all");
		const wallet = feeRow(page, "WALLET");
		const percent = wallet.getByLabel(`Tỷ lệ phí mới cho ${PARTNER_WALLET}`, {
			exact: true,
		});
		const feeDate = wallet.getByLabel(`Áp dụng từ ngày cho ${PARTNER_WALLET}`, {
			exact: true,
		});
		await expect(wallet.getByTestId("fee-method")).toHaveText(PARTNER_WALLET);
		await expect(feeDate).toHaveValue(FIRST_DAY);
		await expect(feeDate).toHaveAccessibleDescription(WHOLE_HISTORY);
		await percent.fill("21");
		await expect(wallet.getByTestId("settings-field-error")).toHaveText(
			"Nhập giá trị từ 0% đến 20%.",
		);
		await percent.fill("2");
		await saveSettings(page.getByTestId("settings-save-bar"));
		await expect(page.getByTestId("fees-catch-up-note")).toBeVisible();
		await expect(wallet.getByTestId("fee-current")).toHaveText(
			"Phí hôm nay: 2%, từ 01/01/2023",
		);
		const banner = page.getByTestId("catch-up-banner");
		await expect(banner).toBeVisible();
		await expect(banner.getByTestId("catch-up-status")).toHaveText(
			CATCH_UP_DONE,
		);
		await expect(banner).toHaveAttribute("data-pending-days", "0");
		await banner.getByTestId("catch-up-action").click();
		await expect(banner).toHaveCount(0);
		await openThemeThroughTheApp(page, "Thanh toán & tiền mặt");
		const after = themeCard(page, "payments", "fees");
		await expect(after.getByTestId("card-notice")).toHaveCount(0);
		await expect(after.getByTestId("headline")).toHaveText(/\d.*₫/);
		await expect(
			after
				.getByRole("table", { name: "Phí theo phương thức thanh toán" })
				.locator("tbody tr")
				.filter({ hasText: PARTNER_WALLET }),
		).toContainText("2,0%");
		await expectSameDocument(page);
		const owner = createSupabaseSettingsSource(await clientAs("owner"));
		expect(
			(await owner.feeRates(tenantId)).map((row) => [
				row.storeId,
				row.paymentMethodExternalId,
				row.feePct,
				row.fixedFeeAmount,
				row.effectiveFrom,
			]),
		).toEqual([[null, "WALLET", 2, 0, FIRST_DAY]]);
		expectNoConsoleErrors(page);
	});
});
