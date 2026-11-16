import { expect, type Locator, type Page, test } from "@playwright/test";
import { isLocalStackConfigured } from "../support/local-stack";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import { saveSettings, settingsNav } from "../support/settings";
import {
	createSettingsFixture,
	openFixtureDatabase,
	type SettingsFixture,
} from "../support/settings-fixture";
import { themeCard, waitForSettledThemeCards } from "../support/themes";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const UNTYPED_ITEM = "Món chưa phân loại";
const SNACK_TYPE = "Ăn vặt";
const UNCATEGORISED = "Chưa phân loại";
const PARTNER_WALLET = "Ví đối tác";
const OTHER_KIND = "Khác";
const WALLET_KIND = "Ví điện tử";
const CATCH_UP_DONE = "Đã cập nhật xong số liệu theo thay đổi cài đặt.";
const NO_RELOAD_MARKER = "phanLoaiSameDocument";

let fixture: SettingsFixture | undefined;

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

async function addOneTenderPerInvoice(current: SettingsFixture): Promise<void> {
	const sql = openFixtureDatabase();
	try {
		await sql`
			insert into public.invoice_payments (
				tenant_id, store_id, invoice_id, business_date,
				payment_method_external_id, payment_method_name, amount
			)
			select
				i.tenant_id, i.store_id, i.id, i.business_date,
				i.primary_payment_method_external_id, i.primary_payment_method_name, i.paid_amount
			from public.invoices i
			where i.tenant_id = ${current.tenantId}
		`;
		await sql`select app.refresh_analytics(${current.tenantId}::uuid, ${current.sales.from}::date, ${current.sales.to}::date)`;
	} finally {
		await sql.end();
	}
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

function tableRow(table: Locator, text: string): Locator {
	return table.locator("tbody tr").filter({ hasText: text });
}

function categoryTable(page: Page): Locator {
	return themeCard(page, "menu", "category_mix").getByRole("table", {
		name: "Doanh thu theo nhóm món",
		exact: true,
	});
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

async function expectCatchUpToFinish(page: Page): Promise<void> {
	const banner = page.getByTestId("catch-up-banner");
	await expect(banner).toBeVisible();
	await expect(banner.getByTestId("catch-up-status")).toHaveText(CATCH_UP_DONE);
	await expect(banner).toHaveAttribute("data-pending-days", "0");
	await banner.getByTestId("catch-up-action").click();
	await expect(banner).toHaveCount(0);
}

test.beforeAll(async () => {
	fixture = await createSettingsFixture();
	await addOneTenderPerInvoice(fixture);
});

test.afterAll(async () => {
	await fixture?.teardown();
});

test("re-mapping the item without a type takes it out of Chưa phân loại on Thực đơn at once, and the catch-up banner clears when the runner finishes", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await created().signIn(page, "owner");
	await markThisDocument(page);
	await openThemeThroughTheApp(page, "Thực đơn");
	await expect(tableRow(categoryTable(page), UNCATEGORISED)).toHaveCount(1);
	await themeCard(page, "menu", "category_mix")
		.getByRole("link", { name: "Phân loại món" })
		.click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai\?tab=nhom-mon/);
	await page
		.getByTestId("categories-uncategorised")
		.getByLabel(UNTYPED_ITEM, { exact: true })
		.selectOption({ label: SNACK_TYPE });
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(page.getByTestId("categories-uncategorised-none")).toBeVisible();
	await expect(
		page
			.getByTestId("categories-overridden")
			.getByTestId("settings-audit-line"),
	).toContainText("Bạn sửa lần cuối");
	await openThemeThroughTheApp(page, "Thực đơn");
	await expect(tableRow(categoryTable(page), UNCATEGORISED)).toHaveCount(0);
	await expect(tableRow(categoryTable(page), SNACK_TYPE)).toHaveCount(1);
	await expectSameDocument(page);
	await expectCatchUpToFinish(page);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("a kind override starts the catch-up, its banner clears when the runner finishes, and the method then sits under its new kind in Thanh toán", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await created().signIn(page, "owner");
	await markThisDocument(page);
	await openThemeThroughTheApp(page, "Thanh toán & tiền mặt");
	await expect(tableRow(methodsTable(page), PARTNER_WALLET)).toContainText(
		OTHER_KIND,
	);
	await expect(tableRow(kindsTable(page), WALLET_KIND)).toHaveCount(0);
	await openMappingTabThroughTheApp(page, "Loại thanh toán");
	const wallet = page
		.getByTestId("payment-kinds-form")
		.getByLabel(PARTNER_WALLET, { exact: true });
	await wallet.selectOption({ label: WALLET_KIND });
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(wallet).toHaveAccessibleDescription(
		`Trên POS: ${OTHER_KIND} · Đang tính là: ${WALLET_KIND}`,
	);
	await expectCatchUpToFinish(page);
	await openThemeThroughTheApp(page, "Thanh toán & tiền mặt");
	await expect(tableRow(methodsTable(page), PARTNER_WALLET)).toContainText(
		WALLET_KIND,
	);
	await expect(tableRow(kindsTable(page), WALLET_KIND)).toHaveCount(1);
	await expect(tableRow(kindsTable(page), OTHER_KIND)).toHaveCount(0);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

for (const role of ["staff", "viewer"] as const) {
	test(`the ${role} sees both tabs read-only, with no save bar`, async ({
		page,
	}) => {
		watchConsoleErrors(page);
		await created().signIn(page, role);
		await openMappingTabThroughTheApp(page, "Nhóm của món");
		const categories = page.getByTestId("categories-form");
		await expect(
			categories
				.getByTestId("categories-overridden")
				.getByRole("textbox", { name: UNTYPED_ITEM }),
		).toHaveValue(SNACK_TYPE);
		await expect(page.getByTestId("settings-read-only")).toBeVisible();
		await expect(categories.getByRole("combobox")).toHaveCount(0);
		await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
		await page
			.getByTestId("mapping-tabs")
			.getByRole("link", { name: "Loại thanh toán" })
			.click();
		const kinds = page.getByTestId("payment-kinds-form");
		await expect(
			kinds.getByRole("textbox", { name: PARTNER_WALLET }),
		).toHaveValue(WALLET_KIND);
		await expect(page.getByTestId("settings-read-only")).toBeVisible();
		await expect(kinds.getByRole("combobox")).toHaveCount(0);
		await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
		expectNoConsoleErrors(page);
	});
}
