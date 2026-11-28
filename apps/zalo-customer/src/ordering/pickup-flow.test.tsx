import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ITEMS } from "../demo/ordering-fixtures";
import type { DemoSettings } from "../demo/world";
import { renderOrderingApp } from "../test/render-ordering";

// Component integration of takeaway with a chosen pick-up time (C17, ADR-072) in the ordering build with online
// payment (VITE_ONLINE_PAYMENT=on, mocked here), on the demo world with `takeaway` on, at a fixed clock (Friday
// 27/11/2026 14:05 on the shop's clock). Use cases and techniques:
// - C17-E1 the open path: Trang chủ "Mang đi · Hẹn giờ lấy" → the menu → the basket's takeaway context → C05 with
//   "Mang đi" chosen, only the online ways and the note why → C17 → a slot → back to C05 "Hôm nay · 14:30" → paid
//   online: the order waits for its payment, held 10 minutes;
// - C17-E3 the slot fills between C17 and paying (error guessing): C05 sends, the server refuses slot_full, C17 comes
//   back with the time in words and the nearest free ones, the full slot marked and the button disabled;
// - C17-E4 back and forward keep the choice (state transitions of the screens);
// - C15 with D7: a closed store offers "Hẹn lấy món sáng mai" and takes a booking for its opening, never "Càng sớm";
// - C17-R1 regression: a table order from a table's QR still starts at the table and pays at the counter.

vi.mock("./flag", async (importOriginal) => ({
	...(await importOriginal<typeof import("./flag")>()),
	ONLINE_PAYMENT_ENABLED: true,
}));

const TAKEAWAY: Partial<DemoSettings> = {
	onlinePayments: true,
	takeaway: true,
};
const NOW = new Date("2026-11-27T14:05:00+07:00");
const at = (local: string) => new Date(`${local}+07:00`).toISOString();

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
	vi.useRealTimers();
});

async function addCake() {
	await screen.findByTestId("ordering-menu");
	const row = (await screen.findAllByTestId("menu-item")).find(
		(element) => element.getAttribute("data-item-id") === DEMO_ITEMS.bananaCake,
	);
	if (row === undefined) throw new Error("no cake");
	fireEvent.click(within(row).getAllByRole("button").at(-1) as HTMLElement);
}

async function toCheckout(search = "?payments=online&takeaway=on") {
	const rendered = renderOrderingApp({ search, settings: TAKEAWAY });
	fireEvent.click(await screen.findByTestId("home-tile-takeaway"));
	await addCake();
	fireEvent.click(
		within(await screen.findByTestId("cart-bar")).getByRole("button"),
	);
	expect(await screen.findByTestId("cart-takeaway")).toHaveTextContent(
		"Mang đi · Lấy tại quầy",
	);
	fireEvent.click(await screen.findByTestId("cart-continue"));
	await screen.findByTestId("checkout");
	return rendered;
}

function slotAt(local: string): HTMLElement {
	const found = screen
		.getAllByTestId("pickup-slot")
		.find((element) => element.getAttribute("data-at") === at(local));
	if (found === undefined) throw new Error(`no slot ${local}`);
	return found;
}

describe("C17 from C05, open", () => {
	it("C17-E1: books 14:30 today, pays online only, and the order waits for its payment held 10 minutes", async () => {
		const { till } = await toCheckout();
		expect(screen.getByTestId("fulfilment")).toHaveAttribute(
			"data-mode",
			"takeaway",
		);
		const ways = screen
			.getAllByTestId("payment-method")
			.map((element) => element.getAttribute("data-method"));
		expect(ways).toEqual(["zalo_checkout", "vietqr"]);
		expect(screen.getByTestId("checkout-takeaway-prepaid")).toHaveTextContent(
			"Đơn mang đi không có “Trả tại quầy”",
		);
		expect(screen.getByTestId("checkout-pickup-when")).toHaveTextContent(
			"Chưa chọn giờ lấy",
		);
		await waitFor(() =>
			expect(screen.getByTestId("checkout-submit")).toBeDisabled(),
		);
		fireEvent.click(screen.getByTestId("checkout-pickup-change"));
		await screen.findByTestId("pickup-slots");
		expect(screen.getByTestId("pickup-asap")).toHaveTextContent(
			"Dự kiến 14:20, khoảng 15 phút nữa",
		);
		expect(screen.getByTestId("pickup-date")).toHaveTextContent(
			"Hôm nay, 27/11/2026",
		);
		expect(screen.getByRole("radiogroup", { name: "Giờ lấy" })).toBeVisible();
		// the first slot is 14:30: 14:15 has passed and is not listed
		expect(
			screen.getAllByTestId("pickup-slot")[0]?.getAttribute("data-at"),
		).toBe(at("2026-11-27T14:30:00"));
		expect(screen.getByTestId("pickup-continue")).toBeDisabled();
		fireEvent.click(within(slotAt("2026-11-27T14:30:00")).getByRole("radio"));
		expect(screen.getByTestId("pickup-chosen")).toHaveTextContent(
			"14:30 hôm nay",
		);
		fireEvent.click(screen.getByTestId("pickup-continue"));
		expect(await screen.findByTestId("checkout-pickup-when")).toHaveTextContent(
			"Hôm nay · 14:30",
		);
		const submit = screen.getByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		expect(submit).toHaveTextContent("Thanh toán");
		fireEvent.click(submit);
		await screen.findByTestId("pay-step");
		expect(till.status()).toBe("awaiting_payment");
		expect(till.pickupOf()).toBe(at("2026-11-27T14:30:00"));
		expect(await screen.findByTestId("pay-held")).toHaveTextContent("14:15");
		expect(screen.getByTestId("pay-pickup")).toHaveTextContent(
			"Giờ lấy: 14:30 hôm nay",
		);
	});

	it("C17-E3: the slot fills before paying: C17 comes back with the time, the nearest free ones and no choice", async () => {
		const { till } = await toCheckout();
		fireEvent.click(screen.getByTestId("checkout-pickup-change"));
		await screen.findByTestId("pickup-slots");
		fireEvent.click(within(slotAt("2026-11-27T15:00:00")).getByRole("radio"));
		fireEvent.click(screen.getByTestId("pickup-continue"));
		await screen.findByTestId("checkout-pickup-when");
		// two other customers take both places of 15:00 meanwhile
		till.fillSlot(at("2026-11-27T15:00:00"), 2);
		const submit = screen.getByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		const problem = await screen.findByTestId("pickup-problem");
		expect(problem).toHaveAttribute("role", "alert");
		// the nearest free slots follow once the slots are read again
		await waitFor(() =>
			expect(problem).toHaveTextContent(
				"Giờ 15:00 vừa hết chỗ. Chọn giờ khác để tiếp tục. Giờ gần nhất còn chỗ là 15:15 và 15:30.",
			),
		);
		await waitFor(() =>
			expect(slotAt("2026-11-27T15:00:00")).toHaveAttribute(
				"data-full",
				"true",
			),
		);
		expect(
			within(slotAt("2026-11-27T15:00:00")).getByRole("radio", {
				name: "15:00, hết chỗ",
			}),
		).toHaveAttribute("aria-disabled", "true");
		expect(screen.getByTestId("pickup-chosen")).toHaveTextContent("Chưa chọn");
		expect(screen.getByTestId("pickup-continue")).toBeDisabled();
		expect(screen.getByTestId("pickup-continue")).toHaveTextContent(
			"Chọn giờ lấy",
		);
		expect(till.placements()).toBe(0);
	});

	it("C17-E4: going back and forth keeps the choice", async () => {
		await toCheckout();
		fireEvent.click(screen.getByTestId("checkout-pickup-change"));
		await screen.findByTestId("pickup-slots");
		fireEvent.click(within(slotAt("2026-11-27T16:00:00")).getByRole("radio"));
		fireEvent.click(screen.getByTestId("pickup-continue"));
		expect(await screen.findByTestId("checkout-pickup-when")).toHaveTextContent(
			"Hôm nay · 16:00",
		);
		fireEvent.click(screen.getByTestId("checkout-pickup-change"));
		await screen.findByTestId("pickup-slots");
		expect(slotAt("2026-11-27T16:00:00")).toHaveAttribute(
			"data-selected",
			"true",
		);
		expect(screen.getByTestId("pickup-chosen")).toHaveTextContent(
			"16:00 hôm nay",
		);
	});
});

describe("C15 with D7: closed, booked for the morning", () => {
	it("offers Hẹn lấy món sáng mai and takes a booking from the opening, without Càng sớm", async () => {
		vi.setSystemTime(new Date("2026-11-27T23:30:00+07:00"));
		const { till } = renderOrderingApp({
			search: "?payments=online&takeaway=on&ordering=closed_now",
			settings: { ...TAKEAWAY, orderingReason: "closed_now" },
		});
		const closed = await screen.findByTestId("ordering-closed");
		expect(closed).toHaveAttribute("data-preorder", "true");
		expect(within(closed).getByTestId("closed-body")).toHaveTextContent(
			"Bạn vẫn xem thực đơn và hẹn giờ lấy món cho sáng mai được.",
		);
		fireEvent.click(
			within(closed).getByRole("button", { name: "Hẹn lấy món sáng mai" }),
		);
		await addCake();
		fireEvent.click(
			within(await screen.findByTestId("cart-bar")).getByRole("button"),
		);
		fireEvent.click(await screen.findByTestId("cart-continue"));
		fireEvent.click(await screen.findByTestId("checkout-pickup-change"));
		const pickup = await screen.findByTestId("pickup");
		await waitFor(() => expect(pickup).toHaveAttribute("data-state", "closed"));
		expect(screen.queryByTestId("pickup-asap")).toBeNull();
		expect(screen.getByTestId("pickup-kicker")).toHaveTextContent(
			"Hẹn giờ lấy sáng mai",
		);
		expect(screen.getByTestId("pickup-date")).toHaveTextContent(
			"Thứ Bảy, 28/11/2026 · mở cửa 07:00",
		);
		fireEvent.click(within(slotAt("2026-11-28T07:30:00")).getByRole("radio"));
		expect(screen.getByTestId("pickup-chosen")).toHaveTextContent(
			"07:30 sáng mai",
		);
		fireEvent.click(screen.getByTestId("pickup-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		await screen.findByTestId("pay-step");
		expect(till.pickupOf()).toBe(at("2026-11-28T07:30:00"));
		// C17-E2: paid in the wallet's sheet, the gateway reports the money; the order status shows the pick-up time
		fireEvent.click(await screen.findByTestId("stand-in-pay"));
		const pickupLine = await screen.findByTestId(
			"order-pickup",
			{},
			{ timeout: 9000 },
		);
		expect(pickupLine).toHaveTextContent("Mang đi · lấy lúc 07:30 sáng mai");
		expect(screen.getByTestId("order-pickup-start")).toHaveTextContent(
			"Quán bắt đầu pha lúc 07:15 để kịp giờ lấy.",
		);
	});
});

describe("the time passes while paying (C17, not drawn)", () => {
	it("says Giờ lấy đã qua and moves the unpaid booking to another slot", async () => {
		const { till } = await toCheckout();
		// a store that prepares in 5 minutes: a booking can pass its start while its 10-minute hold is open
		till.setPrepMinutes(5);
		fireEvent.click(screen.getByTestId("checkout-pickup-change"));
		await screen.findByTestId("pickup-slots");
		fireEvent.click(within(slotAt("2026-11-27T14:15:00")).getByRole("radio"));
		fireEvent.click(screen.getByTestId("pickup-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		await screen.findByTestId("pay-step");
		// 14:11: the preparation should have started at 14:10, the hold lasts to 14:15
		vi.setSystemTime(new Date("2026-11-27T14:11:00+07:00"));
		const passed = await screen.findByTestId(
			"pay-pickup-passed",
			{},
			{ timeout: 9000 },
		);
		expect(passed).toHaveTextContent("Giờ lấy đã qua. Chọn giờ khác.");
		fireEvent.click(screen.getByTestId("pay-pickup-choose"));
		await screen.findByTestId("pickup-slots");
		fireEvent.click(within(slotAt("2026-11-27T14:30:00")).getByRole("radio"));
		const save = screen.getByTestId("pickup-continue");
		expect(save).toHaveTextContent("Đổi giờ lấy");
		fireEvent.click(save);
		await screen.findByTestId("pay-step");
		await waitFor(() =>
			expect(till.pickupOf()).toBe(at("2026-11-27T14:30:00")),
		);
		expect(till.placements()).toBe(1);
	});
});

describe("C17-R1: a table order is unaffected", () => {
	it("starts at the table from its QR and keeps paying at the counter", async () => {
		renderOrderingApp({
			search:
				"?store=mau-1&src=table&t=demo-table-12&payments=online&takeaway=on",
			settings: TAKEAWAY,
		});
		await screen.findByTestId("ordering-menu");
		await addCake();
		fireEvent.click(
			within(await screen.findByTestId("cart-bar")).getByRole("button"),
		);
		expect(await screen.findByTestId("cart-table")).toBeVisible();
		fireEvent.click(await screen.findByTestId("cart-continue"));
		const fulfilment = await screen.findByTestId("fulfilment");
		expect(fulfilment).toHaveAttribute("data-mode", "table");
		expect(screen.queryByTestId("checkout-pickup")).toBeNull();
		expect(
			screen
				.getAllByTestId("payment-method")
				.map((element) => element.getAttribute("data-method")),
		).toEqual(["zalo_checkout", "vietqr", "counter"]);
	});
});
