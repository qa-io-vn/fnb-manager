import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage, expectNoSeriousAxeViolations } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import { expectCurrentSettingsPage, openSettings } from "../support/settings";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const DEMO_DRAFT = "privacy-notice-2026-11";
const STAFF_VERSION = "staff-notice-2026-11";
const CLOCK_TEXT = "04/11/2026 lúc 12:30";
const SKELETON_HEADINGS = [
	"Mục đích xử lý dữ liệu",
	"Dữ liệu được thu thập",
	"Thời gian lưu trữ",
	"Quyền của chủ thể dữ liệu và cách thực hiện",
	"Liên hệ",
	"Bên xử lý dữ liệu và lưu trữ ở nước ngoài",
];

function legalGroup(page: Page, kind: string, language = "vi"): Locator {
	return page.locator(
		`[data-testid="legal-group"][data-kind="${kind}"][data-language="${language}"]`,
	);
}

function version(scope: Locator, label: string): Locator {
	return scope.locator(
		`[data-testid="legal-version"][data-version="${label}"]`,
	);
}

async function openLegal(page: Page): Promise<void> {
	await openSettings(page, "phap-ly");
	await expect(page.getByTestId("legal-documents")).toBeVisible();
	await expect(
		legalGroup(page, "privacy_notice").getByTestId("legal-new"),
	).toBeVisible();
}

async function expectAxeInBothSchemesAt1280(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.emulateMedia({ colorScheme: "dark" });
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "light" });
	await checkPage(page);
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Pháp lý lists each kind in both languages with the demo's draft privacy notice and its label", async ({
	page,
}) => {
	await openLegal(page);
	await expectCurrentSettingsPage(page, "Pháp lý");
	await expect(page.getByTestId("settings-demo-note")).toBeVisible();
	await expect(page.getByTestId("legal-kind")).toHaveCount(6);
	await expect(page.getByTestId("legal-group")).toHaveCount(12);
	const privacy = legalGroup(page, "privacy_notice");
	await expect(privacy.getByTestId("legal-current")).toHaveText(
		"Chưa có bản đang áp dụng.",
	);
	const draft = version(privacy, DEMO_DRAFT);
	await expect(draft.getByTestId("legal-status")).toHaveText("Bản nháp");
	await expect(draft.getByTestId("legal-label")).toHaveText(DEMO_DRAFT);
	await expect(draft).toContainText("Mã phiên bản ghi khi đồng ý");
	await draft
		.getByRole("button", { name: `Xem nội dung ${DEMO_DRAFT}` })
		.click();
	await expect(
		draft.getByTestId("legal-text").getByRole("heading", { level: 5 }),
	).toHaveText(SKELETON_HEADINGS);
	await expect(page.getByTestId("legal-slot-consent")).toContainText("17a");
	await expectAxeInBothSchemesAt1280(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Legal");
	await expect(privacy.getByTestId("legal-current")).toHaveText(
		"No version in force.",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page
		.getByTestId("legal-slot-legal-form")
		.getByRole("link", { name: "Mở trang Cửa hàng" })
		.click();
	await expectCurrentSettingsPage(page, "Cửa hàng");
	expectNoConsoleErrors(page);
});

test("an owner drafts from the skeleton, previews it, publishes after confirming and retires it, with the demo store's dates", async ({
	page,
}) => {
	await openLegal(page);
	const staff = legalGroup(page, "staff_notice");
	await staff
		.getByRole("button", {
			name: "Tạo bản nháp Thông báo cho nhân viên, Tiếng Việt",
		})
		.click();
	const editor = staff.getByTestId("legal-editor");
	await expect(editor.getByLabel("Tiêu đề")).toBeFocused();
	await expect(editor.getByLabel("Mã phiên bản")).toHaveValue(STAFF_VERSION);
	await editor.getByLabel("Mã phiên bản").fill("Bản 1");
	await expect(editor.getByTestId("settings-field-error")).toContainText(
		"chữ thường không dấu",
	);
	await editor.getByLabel("Mã phiên bản").fill(STAFF_VERSION);
	await editor.getByLabel("Tiêu đề").fill("Thông báo cho nhân viên");
	await editor.getByRole("button", { name: "Tạo bản nháp từ khung" }).click();
	await expect(editor.getByLabel("Nội dung (Markdown)")).toHaveValue(
		SKELETON_HEADINGS.map((heading) => `## ${heading}`).join("\n\n"),
	);
	await expectAxeInBothSchemesAt1280(page);
	await editor.getByRole("button", { name: "Xem trước" }).click();
	const preview = editor.getByRole("region", { name: "Xem trước nội dung" });
	await expect(preview.getByRole("heading", { level: 6 })).toHaveText(
		SKELETON_HEADINGS,
	);
	await expectAxeInBothSchemesAt1280(page);
	await editor.getByRole("button", { name: "Lưu bản nháp" }).click();
	await expect(editor.getByTestId("legal-editor-status")).toHaveText(
		"Đã lưu bản nháp.",
	);
	await editor.getByRole("button", { name: "Đóng" }).click();
	const draft = version(staff, STAFF_VERSION);
	await expect(draft.getByTestId("legal-status")).toHaveText("Bản nháp");
	await draft.getByRole("button", { name: `Công bố ${STAFF_VERSION}` }).click();
	const confirm = draft.getByTestId("legal-confirm");
	await expect(confirm).toContainText(
		"Văn bản đã công bố không sửa hay xóa được nữa",
	);
	await expect(confirm.getByRole("button", { name: "Công bố" })).toBeFocused();
	await expectNoSeriousAxeViolations(page);
	await confirm.getByRole("button", { name: "Công bố" }).click();
	await expect(staff.getByTestId("legal-current")).toHaveText(
		`Đang áp dụng: ${STAFF_VERSION}, công bố ${CLOCK_TEXT}.`,
	);
	await expect(staff.getByTestId("legal-group-status")).toHaveText(
		`Đã công bố ${STAFF_VERSION}.`,
	);
	const published = version(staff, STAFF_VERSION);
	await expect(published.getByTestId("legal-published-at")).toHaveText(
		CLOCK_TEXT,
	);
	await expect(published.getByTestId("legal-edit")).toHaveCount(0);
	await expect(published.getByTestId("legal-delete")).toHaveCount(0);
	await published
		.getByRole("button", { name: `Ngừng áp dụng ${STAFF_VERSION}` })
		.click();
	await published
		.getByTestId("legal-confirm")
		.getByRole("button", { name: "Ngừng áp dụng" })
		.click();
	await expect(published.getByTestId("legal-status")).toHaveText(
		"Đã ngừng áp dụng",
	);
	await expect(published.getByTestId("legal-retired-at")).toHaveText(
		CLOCK_TEXT,
	);
	await expect(published.getByRole("button")).toHaveCount(1);
	await expect(staff.getByTestId("legal-current")).toHaveText(
		"Chưa có bản đang áp dụng.",
	);
	await expectAxeInBothSchemesAt1280(page);
	expectNoConsoleErrors(page);
});

test("publishing the next privacy notice retires the one in force, and a draft is deleted after confirming", async ({
	page,
}) => {
	await openLegal(page);
	const privacy = legalGroup(page, "privacy_notice");
	await version(privacy, DEMO_DRAFT)
		.getByRole("button", { name: `Công bố ${DEMO_DRAFT}` })
		.click();
	await version(privacy, DEMO_DRAFT)
		.getByTestId("legal-confirm")
		.getByRole("button", { name: "Công bố" })
		.click();
	await expect(privacy.getByTestId("legal-current")).toContainText(DEMO_DRAFT);
	await privacy.getByTestId("legal-new").click();
	const editor = privacy.getByTestId("legal-editor");
	const next = `${DEMO_DRAFT}.2`;
	await expect(editor.getByLabel("Mã phiên bản")).toHaveValue(next);
	await editor.getByLabel("Tiêu đề").fill("Thông báo bảo mật");
	await editor.getByLabel("Nội dung (Markdown)").fill("## Liên hệ");
	await editor.getByRole("button", { name: "Lưu bản nháp" }).click();
	await expect(editor.getByTestId("legal-editor-status")).toHaveText(
		"Đã lưu bản nháp.",
	);
	await editor.getByRole("button", { name: "Đóng" }).click();
	await version(privacy, next)
		.getByRole("button", { name: `Công bố ${next}` })
		.click();
	await expect(
		version(privacy, next).getByTestId("legal-confirm"),
	).toContainText(`Bản đang áp dụng ${DEMO_DRAFT} sẽ ngừng áp dụng cùng lúc.`);
	await version(privacy, next)
		.getByTestId("legal-confirm")
		.getByRole("button", { name: "Công bố" })
		.click();
	await expect(privacy.getByTestId("legal-current")).toContainText(next);
	await expect(
		version(privacy, DEMO_DRAFT).getByTestId("legal-status"),
	).toHaveText("Đã ngừng áp dụng");
	const english = legalGroup(page, "privacy_notice", "en");
	await english.getByTestId("legal-new").click();
	const englishEditor = english.getByTestId("legal-editor");
	await englishEditor.getByLabel("Tiêu đề").fill("Privacy notice");
	await englishEditor
		.getByRole("button", { name: "Tạo bản nháp từ khung" })
		.click();
	await expect(englishEditor.getByLabel("Nội dung (Markdown)")).toHaveValue(
		/^## Purpose of processing/,
	);
	await englishEditor.getByRole("button", { name: "Lưu bản nháp" }).click();
	await expect(englishEditor.getByTestId("legal-editor-status")).toHaveText(
		"Đã lưu bản nháp.",
	);
	await englishEditor.getByRole("button", { name: "Đóng" }).click();
	await version(english, DEMO_DRAFT)
		.getByRole("button", { name: `Xóa bản nháp ${DEMO_DRAFT}` })
		.click();
	await version(english, DEMO_DRAFT)
		.getByTestId("legal-confirm")
		.getByRole("button", { name: "Xóa bản nháp" })
		.click();
	await expect(english.getByTestId("legal-group-status")).toHaveText(
		`Đã xóa bản nháp ${DEMO_DRAFT}.`,
	);
	await expect(english.getByTestId("legal-version")).toHaveCount(0);
	expectNoConsoleErrors(page);
});
