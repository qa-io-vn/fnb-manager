import { emitMockOpenApp } from "@fnb/zalo-mini/testing/mock-sdk";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_FOREIGN_ORDER_ID, DEMO_ITEMS } from "../demo/ordering-fixtures";
import { renderOrderingApp } from "../test/render-ordering";

// Component integration of the ordering build on the demo world (design spec C01 to C20, the 7 acceptance criteria
// where the customer app has a part). Use cases end to end inside the app, with the till acting as the counter:
// - UC: a table's QR → the menu with the table the server named → add → basket → confirmation → the order, followed
//   through paid, preparing, serving and completed (state transitions driven by the till);
// - criterion 2: an item sold out at the counter while it is in the basket is flagged and blocks the order;
// - criterion 3: a lost answer and a second tap give one order (the same request_id);
// - error guessing / security: a forged table token shows no table and no label from the address; another customer's
//   order id answers "not found"; a note with markup is shown as text; the closed shop offers no add button.

const TABLE = "?store=mau-1&src=table&t=demo-table-12";

async function openMenu(search = TABLE) {
	const rendered = renderOrderingApp({ search });
	await screen.findByTestId("ordering-menu");
	return rendered;
}

async function addBlackCoffee() {
	const row = (await screen.findAllByTestId("menu-item")).find(
		(element) =>
			element.getAttribute("data-item-id") === DEMO_ITEMS.blackCoffee,
	);
	if (row === undefined) throw new Error("no black coffee");
	fireEvent.click(
		within(row).getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }),
	);
	await screen.findByTestId("cart-bar");
}

describe("ordering at a table", () => {
	it("opens the menu of the scanned table with the label the server gives, and orders through to completion", async () => {
		const { till } = await openMenu();
		expect(await screen.findByTestId("table-banner")).toHaveTextContent(
			"Gọi món cho Bàn 12 · Tầng 1",
		);
		await addBlackCoffee();
		expect(screen.getByTestId("cart-bar-count")).toHaveTextContent("1 món");
		expect(screen.getByTestId("cart-bar-total")).toHaveAttribute(
			"data-price",
			"29000",
		);
		fireEvent.click(within(screen.getByTestId("cart-bar")).getByRole("button"));
		expect(await screen.findByTestId("cart-table")).toHaveTextContent(
			"Gọi tại bàn Bàn 12",
		);
		expect(screen.getByTestId("cart-total")).toHaveAttribute(
			"data-price",
			"29000",
		);
		fireEvent.click(screen.getByTestId("cart-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		expect(screen.getByTestId("checkout-total")).toHaveAttribute(
			"data-price",
			"29000",
		);
		const methods = screen.getAllByTestId("payment-method");
		expect(methods.map((method) => method.getAttribute("data-method"))).toEqual(
			["zalo_checkout", "vietqr", "counter"],
		);
		expect(methods.map((method) => method.getAttribute("data-ready"))).toEqual([
			"false",
			"false",
			"true",
		]);
		fireEvent.click(submit);
		const order = await screen.findByTestId("order");
		expect(order).toHaveAttribute("data-status", "accepted");
		expect(order).toHaveAttribute("data-payment", "unpaid");
		expect(screen.getByTestId("order-headline")).toHaveTextContent(
			"Mời bạn ra quầy thanh toán",
		);
		expect(screen.getByTestId("order-total")).toHaveAttribute(
			"data-price",
			"29000",
		);
		expect(till.placements()).toBe(1);

		till.act("pay");
		till.act("start");
		await waitFor(() =>
			expect(screen.getByTestId("order")).toHaveAttribute(
				"data-status",
				"preparing",
			),
		);
		expect(screen.getByTestId("order-headline")).toHaveTextContent(
			"Đang pha cho bạn",
		);
		till.act("done");
		await waitFor(() =>
			expect(screen.getByTestId("order")).toHaveAttribute(
				"data-status",
				"serving",
			),
		);
		expect(screen.getByTestId("order-headline")).toHaveTextContent(
			"Quán đang mang ra Bàn 12",
		);
		till.act("complete");
		await waitFor(() =>
			expect(screen.getByTestId("order")).toHaveAttribute(
				"data-status",
				"completed",
			),
		);
		expect(screen.getByTestId("order-thanks")).toBeInTheDocument();
		const steps = screen.getAllByTestId("order-step");
		expect(steps.map((step) => step.getAttribute("data-state"))).toEqual([
			"done",
			"done",
			"done",
			"done",
			"done",
		]);
	}, 60_000);

	it("flags an item sold out at the counter while it is in the basket and refuses to go on (criterion 2)", async () => {
		const { till } = await openMenu();
		await addBlackCoffee();
		fireEvent.click(within(screen.getByTestId("cart-bar")).getByRole("button"));
		const line = await screen.findByTestId("cart-line");
		expect(line).toHaveAttribute("data-sold-out", "false");
		expect(screen.getByTestId("cart-continue")).toBeEnabled();
		till.soldOut(DEMO_ITEMS.blackCoffee, true);
		await waitFor(
			() =>
				expect(screen.getByTestId("cart-line")).toHaveAttribute(
					"data-sold-out",
					"true",
				),
			{
				timeout: 5000,
			},
		);
		expect(screen.getByTestId("cart-continue")).toBeDisabled();
		expect(screen.getByTestId("cart-blocked")).toHaveTextContent(
			"Bỏ món đã hết trước khi đặt.",
		);
		fireEvent.click(screen.getByTestId("cart-line-remove"));
		expect(await screen.findByTestId("cart-empty")).toBeInTheDocument();
	}, 30_000);

	it("makes one order when the first answer is lost and the customer taps again (criterion 3)", async () => {
		const rendered = renderOrderingApp({
			search: TABLE,
			settings: { network: "lost-once" },
		});
		await screen.findByTestId("ordering-menu");
		const { till } = rendered;
		await addBlackCoffee();
		fireEvent.click(within(screen.getByTestId("cart-bar")).getByRole("button"));
		fireEvent.click(await screen.findByTestId("cart-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		expect(await screen.findByTestId("checkout-problem")).toHaveAttribute(
			"data-problem",
			"network",
		);
		expect(till.placements()).toBe(1);
		fireEvent.click(screen.getByTestId("checkout-submit"));
		expect(await screen.findByTestId("order")).toBeInTheDocument();
		expect(till.placements()).toBe(1);
	}, 30_000);

	it("shows a note with markup as text", async () => {
		await openMenu();
		fireEvent.click(await screen.findByRole("button", { name: /^Cà phê đen/ }));
		const note = await screen.findByTestId("item-note");
		const hostile = '<img src=x onerror="alert(1)">';
		fireEvent.change(note, { target: { value: hostile } });
		fireEvent.click(screen.getByTestId("item-add"));
		fireEvent.click(
			within(await screen.findByTestId("cart-bar")).getByRole("button"),
		);
		const shown = await screen.findByTestId("cart-line-note");
		expect(shown).toHaveTextContent(hostile);
		expect(shown.querySelector("img")).toBeNull();
		expect(document.querySelector('img[src="x"]')).toBeNull();
	}, 30_000);
});

describe("refusals and states", () => {
	it("takes the table of a QR scanned while the app is open (OpenApp), and the next table replaces it", async () => {
		renderOrderingApp();
		await screen.findByTestId("home");
		act(() => emitMockOpenApp("/?store=mau-1&src=table&t=demo-table-3"));
		expect(await screen.findByTestId("table-banner")).toHaveTextContent(
			"Gọi món cho Bàn 3 · Sân",
		);
		act(() => emitMockOpenApp("/?store=mau-1&src=table&t=demo-table-12"));
		await waitFor(() =>
			expect(screen.getByTestId("table-banner")).toHaveTextContent(
				"Gọi món cho Bàn 12 · Tầng 1",
			),
		);
	});

	it("shows no table for a forged token, and never a label from the address", async () => {
		await openMenu("?store=mau-1&src=table&t=forged-token");
		expect(await screen.findByTestId("table-refused")).toHaveAttribute(
			"data-refusal",
			"table_unknown",
		);
		expect(screen.queryByTestId("table-banner")).toBeNull();
		expect(document.body.textContent).not.toContain("forged");
	});

	it("answers another customer's order as an unknown one", async () => {
		renderOrderingApp({ search: `?route=/don/${DEMO_FOREIGN_ORDER_ID}` });
		expect(await screen.findByTestId("order-missing")).toBeInTheDocument();
		expect(screen.queryByTestId("order")).toBeNull();
		expect(document.body.textContent).not.toContain("Bàn 3");
	});

	it("shows the closed shop above the menu and no add button (C15)", async () => {
		renderOrderingApp({
			search: TABLE,
			settings: { orderingReason: "closed_now" },
		});
		expect(await screen.findByTestId("ordering-closed")).toHaveAttribute(
			"data-reason",
			"closed_now",
		);
		expect(screen.getByTestId("closed-reopen")).toHaveTextContent(
			/Mở lại lúc 07:00/,
		);
		expect((await screen.findAllByTestId("menu-item")).length).toBeGreaterThan(
			0,
		);
		expect(screen.queryAllByTestId("menu-item-add")).toEqual([]);
	});

	it("explains a pause and hides the add buttons", async () => {
		renderOrderingApp({
			search: TABLE,
			settings: { orderingReason: "paused" },
		});
		expect(await screen.findByTestId("ordering-paused")).toHaveAttribute(
			"data-reason",
			"paused",
		);
		expect(screen.queryAllByTestId("menu-item-add")).toEqual([]);
	});

	it("finds items with and without Vietnamese marks", async () => {
		await openMenu();
		const search = await screen.findByTestId("menu-search");
		fireEvent.change(search, { target: { value: "ca phe den" } });
		await waitFor(() =>
			expect(
				screen
					.getAllByTestId("menu-item")
					.map((row) => row.getAttribute("data-item-id")),
			).toEqual([DEMO_ITEMS.blackCoffee]),
		);
		fireEvent.change(search, { target: { value: "SỮA cà" } });
		await waitFor(() =>
			expect(
				screen
					.getAllByTestId("menu-item")
					.map((row) => row.getAttribute("data-item-id")),
			).toEqual([DEMO_ITEMS.milkCoffee, DEMO_ITEMS.bacXiu]),
		);
		fireEvent.change(search, { target: { value: "trà" } });
		await waitFor(() =>
			expect(screen.getAllByTestId("menu-item")).toHaveLength(2),
		);
		fireEvent.change(search, { target: { value: "pizza" } });
		expect(await screen.findByTestId("menu-no-results")).toHaveTextContent(
			'Không có món nào khớp "pizza".',
		);
	});
});

describe("the shell of the ordering build", () => {
	it("has four tabs and the order strip after an order", async () => {
		await openMenu();
		const tabs = screen.getByRole("navigation");
		for (const label of ["Trang chủ", "Thực đơn", "Tích điểm", "Tôi"])
			expect(within(tabs).getByText(label)).toBeInTheDocument();
		await addBlackCoffee();
		fireEvent.click(within(screen.getByTestId("cart-bar")).getByRole("button"));
		fireEvent.click(await screen.findByTestId("cart-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		await screen.findByTestId("order");
		expect(screen.queryByTestId("active-order-strip")).toBeNull();
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Trang chủ"),
		);
		await screen.findByTestId("home");
		expect(await screen.findByTestId("active-order-strip")).toHaveTextContent(
			"Mời thanh toán tại quầy",
		);
	}, 30_000);

	it("keeps the stamp card of the Zalo account on Tích điểm, without a phone", async () => {
		const { till } = await openMenu();
		await addBlackCoffee();
		fireEvent.click(within(screen.getByTestId("cart-bar")).getByRole("button"));
		fireEvent.click(await screen.findByTestId("cart-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		await screen.findByTestId("order");
		till.act("pay");
		till.act("start");
		till.act("done");
		till.act("complete");
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Tích điểm"),
		);
		expect(await screen.findByTestId("stamp-count")).toHaveTextContent(
			"1/9 dấu",
		);
		expect(screen.getAllByTestId("stamp-slot")).toHaveLength(10);
		expect(screen.getAllByTestId("stamp-entry")[0]).toHaveAttribute(
			"data-kind",
			"order_earned",
		);
	}, 30_000);
});

describe("the data screen (C19)", () => {
	it("offers a visitor the deletion at once, behind the confirmation", async () => {
		renderOrderingApp({ search: "?route=/du-lieu" });
		expect(await screen.findByTestId("data-summary")).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("data-delete"));
		fireEvent.click(await screen.findByTestId("data-continue"));
		expect(await screen.findByTestId("data-confirm")).toHaveTextContent(
			"Quán xóa ngay dữ liệu của bạn",
		);
		expect(screen.getByTestId("data-confirm-delete")).toBeDisabled();
	});

	it("sends a member's deletion request after the confirmation", async () => {
		renderOrderingApp({
			search: "?route=/du-lieu",
			settings: { member: true },
		});
		fireEvent.click(await screen.findByTestId("data-delete"));
		fireEvent.click(await screen.findByTestId("data-continue"));
		const confirm = await screen.findByTestId("data-confirm-delete");
		expect(confirm).toBeDisabled();
		fireEvent.click(screen.getByTestId("data-confirm-check"));
		fireEvent.click(confirm);
		expect(await screen.findByTestId("data-deletion-sent")).toBeInTheDocument();
		expect(screen.getByTestId("deletion-status")).toHaveAttribute(
			"data-status",
			"received",
		);
	});
});
