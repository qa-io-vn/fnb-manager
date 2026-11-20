import { isExcludedDay, VIETNAM_HOLIDAYS } from "@fnb/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeCodeOf } from "../../src/settings/source";
import { createSupabaseSettingsSource } from "../../src/settings/supabase-settings-source";
import { isLocalStackConfigured } from "../support/local-stack";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	type ExpectedConsoleError,
	expectNoConsoleErrors,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";
import { openSettings, saveSettings, settingsNav } from "../support/settings";
import {
	createSettingsFixture,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const DUPLICATE_CODE_REFUSAL: ExpectedConsoleError = {
	text: /status of 409/,
	url: /\/rest\/v1\/stores\?/,
	atMost: 1,
};

const DATE_AND_TIME = String.raw`\d{2}/\d{2}/\d{4} lúc \d{2}:\d{2}`;

let fixture: SettingsFixture | undefined;
const clients: SupabaseClient[] = [];

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

async function clientAs(role: SettingsRole): Promise<SupabaseClient> {
	const client = await created().clientAs(role);
	clients.push(client);
	return client;
}

function storeBlock(page: Page, storeId: string): Locator {
	return page.locator(`[data-testid="store-profile"][data-store="${storeId}"]`);
}

async function openStoresAs(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await created().signIn(page, role);
	await openSettings(page, "cua-hang");
	await expect(page.getByTestId("tenant-profile")).toBeVisible();
	await expect(page.getByText("Đang kiểm tra quyền sửa của bạn…")).toHaveCount(
		0,
	);
}

test.beforeAll(async () => {
	fixture = await createSettingsFixture();
});

test.afterAll(async () => {
	for (const client of clients) await client.auth.signOut();
	await fixture?.teardown();
});

test("the owner saves a store's profile through row-level security and sees the audit line", async ({
	page,
}) => {
	const { tenantId, storeIds } = created();
	await openStoresAs(page, "owner");
	const first = storeBlock(page, storeIds[0]);
	await expect(first.getByTestId("store-pos-name")).toContainText("lấy từ POS");
	await expect(
		first.getByTestId("store-pos-facts").locator("input, select"),
	).toHaveCount(0);
	await expect(first).toContainText(
		/Gợi ý từ dữ liệu: số hóa đơn của \d+ ngày gần nhất bắt đầu lại mỗi ngày/,
	);
	await first.getByLabel("Mã cửa hàng").fill("E1A");
	await first.getByLabel("Số ghế").fill("32");
	await first
		.getByRole("checkbox", { name: "Thứ Hai, nghỉ cả ngày" })
		.uncheck();
	await first
		.getByRole("button", { name: "Thứ Hai: chép sang các ngày khác" })
		.click();
	await first.getByTestId("store-receipts-apply").click();
	await expect(first.getByTestId("settings-save-bar-pending")).toHaveText(
		"4 thay đổi chưa lưu",
	);
	await saveSettings(first.getByTestId("settings-save-bar"));
	await expect(first.getByTestId("settings-audit-line")).toHaveText(
		new RegExp(`^Bạn sửa lần cuối ${DATE_AND_TIME}\\.$`),
	);
	const second = storeBlock(page, storeIds[1]);
	await second.getByLabel("Mã cửa hàng").fill("e1a");
	await second.getByRole("button", { name: "Lưu" }).click();
	await expect(second.getByTestId("settings-save-bar-status")).toHaveText(
		"Không lưu được: mã này đã dùng cho một cửa hàng khác của chuỗi.",
	);
	const source = createSupabaseSettingsSource(await clientAs("owner"));
	const [saved] = (await source.storeProfiles(tenantId)).filter(
		(profile) => profile.storeId === storeIds[0],
	);
	expect(saved).toMatchObject({
		code: "E1A",
		seatCount: 32,
		tranNoResetPeriod: "daily",
		openingHours: expect.objectContaining({ sun: [["07:00", "22:00"]] }),
	});
	expect(saved?.audit?.author).toEqual({ kind: "you" });
	expectNoConsoleErrors(page, [DUPLICATE_CODE_REFUSAL]);
});

test("a manager sees the opening hours read-only with the owner-only reason and saves the rest of the store", async ({
	page,
}) => {
	const { tenantId, storeIds } = created();
	await openStoresAs(page, "manager");
	const first = storeBlock(page, storeIds[0]);
	await expect(first.getByTestId("settings-audit-line")).toHaveText(
		new RegExp(`^Sửa lần cuối ${DATE_AND_TIME}, bởi chủ\\.$`),
	);
	await expect(first.getByTestId("store-hours-read-only")).toHaveText(
		"Chỉ chủ cửa hàng mới đổi được giờ mở cửa, vì giờ mở cửa quyết định cảnh báo và lịch đồng bộ.",
	);
	await expect(first.getByTestId("opening-hours-add")).toHaveCount(0);
	await expect(
		first.getByRole("checkbox", { name: "Thứ Hai, nghỉ cả ngày" }),
	).toBeDisabled();
	await expect(page.getByTestId("tenant-profile")).toContainText(
		"Chỉ chủ xem được tất cả cửa hàng mới đổi được loại hình pháp lý",
	);
	await expect(
		page.getByTestId("tenant-profile").getByTestId("settings-save-bar"),
	).toHaveCount(0);
	await first.getByLabel("Số ghế").fill("36");
	await saveSettings(first.getByTestId("settings-save-bar"));
	await expect(first.getByTestId("settings-audit-line")).toHaveText(
		new RegExp(`^Bạn sửa lần cuối ${DATE_AND_TIME}\\.$`),
	);
	const managerSource = createSupabaseSettingsSource(await clientAs("manager"));
	const refused = await managerSource
		.updateStoreProfile(tenantId, storeIds[0], { openingHours: null })
		.then(
			() => "saved",
			(error: unknown) => writeCodeOf(error),
		);
	expect(refused).toBe("forbidden");
	expectNoConsoleErrors(page);
});

test("a store-limited manager sees and changes only the store in scope", async ({
	page,
}) => {
	const { storeIds } = created();
	await openStoresAs(page, "store-manager");
	await expect(page.getByTestId("store-profile")).toHaveCount(1);
	await expect(storeBlock(page, storeIds[0])).toBeVisible();
	await expect(
		storeBlock(page, storeIds[0]).getByTestId("settings-save-bar"),
	).toBeVisible();
	expectNoConsoleErrors(page);
});

function daysBefore(date: string, days: number): string {
	const shifted = new Date(`${date}T00:00:00Z`);
	shifted.setUTCDate(shifted.getUTCDate() - days);
	return shifted.toISOString().slice(0, 10);
}

const BASELINE_WEEKS = [1, 2, 3, 4] as const;

function baselinePlan(sales: { readonly from: string; readonly to: string }): {
	readonly reportDay: string;
	readonly sampleDay: string;
} {
	for (let back = 0; back < 7; back += 1) {
		const reportDay = daysBefore(sales.to, back);
		const samples = BASELINE_WEEKS.map((week) =>
			daysBefore(reportDay, 7 * week),
		).filter(
			(day) => day >= sales.from && !isExcludedDay(VIETNAM_HOLIDAYS, day),
		);
		const [sampleDay] = samples;
		if (sampleDay !== undefined && samples.length >= 2) {
			return { reportDay, sampleDay };
		}
	}
	throw new Error(
		"no day of the fixture's sales has two same-weekday samples outside the national calendar",
	);
}

async function baselineWeeks(page: Page): Promise<number> {
	const chip = page
		.getByTestId("card-day-net_revenue")
		.getByTestId("comparison-chip")
		.filter({ hasText: /so với mức nền \(\d\/8 tuần\)/ });
	const text = (await chip.textContent()) ?? "";
	return Number(/\((\d)\/8 tuần\)/.exec(text)?.[1]);
}

test("a day off saved in the browser carries the owner as its author, leaves the day's baseline, and an insert naming someone else is refused", async ({
	page,
}) => {
	const { tenantId, sales, logins } = created();
	const { reportDay, sampleDay } = baselinePlan(sales);
	const name = "Nghỉ thử nghiệm";
	watchConsoleErrors(page);
	await created().signIn(page, "owner");
	await page.goto(`/#/bao-cao/ngay?date=${reportDay}`);
	await waitForSettledCards(page);
	const before = await baselineWeeks(page);
	expect(before).toBeGreaterThanOrEqual(2);
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("link", { name: "Cài đặt" })
		.click();
	await settingsNav(page).getByRole("link", { name: "Ngày lễ" }).click();
	await expect(page.getByTestId("holidays-global")).toBeVisible();
	await page
		.getByLabel("Năm", { exact: true })
		.selectOption(sampleDay.slice(0, 4));
	const form = page.getByTestId("holidays-add");
	await form.getByLabel("Ngày", { exact: true }).fill(sampleDay);
	await form.getByLabel("Tên", { exact: true }).fill(name);
	await form.getByRole("button", { name: "Thêm" }).click();
	await expect(page.getByTestId("holidays-status")).toContainText(
		`Đã thêm ${name}`,
	);
	const row = page
		.getByTestId("holidays-custom")
		.locator(`[data-testid="holiday-row"][data-date="${sampleDay}"]`);
	await expect(row.getByTestId("settings-audit-line")).toHaveText(
		new RegExp(`^Bạn sửa lần cuối ${DATE_AND_TIME}\\.$`),
	);
	const owner = await clientAs("owner");
	const { data: stored, error: readError } = await owner
		.from("holidays")
		.select("id,kind,created_by,updated_by")
		.eq("tenant_id", tenantId)
		.eq("holiday_date", sampleDay);
	expect(readError).toBeNull();
	expect(stored).toEqual([
		{
			id: expect.any(String),
			kind: "custom",
			created_by: logins.owner.userId,
			updated_by: logins.owner.userId,
		},
	]);
	const { error: forged } = await owner.from("holidays").insert({
		tenant_id: tenantId,
		country_code: "VN",
		holiday_date: daysBefore(sales.to, 14),
		name: "Ghi tên người khác",
		kind: "custom",
		created_by: logins.manager.userId,
	});
	expect(forged?.code).toBe("42501");
	await page.goBack();
	await page.goBack();
	await waitForSettledCards(page);
	await expect.poll(() => baselineWeeks(page)).toBe(before - 1);
	await page.goForward();
	await page.goForward();
	await page
		.getByLabel("Năm", { exact: true })
		.selectOption(sampleDay.slice(0, 4));
	await row.getByRole("button", { name: new RegExp(`^Xóa ${name}`) }).click();
	await expect(page.getByTestId("holidays-status")).toContainText(
		`Đã xóa ${name}`,
	);
	const { data: left } = await owner
		.from("holidays")
		.select("id")
		.eq("tenant_id", tenantId);
	expect(left).toEqual([]);
	expectNoConsoleErrors(page);
});

test("after the owner sets the default language to English, a new session of a member without a stored language opens in English", async ({
	page,
	browser,
}) => {
	await openStoresAs(page, "owner");
	const tenant = page.getByTestId("tenant-profile");
	await tenant.getByLabel("Ngôn ngữ mặc định").selectOption("en");
	await tenant.getByRole("button", { name: "Lưu" }).click();
	await expect(
		page.getByRole("heading", { level: 2, name: "Stores" }),
	).toBeVisible();
	await expect(tenant.getByTestId("settings-audit-line")).toContainText(
		"You last changed this on",
	);
	const viewerContext = await browser.newContext();
	try {
		const viewer = await viewerContext.newPage();
		watchConsoleErrors(viewer);
		const login = created().logins.viewer;
		await viewer.goto("/#/dang-nhap");
		await viewer.getByLabel("E-mail").fill(login.email);
		await viewer.getByLabel("Mật khẩu").fill(login.password);
		await viewer.getByRole("button", { name: "Đăng nhập" }).click();
		await expect(
			viewer.getByRole("heading", { level: 1, name: "Today" }),
		).toBeVisible();
		await viewer.getByRole("button", { name: "VI", exact: true }).click();
		await expect(
			viewer.getByRole("heading", { level: 1, name: "Hôm nay" }),
		).toBeVisible();
		await viewer.reload();
		await expect(
			viewer.getByRole("heading", { level: 1, name: "Hôm nay" }),
		).toBeVisible();
		expectNoConsoleErrors(viewer);
	} finally {
		await viewerContext.close();
	}
	expectNoConsoleErrors(page);
});
