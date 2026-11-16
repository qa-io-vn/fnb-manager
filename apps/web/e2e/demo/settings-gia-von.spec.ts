import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
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
const FIRST_DAY = "2023-01-01";
const TODAY = "2026-11-04";
const WHOLE_HISTORY = "Áp dụng cho toàn bộ lịch sử bán.";
const KEEPS_EARLIER = "Từ ngày này trở đi; các ngày trước giữ giá vốn cũ.";
const REPLACES = "Thay giá vốn đang có từ đúng ngày này.";
const NO_RELOAD_MARKER = "giaVonSameDocument";
const FIVE_COSTS = [12_000, 15_000, 13_000, 18_000, 17_000] as const;
const ESTABLISHED = "MOCK-S1";
const YOUNG = "MOCK-S2";
const KEEPS_SHARED = "Từ ngày này trở đi; các ngày trước giữ giá vốn chung.";
const REPLACES_SHARED =
	"Thay giá vốn chung ở cửa hàng này từ ngày này trở đi, kể cả các ngày đã qua.";

async function chooseOnlyStore(page: Page, storeId: string): Promise<void> {
	const trigger = page.getByTestId("store-select");
	if (!(await trigger.isVisible())) {
		await page.getByTestId("scope-summary").click();
	}
	await trigger.click();
	const boxes = page.locator('input[data-store-id]:not([data-store-id="all"])');
	await page.locator(`input[data-store-id="${storeId}"]`).check();
	const count = await boxes.count();
	for (let index = 0; index < count; index += 1) {
		const box = boxes.nth(index);
		if ((await box.getAttribute("data-store-id")) !== storeId) {
			await box.uncheck();
		}
	}
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(new RegExp(`store=${storeId}(&|$)`));
	await waitForSettledThemeCards(page);
}

function costRows(page: Page): Locator {
	return page.getByTestId("cost-row");
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

function saveBar(page: Page): Locator {
	return page.getByTestId("settings-save-bar");
}

function mainNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Điều hướng chính" });
}

function money(amount: number): RegExp {
	const grouped = new Intl.NumberFormat("vi-VN").format(amount);
	return new RegExp(`(?<![\\d.])${grouped.replaceAll(".", "\\.")}\\s₫`);
}

async function openCosts(page: Page, search = "tab=gia-von"): Promise<void> {
	await openSettings(page, "du-lieu-nhap-tay", search);
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
	await expect(page.getByTestId("costs-form")).toHaveAttribute(
		"data-sales",
		"ready",
	);
}

function marginsTable(page: Page): Locator {
	return themeCard(page, "menu", "margins").getByRole("table", {
		name: "Biên lợi nhuận các món có giá vốn",
		exact: true,
	});
}

async function marginItems(page: Page): Promise<string[]> {
	const cells = marginsTable(page).locator("tbody tr td:first-child");
	return (await cells.allTextContents()).map((text) => text.trim());
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
	const row = table.locator("tbody tr").filter({
		has: page.locator("td:first-child", { hasText: item }),
	});
	await expect(row).toHaveCount(1);
	return ((await row.locator("td").nth(index).textContent()) ?? "").trim();
}

async function enterCost(row: Locator, amount: number): Promise<void> {
	await costField(row).fill(String(amount));
	await costField(row).blur();
	await expect(costField(row)).toHaveValue(
		new Intl.NumberFormat("vi-VN").format(amount),
	);
}

async function itemIdOf(row: Locator): Promise<string> {
	const id = await row.getAttribute("data-item");
	if (id === null) throw new Error("a cost row without its item");
	return id;
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("with Thực đơn open for store 1, five costs for that store entered with their default date 01/01/2023 put exactly those five items on its margin card, the matrix staying tạm tính, through the app's own links", async ({
	page,
}) => {
	await openTheme(page, "menu", `store=${ESTABLISHED}`);
	await markThisDocument(page);
	const margins = themeCard(page, "menu", "margins");
	await expect(margins.getByTestId("card-notice")).toContainText(
		"Nhập giá vốn để xem biên lợi nhuận của từng món.",
	);
	await margins.getByRole("link", { name: "Nhập giá vốn" }).click();
	await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=gia-von/);
	await expectCurrentSettingsPage(page, "Dữ liệu nhập tay");
	await expect(
		page.getByTestId("manual-tabs").locator('[aria-current="page"]'),
	).toHaveText("Giá vốn");
	await expect(page.getByTestId("costs-form")).toHaveAttribute(
		"data-sales",
		"ready",
	);
	await expect(page.getByLabel("Áp dụng cho", { exact: true })).toHaveValue(
		"all",
	);
	await page
		.getByLabel("Áp dụng cho", { exact: true })
		.selectOption(ESTABLISHED);
	await expect(page.getByTestId("costs-form")).toHaveAttribute(
		"data-sales",
		"ready",
	);
	const names: string[] = [];
	for (const [index, amount] of FIVE_COSTS.entries()) {
		const row = costRows(page).nth(index);
		await expect(row.getByTestId("cost-current")).toHaveText(
			"Chưa có giá vốn.",
		);
		await expect(dateField(row)).toHaveValue(FIRST_DAY);
		await expect(dateField(row)).toHaveAccessibleDescription(WHOLE_HISTORY);
		await expect(costField(row)).toHaveAttribute("inputmode", "numeric");
		await enterCost(row, amount);
		names.push(
			((await row.getByTestId("cost-item").textContent()) ?? "").trim(),
		);
	}
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"5 thay đổi chưa lưu",
	);
	await expect(page.getByLabel("Áp dụng cho", { exact: true })).toBeDisabled();
	await saveSettings(saveBar(page));
	for (const [index, amount] of FIVE_COSTS.entries()) {
		const row = costRows(page).nth(index);
		await expect(row.getByTestId("cost-current")).toContainText(
			"Giá vốn hôm nay:",
		);
		await expect(row.getByTestId("cost-current")).toContainText(money(amount));
		await expect(row.getByTestId("cost-current")).toContainText(
			"từ 01/01/2023",
		);
		await expect(row.getByTestId("settings-audit-line").first()).toContainText(
			"Bạn sửa lần cuối",
		);
		await expect(dateField(row)).toHaveValue(TODAY);
		await expect(costField(row)).toHaveValue("");
	}
	await openMenuThroughTheApp(page);
	await expect(page).toHaveURL(new RegExp(`store=${ESTABLISHED}`));
	await expect(marginsTable(page).locator("tbody tr")).toHaveCount(5);
	expect((await marginItems(page)).sort()).toEqual([...names].sort());
	for (const [index, amount] of FIVE_COSTS.entries()) {
		expect(
			await marginCell(page, names[index] ?? "", "Giá vốn mỗi món"),
		).toMatch(new RegExp(`^${money(amount).source}$`));
	}
	await expect(
		themeCard(page, "menu", "margins").getByTestId("headline"),
	).toHaveText(/\d.*%/);
	await expect(themeCard(page, "menu", "menu_matrix")).toContainText(
		"tạm tính",
	);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("a later cost defaults to today and leaves the earlier days at the earlier cost, and the history deletes it again", async ({
	page,
}) => {
	await openCosts(page);
	const row = costRows(page).first();
	const itemId = await itemIdOf(row);
	const name = (
		(await row.getByTestId("cost-item").textContent()) ?? ""
	).trim();
	await enterCost(row, 20_000);
	await saveSettings(saveBar(page));
	const saved = costRow(page, itemId);
	await expect(dateField(saved)).toHaveValue(TODAY);
	await expect(dateField(saved)).toHaveAccessibleDescription(KEEPS_EARLIER);
	await enterCost(saved, 25_000);
	await saveSettings(saveBar(page));
	await expect(saved.getByTestId("cost-current")).toContainText(money(25_000));
	await expect(saved.getByTestId("cost-current")).toContainText(
		"từ 04/11/2026",
	);
	const toggle = saved.getByTestId("cost-history-toggle");
	await expect(toggle).toHaveText("Lịch sử giá vốn (2)");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	const history = saved.getByTestId("cost-history-row");
	await expect(history).toHaveCount(2);
	await expect(history.nth(0)).toContainText("Từ 04/11/2026:");
	await expect(history.nth(0)).toContainText("đang áp dụng");
	await expect(history.nth(1)).toContainText("Từ 01/01/2023:");
	await expect(history.nth(1)).toContainText(money(20_000));
	await dateField(saved).fill(FIRST_DAY);
	await expect(dateField(saved)).toHaveAccessibleDescription(REPLACES);
	await dateField(saved).fill(TODAY);

	await openMenuThroughTheApp(page);
	expect(await marginCell(page, name, "Giá vốn mỗi món")).toMatch(
		new RegExp(`^${money(20_000).source}$`),
	);

	await openCostsThroughTheApp(page);
	const again = costRow(page, itemId);
	await again.getByTestId("cost-history-toggle").click();
	await again
		.getByRole("button", { name: `Xóa giá vốn từ 04/11/2026 của ${name}` })
		.click();
	await expect(page.getByTestId("costs-delete-status")).toHaveText(
		`Đã xóa giá vốn từ 04/11/2026 của ${name}.`,
	);
	await expect(again.getByTestId("cost-history-toggle")).toHaveText(
		"Lịch sử giá vốn (1)",
	);
	await expect(again.getByTestId("cost-current")).toContainText(money(20_000));
	await expect(again.getByTestId("cost-current")).toContainText(
		"từ 01/01/2023",
	);
	expectNoConsoleErrors(page);
});

test("a negative cost, a fraction of a đồng and a cost above the limit are refused before anything is sent", async ({
	page,
}) => {
	await openCosts(page);
	const row = costRows(page).first();
	const error = row.getByTestId("settings-field-error");
	await costField(row).fill("-5000");
	await expect(error).toHaveText("Nhập giá trị từ 0 ₫ trở lên.");
	await expect(page.getByTestId("settings-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Sửa các ô đang báo lỗi rồi lưu.",
	);
	for (const fraction of ["25000,5", "8333.33", "25.5"]) {
		await costField(row).fill(fraction);
		await expect(error).toHaveText("Nhập số tiền chẵn đồng, không có phần lẻ.");
	}
	await costField(row).fill("150000000");
	await expect(error).toHaveText("Nhập giá trị không quá 100.000.000 ₫.");
	await page.getByTestId("settings-save").click({ force: true });
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"1 thay đổi chưa lưu",
	);
	await page.getByTestId("settings-cancel").click();
	await expect(costField(row)).toHaveValue("");
	await expect(error).toHaveCount(0);
	await expect(row.getByTestId("cost-current")).toHaveText("Chưa có giá vốn.");
	expectNoConsoleErrors(page);
});

test("a store's own cost dated back over the cost for all stores replaces it on Thực đơn for that store only, and the scope changes only once the changes are saved or cancelled", async ({
	page,
}) => {
	await openTheme(page, "menu", `store=${ESTABLISHED}`);
	await markThisDocument(page);
	await themeCard(page, "menu", "margins")
		.getByRole("link", { name: "Nhập giá vốn" })
		.click();
	await expect(page.getByTestId("costs-form")).toHaveAttribute(
		"data-sales",
		"ready",
	);
	const scope = page.getByLabel("Áp dụng cho", { exact: true });
	const row = costRows(page).first();
	const itemId = await itemIdOf(row);
	const name = (
		(await row.getByTestId("cost-item").textContent()) ?? ""
	).trim();
	await enterCost(row, 20_000);
	await expect(scope).toBeDisabled();
	await expect(scope).toHaveAccessibleDescription(
		"Lưu hoặc hủy các thay đổi trước khi đổi phạm vi.",
	);
	await saveSettings(saveBar(page));
	await expect(scope).toBeEnabled();
	await scope.selectOption(ESTABLISHED);
	const inStore = costRow(page, itemId);
	await expect(inStore.getByTestId("cost-current")).toContainText(
		"theo Tất cả cửa hàng",
	);
	await expect(inStore.getByTestId("cost-current")).toContainText(
		money(20_000),
	);
	await expect(dateField(inStore)).toHaveValue(TODAY);
	await expect(dateField(inStore)).toHaveAccessibleDescription(KEEPS_SHARED);
	await expect(inStore.getByTestId("cost-history-toggle")).toHaveCount(0);
	await dateField(inStore).fill(FIRST_DAY);
	await expect(dateField(inStore)).toHaveAccessibleDescription(REPLACES_SHARED);
	await expect(scope).toBeDisabled();
	await enterCost(inStore, 22_000);
	await saveSettings(saveBar(page));
	await expect(inStore.getByTestId("cost-current")).toContainText(
		money(22_000),
	);
	await expect(inStore.getByTestId("cost-current")).not.toContainText(
		"theo Tất cả cửa hàng",
	);
	await scope.selectOption("all");
	await expect(costRow(page, itemId).getByTestId("cost-current")).toContainText(
		money(20_000),
	);

	await openMenuThroughTheApp(page);
	await expect(page).toHaveURL(new RegExp(`store=${ESTABLISHED}`));
	expect(await marginCell(page, name, "Giá vốn mỗi món")).toMatch(
		new RegExp(`^${money(22_000).source}$`),
	);
	await chooseOnlyStore(page, YOUNG);
	expect(await marginCell(page, name, "Giá vốn mỗi món")).toMatch(
		new RegExp(`^${money(20_000).source}$`),
	);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("Giá vốn searches without Vietnamese marks, passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openCosts(page);
	await expect(page.getByTestId("costs-list-status")).toContainText(
		"món bán trong 90 ngày qua đứng đầu",
	);
	await expect(costRows(page)).toHaveCount(25);
	await page.getByTestId("costs-more").click();
	await expect(costRows(page)).toHaveCount(50);
	await page.getByRole("searchbox", { name: "Tìm món" }).fill("ca phe trung");
	await expect(costRows(page).first().getByTestId("cost-item")).toHaveText(
		"Cà phê trứng",
	);
	await page.getByRole("searchbox", { name: "Tìm món" }).fill("matcha da xay");
	const first = costRows(page).first();
	await enterCost(first, 14_000);
	await saveSettings(saveBar(page));
	await first.getByTestId("cost-history-toggle").click();
	await expect(first.getByTestId("cost-history-row")).toHaveCount(1);
	await costField(costRows(page).nth(1)).fill("-1");
	await page.getByRole("searchbox", { name: "Tìm món" }).fill("ca phe trung");
	await expect(page.getByTestId("costs-unsaved-kept")).toBeVisible();
	await checkPage(page);
	await page.getByTestId("settings-cancel").click();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Manual data");
	await expect(
		page.getByTestId("manual-tabs").locator('[aria-current="page"]'),
	).toHaveText("Item costs");
	await expect(page.getByTestId("costs-form")).toContainText("New cost");
	expect(RAW_KEY.test((await page.locator("main").textContent()) ?? "")).toBe(
		false,
	);
	await page
		.getByTestId("manual-tabs")
		.getByRole("link", { name: "Payment fees" })
		.click();
	await expect(page).toHaveURL(/tab=phi/);
	await expect(page.getByTestId("manual-tab-placeholder")).toContainText(
		"Payment fees comes in phase 10b",
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page
		.getByTestId("manual-tabs")
		.getByRole("link", { name: "Mục tiêu" })
		.click();
	await expect(page.getByTestId("manual-tab-placeholder")).toContainText(
		"Phần Mục tiêu có ở giai đoạn 10b",
	);
	expectNoConsoleErrors(page);
});
