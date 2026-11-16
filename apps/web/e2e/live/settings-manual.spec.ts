import { expect, type Locator, type Page, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseManualSource } from "../../src/settings/manual/supabase-manual-source";
import { writeCodeOf } from "../../src/settings/source";
import { createSupabaseSettingsSource } from "../../src/settings/supabase-settings-source";
import { isLocalStackConfigured } from "../support/local-stack";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
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
