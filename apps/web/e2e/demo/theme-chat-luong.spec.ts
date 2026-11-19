import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	saveSettings,
	settingsNav,
} from "../support/settings";
import {
	chooseSemicolonCsv,
	expectCsvTablesWithBom,
	expectDecimalCommas,
	expectEveryThemeCardSettled,
	expectRangeRoundTrip,
	expectSemicolonCsvTables,
	expectThemeInEnglish,
	expectThemePrintLayout,
	openTheme,
	themeCard,
	themeCardIds,
	themeCards,
	themeSearch,
	waitForSettledThemeCards,
} from "../support/themes";

const TITLE = "Chất lượng dữ liệu";
const YOUNG_STORE = "Cửa hàng mẫu 2";
const DRESSED_ITEM = "Hạt bí rang";
const DRESSED_ITEM_NEW_TYPE = "Đồ ăn kèm";
const TOPPING_TYPE = "TYPE-007";
const REMAPPED_METHOD = "Chuyển khoản";
const NO_RELOAD_MARKER = "chatLuongSameDocument";

function card(page: Page, id: string): Locator {
	return themeCard(page, "quality", id);
}

function table(scope: Locator, name: string): Locator {
	return scope.getByRole("table", { name, exact: true });
}

function rowsWith(scope: Locator, text: string): Locator {
	return scope.locator("tbody tr").filter({ hasText: text });
}

function noticeLink(scope: Locator, name: string): Locator {
	return scope.getByTestId("card-notice").getByRole("link", { name });
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

function mainNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Điều hướng chính" });
}

async function openQualityThroughTheApp(page: Page): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Chủ đề" }).click();
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: TITLE })
		.click();
	await expect(page).toHaveURL(/#\/chu-de\/chat-luong/);
	await waitForSettledThemeCards(page);
}

async function openClassificationTab(page: Page, tab: string): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Cài đặt" }).click();
	await settingsNav(page).getByRole("link", { name: "Phân loại" }).click();
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: tab })
		.click();
}

async function followAndReturn(
	page: Page,
	link: Locator,
	address: RegExp,
	settingsPage: string,
): Promise<void> {
	await link.click();
	await expect(page).toHaveURL(address);
	await expectCurrentSettingsPage(page, settingsPage);
	await page.goBack();
	await waitForSettledThemeCards(page);
}

test("Chất lượng dữ liệu opens on the last four weeks with every card settled and flags the young store for e-invoicing", async ({
	page,
}) => {
	await openTheme(page, "quality");
	await expect(
		page.getByRole("heading", { level: 1, name: TITLE }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(themeCards(page, "quality")).toHaveCount(
		themeCardIds.quality.length,
	);
	await expectEveryThemeCardSettled(page, "quality");
	await expect(
		page.getByTestId("theme-tabs").getByRole("link", { name: TITLE }),
	).toHaveAttribute("aria-current", "page");
	const compliance = card(page, "compliance");
	await expect(compliance.getByTestId("headline")).toHaveText("1");
	const findings = table(compliance, "Việc cần làm theo cửa hàng");
	const eInvoice = rowsWith(findings, "Chưa đăng ký hóa đơn điện tử");
	await expect(eInvoice).toHaveCount(1);
	await expect(eInvoice).toContainText(YOUNG_STORE);
	await expect(eInvoice).toContainText(
		"Sửa trong POS: đăng ký hóa đơn điện tử khởi tạo từ máy tính tiền",
	);
	await expect(rowsWith(findings, "Cửa hàng mẫu 1")).toHaveCount(0);
	await expect(
		rowsWith(table(compliance, "Hồ sơ cửa hàng"), YOUNG_STORE),
	).toContainText("Chưa đăng ký");
	await expect(compliance.getByTestId("card-notice")).toContainText(
		"Sửa trong POS: đăng ký hóa đơn điện tử",
	);
	const modifiers = table(
		card(page, "modifiers"),
		"Dòng món và dòng tùy chọn theo cửa hàng",
	);
	await expect(modifiers.locator("tbody tr")).toHaveCount(2);
	for (const cells of await modifiers.locator("tbody tr").all()) {
		await expect(cells.locator("td").nth(4)).toHaveText("0");
	}
	await expect(card(page, "modifiers").getByTestId("sentence")).toContainText(
		"Không có tùy chọn nào trong danh mục được bán như món.",
	);
	const verification = table(
		card(page, "verification"),
		"Ngày chưa đối soát theo cửa hàng",
	);
	await expect(rowsWith(verification, "Chưa khớp")).toContainText(
		"Chạy lại đồng bộ cho ngày này",
	);
	await expect(rowsWith(verification, "Chưa kiểm tra")).toHaveCount(1);
	const customers = card(page, "customers");
	await expect(customers.getByTestId("sentence")).toContainText(
		"có số điện thoại hoặc mã khách",
	);
	await expect(customers.getByTestId("sentence")).toContainText(
		"Chưa hóa đơn nào gắn với khách trong danh sách khách hàng",
	);
	await expect(card(page, "payments").getByTestId("headline")).toHaveText("0");
	expectNoConsoleErrors(page);
});

test("each Settings action opens the right page and tab", async ({ page }) => {
	await openTheme(page, "quality");
	await followAndReturn(
		page,
		noticeLink(card(page, "compliance"), "Ghi trạng thái hóa đơn điện tử"),
		/#\/cai-dat\/cua-hang$/,
		"Cửa hàng",
	);
	await followAndReturn(
		page,
		noticeLink(card(page, "costs"), "Nhập giá vốn"),
		/#\/cai-dat\/du-lieu-nhap-tay\?tab=gia-von$/,
		"Dữ liệu nhập tay",
	);
	await noticeLink(card(page, "uncategorised"), "Phân loại món").click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai\?tab=nhom-mon$/);
	await expect(page.getByTestId("categories-form")).toBeVisible();
	expectNoConsoleErrors(page);
});

test("the capture card links to the member invoice share per shift of Ca & két tiền", async ({
	page,
}) => {
	await openTheme(page, "quality");
	await noticeLink(
		card(page, "customers"),
		"Xem tỷ lệ hóa đơn có hội viên theo ca",
	).click();
	await expect(page).toHaveURL(/#\/chu-de\/ca-ket-tien/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Ca & két tiền" }),
	).toBeVisible();
	await waitForSettledThemeCards(page);
	await expect(
		page.getByTestId("card-shifts-member_share").getByTestId("headline"),
	).toHaveText(/\d.*%/);
	expectNoConsoleErrors(page);
});

test("re-mapping the uncategorised item from its action takes it out of the table on the next visit, through the app's own links (acceptance A6)", async ({
	page,
}) => {
	await openTheme(page, "quality");
	await markThisDocument(page);
	const uncategorised = card(page, "uncategorised");
	await expect(uncategorised.getByTestId("headline")).toHaveText("1");
	await expect(
		rowsWith(table(uncategorised, "Món chưa có nhóm"), DRESSED_ITEM),
	).toContainText("Sửa trong POS: gán nhóm cho món");
	await noticeLink(uncategorised, "Phân loại món").click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai\?tab=nhom-mon/);
	await page
		.getByTestId("categories-uncategorised")
		.getByLabel(DRESSED_ITEM, { exact: true })
		.selectOption({ label: DRESSED_ITEM_NEW_TYPE });
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(page.getByTestId("categories-uncategorised-none")).toBeVisible();
	await openQualityThroughTheApp(page);
	await expect(uncategorised.getByTestId("headline")).toHaveText("0");
	await expect(table(uncategorised, "Món chưa có nhóm")).toHaveCount(0);
	await expect(uncategorised.getByTestId("sentence")).toContainText(
		"đều đã có nhóm",
	);
	await expect(uncategorised.getByTestId("card-notice")).toHaveCount(0);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("a category without a role shows its finding with both Settings links, and a method set to Khác on purpose is not flagged", async ({
	page,
}) => {
	await openTheme(page, "quality");
	await markThisDocument(page);
	await openClassificationTab(page, "Vai trò nhóm món");
	await page
		.getByTestId("roles-form")
		.locator(`[data-testid="role-row"][data-type="${TOPPING_TYPE}"]`)
		.locator('select[data-testid="role-select"]')
		.selectOption("");
	await saveSettings(page.getByTestId("settings-save-bar"));
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Loại thanh toán" })
		.click();
	await page
		.getByTestId("payment-kinds-form")
		.getByLabel(REMAPPED_METHOD, { exact: true })
		.selectOption({ label: "Khác" });
	await saveSettings(page.getByTestId("settings-save-bar"));
	await openQualityThroughTheApp(page);
	const uncategorised = card(page, "uncategorised");
	await expect(
		table(uncategorised, "Nhóm món chưa có vai trò").locator("tbody tr"),
	).toHaveCount(1);
	await expect(table(uncategorised, "Nhóm món chưa có vai trò")).toContainText(
		"Gán vai trò ở Cài đặt → Phân loại → Vai trò nhóm món",
	);
	await expect(noticeLink(uncategorised, "Gán vai trò món")).toHaveAttribute(
		"href",
		/#\/cai-dat\/phan-loai$/,
	);
	await expect(noticeLink(uncategorised, "Phân loại món")).toHaveAttribute(
		"href",
		/#\/cai-dat\/phan-loai\?tab=nhom-mon$/,
	);
	const payments = card(page, "payments");
	await expect(payments.getByTestId("headline")).toHaveText("0");
	await expect(
		table(payments, "Phương thức cần phân loại hoặc đồng bộ lại"),
	).toHaveCount(0);
	await expect(payments.getByTestId("card-notice")).toHaveCount(0);
	await expect(payments.getByTestId("sentence")).toContainText(
		"đều đã có loại",
	);
	await noticeLink(uncategorised, "Gán vai trò món").click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai$/);
	await expect(page.getByTestId("roles-form")).toBeVisible();
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("a custom range survives a reload, steps by its own length and comes back", async ({
	page,
}) => {
	await expectRangeRoundTrip(page, "quality");
});

test("over 52 weeks the unverified days come by week for both stores, and the young store alone is still flagged", async ({
	page,
}) => {
	await openTheme(page, "quality", "range=364d");
	const verification = table(
		card(page, "verification"),
		"Ngày chưa đối soát theo cửa hàng",
	);
	await expect(verification.getByRole("columnheader")).toHaveText([
		/Cửa hàng/,
		/Từ ngày/,
		/Đến ngày/,
		/Số ngày/,
		/Trạng thái/,
		/Cách sửa/,
	]);
	await expect(verification.locator("tbody tr").first()).toContainText(
		"Chạy lại đồng bộ cho các ngày này",
	);
	await openTheme(page, "quality", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "quality");
	await expect(card(page, "compliance").getByTestId("headline")).toHaveText(
		"1",
	);
	await expect(
		table(card(page, "compliance"), "Hồ sơ cửa hàng").locator("tbody tr"),
	).toHaveCount(1);
	expectNoConsoleErrors(page);
});

test("every Chất lượng dữ liệu table downloads as UTF-8 CSV with a BOM", async ({
	page,
}) => {
	await openTheme(page, "quality");
	const headers: string[] = [];
	for (const id of themeCardIds.quality) {
		headers.push(...(await expectCsvTablesWithBom(page, card(page, id))));
	}
	const text = headers.join(" ");
	for (const label of [
		"Việc cần làm",
		"Hóa đơn điện tử",
		"Cách sửa",
		"Tùy chọn bán như món",
		"Tỷ trọng doanh thu món",
		"Khách trong danh sách khách hàng",
	]) {
		expect(text).toContain(label);
	}
	expect(text).not.toMatch(/theme\.quality\./);
});

test("Chất lượng dữ liệu downloads every table semicolon-separated with decimal commas on a device set to that format", async ({
	page,
}) => {
	await chooseSemicolonCsv(page);
	await openTheme(page, "quality");
	const texts: string[] = [];
	for (const id of themeCardIds.quality) {
		texts.push(...(await expectSemicolonCsvTables(page, card(page, id))));
	}
	expectDecimalCommas(texts);
});

test("Chất lượng dữ liệu prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	await expectNoExternalRequests(page, async () => {
		await openTheme(page, "quality");
	});
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Data quality");
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await waitForSettledThemeCards(page);
	await expect(card(page, "compliance")).toContainText(
		"E-invoices not registered",
	);
	await expect(
		noticeLink(card(page, "compliance"), "Record the e-invoice status"),
	).toBeVisible();
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});

test("the page opens straight from its address with the stores of the link", async ({
	page,
}) => {
	await openTheme(page, "quality", "range=7d&store=MOCK-S1");
	await expect(page).toHaveURL(
		/#\/chu-de\/chat-luong\?range=7d&store=MOCK-S1$/,
	);
	await expect(card(page, "compliance").getByTestId("headline")).toHaveText(
		"0",
	);
	await expect(card(page, "compliance").getByTestId("sentence")).toContainText(
		"Mọi cửa hàng đã ghi đủ",
	);
	expectNoConsoleErrors(page);
});
