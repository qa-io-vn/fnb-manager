import { expect, test } from "@playwright/test";
import { buildStandee } from "../scripts/standee";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	openHome,
	openTab,
	PROGRAMME,
	sdkCalls,
	watchCustomerPage,
} from "./customer-checks";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

test("the home shows the programme, the stores and the menu without any permission prompt", async ({
	page,
}) => {
	await page.goto("./?dataDelay=800");
	await expect(page.getByRole("status")).toHaveText("Đang tải…");
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await expect(page.getByTestId("store-list").getByRole("button")).toHaveCount(
		2,
	);
	await expect(page.getByTestId("menu-at-counter")).toHaveText(
		Array(4).fill("Xem tại quầy"),
	);
	await expect(
		page.getByRole("button", { name: "Tham gia thành viên" }),
	).toBeVisible();
	expect(await sdkCalls(page)).toEqual(["getAccessToken"]);
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
	await checkCustomerScreen(page);
});

test("a store's QR link opens that store's page", async ({ page }) => {
	await page.goto("./?store=mau-2&src=qr");
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 2" }),
	).toBeVisible();
	await expect(page.getByTestId("store-address")).toHaveText(
		"34 Đường Số 2, Phường Mẫu, Thành phố Mẫu",
	);
	await expect(page.locator("[data-today=true]")).toContainText("Thứ Năm");
	await expect(page.getByTestId("menu-item")).toHaveCount(3);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
});

test("Privacy and Terms open as popups titled with the Mini App's name", async ({
	page,
}) => {
	await openHome(page);
	await page.getByRole("button", { name: "Chính sách bảo mật" }).click();
	const privacy = page.getByRole("dialog", {
		name: "Chính sách bảo mật Mini App Thành viên Quán Mẫu Một",
	});
	await expect(privacy).toBeVisible();
	await expect(privacy.getByTestId("legal-entity")).toHaveText(
		"Đơn vị chịu trách nhiệm: Hộ kinh doanh Quán Mẫu Một",
	);
	await expect(privacy.getByTestId("legal-version")).toContainText(
		"privacy-demo-1",
	);
	await checkCustomerScreen(page);
	await privacy.getByRole("button", { name: "Đóng" }).click();
	await page.getByRole("button", { name: "Điều khoản sử dụng" }).click();
	await expect(
		page.getByRole("dialog", {
			name: "Điều khoản sử dụng Mini App Thành viên Quán Mẫu Một",
		}),
	).toBeVisible();
	await checkCustomerScreen(page);
});

test("no screen a visitor can reach has an outbound link or a price", async ({
	page,
}) => {
	await openHome(page);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: /Cửa hàng Mẫu 1/ }).click();
	await expect(page.getByTestId("store")).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Tham gia thành viên" }).click();
	await expect(page.getByTestId("join-purpose")).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("join-consent")).toBeVisible();
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Hủy" }).click();
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("join-prompt")).toBeVisible();
	await checkCustomerScreen(page);
	await openTab(page, "Tài khoản");
	await expect(page.getByTestId("settings-visitor")).toBeVisible();
	await checkCustomerScreen(page);
	expect(await sdkCalls(page)).not.toContain("getPhoneNumber");
});

test("a lost connection says so and offers a retry", async ({ page }) => {
	await page.goto("./?session=failed");
	await expect(page.getByRole("alert")).toContainText("Mất kết nối mạng");
	await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
	await checkCustomerScreen(page);
});

test("the app speaks English when Zalo does", async ({ page }) => {
	await page.goto("./?lang=en");
	await expect(
		page.getByRole("button", { name: "Become a member" }),
	).toBeVisible();
	await expect(page.getByTestId("menu-at-counter").first()).toHaveText(
		"Ask at the counter",
	);
	await checkCustomerScreen(page);
});

test("without a published privacy notice the visitor browses on and joining waits, with the reason", async ({
	page,
}) => {
	await openHome(page, "?privacy=none");
	const note = page.getByTestId("join-closed");
	await expect(note).toHaveAttribute("data-reason", "no-privacy");
	await expect(note).toContainText("chưa công bố Chính sách bảo mật");
	for (const name of ["Tham gia thành viên", "Nhận điểm từ hóa đơn"]) {
		await expect(page.getByRole("button", { name })).toBeDisabled();
	}
	await expect(page.getByTestId("menu-item")).toHaveCount(4);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: /Cửa hàng Mẫu 2/ }).click();
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 2" }),
	).toBeVisible();
	await expect(page.getByTestId("join-closed")).toBeVisible();
	await checkCustomerScreen(page);
	expect(await sdkCalls(page)).toEqual(["getAccessToken"]);
});

test("without an active programme the home shows the stores and says joining is not open", async ({
	page,
}) => {
	await page.goto("./?programme=none");
	await expect(
		page.getByRole("heading", { name: "Chương trình thành viên" }),
	).toBeVisible();
	await expect(page.getByTestId("join-closed")).toHaveAttribute(
		"data-reason",
		"no-programme",
	);
	await expect(
		page.getByRole("button", { name: "Tham gia thành viên" }),
	).toBeDisabled();
	await expect(page.getByTestId("store-list").getByRole("button")).toHaveCount(
		2,
	);
	await checkCustomerScreen(page);
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("join-prompt")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Tham gia thành viên" }),
	).toBeDisabled();
	await checkCustomerScreen(page);
});

test("a standee's link opens that store's page, whatever the case of its code", async ({
	page,
}) => {
	await page.goto("./?store=MAU-1&src=standee");
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 1" }),
	).toBeVisible();
	await expect(page.getByTestId("menu-item")).toHaveCount(4);
	await checkCustomerScreen(page);
});

test("a printed standee's QR, made for this build, opens its store's page", async ({
	page,
	baseURL,
}) => {
	const standee = buildStandee(
		{ displayName: "Quán Mẫu Một", headerColor: "#0A6B56", textColor: "white" },
		{ code: "mau-2", name: "Cửa hàng Mẫu 2" },
		baseURL ?? "",
	);
	expect(standee.link).toContain("?store=mau-2&src=standee");
	await page.goto(standee.link);
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 2" }),
	).toBeVisible();
	await checkCustomerScreen(page);
});
