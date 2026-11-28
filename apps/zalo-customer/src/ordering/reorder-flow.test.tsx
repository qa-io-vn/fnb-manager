import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	DEMO_GROUPS,
	DEMO_ITEMS,
	DEMO_OPTIONS,
	DEMO_SIZES,
} from "../demo/ordering-fixtures";
import type { DemoTill } from "../demo/ordering-world";
import { renderOrderingApp } from "../test/render-ordering";

// Component integration of C14 Đơn đã đặt and "Đặt lại" (design spec C14; GA-072 to GA-074) on the demo world, the till
// standing in for the counter and for menu changes made since an order:
// - use case: Tôi → Lịch sử đơn → the history with its filters and pills (table, takeaway, cancelled, cancelled and
//   refunded) → "Đặt lại" → the basket from the current menu → the order placed at today's prices;
// - decision table on the screen: one line sold out, one size gone, one option gone → the rest added and the three
//   named; a group made required with a default → taken, without one → the line asks in the basket and blocks the
//   order until chosen; nothing left → the card says so and the basket stays;
// - state transitions of the basket: empty → filled; holding items → "Thay giỏ", "Thêm vào giỏ" or closed (unchanged);
// - error guessing and security: an order of another store refused in words; markup and control characters in the
//   order's names and notes shown as text (a note the basket would refuse dropped and said); prices never from history.

const TABLE = "?store=mau-1&src=table&t=demo-table-12";

async function start(): Promise<DemoTill> {
	const { till } = renderOrderingApp({ search: TABLE });
	await screen.findByTestId("ordering-menu");
	return till;
}

async function openHistory(): Promise<void> {
	fireEvent.click(
		within(screen.getByRole("navigation")).getByText("Tôi", { exact: true }),
	);
	fireEvent.click(
		(await screen.findAllByTestId("account-row")).find(
			(row) => row.getAttribute("data-row") === "orders",
		) as HTMLElement,
	);
	await screen.findByTestId("orders");
}

async function card(orderId: string): Promise<HTMLElement> {
	const row = await waitFor(() => {
		const found = screen
			.getAllByTestId("order-row")
			.find((element) => element.getAttribute("data-order-id") === orderId);
		if (found === undefined) throw new Error("no such row");
		return found;
	});
	const article = row.closest("article");
	if (article === null) throw new Error("no card");
	return article;
}

async function reorder(orderId: string): Promise<HTMLElement> {
	const found = await card(orderId);
	fireEvent.click(within(found).getByTestId("order-row-reorder"));
	return found;
}

function cartLines(): string[] {
	return screen
		.getAllByTestId("cart-line")
		.map((line) => line.getAttribute("data-item-id") ?? "");
}

describe("C14 the history", () => {
	it("lists each kind of order with its pill and filters them by how they were served (GA-072, GA-074)", async () => {
		const till = await start();
		const table = till.pastOrder({
			lines: [{ size: DEMO_SIZES.blackCoffee }],
		});
		const takeaway = till.pastOrder({
			type: "takeaway",
			daysAgo: 2,
			lines: [{ size: DEMO_SIZES.peachTea, qty: 2 }],
		});
		const cancelled = till.pastOrder({
			status: "cancelled",
			daysAgo: 3,
			lines: [{ size: DEMO_SIZES.lotusTea }],
		});
		const refunded = till.pastOrder({
			status: "refunded",
			daysAgo: 4,
			lines: [{ size: DEMO_SIZES.bananaCake }],
		});
		await openHistory();
		const rows = screen.getAllByTestId("order-row");
		expect(rows.map((row) => row.getAttribute("data-order-id"))).toEqual([
			table,
			takeaway,
			cancelled,
			refunded,
		]);
		expect(await card(table)).toHaveTextContent("Bàn 12");
		expect(await card(table)).toHaveTextContent("Hoàn thành");
		expect(await card(takeaway)).toHaveTextContent("Mang đi");
		expect(within(await card(cancelled)).getByText("Đã hủy")).toBeTruthy();
		const refundedCard = await card(refunded);
		expect(refundedCard).toHaveTextContent("Đã hủy · đã hoàn tiền");
		expect(refundedCard.getAttribute("aria-label")).toMatch(
			/^Đơn \d\d\/\d\d\/\d{4} \d\d:\d\d, Đã hủy · đã hoàn tiền$/,
		);
		expect(
			within(refundedCard).getByRole("button", {
				name: /^Đặt lại đơn \d\d\/\d\d\/\d{4} \d\d:\d\d$/,
			}),
		).toBeTruthy();

		const filters = screen.getByTestId("orders-filter");
		fireEvent.click(within(filters).getByRole("button", { name: "Mang đi" }));
		expect(
			screen
				.getAllByTestId("order-row")
				.map((row) => row.getAttribute("data-order-id")),
		).toEqual([takeaway]);
		expect(
			within(filters).getByRole("button", { name: "Mang đi" }),
		).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(within(filters).getByRole("button", { name: "Tại bàn" }));
		expect(screen.getAllByTestId("order-row")).toHaveLength(3);
		fireEvent.click(within(filters).getByRole("button", { name: "Tất cả" }));
		expect(screen.getAllByTestId("order-row")).toHaveLength(4);
	});

	it("opens the order (C06) from the card", async () => {
		const till = await start();
		const id = till.pastOrder({ lines: [{ size: DEMO_SIZES.blackCoffee }] });
		await openHistory();
		fireEvent.click(within(await card(id)).getByTestId("order-row"));
		expect(await screen.findByTestId("order")).toHaveAttribute(
			"data-status",
			"completed",
		);
	});
});

describe("Đặt lại", () => {
	it("fills an empty basket from today's menu and prices, and the order goes through at those prices", async () => {
		const till = await start();
		const id = till.pastOrder({
			lines: [
				{
					size: DEMO_SIZES.milkCoffeeL,
					qty: 2,
					options: [DEMO_OPTIONS.iceLess, DEMO_OPTIONS.sweetLess],
					note: "ít ngọt",
					// sold then at another price: never used
					price: 1000,
				},
				{ size: DEMO_SIZES.bananaCake },
			],
		});
		till.setPrice(DEMO_SIZES.milkCoffeeL, 47000);
		await openHistory();
		await reorder(id);
		await screen.findByTestId("cart");
		expect(cartLines()).toEqual([DEMO_ITEMS.milkCoffee, DEMO_ITEMS.bananaCake]);
		expect(screen.queryByTestId("orders-reorder-partial")).toBeNull();
		expect(screen.getAllByTestId("cart-line-options")[0]).toHaveTextContent(
			"Lớn · Ít đá · Ít ngọt",
		);
		expect(screen.getByTestId("cart-line-note")).toHaveTextContent("ít ngọt");
		// 2 × 47 000 + 25 000, never the 1 000 of the order
		expect(screen.getByTestId("cart-total")).toHaveAttribute(
			"data-price",
			"119000",
		);
		fireEvent.click(screen.getByTestId("cart-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		await screen.findByTestId("order");
		expect(till.placements()).toBe(1);
		expect(screen.getByTestId("order-total")).toHaveAttribute(
			"data-price",
			"119000",
		);
	});

	it("adds what is still sold and names a line sold out, one whose size is gone and one whose option is gone", async () => {
		const till = await start();
		const id = till.pastOrder({
			lines: [
				{ size: DEMO_SIZES.blackCoffee, options: [DEMO_OPTIONS.iceNone] },
				{ size: DEMO_SIZES.bananaCake },
				{ size: DEMO_SIZES.bacXiuL, options: [DEMO_OPTIONS.iceNormal] },
				{
					size: DEMO_SIZES.bacXiuM,
					options: [DEMO_OPTIONS.iceNormal, DEMO_OPTIONS.saltCream],
				},
			],
		});
		till.soldOut(DEMO_ITEMS.bananaCake, true);
		till.removeSize(DEMO_SIZES.bacXiuL);
		till.removeOption(DEMO_OPTIONS.saltCream);
		await openHistory();
		await reorder(id);
		const report = await screen.findByTestId("orders-reorder-partial");
		expect(cartLines()).toEqual([DEMO_ITEMS.blackCoffee]);
		expect(report).toHaveTextContent(
			"3 món không còn bán nên không được thêm vào giỏ: Bánh chuối, Bạc xỉu (Lớn), Bạc xỉu (Vừa).",
		);
		expect(report).toHaveFocus();
		expect(screen.getByTestId("cart-continue")).toBeEnabled();
	});

	it("takes the default of a group required since", async () => {
		const till = await start();
		const id = till.pastOrder({
			lines: [{ size: DEMO_SIZES.bacXiuM, options: [DEMO_OPTIONS.iceNormal] }],
		});
		till.requireGroup(DEMO_GROUPS.extra, 1, DEMO_OPTIONS.shot);
		await openHistory();
		await reorder(id);
		await screen.findByTestId("cart");
		expect(screen.getByTestId("cart-line-options")).toHaveTextContent(
			"Vừa · Bình thường · Thêm một shot",
		);
		expect(screen.queryByTestId("cart-line-choose")).toBeNull();
		expect(screen.queryByTestId("orders-reorder-partial")).toBeNull();
	});

	it("puts a line whose group became required without a default in the basket, where it asks for the choice", async () => {
		const till = await start();
		const id = till.pastOrder({
			lines: [{ size: DEMO_SIZES.bacXiuM, options: [DEMO_OPTIONS.iceNormal] }],
		});
		till.requireGroup(DEMO_GROUPS.extra, 1, null);
		await openHistory();
		await reorder(id);
		expect(
			await screen.findByTestId("orders-reorder-partial"),
		).toHaveTextContent("Bạc xỉu (Vừa) cần chọn lại tùy chọn trong giỏ.");
		const line = screen.getByTestId("cart-line");
		expect(line).toHaveAttribute("data-needs-choice", "true");
		expect(screen.getByTestId("cart-line-choose")).toHaveTextContent(
			"Chọn thêm cho Bạc xỉu trước khi đặt.",
		);
		expect(screen.getByTestId("cart-continue")).toBeDisabled();
		expect(screen.getByTestId("cart-blocked")).toHaveTextContent(
			"Chọn đủ tùy chọn cho món được đánh dấu trước khi đặt.",
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Chọn thêm cho Bạc xỉu" }),
		);
		fireEvent.click(
			await screen.findByRole("checkbox", { name: /Thêm một shot/ }),
		);
		fireEvent.click(screen.getByTestId("item-add"));
		await waitFor(() =>
			expect(screen.getByTestId("cart-line")).toHaveAttribute(
				"data-needs-choice",
				"false",
			),
		);
		expect(screen.getByTestId("cart-continue")).toBeEnabled();
	});

	it("asks whether to replace the basket or add to it, and a closed question changes nothing", async () => {
		const till = await start();
		const id = till.pastOrder({ lines: [{ size: DEMO_SIZES.lotusTea }] });
		fireEvent.click(
			await screen.findByRole("button", { name: "Thêm Cà phê đen vào giỏ" }),
		);
		await screen.findByTestId("cart-bar");
		await openHistory();

		await reorder(id);
		const ask = await screen.findByRole("dialog", { name: "Giỏ đang có món" });
		expect(ask).toHaveTextContent("Giỏ của bạn đang có 1 món.");
		fireEvent.click(within(ask).getByRole("button", { name: "Đóng" }));
		await waitFor(() =>
			expect(screen.queryByTestId("orders-reorder-ask")).toBeNull(),
		);
		expect(screen.getByTestId("orders")).toBeTruthy();

		await reorder(id);
		fireEvent.click(await screen.findByTestId("orders-reorder-add"));
		await screen.findByTestId("cart");
		expect(cartLines()).toEqual([DEMO_ITEMS.blackCoffee, DEMO_ITEMS.lotusTea]);

		fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
		await screen.findByTestId("orders");
		await reorder(id);
		fireEvent.click(await screen.findByTestId("orders-reorder-replace"));
		await screen.findByTestId("cart");
		expect(cartLines()).toEqual([DEMO_ITEMS.lotusTea]);
		expect(screen.getByTestId("cart-line-qty")).toBeTruthy();
	});

	it("leaves the basket as it is and says so on the card when nothing can be added", async () => {
		const till = await start();
		fireEvent.click(
			await screen.findByRole("button", { name: "Thêm Cà phê đen vào giỏ" }),
		);
		const id = till.pastOrder({ lines: [{ size: DEMO_SIZES.bananaCake }] });
		till.soldOut(DEMO_ITEMS.bananaCake, true);
		await openHistory();
		const found = await reorder(id);
		expect(
			await within(found).findByTestId("orders-reorder-partial"),
		).toHaveTextContent(
			"1 món không còn bán nên không được thêm vào giỏ: Bánh chuối.",
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByTestId("orders")).toBeTruthy();
	});

	it("refuses in words an order of another store", async () => {
		const till = await start();
		const id = till.pastOrder({
			storeName: "Cửa hàng Mẫu 2",
			lines: [{ size: DEMO_SIZES.blackCoffee }],
		});
		await openHistory();
		const found = await reorder(id);
		expect(
			await within(found).findByTestId("order-row-reorder-problem"),
		).toHaveTextContent(
			"Đơn này đặt ở Cửa hàng Mẫu 2. Bạn đang gọi món ở Cửa hàng Mẫu 1 nên không đặt lại được đơn này.",
		);
		expect(screen.getByTestId("orders")).toBeTruthy();
	});

	it("shows markup and control characters of the order's names and notes as text, and drops a note the basket refuses", async () => {
		const till = await start();
		const hostile = '<img src=x onerror="alert(1)">';
		const id = till.pastOrder({
			lines: [
				{
					size: "eeeeeeee-0000-4000-8000-000000000999",
					name: `${hostile}‮abc`,
				},
				{ size: DEMO_SIZES.lotusTea, note: hostile },
				{ size: DEMO_SIZES.bananaCake, note: "ít\u0007ngọt" },
			],
		});
		await openHistory();
		await reorder(id);
		const report = await screen.findByTestId("orders-reorder-partial");
		expect(report.textContent).toContain(`${hostile}‮abc`);
		expect(report).toHaveTextContent(
			"Ghi chú cũ của Bánh chuối không còn hợp lệ nên không được chép lại.",
		);
		expect(screen.getByTestId("cart-line-note")).toHaveTextContent(hostile);
		expect(document.querySelector('img[src="x"]')).toBeNull();
		expect(cartLines()).toEqual([DEMO_ITEMS.lotusTea, DEMO_ITEMS.bananaCake]);
	});
});
