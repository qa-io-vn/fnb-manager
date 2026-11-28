// C14 Đơn đã đặt and "Đặt lại" in the ordering build (VITE_ORDERING=on) on the ordering projects: a 360 px phone in
// light and dark, and an iPhone in WebKit (design spec C14, GA-072 to GA-074). The data is the demo world; the test
// stands in for the counter and for the menu changes made since an order through the demo till (DEMO_TILL_GLOBAL).
// ISTQB: use case end to end by keyboard with the names a screen reader reads (Tôi → Lịch sử đơn → filters → "Đặt
// lại" → the basket → the order at today's prices); decision table on the screen (a line sold out, a size gone, an
// option gone; a group required since without a default); state transitions of the basket (holding items → the
// question → closed, added to, replaced); error guessing for the security cases a browser can reach (another
// customer's order by a hand-made route, an order of another store, markup and control characters in the order's
// names and notes, no price taken from the history).
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

const TILL = "__FNB_DEMO_TILL__";
const TABLE = "?store=mau-1&src=table&t=demo-table-12";
const FOREIGN_ORDER = "ffffffff-0000-4000-8000-000000000001";
const ITEMS = {
	milkCoffee: "dddddddd-0000-4000-8000-000000000001",
	blackCoffee: "dddddddd-0000-4000-8000-000000000002",
	lotusTea: "dddddddd-0000-4000-8000-000000000005",
	bananaCake: "dddddddd-0000-4000-8000-000000000006",
} as const;
const SIZES = {
	milkCoffeeL: "eeeeeeee-0000-4000-8000-000000000002",
	blackCoffee: "eeeeeeee-0000-4000-8000-000000000003",
	bacXiuM: "eeeeeeee-0000-4000-8000-000000000004",
	bacXiuL: "eeeeeeee-0000-4000-8000-000000000005",
	peachTea: "eeeeeeee-0000-4000-8000-000000000006",
	lotusTea: "eeeeeeee-0000-4000-8000-000000000007",
	bananaCake: "eeeeeeee-0000-4000-8000-000000000008",
} as const;
const OPTIONS = {
	iceNormal: "bbbbbbbb-0000-4000-8000-000000000001",
	iceLess: "bbbbbbbb-0000-4000-8000-000000000002",
	sweetLess: "bbbbbbbb-0000-4000-8000-000000000005",
	saltCream: "bbbbbbbb-0000-4000-8000-000000000008",
} as const;
const EXTRA_GROUP = "aaaaaaaa-0000-4000-8000-000000000003";
/** a card's name and its "Đặt lại": "Đơn 27/11/2026 09:30, Hoàn thành" */
const DATED = String.raw`(?:Hôm nay|\d\d/\d\d/\d{4}) \d\d:\d\d`;

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

async function pastOrder(page: Page, order: unknown): Promise<string> {
	return String(await till(page, "pastOrder", order));
}

async function checkOrderingScreen(page: Page): Promise<void> {
	await checkMiniAppScreen(page);
	await expectPricesOnlyWhereAllowed(page, { allowed: true });
}

async function openMenu(page: Page): Promise<void> {
	await page.goto(`./${TABLE}`);
	await expect(page.getByTestId("ordering-menu")).toBeVisible();
}

async function openHistory(page: Page): Promise<void> {
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await page.locator("[data-testid=account-row][data-row=orders]").click();
	await expect(page.getByTestId("orders")).toBeVisible();
}

function card(page: Page, orderId: string): Locator {
	return page.getByRole("article").filter({
		has: page.locator(`[data-testid=order-row][data-order-id="${orderId}"]`),
	});
}

/** "Đặt lại" of an order from the keyboard: Tab from the card's link to it, then Enter. */
async function reorderByKeyboard(page: Page, orderId: string): Promise<void> {
	const found = card(page, orderId);
	await found.getByTestId("order-row").focus();
	await page.keyboard.press("Tab");
	const button = found.getByRole("button", {
		name: new RegExp(`^Đặt lại đơn ${DATED}$`),
	});
	await expect(button).toBeFocused();
	await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page, null);
});

test("C14: the history by keyboard, each card named with its date and state, filtered by how it was served (GA-072, GA-074)", async ({
	page,
}) => {
	await openMenu(page);
	const table = await pastOrder(page, {
		lines: [{ size: SIZES.blackCoffee }],
	});
	const takeaway = await pastOrder(page, {
		type: "takeaway",
		daysAgo: 2,
		lines: [{ size: SIZES.peachTea, qty: 2 }],
	});
	const cancelled = await pastOrder(page, {
		status: "cancelled",
		daysAgo: 3,
		lines: [{ size: SIZES.lotusTea }],
	});
	const refunded = await pastOrder(page, {
		status: "refunded",
		daysAgo: 4,
		lines: [{ size: SIZES.bananaCake }],
	});
	await openHistory(page);
	await expect(page.getByTestId("order-row")).toHaveCount(4);
	await expect(card(page, table)).toHaveAccessibleName(
		new RegExp(`^Đơn ${DATED}, Hoàn thành$`),
	);
	await expect(card(page, takeaway)).toContainText("Mang đi");
	await expect(card(page, cancelled)).toHaveAccessibleName(
		new RegExp(`^Đơn ${DATED}, Đã hủy$`),
	);
	await expect(card(page, refunded)).toHaveAccessibleName(
		new RegExp(`^Đơn ${DATED}, Đã hủy · đã hoàn tiền$`),
	);
	await expect(card(page, refunded)).toContainText("Đã hủy · đã hoàn tiền");
	await checkOrderingScreen(page);

	const filters = page.getByRole("group", { name: "Lọc đơn" });
	await filters.getByRole("button", { name: "Mang đi" }).focus();
	await page.keyboard.press("Enter");
	await expect(
		filters.getByRole("button", { name: "Mang đi" }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("order-row")).toHaveCount(1);
	await expect(page.getByTestId("order-row")).toHaveAttribute(
		"data-order-id",
		takeaway,
	);
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Enter");
	await expect(
		filters.getByRole("button", { name: "Tại bàn" }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("order-row")).toHaveCount(3);
	await checkOrderingScreen(page);
});

test("Đặt lại by keyboard: the line sold out is named, the rest goes in the basket at today's prices and the order goes through at them", async ({
	page,
}) => {
	await openMenu(page);
	const id = await pastOrder(page, {
		lines: [
			{
				size: SIZES.milkCoffeeL,
				qty: 2,
				options: [OPTIONS.iceLess, OPTIONS.sweetLess],
				note: "ít ngọt",
				// sold then at another price: never used
				price: 1000,
			},
			{ size: SIZES.bananaCake },
		],
	});
	await till(page, "soldOut", ITEMS.bananaCake, true);
	await till(page, "setPrice", SIZES.milkCoffeeL, 47000);
	await openHistory(page);
	await checkOrderingScreen(page);
	await reorderByKeyboard(page, id);

	const report = page.getByTestId("orders-reorder-partial");
	await expect(report).toHaveText(
		"1 món không còn bán nên không được thêm vào giỏ: Bánh chuối.",
	);
	await expect(report).toBeFocused();
	await expect(page.getByTestId("cart-line")).toHaveCount(1);
	await expect(page.getByTestId("cart-line")).toHaveAttribute(
		"data-item-id",
		ITEMS.milkCoffee,
	);
	await expect(page.getByTestId("cart-line-options")).toHaveText(
		"Lớn · Ít đá · Ít ngọt",
	);
	await expect(page.getByTestId("cart-line-note")).toHaveText("ít ngọt");
	await expect(page.getByTestId("cart-total")).toHaveAttribute(
		"data-price",
		"94000",
	);
	await checkOrderingScreen(page);

	await page.getByTestId("cart-continue").click();
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await expect(page.getByTestId("checkout-total")).toHaveAttribute(
		"data-price",
		"94000",
	);
	await submit.click();
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-status",
		"accepted",
	);
	await expect(page.getByTestId("order-total")).toHaveAttribute(
		"data-price",
		"94000",
	);
	expect(await till(page, "placements")).toBe(1);
});

test("a basket holding items asks first: Escape keeps it as it was, Thêm vào giỏ adds, Thay giỏ replaces", async ({
	page,
}) => {
	await openMenu(page);
	const id = await pastOrder(page, { lines: [{ size: SIZES.lotusTea }] });
	await page.getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }).click();
	await expect(page.getByTestId("cart-bar")).toBeVisible();
	await openHistory(page);

	await reorderByKeyboard(page, id);
	const ask = page.getByRole("dialog", { name: "Giỏ đang có món" });
	await expect(ask).toContainText("Giỏ của bạn đang có 1 món.");
	await checkOrderingScreen(page);
	await page.keyboard.press("Escape");
	await expect(ask).toHaveCount(0);
	await expect(
		card(page, id).getByRole("button", { name: /^Đặt lại đơn / }),
	).toBeFocused();

	await page.keyboard.press("Enter");
	await ask.getByRole("button", { name: "Thêm vào giỏ" }).click();
	await expect(page.getByTestId("cart")).toBeVisible();
	await expect(page.getByTestId("cart-line")).toHaveCount(2);

	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByTestId("orders")).toBeVisible();
	await reorderByKeyboard(page, id);
	await ask.getByRole("button", { name: "Thay giỏ" }).click();
	await expect(page.getByTestId("cart-line")).toHaveCount(1);
	await expect(page.getByTestId("cart-line")).toHaveAttribute(
		"data-item-id",
		ITEMS.lotusTea,
	);
});

test("a size and an option gone are named; a group required since without a default makes the line ask in the basket until chosen", async ({
	page,
}) => {
	await openMenu(page);
	const id = await pastOrder(page, {
		lines: [
			{ size: SIZES.bacXiuM, options: [OPTIONS.iceNormal] },
			{ size: SIZES.bacXiuL, options: [OPTIONS.iceNormal] },
			{ size: SIZES.bacXiuM, options: [OPTIONS.iceNormal, OPTIONS.saltCream] },
		],
	});
	await till(page, "removeSize", SIZES.bacXiuL);
	await till(page, "removeOption", OPTIONS.saltCream);
	await till(page, "requireGroup", EXTRA_GROUP, 1, null);
	await openHistory(page);
	await reorderByKeyboard(page, id);

	const report = page.getByTestId("orders-reorder-partial");
	await expect(report.locator("[data-kind=unavailable]")).toHaveText(
		"2 món không còn bán nên không được thêm vào giỏ: Bạc xỉu (Lớn), Bạc xỉu (Vừa).",
	);
	await expect(report.locator("[data-kind=choose]")).toHaveText(
		"Bạc xỉu (Vừa) cần chọn lại tùy chọn trong giỏ.",
	);
	await expect(page.getByTestId("cart-line")).toHaveAttribute(
		"data-needs-choice",
		"true",
	);
	await expect(page.getByTestId("cart-line-choose")).toHaveText(
		"Chọn thêm cho Bạc xỉu trước khi đặt.",
	);
	await expect(page.getByTestId("cart-continue")).toBeDisabled();
	await expect(page.getByTestId("cart-blocked")).toHaveText(
		"Chọn đủ tùy chọn cho món được đánh dấu trước khi đặt.",
	);
	await checkOrderingScreen(page);

	await page.getByRole("button", { name: "Chọn thêm cho Bạc xỉu" }).click();
	await page.getByRole("checkbox", { name: /Thêm một shot/ }).check();
	await page.getByTestId("item-add").click();
	await expect(page.getByTestId("cart-line")).toHaveAttribute(
		"data-needs-choice",
		"false",
	);
	await expect(page.getByTestId("cart-continue")).toBeEnabled();
});

test("an order of another store is refused in words, and an order with nothing left says so on its card", async ({
	page,
}) => {
	await openMenu(page);
	const elsewhere = await pastOrder(page, {
		storeName: "Cửa hàng Mẫu 2",
		lines: [{ size: SIZES.blackCoffee }],
	});
	const gone = await pastOrder(page, {
		daysAgo: 2,
		lines: [{ size: SIZES.bananaCake }],
	});
	await till(page, "soldOut", ITEMS.bananaCake, true);
	await openHistory(page);

	await reorderByKeyboard(page, elsewhere);
	await expect(
		card(page, elsewhere).getByTestId("order-row-reorder-problem"),
	).toHaveText(
		"Đơn này đặt ở Cửa hàng Mẫu 2. Bạn đang gọi món ở Cửa hàng Mẫu 1 nên không đặt lại được đơn này.",
	);
	await reorderByKeyboard(page, gone);
	await expect(
		card(page, gone).getByTestId("orders-reorder-partial"),
	).toHaveText("1 món không còn bán nên không được thêm vào giỏ: Bánh chuối.");
	await expect(page.getByTestId("orders")).toBeVisible();
	await expect(page.getByTestId("cart-bar")).toHaveCount(0);
	await checkOrderingScreen(page);
});

test("security: markup and control characters of the order stay text, and another customer's order by a hand-made route is not found", async ({
	page,
}) => {
	const dialogs: string[] = [];
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await openMenu(page);
	const hostile = '<img src=x onerror="alert(1)">';
	const id = await pastOrder(page, {
		lines: [
			{ size: "eeeeeeee-0000-4000-8000-000000000999", name: hostile },
			{ size: SIZES.lotusTea, note: hostile },
			{ size: SIZES.bananaCake, note: "ít\u0007ngọt" },
		],
	});
	await openHistory(page);
	await reorderByKeyboard(page, id);
	const report = page.getByTestId("orders-reorder-partial");
	await expect(report.locator("[data-kind=unavailable]")).toHaveText(
		`1 món không còn bán nên không được thêm vào giỏ: ${hostile}.`,
	);
	await expect(report.locator("[data-kind=note]")).toHaveText(
		"Ghi chú cũ của Bánh chuối không còn hợp lệ nên không được chép lại.",
	);
	await expect(page.getByTestId("cart-line-note")).toHaveText(hostile);
	await expect(page.locator('img[src="x"]')).toHaveCount(0);
	expect(dialogs).toEqual([]);

	await page.goto(`./?route=/don/${FOREIGN_ORDER}`);
	await expect(page.getByTestId("order-missing-note")).toHaveText(
		"Không tìm thấy đơn này.",
	);
	await expect(page.getByTestId("order")).toHaveCount(0);
	await expect(page.getByTestId("order-row-reorder")).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText("Bàn 3");
});
