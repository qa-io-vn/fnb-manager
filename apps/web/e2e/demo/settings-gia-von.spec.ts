import { readFile } from "node:fs/promises";
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

// Back on Thực đơn after a save, the card shows its cached figures (or, before
// any cost, no table at all) until its refetch lands, so this waits for the
// column and retries until the item's cost reads the amount.
async function expectMarginCost(
	page: Page,
	item: string,
	amount: number,
): Promise<void> {
	const column = "Giá vốn mỗi món";
	const table = marginsTable(page);
	const headerCells = table.locator("thead th");
	await expect(headerCells.filter({ hasText: column })).toHaveCount(1);
	const headers = (await headerCells.allTextContents()).map((text) =>
		text.replace(/[↑↓↕]/g, "").trim(),
	);
	const index = headers.indexOf(column);
	expect(index, column).toBeGreaterThan(0);
	const row = table.locator("tbody tr").filter({
		has: page.locator("td:first-child", { hasText: item }),
	});
	await expect(row).toHaveCount(1);
	await expect(row.locator("td").nth(index), `${item}: ${column}`).toHaveText(
		new RegExp(`^${money(amount).source}$`),
	);
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
		await expectMarginCost(page, names[index] ?? "", amount);
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
	await expectMarginCost(page, name, 20_000);

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
	await expectMarginCost(page, name, 22_000);
	await chooseOnlyStore(page, YOUNG);
	await expectMarginCost(page, name, 20_000);
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
	await expect(page.getByTestId("fees-form")).toContainText("New fee rate");
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page
		.getByTestId("manual-tabs")
		.getByRole("link", { name: "Mục tiêu" })
		.click();
	await expect(page.getByTestId("targets-form")).toContainText(
		"Mục tiêu doanh thu thuần",
	);
	expectNoConsoleErrors(page);
});

const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf];
const TEMPLATE_HEADER = "ma_mon,ten_mon,size,ma_cua_hang,gia_von,tu_ngay";

interface Template {
	readonly name: string;
	readonly bytes: Buffer;
}

async function downloadTemplate(page: Page): Promise<Template> {
	const downloading = page.waitForEvent("download");
	await page.getByRole("button", { name: "Tải mẫu" }).click();
	const download = await downloading;
	return {
		name: download.suggestedFilename(),
		bytes: await readFile(await download.path()),
	};
}

function templateLines({ bytes }: Template): string[] {
	expect([...bytes.subarray(0, 3)]).toEqual(UTF8_BOM_BYTES);
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\r\n");
}

function importPreview(page: Page): Locator {
	return page.getByTestId("cost-import-preview");
}

async function importCsv(
	page: Page,
	name: string,
	content: Buffer | string,
): Promise<Locator> {
	const choosing = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Nhập từ CSV" }).click();
	await (await choosing).setFiles({
		name,
		mimeType: "text/csv",
		buffer: typeof content === "string" ? Buffer.from(content) : content,
	});
	await expect(importPreview(page)).toBeVisible();
	return importPreview(page);
}

function importRow(preview: Locator, line: number): Locator {
	return preview.locator(
		`[data-testid="cost-import-row"][data-line="${line}"]`,
	);
}

test("the cost template downloads with a BOM and the saved costs, re-imports unchanged without saving anything, and an edited cost saves exactly that row", async ({
	page,
}) => {
	await openCosts(page);
	const first = costRows(page).nth(0);
	const second = costRows(page).nth(1);
	const firstId = await itemIdOf(first);
	const secondId = await itemIdOf(second);
	const firstName = (
		(await first.getByTestId("cost-item").textContent()) ?? ""
	).trim();
	await enterCost(first, 20_000);
	await enterCost(second, 30_000);
	await saveSettings(saveBar(page));

	const template = await downloadTemplate(page);
	expect(template.name).toBe(`gia-von-tat-ca-cua-hang-${TODAY}.csv`);
	const lines = templateLines(template);
	expect(lines[0]).toBe(TEMPLATE_HEADER);
	const firstLine = lines.find((line) => line.startsWith(`${firstId},`)) ?? "";
	expect(firstLine).toMatch(/,,20000,2023-01-01$/);
	expect(firstName.startsWith(firstLine.split(",")[1] ?? "?")).toBe(true);
	expect(lines.find((line) => line.startsWith(`${secondId},`))).toMatch(
		/,,30000,2023-01-01$/,
	);
	expect(lines.filter((line) => /,,,$/.test(line)).length).toBeGreaterThan(20);

	const unchanged = await importCsv(page, template.name, template.bytes);
	await expect(unchanged.getByTestId("cost-import-summary-save")).toHaveText(
		"Sẽ lưu: 0 dòng",
	);
	await expect(
		unchanged.getByTestId("cost-import-summary-unchanged"),
	).toContainText(": 2 dòng");
	await expect(unchanged.getByTestId("cost-import-row")).toHaveCount(0);
	await expect(unchanged.getByTestId("cost-import-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByLabel("Áp dụng cho", { exact: true })).toBeDisabled();
	await unchanged.getByRole("button", { name: "Hủy nhập" }).click();
	await expect(importPreview(page)).toHaveCount(0);

	const edited = new TextDecoder()
		.decode(template.bytes)
		.replace(firstLine, firstLine.replace(",20000,", ",25.000,"));
	const preview = await importCsv(page, "gia-von-sua.csv", edited);
	await expect(preview.getByTestId("cost-import-summary-save")).toHaveText(
		"Sẽ lưu: 1 dòng",
	);
	const row = preview.getByTestId("cost-import-row");
	await expect(row).toHaveCount(1);
	await expect(row).toHaveAttribute("data-item", firstId);
	await expect(row).toHaveAttribute("data-outcome", "ok");
	await expect(row.getByTestId("cost-import-row-values")).toHaveText(
		"Tất cả cửa hàng · 25.000 ₫ · từ 01/01/2023",
	);
	await preview.getByRole("button", { name: "Lưu 1 dòng" }).click();
	await expect(page.getByTestId("cost-import-saved")).toHaveText(
		"Đã lưu 1 giá vốn từ tệp gia-von-sua.csv.",
	);
	await expect(importPreview(page)).toHaveCount(0);
	const saved = costRow(page, firstId);
	await expect(saved.getByTestId("cost-current")).toContainText(money(25_000));
	await expect(saved.getByTestId("cost-current")).toContainText(
		"từ 01/01/2023",
	);
	await expect(saved.getByTestId("cost-history-toggle")).toHaveText(
		"Lịch sử giá vốn (1)",
	);
	await expect(
		costRow(page, secondId).getByTestId("cost-current"),
	).toContainText(money(30_000));
	expectNoConsoleErrors(page);
});

test("a semicolon file follows the device's dialect, shows a fractional cost, unknown codes and a cost above the price with their outcomes, re-reads its dates in the chosen order, passes axe and reads in English", async ({
	page,
}) => {
	await openSettings(page, "bao-cao");
	await page.getByTestId("csv-dialect-semicolon").check();
	await openCosts(page);
	const semicolonHeader = TEMPLATE_HEADER.replaceAll(",", ";");
	expect(templateLines(await downloadTemplate(page))[0]).toBe(semicolonHeader);
	const ids: string[] = [];
	for (let index = 0; index < 4; index += 1) {
		ids.push(await itemIdOf(costRows(page).nth(index)));
	}
	const [fraction, inStore, unknownStore, abovePrice] = ids;
	const file = [
		semicolonHeader,
		`${fraction};Món một;;;8333,33;`,
		`${inStore};Món hai;;ch1;25.000;03/04/2026`,
		`${unknownStore};Món ba;;XX9;12000;`,
		"KHONG-CO;Không có;;;12000;",
		`${abovePrice};Món bốn;;;99.000.000;2024-01-01`,
	].join("\n");
	const preview = await importCsv(page, "gia-von-loi.csv", file);
	await expect(
		preview.getByRole("heading", { name: "Xem trước tệp gia-von-loi.csv" }),
	).toBeVisible();
	expect(
		await preview
			.getByTestId("cost-import-row")
			.evaluateAll((rows) =>
				rows.map((row) => row.getAttribute("data-outcome")),
			),
	).toEqual([
		"invalid_cost",
		"ok",
		"unknown_store",
		"unknown_item",
		"cost_above_price",
	]);
	await expect(
		importRow(preview, 2).getByTestId("cost-import-row-outcome"),
	).toHaveText("Giá vốn tính bằng đồng, không có phần lẻ.");
	await expect(
		importRow(preview, 2).getByTestId("cost-import-row-values"),
	).toContainText('giá vốn "8333,33"');
	await expect(
		importRow(preview, 4).getByTestId("cost-import-row-outcome"),
	).toHaveText("Không có cửa hàng nào mã XX9.");
	await expect(
		importRow(preview, 5).getByTestId("cost-import-row-outcome"),
	).toHaveText("Không có món nào mã KHONG-CO.");
	await expect(
		importRow(preview, 6).getByTestId("cost-import-row-outcome"),
	).toContainText("Sẽ lưu; giá vốn cao hơn giá bán");
	await expect(
		importRow(preview, 6).getByTestId("cost-import-row-values"),
	).toContainText("99.000.000 ₫");
	const inStoreValues = importRow(preview, 3).getByTestId(
		"cost-import-row-values",
	);
	const order = preview.getByRole("group", { name: "Thứ tự ngày" });
	await expect(order.getByLabel("Ngày/Tháng/Năm")).toBeChecked();
	await expect(inStoreValues).toHaveText(/ · 25\.000\s₫ · từ 03\/04\/2026$/);
	await order.getByLabel("Tháng/Ngày/Năm").check();
	await expect(inStoreValues).toHaveText(/ · 25\.000\s₫ · từ 04\/03\/2026$/);
	await expect(
		preview.getByRole("button", { name: "Lưu 2 dòng" }),
	).toBeVisible();
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		preview.getByRole("heading", { name: "Preview of gia-von-loi.csv" }),
	).toBeVisible();
	await expect(
		preview.getByRole("button", { name: "Save 2 rows" }),
	).toBeVisible();
	expect(RAW_KEY.test((await page.locator("main").textContent()) ?? "")).toBe(
		false,
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await preview.getByRole("button", { name: "Hủy nhập" }).click();
	await expect(importPreview(page)).toHaveCount(0);
	expectNoConsoleErrors(page);
});
