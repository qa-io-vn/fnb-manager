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

async function expectSaveDisabled(
	page: Page,
	note = "Sửa các lỗi rồi kiểm tra lại trước khi lưu. Lưu ý không chặn việc lưu.",
): Promise<void> {
	await expect(
		page.getByRole("button", { name: "Lưu kế hoạch", exact: true }),
	).toBeDisabled();
	await expect(page.getByTestId("plan-save-note")).toHaveText(note);
}

test("Kế hoạch lists the automatic sample plan with its badges and KPI summary, leads to the paste box and passes axe at 360 and 1280 px", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await expectNoExternalRequests(page, async () => {
		await page.goto("/#/ke-hoach");
		await expect(
			page.getByRole("heading", { level: 1, name: "Kế hoạch" }),
		).toBeVisible();
		const card = page.getByTestId("plan-card").first();
		await expect(card).toBeVisible({ timeout: BUILD_TIMEOUT });
		await expect(card).toContainText("Kế hoạch mẫu, tạo tự động để minh họa");
		await expect(card.getByTestId("plan-version")).toHaveText("Bản 1");
		await expect(card.getByTestId("plan-via")).toHaveText("Dán");
		await expect(card.getByTestId("plan-follow-up")).toHaveText(
			/^\d+\/3 KPI đúng tiến độ$/,
			{ timeout: BUILD_TIMEOUT },
		);
		await checkPage(page);
		await page.getByRole("link", { name: "Dán kế hoạch" }).first().click();
		await expect(page).toHaveURL(/#\/ke-hoach\/dan$/);
		await expect(
			page.getByRole("heading", { level: 1, name: "Dán kế hoạch" }),
		).toBeVisible();
	});
	expectNoConsoleErrors(page);
});

test("the sample plan opens with chips from its pack, a KPI table with live values, a matching pack id, KPI cards at 360 px, and prints", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/ke-hoach");
	await page.getByTestId("plan-card").first().getByRole("link").first().click();
	await expect(page).toHaveURL(/#\/ke-hoach\/[0-9a-f-]{36}$/);
	const detail = page.getByTestId("plan-detail");
	await expect(detail.getByTestId("plan-pack-badge")).toHaveText("Mã gói khớp");
	await expect(detail.getByTestId("kpi-row")).toHaveCount(3, {
		timeout: BUILD_TIMEOUT,
	});
	await expect(detail.getByTestId("kpi-current").first()).not.toHaveText("—");
	await expect(detail.getByTestId("kpi-baseline").first()).not.toContainText(
		"≠",
	);
	const chips = detail.getByTestId("plan-cite");
	expect(await chips.count()).toBeGreaterThan(5);
	await expect(
		detail.locator("[data-testid=plan-cite][data-resolved=false]"),
	).toHaveCount(0);
	await expect(detail.getByTestId("plan-lint-note")).toContainText("0 lỗi");
	await expect(detail.getByTestId("plan-actions")).toBeVisible();
	await checkPage(page);
	await page.setViewportSize({ width: 360, height: 800 });
	await expect(detail.getByTestId("kpi-card").first()).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.emulateMedia({ media: "print" });
	await expect(detail.getByTestId("kpi-table")).toBeVisible();
	await expect(detail.getByTestId("plan-actions")).toBeHidden();
	await page.emulateMedia({ media: "screen" });
	expectNoConsoleErrors(page);
});

test("a pasted plan with injected HTML saves for the session, renders the HTML as text, compares with the sample plan, archives and deletes", async ({
	page,
}) => {
	watchConsoleErrors(page);
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
	const injected = samplePlan(parsed.pack)
		.replace(
			'Kế hoạch mẫu, tạo tự động để minh họa",',
			'Kế hoạch thử của phiên",',
		)
		.concat(
			'\n<img src=x onerror="window.__planXss = 1">\n\n<script>window.__planXss = 2</script>\n\n[bấm vào đây](javascript:window.__planXss=3)\n',
		);
	await page.goto("/#/ke-hoach/dan");
	await pasteAndCheck(page, injected);
	await expect(page.getByTestId("plan-result")).toHaveAttribute(
		"data-ok",
		"true",
	);
	await expect(page.getByTestId("plan-preview")).toBeVisible();
	await expect(page.getByTestId("plan-demo-note")).toBeVisible();
	const save = page.getByRole("button", { name: "Lưu kế hoạch", exact: true });
	await expect(save).toBeEnabled();
	await expectNoExternalRequests(page, async () => {
		await save.click();
		await expect(page).toHaveURL(/#\/ke-hoach\/[0-9a-f-]{36}$/);
	});
	const detail = page.getByTestId("plan-detail");
	await expect(detail.getByTestId("plan-saved-note")).toHaveText(
		"Đã lưu kế hoạch.",
	);
	const body = detail.getByTestId("plan-body");
	await expect(body).toContainText("bấm vào đây");
	await expect(body.locator("img, script, a")).toHaveCount(0);
	expect(
		await page.evaluate(
			() => (window as unknown as { __planXss?: number }).__planXss,
		),
	).toBeUndefined();
	const savedUrl = page.url();

	await page.goto("/#/ke-hoach/dan");
	await pasteAndCheck(page, injected);
	await page.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();
	await expect(page.getByTestId("plan-saved-note")).toHaveText(
		"Kế hoạch này đã được lưu.",
	);
	expect(page.url()).toBe(savedUrl);

	await page.getByTestId("plan-compare").click();
	await expect(page).toHaveURL(/#\/ke-hoach\/so-sanh\?a=.+&b=.+$/);
	await expect(page.getByTestId("compare-header")).toHaveCount(2);
	await expect(page.getByTestId("compare-kpi").first()).toHaveAttribute(
		"data-change",
		"kept",
	);
	await expect(
		page.getByTestId("compare-initiatives").locator("li"),
	).not.toHaveCount(0);
	await checkPage(page);
	await page.reload();
	await expect(page.getByTestId("compare-header")).toHaveCount(2, {
		timeout: BUILD_TIMEOUT,
	});

	await page.goto(savedUrl);
	await page.getByTestId("plan-archive").click();
	await expect(page.getByTestId("plan-archive")).toHaveText("Bỏ lưu trữ");
	await page.goto("/#/ke-hoach");
	await expect(page.getByTestId("plan-card")).toHaveCount(1, {
		timeout: BUILD_TIMEOUT,
	});
	await page.getByTestId("plans-show-archived").check();
	await expect(page.getByTestId("plan-card")).toHaveCount(2);
	await page.goto(savedUrl);
	await page.getByTestId("plan-delete").click();
	await page.getByTestId("plan-delete-confirm").click();
	await expect(page).toHaveURL(/#\/ke-hoach$/);
	await page.getByTestId("plans-show-archived").check();
	await expect(page.getByTestId("plan-card")).toHaveCount(1);
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
	await expectSaveDisabled(page, "Kiểm tra kế hoạch trước khi lưu.");
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

test("a file that is not a pack is refused, and a pack built on the pack tab checks its sample plan as valid and lets the demo owner save it", async ({
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
	await expect(
		page.getByRole("button", { name: "Lưu kế hoạch", exact: true }),
	).toBeEnabled();
	await checkPage(page);
	expectNoConsoleErrors(page);
});
