// C18 Xin hóa đơn có mã số thuế công ty in the ordering build (VITE_ORDERING=on) on the ordering projects: a 360 px
// phone in light and dark, and an iPhone in WebKit (missing-screens README 5.7, C18-E1 to E4, R2, S1, S2, S4). The data
// is the demo world; the test acts as the counter and the e-invoice job through the demo till (DEMO_TILL_GLOBAL), as
// the real job does on the server. ISTQB: use case end to end through the four frames by keyboard, with the names a
// screen reader reads (state transitions: form → errors → review → received → issued and emailed), the window's
// boundary (day 8), the slow provider, the saved companies kept and deleted from "Dữ liệu của bạn", and error guessing
// for the security cases a browser can reach (another customer's order, markup and CRLF, no tax data in the address
// or the console).
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

const TILL = "__FNB_DEMO_TILL__";
const TABLE = "?store=mau-1&src=table&t=demo-table-12";
const FOREIGN_ORDER = "ffffffff-0000-4000-8000-000000000001";
const TAX = "0312345678";
const COMPANY = "Công ty TNHH Thương mại Mẫu";
const ADDRESS = "12 Đường Mẫu, Phường Bến Nghé, Quận 1";
const EMAIL = "ketoan@example.com";
/** a poll of the order is every 3 seconds: a change is seen within two */
const POLLED = { timeout: 8000 };

async function till(
	page: Page,
	method: string,
	...args: unknown[]
): Promise<unknown> {
	return page.evaluate(
		({ name, method, args }) => {
			const target = (
				window as unknown as Record<
					string,
					Record<string, (...a: unknown[]) => unknown>
				>
			)[name];
			if (target === undefined) throw new Error("no demo till on the page");
			return target[method]?.(...args);
		},
		{ name: TILL, method, args },
	);
}

async function checkOrderingScreen(page: Page): Promise<void> {
	await checkMiniAppScreen(page);
	await expectPricesOnlyWhereAllowed(page, { allowed: true });
	// nothing at 360 px needs a sideways scroll
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
}

/** A paid table order with its "Xin hóa đơn công ty" on the order screen. */
async function paidOrder(page: Page, extra = ""): Promise<void> {
	await page.goto(`./${TABLE}${extra}`);
	await expect(page.getByTestId("ordering-menu")).toBeVisible();
	await page.getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }).click();
	await page.getByTestId("cart-bar").getByRole("button").click();
	await page.getByTestId("cart-continue").click();
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await submit.click();
	await expect(page.getByTestId("order")).toBeVisible();
	await expect(page.getByTestId("order-invoice")).toHaveCount(0);
	await till(page, "act", "pay");
	await expect(page.getByTestId("order-invoice-ask")).toBeVisible(POLLED);
}

function textbox(page: Page, name: string) {
	return page.getByRole("textbox", { name, exact: true });
}

/** The screen moves the focus to its title when it opens; a test types only after that. */
async function formOpen(page: Page): Promise<void> {
	await expect(page.getByTestId("company-invoice-form")).toBeVisible();
	await expect(page.getByTestId("invoice-title")).toBeFocused();
}

/** Fills the four fields from the keyboard alone: Tab from one to the next. */
async function typeCompany(page: Page, fresh = true): Promise<void> {
	if (fresh) await formOpen(page);
	await textbox(page, "Mã số thuế").focus();
	await expect(textbox(page, "Mã số thuế")).toBeFocused();
	await page.keyboard.type(TAX);
	await page.keyboard.press("Tab");
	await expect(textbox(page, "Tên công ty")).toBeFocused();
	await page.keyboard.type(COMPANY);
	await page.keyboard.press("Tab");
	await page.keyboard.type(ADDRESS);
	await page.keyboard.press("Tab");
	await expect(textbox(page, "Email nhận hóa đơn")).toBeFocused();
	await page.keyboard.type(EMAIL);
}

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page, null);
});

test("C18-E1: the four frames by keyboard, with the names a screen reader reads, at the phone's width", async ({
	page,
}) => {
	const console: string[] = [];
	page.on("console", (message) => console.push(message.text()));
	await paidOrder(page);
	await expect(page.getByTestId("order-invoice-line")).toHaveText(
		/Xin hóa đơn có mã số thuế công ty đến hết ngày \d\d\/\d\d\/\d{4}\./,
	);
	await checkOrderingScreen(page);
	await page.getByTestId("order-invoice-ask").click();

	// frame 1: the form, every field named by its label; the focus is on its title
	await formOpen(page);
	await expect(
		page.getByRole("heading", { name: "Hóa đơn công ty", level: 1 }),
	).toBeVisible();
	await expect(textbox(page, "Mã số thuế")).toHaveAttribute(
		"inputmode",
		"numeric",
	);
	await expect(textbox(page, "Mã số thuế")).toHaveAccessibleDescription(
		"Ví dụ 0312345678 hoặc 0312345678-001",
	);
	await expect(textbox(page, "Email nhận hóa đơn")).toHaveAttribute(
		"autocomplete",
		"email",
	);
	await expect(
		page.getByRole("checkbox", { name: "Lưu công ty này cho lần sau" }),
	).toBeChecked();
	await checkOrderingScreen(page);

	// frame 2: an 8-digit tax code and an email without its domain, said under each field and linked to it
	await textbox(page, "Mã số thuế").focus();
	await page.keyboard.type("03123456");
	await page.keyboard.press("Tab");
	const tax = textbox(page, "Mã số thuế");
	await expect(tax).toHaveAttribute("aria-invalid", "true");
	await expect(tax).toHaveAccessibleDescription(
		/Mã số thuế gồm 10 hoặc 13 số\. Bạn đang nhập 8 số\./,
	);
	await textbox(page, "Email nhận hóa đơn").fill("ketoan@example");
	await textbox(page, "Email nhận hóa đơn").blur();
	await expect(textbox(page, "Email nhận hóa đơn")).toHaveAccessibleDescription(
		/Email chưa đúng/,
	);
	await page.getByRole("button", { name: "Xem lại thông tin" }).click();
	await expect(tax).toBeFocused();
	await expect(page.getByTestId("company-invoice-review")).toHaveCount(0);
	await checkOrderingScreen(page);

	// frame 3: corrected from the keyboard, sent with Enter; the review is a definition list with the warning
	await tax.fill("");
	await textbox(page, "Email nhận hóa đơn").fill("");
	await typeCompany(page, false);
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("company-invoice-review")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Kiểm tra lại", level: 1 }),
	).toBeFocused();
	const review = page.getByTestId("invoice-company");
	await expect(review.getByRole("term")).toHaveText([
		"Mã số thuế",
		"Tên công ty",
		"Địa chỉ",
		"Email nhận hóa đơn",
	]);
	await expect(page.getByTestId("invoice-value-tax_code")).toHaveText(
		`${TAX} đúng định dạng`,
	);
	await expect(page.getByTestId("invoice-immutable")).toContainText(
		"Hóa đơn không sửa được sau khi xuất.",
	);
	await checkOrderingScreen(page);

	// frame 4: one request, three steps
	await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
	await expect(
		page.getByRole("heading", { name: "Đã nhận yêu cầu", level: 1 }),
	).toBeFocused();
	expect(await till(page, "invoiceRequests")).toBe(1);
	await expect(page.getByTestId("invoice-step")).toHaveCount(3);
	await expect(
		page.locator("[data-testid=invoice-step][aria-current=step]"),
	).toHaveAttribute("data-step", "issuing");
	await expect(page.getByTestId("invoice-received-body")).toHaveText(
		`Quán xuất hóa đơn tên ${COMPANY} và gửi tới ${EMAIL}.`,
	);
	await checkOrderingScreen(page);

	// C18-S4: no tax data in the address or a console line
	expect(page.url()).not.toContain(TAX);
	expect(
		console.filter((line) => line.includes(TAX) || line.includes("ketoan@")),
	).toEqual([]);

	// C18-R2: the order history still opens the order, which now shows the request
	await page.getByRole("button", { name: "Về lịch sử đơn" }).click();
	await expect(page.getByTestId("order-row")).toHaveCount(1);
	await page.getByTestId("order-row").click();
	await expect(page.getByTestId("order-invoice-view")).toBeVisible(POLLED);
	await expect(page.getByTestId("order-invoice-line")).toHaveText(
		"Đã nhận yêu cầu, đang xuất hóa đơn",
	);
});

test("the request read only as the job moves it: slower than expected, then issued and emailed", async ({
	page,
}) => {
	await paidOrder(page);
	await page.getByTestId("order-invoice-ask").click();
	await typeCompany(page);
	await page.getByRole("button", { name: "Xem lại thông tin" }).click();
	await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
	await expect(page.getByTestId("company-invoice-status")).toBeVisible();
	// the provider keeps failing the sale invoice the company invoice replaces
	await till(page, "einvoice", "retrying");
	const reopen = async () => {
		await page.getByRole("button", { name: "Về lịch sử đơn" }).click();
		await page.getByTestId("order-row").click();
		await page.getByTestId("order-invoice-view").click(POLLED);
		await expect(page.getByTestId("company-invoice-status")).toBeVisible();
	};
	await reopen();
	await expect(
		page.getByRole("heading", {
			name: "Bạn đã xin hóa đơn công ty cho đơn này",
		}),
	).toBeVisible();
	await expect(page.getByTestId("invoice-slow")).toHaveText(
		"Chậm hơn dự kiến, quán đang xử lý.",
	);
	await expect(page.getByTestId("invoice-value-company_name")).toHaveText(
		COMPANY,
	);
	await expect(page.getByTestId("company-invoice-form")).toHaveCount(0);
	await checkOrderingScreen(page);
	// the job issues the company invoice and emails it: every step done
	await till(page, "einvoice", "issued");
	await till(page, "companyInvoice", "emailed");
	await reopen();
	await expect(
		page.locator("[data-testid=invoice-step][data-state=done]"),
	).toHaveCount(3);
	await expect(page.getByTestId("invoice-slow")).toHaveCount(0);
	await checkOrderingScreen(page);
});

test("C18-U4 as the server answers it: on day 8 after the payment it is too late, and nothing is sent", async ({
	page,
}) => {
	await paidOrder(page);
	await till(page, "paidDaysAgo", 8);
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await page.locator("[data-testid=account-row][data-row=orders]").click();
	await page.getByTestId("order-row").click();
	await expect(page.getByTestId("order-invoice-late")).toHaveText(
		"Đã quá hạn xin hóa đơn cho đơn này, bạn hỏi nhân viên ở quầy giúp.",
		POLLED,
	);
	await expect(page.getByTestId("order-invoice-ask")).toHaveCount(0);
	expect(await till(page, "invoiceRequests")).toBe(0);
	await checkOrderingScreen(page);
});

test("saved companies: kept by the request, offered as a chip, and deleted from Dữ liệu của bạn; the copy names them", async ({
	page,
}) => {
	// every answer takes 400 ms, so the second tap of a double tap meets the busy button
	await paidOrder(page, "&answerDelay=400");
	await page.getByTestId("order-invoice-ask").click();
	await typeCompany(page);
	await page.getByRole("button", { name: "Xem lại thông tin" }).click();
	// C18-I2: a double tap sends one request
	await page.getByRole("button", { name: "Gửi yêu cầu" }).dblclick();
	await expect(page.getByTestId("company-invoice-status")).toBeVisible();
	expect(await till(page, "invoiceRequests")).toBe(1);
	await page.getByRole("button", { name: "Về lịch sử đơn" }).click();
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await expect(page.getByTestId("account-row")).toHaveCount(5);
	await page.locator("[data-testid=account-row][data-row=company]").click();
	await expect(page.getByTestId("company-hub")).toBeVisible();
	await expect(page.getByTestId("saved-company")).toHaveCount(1);
	await checkOrderingScreen(page);
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await page.locator("[data-testid=account-row][data-row=data]").click();
	const saved = page.getByTestId("saved-company");
	await expect(saved).toContainText(`MST ${TAX} · ${EMAIL}`);
	await expect(
		page.locator("[data-testid=data-item][data-item=company]"),
	).toBeVisible();
	await checkOrderingScreen(page);
	await page.getByTestId("data-export").click();
	await page.getByTestId("data-export-load").click();
	const view = page.getByTestId("data-export-view");
	await expect(
		view.getByRole("heading", { name: "Yêu cầu hóa đơn công ty" }),
	).toBeVisible();
	await expect(
		view.getByRole("heading", { name: "Công ty đã lưu" }),
	).toBeVisible();
	await expect(view.locator("[data-field=tax_code]").first()).toHaveText(
		"Mã số thuế",
	);
	await page.getByRole("button", { name: "Về Dữ liệu của bạn" }).click();
	await page.getByRole("button", { name: `Xóa công ty ${COMPANY}` }).click();
	await expect(
		page.getByRole("dialog", { name: "Xóa công ty đã lưu?" }),
	).toBeVisible();
	await checkOrderingScreen(page);
	await page.getByTestId("saved-company-confirm-delete").click();
	await expect(page.getByTestId("saved-companies-empty")).toHaveText(
		"Bạn chưa lưu công ty nào.",
	);
});

test("C18-S1 and S2: another customer's order is not found; markup and a CRLF are refused before any call", async ({
	page,
}) => {
	const dialogs: string[] = [];
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await page.goto(`./?route=/hoa-don-cong-ty/${FOREIGN_ORDER}`);
	await expect(page.getByTestId("invoice-missing-note")).toHaveText(
		"Không tìm thấy đơn này.",
	);
	await expect(page.getByTestId("company-invoice-form")).toHaveCount(0);
	await checkOrderingScreen(page);

	await paidOrder(page);
	await page.getByTestId("order-invoice-ask").click();
	await textbox(page, "Mã số thuế").fill(TAX);
	await textbox(page, "Tên công ty").fill("<script>alert(1)</script>");
	await textbox(page, "Địa chỉ").fill(
		"{{ constructor.constructor('alert(1)')() }}",
	);
	await textbox(page, "Email nhận hóa đơn").fill(
		"ketoan@example.com\r\nBcc: x@example.com",
	);
	await page.getByRole("button", { name: "Xem lại thông tin" }).click();
	await expect(textbox(page, "Tên công ty")).toHaveAccessibleDescription(
		"Không dùng các ký tự < > { }.",
	);
	await expect(textbox(page, "Địa chỉ")).toHaveAccessibleDescription(
		"Không dùng các ký tự < > { }.",
	);
	await expect(textbox(page, "Email nhận hóa đơn")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(page.getByTestId("company-invoice-review")).toHaveCount(0);
	expect(await till(page, "invoiceRequests")).toBe(0);
	expect(dialogs).toEqual([]);
});
