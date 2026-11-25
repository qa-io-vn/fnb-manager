import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	openTab,
	PROGRAMME,
	watchCustomerPage,
} from "./customer-checks";

// Test design (ISTQB): use-case tests of the redesigned home on a themed brand (synthetic brand-2, ADR-056) built for
// Development, in light, dark and on WebKit as an iPhone. Equivalence partitions of the customer, a visitor, a member, a
// shop without a programme; a state-transition test of the sign-in, refused -> retried -> signed in, the failure a
// wrong Zalo App secret in the cloud gave on the owner's phone (G-109); boundary of the banner, edge to edge, and of the
// first card, over the banner. Every screen also passes the shared checks: targets of at least 44 x 44 px, no serious
// axe violation (colour contrast included), no outbound link, no price and no console error.

const STAMPS_PER_CARD = 10;
const WORDMARK = "QMH";
const TAGLINE = "Quán mẫu thứ hai, chỉ để thử.";
const UNKNOWN_FAILURE = "Chưa tải được dữ liệu. Hãy thử lại sau ít phút.";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

async function box(locator: Locator) {
	const found = await locator.boundingBox();
	if (found === null) throw new Error("the element has no box on screen");
	return found;
}

async function filledCups(cups: Locator): Promise<number> {
	return cups.locator("[data-on=true]").count();
}

async function expectBanner(page: Page): Promise<void> {
	const banner = page.getByTestId("brand-banner");
	await expect(banner).toBeVisible();
	await expect(banner.getByTestId("brand-wordmark")).toHaveText(WORDMARK);
	await expect(banner.getByText(TAGLINE)).toBeVisible();
	// edge to edge: the banner starts at the left edge and spans the viewport
	const width = page.viewportSize()?.width ?? 0;
	const banned = await box(banner);
	expect(Math.round(banned.x)).toBe(0);
	expect(Math.round(banned.width)).toBe(width);
}

test("a visitor's home: the brand banner with a greeting, the programme card over it, an empty cup card and the rules on demand", async ({
	page,
}) => {
	await page.goto("./");
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await expectBanner(page);
	await expect(page.getByTestId("greeting")).toHaveText("Xin chào, Khách thử!");

	const card = page.getByTestId("programme");
	// the first card overlaps the banner's lower edge
	const banner = await box(page.getByTestId("brand-banner"));
	expect((await box(card)).y).toBeLessThan(banner.y + banner.height);

	const cups = card.getByTestId("cup-row");
	await expect(cups.locator("[data-on]")).toHaveCount(STAMPS_PER_CARD);
	expect(await filledCups(cups)).toBe(0);
	await expect(card.getByTestId("home-stamps")).toHaveCount(0);
	await expect(page.getByTestId("shortcuts")).toHaveCount(0);

	// the rules are closed, open on a tap and close again
	const rules = card.getByText("Thể lệ chương trình");
	const period = card.getByTestId("programme-period");
	await expect(period).toBeHidden();
	await rules.click();
	await expect(period).toBeVisible();
	await rules.click();
	await expect(period).toBeHidden();

	await expect(
		card.getByRole("button", { name: "Tham gia thành viên" }),
	).toBeVisible();
	await checkCustomerScreen(page);
});

test("a member's home: their stamps as cups, the same count as the member card, and three shortcuts that open their screens", async ({
	page,
}) => {
	await page.goto("./?member=1&vouchers=1");
	const stamps = page.getByTestId("home-stamps");
	await expect(stamps).toBeVisible();
	await expect(page.getByTestId("member-badge")).toHaveText(
		"Bạn đã là thành viên.",
	);
	const filled = await filledCups(stamps.getByTestId("cup-row"));
	expect(filled).toBeGreaterThan(0);
	expect(filled).toBeLessThan(STAMPS_PER_CARD);
	await expect(page.getByTestId("home-stamps-left")).toHaveText(
		`Đã có ${filled}/${STAMPS_PER_CARD}: thêm ${STAMPS_PER_CARD - filled} ly nữa là có quà`,
	);
	await checkCustomerScreen(page);

	// the member card tab counts the same stamps
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("stamp-count").first()).toHaveText(
		`${filled}/${STAMPS_PER_CARD} dấu`,
	);
	await openTab(page, "Trang chủ");

	const shortcuts = page.getByTestId("shortcuts");
	await expect(shortcuts.getByRole("button")).toHaveText([
		"Mã thành viên",
		"Đổi quà",
		"Ví voucher",
	]);
	for (const [name, screen] of [
		["Mã thành viên", "member-code-screen"],
		["Đổi quà", "rewards-screen"],
		["Ví voucher", "vouchers-screen"],
	] as const) {
		await shortcuts.getByRole("button", { name }).click();
		await expect(page.getByTestId(screen)).toBeVisible();
		await page.getByRole("button", { name: "Quay lại" }).first().click();
		await expect(shortcuts).toBeVisible();
	}
});

test("a shop without a programme: the card says it is coming soon and joining waits", async ({
	page,
}) => {
	await page.goto("./?programme=none");
	const card = page.getByTestId("programme");
	await expect(card.getByText("Sắp ra mắt")).toBeVisible();
	await expect(
		card.getByText("Quán chưa mở chương trình thành viên."),
	).toBeVisible();
	await expect(card.getByTestId("cup-row").locator("[data-on]")).toHaveCount(6);
	await expect(card.getByTestId("join-closed")).toBeVisible();
	await checkCustomerScreen(page);
});

test("a store card says whether the store is open today, where it is, and opens its page", async ({
	page,
}) => {
	await page.goto("./");
	const first = page.getByTestId("store-list").getByRole("button").first();
	await expect(first).toContainText("Cửa hàng Mẫu 1");
	// the clock is a Thursday at 10:00, inside the store's hours
	await expect(first.locator("[data-hours=open]")).toHaveText(
		"Hôm nay mở cửa 07:00–22:00",
	);
	await expect(first).toContainText("12 Đường Số 1");
	await first.click();
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 1" }),
	).toBeVisible();
});

test("while the first answer is on its way, card-shaped placeholders and the loading line show under the banner", async ({
	page,
}) => {
	await page.goto("./?dataDelay=1500");
	await expect(page.getByTestId("home-skeleton")).toBeVisible();
	await expect(page.getByRole("status")).toHaveText("Đang tải…");
	await expect(page.getByTestId("brand-banner")).toBeVisible();
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await expect(page.getByTestId("home-skeleton")).toHaveCount(0);
});

test("a sign-in the cloud refuses (zalo_token_refused) shows the message, the failing step's code and one retry, under the banner", async ({
	page,
}) => {
	await page.goto("./?session=refused");
	const failed = page.getByTestId("failed");
	await expect(failed.getByRole("alert")).toHaveText(UNKNOWN_FAILURE);
	await expect(failed.getByTestId("failed-detail")).toHaveText(
		"session 401 zalo_token_refused",
	);
	await expect(failed.getByRole("button")).toHaveCount(1);
	await expectBanner(page);
	await expect(page.getByRole("heading", { name: PROGRAMME })).toHaveCount(0);
	await checkCustomerScreen(page);
	// refused again on the retry: the same failure stays, nothing else appears
	await failed.getByRole("button", { name: "Thử lại" }).click();
	await expect(failed.getByTestId("failed-detail")).toHaveText(
		"session 401 zalo_token_refused",
	);
	await expect(page.getByRole("heading", { name: PROGRAMME })).toHaveCount(0);
});

test("once the cloud accepts the sign-in again, Thử lại loads the home and the failure is gone", async ({
	page,
}) => {
	await page.goto("./?session=refused-once");
	const failed = page.getByTestId("failed");
	await expect(failed.getByTestId("failed-detail")).toHaveText(
		"session 401 zalo_token_refused",
	);
	await failed.getByRole("button", { name: "Thử lại" }).click();
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await expect(page.getByTestId("failed")).toHaveCount(0);
	await checkCustomerScreen(page);
});
