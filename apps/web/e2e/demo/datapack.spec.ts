import { readFile } from "node:fs/promises";
import { chatBundle, type DataPack, parsePack } from "@fnb/datapack";
import { checkPage } from "../support/checks";
import { clipboardText } from "../support/clipboard";
import { type Download, expect, type Page, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
	watchConsoleErrors,
} from "../support/reports";

const RAW_EXPORT_KEY = /\bexports\.[a-z]+/;
const BOM = [0xef, 0xbb, 0xbf];
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const FOCUS = "Tăng giá trị hóa đơn buổi chiều";
const BUILD_TIMEOUT = 60_000;

async function expectTab(page: Page, name: string): Promise<void> {
	await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

interface DownloadedPack {
	readonly text: string;
	readonly pack: DataPack;
	readonly packId: string;
}

async function bytesOf(download: Download): Promise<string> {
	const bytes = new Uint8Array(await readFile(await download.path()));
	expect([...bytes.slice(0, 3)]).not.toEqual(BOM);
	return strictUtf8.decode(bytes);
}

async function readPack(download: Download): Promise<DownloadedPack> {
	const text = await bytesOf(download);
	const parsed = await parsePack(text);
	expect(parsed.issues).toEqual([]);
	expect(parsed.valid).toBe(true);
	if (parsed.pack === null || parsed.packId === null) {
		throw new Error("the downloaded file is not a pack");
	}
	expect(download.suggestedFilename()).toBe(
		`goi-du-lieu_${parsed.pack.request.as_of}_tat-ca_${parsed.packId.slice(0, 8)}.json`,
	);
	return { text, pack: parsed.pack, packId: parsed.packId };
}

async function buildPack(page: Page, button: string): Promise<void> {
	await expectNoExternalRequests(page, async () => {
		await page
			.getByTestId("pack-form")
			.getByRole("button", { name: button, exact: true })
			.click();
		await expect(page.getByTestId("pack-result")).toBeVisible({
			timeout: BUILD_TIMEOUT,
		});
	});
}

async function download(page: Page, link: string): Promise<DownloadedPack> {
	const [file] = await Promise.all([
		page.waitForEvent("download"),
		page.getByTestId("pack-result").getByRole("link", { name: link }).click(),
	]);
	return readPack(file);
}

test("Xuất dữ liệu opens on the pack tab, tells the demo has no invoices to export, stays local and passes axe at 360 and 1280 px", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await expectNoExternalRequests(page, async () => {
		await page.goto("/#/xuat-du-lieu");
		await expect(
			page.getByRole("heading", { level: 1, name: "Xuất dữ liệu" }),
		).toBeVisible();
		await expectTab(page, "Gói dữ liệu cho AI");
		await expect(page.getByTestId("pack-form")).toBeVisible();
		await checkPage(page);
		await page
			.getByTestId("exports-tabs")
			.getByRole("link", { name: "Xuất dữ liệu", exact: true })
			.click();
		await expect(page).toHaveURL(/#\/xuat-du-lieu\?tab=xuat$/);
		await expectTab(page, "Xuất dữ liệu");
		await expect(page.getByTestId("exports-demo-notice")).toHaveText(
			/Bản demo không có dữ liệu hóa đơn thật để xuất\./,
		);
		await expect(page.getByTestId("export-form")).toHaveCount(0);
		await checkPage(page);
		await page.getByRole("link", { name: "Xem gói dữ liệu cho AI" }).click();
		await expectTab(page, "Gói dữ liệu cho AI");
		await expect(page.getByTestId("pack-form")).toBeVisible();
	});
	expectNoConsoleErrors(page);
});

test("the export tab reads in English without raw keys and its links reach 44 px", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/xuat-du-lieu?tab=xuat");
	await expect(page.getByTestId("exports-demo-notice")).toBeVisible();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	try {
		await expect(
			page.getByRole("heading", { level: 1, name: "Export data" }),
		).toBeVisible();
		await expect(page.getByTestId("exports-demo-notice")).toHaveText(
			/The demo has no real invoices to export\./,
		);
		const text = (await page.locator("main").textContent()) ?? "";
		expect(RAW_EXPORT_KEY.test(text)).toBe(false);
		for (const link of await page
			.getByTestId("exports-tabs")
			.getByRole("link")
			.all()) {
			const box = await link.boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}
		await checkPage(page);
	} finally {
		await page.getByRole("button", { name: "VI", exact: true }).click();
	}
	expectNoConsoleErrors(page);
});

test("the pack tab builds the demo's sample pack from the address, summarises it with its missing inputs, downloads it byte for byte and copies the prompt with the same pack", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	watchConsoleErrors(page);
	await page.goto(
		`/#/xuat-du-lieu?tab=goi&horizon=30d&lang=vi&focus=${encodeURIComponent(FOCUS)}`,
	);
	const form = page.getByTestId("pack-form");
	await expect(form.getByRole("radio", { name: "30 ngày" })).toBeChecked();
	await expect(form.getByRole("radio", { name: "Tiếng Việt" })).toBeChecked();
	await expect(form.getByLabel("Trọng tâm")).toHaveValue(FOCUS);
	await expect(
		form.getByTestId("pack-stores-field").getByRole("listitem"),
	).toHaveText(["Cửa hàng mẫu 1", "Cửa hàng mẫu 2"]);
	await expect(form.getByRole("checkbox")).toHaveCount(0);
	await buildPack(page, "Tạo gói");
	const result = page.getByTestId("pack-result");
	await expect(result.getByTestId("pack-summary")).toContainText("dữ liệu mẫu");
	await expect(result.getByTestId("pack-table-count")).toHaveText("20 bảng");
	await expect(result.getByTestId("pack-totals-only")).toBeVisible();
	await result.getByTestId("pack-tables").locator("summary").click();
	await expect(
		result.getByTestId("pack-tables").getByRole("listitem"),
	).toHaveCount(20);
	const downloaded = await download(page, "Tải gói dữ liệu cho AI");
	expect(downloaded.pack.sample).toBe(true);
	expect(downloaded.pack.request.stores).toEqual([
		{ id: "MOCK-S1", label: "S1" },
		{ id: "MOCK-S2", label: "S2" },
	]);
	expect(downloaded.pack.request.horizon).toBe("30d");
	expect(downloaded.pack.request.language).toBe("vi");
	expect(downloaded.pack.request.focus).toBe(FOCUS);
	expect(downloaded.pack.budget.estimated_tokens).toBeLessThanOrEqual(30_000);
	await expect(result.getByTestId("pack-id")).toHaveText(
		downloaded.packId.slice(0, 8),
	);
	await expect(result.getByTestId("pack-as-of-day")).toHaveText(
		downloaded.pack.request.as_of.split("-").reverse().join("/"),
	);

	await result.getByRole("button", { name: "Sao chép gói + prompt" }).click();
	await expect(result.getByTestId("pack-copy-status")).toHaveText(
		"Đã sao chép lời nhắc và gói dữ liệu. Dán vào khung chat của trợ lý.",
	);
	const copied = await clipboardText(page);
	expect(copied.startsWith("# Lời nhắc chiến lược fnb-strategy\n")).toBe(true);
	expect(copied).toBe(chatBundle(downloaded.pack));
	await expect(page.getByTestId("pack-copy-dialog")).toHaveCount(0);

	for (const control of [
		result.getByRole("link", { name: "Tải gói dữ liệu cho AI" }),
		result.getByRole("button", { name: "Sao chép gói + prompt" }),
		result.getByTestId("pack-tables").locator("summary"),
	]) {
		const box = await control.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
	}
	await expect(
		result
			.getByTestId("pack-steps")
			.getByRole("link", { name: "Dán kế hoạch" }),
	).toHaveAttribute("href", "#/ke-hoach/dan");
	await checkPage(page);

	const target = result.locator('[data-gap="target"][data-scope="S2"]');
	await expect(target).toContainText("S2 · Cửa hàng mẫu 2");
	await expect(target).toContainText("Chưa có mục tiêu doanh thu");
	await target.getByRole("link", { name: "Đặt mục tiêu tháng" }).click();
	await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=muc-tieu$/);
	expectNoConsoleErrors(page);
});

test("the manual-copy dialog when the clipboard permission is denied offers the text selected and a working download", async ({
	page,
	context,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/xuat-du-lieu?tab=goi");
	const cdp = await context.newCDPSession(page);
	await cdp.send("Browser.setPermission", {
		permission: { name: "clipboard-write" },
		setting: "denied",
	});
	await buildPack(page, "Tạo gói");
	const pack = await download(page, "Tải gói dữ liệu cho AI");
	const result = page.getByTestId("pack-result");
	const copy = result.getByRole("button", { name: "Sao chép gói + prompt" });
	await copy.click();
	const dialog = page.getByRole("dialog", { name: "Sao chép thủ công" });
	await expect(dialog).toBeVisible();
	await expect(result.getByTestId("pack-copy-status")).toHaveText(
		"Trình duyệt không cho sao chép tự động. Hãy sao chép trong hộp vừa mở.",
	);
	const box = dialog.getByRole("textbox", { name: "Gói dữ liệu kèm lời nhắc" });
	await expect(box).toBeFocused();
	await expect(box).toHaveJSProperty("readOnly", true);
	expect(await box.inputValue()).toBe(chatBundle(pack.pack));
	expect(
		await box.evaluate((element) => {
			const area = element as HTMLTextAreaElement;
			return [area.selectionStart, area.selectionEnd, area.value.length];
		}),
	).toEqual([0, chatBundle(pack.pack).length, chatBundle(pack.pack).length]);
	const [file] = await Promise.all([
		page.waitForEvent("download"),
		dialog.getByRole("link", { name: "Tải văn bản này" }).click(),
	]);
	expect(file.suggestedFilename()).toBe(
		`goi-du-lieu-kem-prompt_${pack.pack.request.as_of}_tat-ca_${pack.packId.slice(0, 8)}.txt`,
	);
	expect(await bytesOf(file)).toBe(chatBundle(pack.pack));
	for (const control of [
		dialog.getByRole("link", { name: "Tải văn bản này" }),
		dialog.getByRole("button", { name: "Đóng" }),
	]) {
		const height = (await control.boundingBox())?.height ?? 0;
		expect(height).toBeGreaterThanOrEqual(44);
	}
	await checkPage(page);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(copy).toBeFocused();
	await copy.click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Đóng" }).click();
	await expect(dialog).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("the pack tab reads in English, builds an English pack and refuses a phone number in the focus before reading", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	watchConsoleErrors(page);
	await page.goto("/#/xuat-du-lieu?tab=goi");
	await expect(page.getByTestId("pack-form")).toBeVisible();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	try {
		const form = page.getByTestId("pack-form");
		await expect(
			page.getByRole("heading", { level: 2, name: "AI data pack" }),
		).toBeVisible();
		await form.getByLabel("Focus").fill("Call me on 0901 234 567");
		await form
			.getByRole("button", { name: "Build the pack", exact: true })
			.click();
		const failed = page.getByTestId("pack-failed");
		await expect(failed).toContainText(
			"The focus or the note seems to hold an e-mail address, a phone number",
		);
		await expect(failed).toContainText("Error code: pack_text_contact_details");
		await form.getByLabel("Focus").fill("");
		await form.getByRole("radio", { name: "English" }).check();
		const text = (await page.locator("main").textContent()) ?? "";
		expect(RAW_EXPORT_KEY.test(text)).toBe(false);
		await buildPack(page, "Build the pack");
		const result = page.getByTestId("pack-result");
		await expect(result.getByTestId("pack-language")).toHaveText("English");
		await expect(result.getByTestId("pack-summary")).toContainText(
			"the demo's sample data",
		);
		const downloaded = await download(page, "Download the AI data pack");
		expect(downloaded.pack.request.language).toBe("en");
		expect(downloaded.pack.request.focus).toBeNull();
		await result.getByRole("button", { name: "Copy pack + prompt" }).click();
		const copied = await clipboardText(page);
		expect(copied.startsWith("# Strategy prompt fnb-strategy\n")).toBe(true);
		expect(copied).toBe(chatBundle(downloaded.pack));
		const resultText = (await result.textContent()) ?? "";
		expect(RAW_EXPORT_KEY.test(resultText)).toBe(false);
		await checkPage(page);
	} finally {
		await page.getByRole("button", { name: "VI", exact: true }).click();
	}
	expectNoConsoleErrors(page);
});
