import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type DataPack, parsePack } from "@fnb/datapack";
import { samplePlan } from "@fnb/datapack/testing";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import { clipboardText } from "../support/clipboard";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
	watchConsoleErrors,
} from "../support/reports";

const FIXTURES = fileURLToPath(
	new URL("../../../../packages/datapack/test/fixtures/", import.meta.url),
);
const GOLDEN_PACK = `${FIXTURES}demo-pack.json`;
const MISSING_SECTION = `${FIXTURES}plans/missing-section.md`;
const UNKNOWN_KPI = `${FIXTURES}plans/unknown-kpi.md`;
const RAW_PLAN_KEY = /\bplans\.[a-z]+/;
const BUILD_TIMEOUT = 60_000;

async function goldenPack(): Promise<DataPack> {
	return JSON.parse(await readFile(GOLDEN_PACK, "utf8")) as DataPack;
}

async function pasteAndCheck(page: Page, text: string): Promise<void> {
	await page.getByRole("textbox", { name: "Kế hoạch của trợ lý" }).fill(text);
	await page
		.getByTestId("plan-form")
		.getByRole("button", { name: "Kiểm tra", exact: true })
		.click();
}

function issue(page: Page, code: string): Locator {
	return page.getByTestId("plan-issues").locator(`[data-code="${code}"]`);
}

async function expectSaveDisabled(page: Page): Promise<void> {
	await expect(
		page.getByRole("button", { name: "Lưu kế hoạch", exact: true }),
	).toBeDisabled();
	await expect(page.getByTestId("plan-save-note")).toHaveText(
		"Lưu kế hoạch sẽ có ở giai đoạn 11b của lộ trình.",
	);
}

test("Kế hoạch leads to the pack tab and the paste box, says the plan list comes in 11b and passes axe at 360 and 1280 px", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/ke-hoach");
	await expect(
		page.getByRole("heading", { level: 1, name: "Kế hoạch" }),
	).toBeVisible();
	await expect(page.getByTestId("placeholder-phase")).toContainText("11b");
	const steps = page.getByTestId("plans-next-steps");
	await expect(
		steps.getByRole("link", { name: "Tạo gói dữ liệu cho AI" }),
	).toHaveAttribute("href", "#/xuat-du-lieu?tab=goi");
	await checkPage(page);
	await steps.getByRole("link", { name: "Dán kế hoạch" }).click();
	await expect(page).toHaveURL(/#\/ke-hoach\/dan$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Dán kế hoạch" }),
	).toBeVisible();
	await page.goto("/#/ke-hoach/khong-co");
	await expect(page).toHaveURL(/#\/ke-hoach$/);
	expectNoConsoleErrors(page);
});

test("the paste box refuses missing-section.md and unknown-kpi.md with their Vietnamese messages, finds the attached pack on the device the second time, keeps Lưu disabled and passes axe at 360 and 1280 px", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	watchConsoleErrors(page);
	const pack = await goldenPack();
	const prefix = pack.pack_id.slice(0, 8);
	await page.goto("/#/ke-hoach/dan");
	const box = page.getByRole("textbox", { name: "Kế hoạch của trợ lý" });
	await expect(box).toBeVisible();
	expect(
		await box.evaluate((element) => getComputedStyle(element).fontSize),
	).toBe("16px");
	await expectSaveDisabled(page);
	await checkPage(page);

	await expectNoExternalRequests(page, async () => {
		await pasteAndCheck(page, await readFile(MISSING_SECTION, "utf8"));
		const missing = page.getByTestId("plan-pack-missing");
		await expect(missing).toContainText(
			`Không tìm thấy gói dữ liệu ${prefix} trên thiết bị này.`,
		);
		await expect(page.getByTestId("plan-result")).toHaveCount(0);
		await checkPage(page);
		const [chooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			missing
				.getByRole("button", { name: "Đính kèm gói dữ liệu (.json)" })
				.click(),
		]);
		await chooser.setFiles(GOLDEN_PACK);
		const result = page.getByTestId("plan-result");
		await expect(result).toBeVisible();
		await expect(page.getByTestId("plan-pack-missing")).toHaveCount(0);
		await expect(result.getByTestId("plan-summary")).toHaveText(
			"Kế hoạch chưa hợp lệ: 1 lỗi, 0 lưu ý.",
		);
		await expect(
			issue(page, "section_missing:7").getByTestId("plan-issue-message"),
		).toHaveText("Thiếu mục 7: Lịch khuyến mãi.");
		await expect(result.getByTestId("plan-sample")).toBeVisible();
		await expectSaveDisabled(page);
		await result
			.getByRole("button", { name: "Sao chép danh sách lỗi" })
			.click();
		await expect(result.getByTestId("plan-copy-status")).toHaveText(
			"Đã sao chép danh sách. Dán vào khung chat để trợ lý sửa kế hoạch.",
		);
		expect(await clipboardText(page)).toBe(
			[
				`Kết quả kiểm tra kế hoạch với gói dữ liệu ${prefix}: 1 lỗi, 0 lưu ý. Hãy sửa rồi gửi lại toàn bộ kế hoạch.`,
				"- Cả kế hoạch · Lỗi · section_missing:7: Thiếu mục 7: Lịch khuyến mãi.",
			].join("\n"),
		);
		const copy = result.getByRole("button", {
			name: "Sao chép danh sách lỗi",
		});
		expect((await copy.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
		await checkPage(page);

		await pasteAndCheck(page, await readFile(UNKNOWN_KPI, "utf8"));
		await expect(page.getByTestId("plan-pack-missing")).toHaveCount(0);
		await expect(result.getByTestId("plan-summary")).toHaveText(
			"Kế hoạch chưa hợp lệ: 1 lỗi, 0 lưu ý.",
		);
		const unknown = issue(page, "kpi_unknown:net_sales");
		await expect(unknown.getByTestId("plan-issue-message")).toHaveText(
			"KPI “net_sales” không có trong danh mục chỉ số.",
		);
		await expect(unknown.getByTestId("plan-issue-line")).toHaveText(
			/^Dòng \d+$/,
		);
		await expectSaveDisabled(page);
		const text = (await page.locator("main").textContent()) ?? "";
		expect(RAW_PLAN_KEY.test(text)).toBe(false);
		await checkPage(page);
	});
	expectNoConsoleErrors(page);
});

test("a file that is not a pack is refused, and a pack built on the pack tab checks its sample plan as valid", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/ke-hoach/dan");
	await pasteAndCheck(page, await readFile(MISSING_SECTION, "utf8"));
	const missing = page.getByTestId("plan-pack-missing");
	await missing.getByTestId("plan-pack-file").setInputFiles({
		name: "goi-du-lieu.json",
		mimeType: "application/json",
		buffer: Buffer.from("{}"),
	});
	await expect(missing.getByTestId("plan-pack-refused")).toContainText(
		"Tệp này không phải gói dữ liệu hợp lệ nên chưa được dùng.",
	);
	await expect(page.getByTestId("plan-result")).toHaveCount(0);
	await checkPage(page);

	await page.goto("/#/xuat-du-lieu?tab=goi");
	await page
		.getByTestId("pack-form")
		.getByRole("button", { name: "Tạo gói", exact: true })
		.click();
	const built = page.getByTestId("pack-result");
	await expect(built).toBeVisible({ timeout: BUILD_TIMEOUT });
	const [file] = await Promise.all([
		page.waitForEvent("download"),
		built.getByRole("link", { name: "Tải gói dữ liệu cho AI" }).click(),
	]);
	const parsed = await parsePack(await readFile(await file.path(), "utf8"));
	if (parsed.pack === null)
		throw new Error("the downloaded file is not a pack");
	await built
		.getByTestId("pack-steps")
		.getByRole("link", { name: "Dán kế hoạch" })
		.click();
	await expect(page).toHaveURL(/#\/ke-hoach\/dan$/);
	await pasteAndCheck(page, samplePlan(parsed.pack));
	const result = page.getByTestId("plan-result");
	await expect(result).toHaveAttribute("data-ok", "true");
	await expect(result.getByTestId("plan-summary")).toHaveText(
		/^Kế hoạch hợp lệ: 10 mục, 5 sáng kiến, \d+ trích dẫn đúng, 3 KPI\.$/,
	);
	await expect(result.getByTestId("plan-pack")).toContainText(
		parsed.pack.pack_id.slice(0, 8),
	);
	await expect(page.getByTestId("plan-pack-missing")).toHaveCount(0);
	await expect(result.getByTestId("plan-issues")).toHaveCount(0);
	await expectSaveDisabled(page);
	await checkPage(page);
	expectNoConsoleErrors(page);
});
