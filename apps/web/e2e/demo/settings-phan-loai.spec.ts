import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	saveSettings,
	settingsNav,
} from "../support/settings";
import {
	openTheme,
	themeCard,
	waitForSettledThemeCards,
} from "../support/themes";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const TOPPING_TYPES = ["TYPE-007", "TYPE-008"] as const;
const DRESSED_ITEM = "Hạt bí rang";
const DRESSED_ITEM_NEW_TYPE = "Đồ ăn kèm";
const DRESSED_ITEM_NEW_TYPE_ID = "TYPE-009";
const UNCATEGORISED = "Chưa phân loại";
const REMAPPED_METHOD = "Chuyển khoản";
const BANK_KIND = "Chuyển khoản";
const REMAPPED_KIND = "Thẻ";
const NO_RELOAD_MARKER = "phanLoaiSameDocument";

function rolesForm(page: Page): Locator {
	return page.getByTestId("roles-form");
}

function roleOf(page: Page, typeId: string): Locator {
	return rolesForm(page)
		.locator(`[data-testid="role-row"][data-type="${typeId}"]`)
		.locator('select[data-testid="role-select"]');
}

async function openRoles(page: Page): Promise<void> {
	await openSettings(page, "phan-loai");
	await expect(rolesForm(page)).toBeVisible();
}

async function openMonthThroughTheApp(page: Page): Promise<Locator> {
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("link", { name: "Báo cáo" })
		.click();
	await page
		.getByTestId("report-tabs")
		.getByRole("link", { name: "Tháng" })
		.click();
	await expect(page).toHaveURL(/#\/bao-cao\/thang/);
	await waitForSettledCards(page);
	return page.getByTestId("card-month-attach_rate");
}

async function setToppingRoles(page: Page, value: string): Promise<void> {
	for (const typeId of TOPPING_TYPES) {
		await roleOf(page, typeId).selectOption(value);
	}
	await saveSettings(page.getByTestId("settings-save-bar"));
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Phân loại lists the demo item types with their roles and their 28-day sales, and shows no catch-up in the demo", async ({
	page,
}) => {
	await openRoles(page);
	await expectCurrentSettingsPage(page, "Phân loại");
	await expect(
		page.getByTestId("mapping-tabs").locator('[aria-current="page"]'),
	).toHaveText("Vai trò nhóm món");
	await expect(rolesForm(page).getByTestId("role-row")).toHaveCount(10);
	await expect(roleOf(page, "TYPE-001")).toHaveValue("drink");
	await expect(roleOf(page, "TYPE-007")).toHaveValue("topping");
	await expect(roleOf(page, "TYPE-009")).toHaveValue("snack");
	await expect(rolesForm(page).locator('[data-type="TYPE-001"]')).toContainText(
		/\d+ món đã bán · [\d,]+% doanh thu món trong 28 ngày/,
	);
	await expect(page.getByTestId("roles-apply-suggestions")).toHaveCount(0);
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Nhóm của món" })
		.click();
	await expect(page).toHaveURL(/tab=nhom-mon/);
	await expect(page.getByTestId("categories-form")).toBeVisible();
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Loại thanh toán" })
		.click();
	await expect(page).toHaveURL(/tab=thanh-toan/);
	await expect(page.getByTestId("payment-kinds-form")).toBeVisible();
	expectNoConsoleErrors(page);
});

test("a cleared role gets its suggestion back on request, and nothing is saved before Lưu", async ({
	page,
}) => {
	await openRoles(page);
	await roleOf(page, "TYPE-007").selectOption("");
	await expect(
		rolesForm(page)
			.locator('[data-type="TYPE-007"]')
			.getByTestId("role-suggestion"),
	).toHaveText("Gợi ý: Topping");
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"1 thay đổi chưa lưu",
	);
	await page.getByTestId("roles-apply-suggestions").click();
	await expect(roleOf(page, "TYPE-007")).toHaveValue("topping");
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"Chưa có thay đổi.",
	);
	await roleOf(page, "TYPE-010").selectOption("food");
	await page.getByTestId("settings-cancel").click();
	await expect(roleOf(page, "TYPE-010")).toHaveValue("other");
	expectNoConsoleErrors(page);
});

test("clearing the topping roles empties Tháng's attach card and restoring them brings the rate back, all through the app's own links", async ({
	page,
}) => {
	await openRoles(page);
	await setToppingRoles(page, "");
	await expect(roleOf(page, "TYPE-007")).toHaveValue("");
	const attach = await openMonthThroughTheApp(page);
	const notice = attach.getByTestId("card-notice");
	await expect(notice).toContainText(
		"Chưa có nhóm món nào mang vai trò topping.",
	);
	await notice.getByRole("link", { name: "Gán vai trò món" }).click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai/);
	await expect(rolesForm(page)).toBeVisible();
	await expect(roleOf(page, "TYPE-007")).toHaveValue("");
	await expect(roleOf(page, "TYPE-008")).toHaveValue("");
	await setToppingRoles(page, "topping");
	const restored = await openMonthThroughTheApp(page);
	await expect(restored.getByTestId("headline")).toHaveText(/\d.*%/);
	await expect(restored.getByTestId("card-notice")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("Phân loại passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openRoles(page);
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Classification");
	await expect(
		page.getByTestId("mapping-tabs").locator('[aria-current="page"]'),
	).toHaveText("Item-type roles");
	await expect(rolesForm(page)).toContainText("items sold");
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});

function mainNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Điều hướng chính" });
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

async function openThemeThroughTheApp(page: Page, tab: string): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Chủ đề" }).click();
	await page.getByTestId("theme-tabs").getByRole("link", { name: tab }).click();
	await waitForSettledThemeCards(page);
}

async function openMappingTabThroughTheApp(
	page: Page,
	tab: string,
): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Cài đặt" }).click();
	await settingsNav(page).getByRole("link", { name: "Phân loại" }).click();
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: tab })
		.click();
}

function categoryTable(page: Page): Locator {
	return themeCard(page, "menu", "category_mix").getByRole("table", {
		name: "Doanh thu theo nhóm món",
		exact: true,
	});
}

function tableRow(table: Locator, text: string): Locator {
	return table.locator("tbody tr").filter({ hasText: text });
}

function methodsTable(page: Page): Locator {
	return themeCard(page, "payments", "payment_mix").getByRole("table", {
		name: "Thanh toán theo phương thức",
		exact: true,
	});
}

function kindsTable(page: Page): Locator {
	return themeCard(page, "payments", "payment_mix").getByRole("table", {
		name: "Thanh toán theo loại",
		exact: true,
	});
}

function kindSelect(page: Page, method: string): Locator {
	return page
		.getByTestId("payment-kinds-form")
		.getByLabel(method, { exact: true });
}

test("re-mapping the uncategorised item takes it out of Chưa phân loại on Thực đơn and into its new category, through the app's own links", async ({
	page,
}) => {
	await openTheme(page, "menu");
	await markThisDocument(page);
	await expect(tableRow(categoryTable(page), UNCATEGORISED)).toHaveCount(1);
	const newCategoryBefore = await tableRow(
		categoryTable(page),
		DRESSED_ITEM_NEW_TYPE,
	).textContent();
	await themeCard(page, "menu", "category_mix")
		.getByRole("link", { name: "Phân loại món" })
		.click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai\?tab=nhom-mon/);
	const uncategorised = page.getByTestId("categories-uncategorised");
	await expect(uncategorised.getByTestId("category-row")).toHaveCount(1);
	await uncategorised
		.getByLabel(DRESSED_ITEM, { exact: true })
		.selectOption({ label: DRESSED_ITEM_NEW_TYPE });
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(page.getByTestId("categories-uncategorised-none")).toBeVisible();
	await expect(
		page
			.getByTestId("categories-overridden")
			.getByLabel(DRESSED_ITEM, { exact: true }),
	).toHaveValue(DRESSED_ITEM_NEW_TYPE_ID);
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await openThemeThroughTheApp(page, "Thực đơn");
	await expect(tableRow(categoryTable(page), UNCATEGORISED)).toHaveCount(0);
	await expect(
		tableRow(categoryTable(page), DRESSED_ITEM_NEW_TYPE),
	).toHaveCount(1);
	expect(
		await tableRow(categoryTable(page), DRESSED_ITEM_NEW_TYPE).textContent(),
	).not.toBe(newCategoryBefore);
	await expect(
		themeCard(page, "menu", "category_mix").getByRole("link", {
			name: "Phân loại món",
		}),
	).toHaveCount(0);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("a payment method re-mapped to another kind moves in Thanh toán's payment mix and back with Theo POS, through the app's own links", async ({
	page,
}) => {
	await openTheme(page, "payments");
	await markThisDocument(page);
	await expect(tableRow(methodsTable(page), REMAPPED_METHOD)).toHaveCount(1);
	await expect(tableRow(methodsTable(page), REMAPPED_METHOD)).not.toContainText(
		REMAPPED_KIND,
	);
	await expect(tableRow(kindsTable(page), BANK_KIND)).toHaveCount(1);
	await expect(tableRow(kindsTable(page), REMAPPED_KIND)).toHaveCount(0);
	await openMappingTabThroughTheApp(page, "Loại thanh toán");
	await expect(page.getByTestId("payment-kinds-drawer-note")).toBeVisible();
	await kindSelect(page, REMAPPED_METHOD).selectOption({
		label: REMAPPED_KIND,
	});
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(kindSelect(page, REMAPPED_METHOD)).toHaveAccessibleDescription(
		`Trên POS: ${BANK_KIND} · Đang tính là: ${REMAPPED_KIND}`,
	);
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await openThemeThroughTheApp(page, "Thanh toán & tiền mặt");
	await expect(tableRow(methodsTable(page), REMAPPED_METHOD)).toContainText(
		REMAPPED_KIND,
	);
	await expect(tableRow(kindsTable(page), REMAPPED_KIND)).toHaveCount(1);
	await expect(tableRow(kindsTable(page), BANK_KIND)).toHaveCount(0);
	await openMappingTabThroughTheApp(page, "Loại thanh toán");
	await kindSelect(page, REMAPPED_METHOD).selectOption({ label: "Theo POS" });
	await saveSettings(page.getByTestId("settings-save-bar"));
	await openThemeThroughTheApp(page, "Thanh toán & tiền mặt");
	await expect(tableRow(methodsTable(page), REMAPPED_METHOD)).toHaveCount(1);
	await expect(tableRow(methodsTable(page), REMAPPED_METHOD)).not.toContainText(
		REMAPPED_KIND,
	);
	await expect(tableRow(kindsTable(page), BANK_KIND)).toHaveCount(1);
	await expect(tableRow(kindsTable(page), REMAPPED_KIND)).toHaveCount(0);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("Nhóm của món and Loại thanh toán pass axe, fit 360 px and read in English without raw keys", async ({
	page,
}) => {
	await openSettings(page, "phan-loai", "tab=nhom-mon");
	await expect(page.getByTestId("categories-form")).toBeVisible();
	await page.getByRole("searchbox", { name: "Tìm món" }).fill("tra");
	await expect(page.getByTestId("categories-search-list")).toBeVisible();
	await checkPage(page);
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Loại thanh toán" })
		.click();
	await expect(page.getByTestId("payment-kinds-form")).toBeVisible();
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByTestId("mapping-tabs").locator('[aria-current="page"]'),
	).toHaveText("Payment kinds");
	await expect(page.getByTestId("payment-kinds-form")).toContainText(
		"Counted as",
	);
	expect(RAW_KEY.test((await page.locator("main").textContent()) ?? "")).toBe(
		false,
	);
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Item categories" })
		.click();
	await expect(
		page.getByRole("region", { name: "Uncategorised (1)" }),
	).toBeVisible();
	expect(RAW_KEY.test((await page.locator("main").textContent()) ?? "")).toBe(
		false,
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
