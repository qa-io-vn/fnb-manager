import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import {
	checkEntryScreen,
	expectFeedbackWithin,
	expectResultModalClosed,
	mockSdkApis,
	watchResultModal,
} from "./entry-checks";

const NOTICE = "Thông báo cho nhân viên (bản thử)";
const NEW_NOTICE = "Thông báo cho nhân viên (bản thử, phiên bản mới)";
const CONTACT =
	"Văn bản liên hệ giữ chỗ của bản thử: hãy hỏi quản lý cửa hàng tại quầy.";

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

function heading(page: Page, name: string) {
	return page.getByRole("heading", { level: 1, name, exact: true });
}

async function continueToNotice(page: Page): Promise<void> {
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Tiếp tục" }).click(),
	);
	await expect(heading(page, NOTICE)).toBeVisible();
}

async function agreeAndEnter(page: Page, code: string): Promise<void> {
	await page.getByRole("button", { name: "Đồng ý" }).click();
	await expect(heading(page, "Nhập mã ghép nối")).toBeVisible();
	await page.getByLabel("Mã ghép nối").fill(code);
}

async function openProfile(page: Page): Promise<void> {
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("button", { name: "Cá nhân" })
		.click();
	await expect(page.getByTestId("profile")).toBeVisible();
}

test("first open: onboarding before any Zalo call, with Privacy and Terms as popups", async ({
	page,
}) => {
	await page.goto("./?session=unpaired");
	await expect(heading(page, "Ứng dụng nội bộ cho nhân viên")).toBeVisible();
	await expect(page.getByTestId("entry")).toContainText(
		"Vì sao cần đăng nhập bằng Zalo",
	);
	await expect(page.getByRole("navigation")).toHaveCount(0);
	expect(await mockSdkApis(page)).toEqual([]);
	await checkEntryScreen(page);

	for (const [button, title] of [
		["Quyền riêng tư", "Chính sách quyền riêng tư (bản thử)"],
		["Điều khoản sử dụng", "Điều khoản sử dụng (bản thử)"],
	] as const) {
		await page.getByRole("button", { name: button }).click();
		const dialog = page.getByRole("dialog", { name: title });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("legal-version")).toContainText(
			"Phiên bản stand-in-",
		);
		await expect(dialog.locator("a")).toHaveCount(0);
		await checkMiniAppScreen(page);
		await dialog.getByRole("button", { name: "Đóng" }).click();
		await expect(dialog).toHaveCount(0);
	}
	expect(await mockSdkApis(page)).toEqual([]);
});

test("notice and từ chối: declining leaves a usable screen with the contact, and leads back", async ({
	page,
}) => {
	await page.goto("./?session=unpaired&delay=600");
	await continueToNotice(page);
	expect(await mockSdkApis(page)).toEqual(["getAccessToken"]);
	await expect(page.getByTestId("staff-notice")).toContainText(
		"Văn bản giữ chỗ của bản thử",
	);
	await checkEntryScreen(page);

	await page.getByRole("button", { name: "Từ chối" }).click();
	await expect(heading(page, "Bạn đã từ chối")).toBeVisible();
	await expect(page.getByTestId("refusal-contact")).toHaveText(CONTACT);
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkEntryScreen(page);

	await page.getByRole("button", { name: "Xem lại thông báo" }).click();
	await expect(heading(page, NOTICE)).toBeVisible();
});

test("pairing: a wrong or expired code, then the wait after too many attempts", async ({
	page,
}) => {
	await page.goto("./?session=unpaired&delay=500");
	await continueToNotice(page);
	await agreeAndEnter(page, "000000");
	await expect(page.getByLabel("Mã ghép nối")).toHaveAttribute(
		"inputmode",
		"numeric",
	);
	await checkEntryScreen(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Ghép nối" }).click(),
	);
	await expect(page.getByRole("alert")).toHaveText(
		"Mã không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc nhờ quản lý cấp mã mới.",
	);
	await checkEntryScreen(page);

	await page.getByLabel("Mã ghép nối").fill("999999");
	await page.getByRole("button", { name: "Ghép nối" }).click();
	await expect(page.getByRole("timer")).toHaveText(
		/^Bạn đã nhập sai nhiều lần\. Hãy thử lại sau 1[45]:\d{2}\.$/,
	);
	await expect(page.getByRole("button", { name: "Ghép nối" })).toBeDisabled();
	await checkEntryScreen(page);
});

test("pairing success: loading at once, a result modal for 1.5 s, then the home", async ({
	page,
}) => {
	await page.goto("./?session=unpaired&delay=700");
	await continueToNotice(page);
	await agreeAndEnter(page, "123456");
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Ghép nối" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toContainText(
		"Ghép nối thành công",
	);
	await checkMiniAppScreen(page);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("home")).toHaveAttribute(
		"data-status",
		"ready",
	);
	await expect(
		page
			.getByRole("navigation", { name: "Điều hướng chính" })
			.getByRole("button", { name: "Trang chủ" }),
	).toBeVisible();
	await checkMiniAppScreen(page);
});

test("an outdated notice while pairing shows the new version, then pairs with the code kept", async ({
	page,
}) => {
	await page.goto("./?session=unpaired&notice=changed");
	await continueToNotice(page);
	await agreeAndEnter(page, "123456");
	await page.getByRole("button", { name: "Ghép nối" }).click();
	await expect(heading(page, NEW_NOTICE)).toBeVisible();
	await expect(page.getByTestId("notice-hint")).toHaveText(
		"Thông báo cho nhân viên vừa có phiên bản mới. Hãy đọc lại trước khi đồng ý.",
	);
	await checkEntryScreen(page);
	await page.getByRole("button", { name: "Đồng ý" }).click();
	await expect(page.getByLabel("Mã ghép nối")).toHaveValue("123456");
	await page.getByRole("button", { name: "Ghép nối" }).click();
	await expect(page.getByTestId("home")).toBeVisible();
});

test("an outdated notice after pairing is shown again before anything else", async ({
	page,
}) => {
	await page.goto("./?session=notice&delay=400");
	await expect(heading(page, NOTICE)).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkEntryScreen(page);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Đồng ý" }).click(),
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("home")).toBeVisible();

	await page.goto("./?consent=outdated&dataDelay=400");
	await expect(heading(page, NEW_NOTICE)).toBeVisible();
	await expect(page.getByTestId("home")).toHaveCount(0);
	await checkEntryScreen(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Đồng ý" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toContainText(
		"Đã ghi nhận đồng ý",
	);
	await expect(page.getByTestId("home")).toBeVisible();
});

test("Cá nhân: Privacy and Terms popups, and withdrawal back to the notice", async ({
	page,
}) => {
	await page.goto("./?dataDelay=300");
	await openProfile(page);
	await checkEntryScreen(page);
	await page.getByRole("button", { name: "Quyền riêng tư" }).click();
	await expect(
		page.getByRole("dialog", { name: "Chính sách quyền riêng tư (bản thử)" }),
	).toBeVisible();
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Đóng" }).click();
	await page.getByRole("button", { name: "Điều khoản sử dụng" }).click();
	await expect(
		page.getByRole("dialog", { name: "Điều khoản sử dụng (bản thử)" }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Rút lại đồng ý" }).click();
	const confirm = page.getByRole("dialog", { name: "Rút lại đồng ý?" });
	await expect(confirm).toBeVisible();
	await checkEntryScreen(page);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		confirm.getByRole("button", { name: "Rút lại đồng ý" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toContainText(
		"Đã rút lại đồng ý",
	);
	await expectResultModalClosed(page);
	await expect(heading(page, NOTICE)).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkEntryScreen(page);
});

test("Cá nhân: the phone link explains itself first, and a refusal changes nothing", async ({
	page,
}) => {
	await page.goto("./?phone=refused");
	await openProfile(page);
	await page.getByRole("button", { name: "Liên kết số điện thoại" }).click();
	await expect(heading(page, "Liên kết số điện thoại")).toBeVisible();
	await expect(page.getByTestId("phone-purpose")).toContainText(
		"Việc liên kết là tùy chọn",
	);
	expect(await mockSdkApis(page)).not.toContain("getPhoneNumber");
	await checkEntryScreen(page);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("profile-phone-state")).toHaveText(
		"Chưa liên kết. Việc liên kết là tùy chọn.",
	);
	expect(await mockSdkApis(page)).toContain("getPhoneNumber");
	await expect(page.getByTestId("result-modal")).toHaveCount(0);
	await checkEntryScreen(page);

	await page.goto("./?dataDelay=400");
	await openProfile(page);
	await page.getByRole("button", { name: "Liên kết số điện thoại" }).click();
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Tiếp tục" }).click(),
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("profile-phone-state")).toHaveText(
		"Đã liên kết số …789",
	);
});

test("the entry speaks English when Zalo does", async ({ page }) => {
	await page.goto("./?session=unpaired&lang=en");
	await expect(heading(page, "An internal app for staff")).toBeVisible();
	await page.getByRole("button", { name: "Continue" }).click();
	await expect(heading(page, NOTICE)).toBeVisible();
	await page.getByRole("button", { name: "Decline" }).click();
	await expect(heading(page, "You declined")).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await checkEntryScreen(page);
});
