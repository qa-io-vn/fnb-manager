import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEMO_ITEMS } from "../demo/ordering-fixtures";
import type { DemoSettings } from "../demo/world";
import { renderOrderingApp } from "../test/render-ordering";

// Component integration of online payment in the ordering build (VITE_ONLINE_PAYMENT=on, mocked here) on the demo
// world, which stands in for checkout-order, the gateway and the bank (acceptance criteria 1 and 3). Use cases:
// - UC1 wallet: C05 → the payment step → the stand-in sheet → the gateway reports it → the order accepted with a
//   number, read from the server's order only;
// - UC2 a failed wallet payment → C11 → Thử lại (a new attempt) → paid; "Hủy" on the sheet → C11 "no method chosen";
// - UC3 transfer: the in-app VietQR with its amount, bank, account and reference → the exact transfer → accepted;
// - UC4 another amount leaves the order waiting; the window passes → C11 expired → Trả tại quầy → a new counter order
//   and the old one cancelled (no duplicate at the counter);
// - error guessing / security: a client that claims success while the gateway heard nothing never shows paid; a double
//   tap gives one order and one attempt; "Tiếp tục thanh toán" resumes the same attempt; too_many_attempts is worded;
// - regression with the flag on: a store that offers only the counter keeps the online methods disabled.

vi.mock("./flag", async (importOriginal) => ({
	...(await importOriginal<typeof import("./flag")>()),
	ONLINE_PAYMENT_ENABLED: true,
}));

const TABLE = "?store=mau-1&src=table&t=demo-table-12";
const POLL_WAIT = { timeout: 9000 };
const ONLINE: Partial<DemoSettings> = { onlinePayments: true };

async function toCheckout(
	search = TABLE,
	settings: Partial<DemoSettings> = ONLINE,
) {
	const rendered = renderOrderingApp({ search, settings });
	await screen.findByTestId("ordering-menu");
	const row = (await screen.findAllByTestId("menu-item")).find(
		(element) =>
			element.getAttribute("data-item-id") === DEMO_ITEMS.blackCoffee,
	);
	if (row === undefined) throw new Error("no black coffee");
	fireEvent.click(
		within(row).getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }),
	);
	fireEvent.click(
		within(await screen.findByTestId("cart-bar")).getByRole("button"),
	);
	fireEvent.click(await screen.findByTestId("cart-continue"));
	const submit = await screen.findByTestId("checkout-submit");
	await waitFor(() => expect(submit).toBeEnabled());
	return { ...rendered, submit };
}

function method(name: string): HTMLElement {
	const found = screen
		.getAllByTestId("payment-method")
		.find((element) => element.getAttribute("data-method") === name);
	if (found === undefined) throw new Error(`no method ${name}`);
	return found;
}

function choose(name: string) {
	fireEvent.click(within(method(name)).getByRole("radio"));
	expect(method(name)).toHaveAttribute("data-selected", "true");
}

async function acceptedOrder() {
	const order = await screen.findByTestId("order", {}, POLL_WAIT);
	expect(order).toHaveAttribute("data-status", "accepted");
	return order;
}

describe("paying with the wallet", () => {
	it("opens the wallet with the server's attempt and shows the order accepted with a number once the gateway paid", async () => {
		const { till, submit } = await toCheckout();
		expect(
			screen
				.getAllByTestId("payment-method")
				.map((element) => element.getAttribute("data-ready")),
		).toEqual(["true", "true", "true"]);
		choose("zalo_checkout");
		fireEvent.click(submit);
		const sheet = await screen.findByTestId("stand-in-sheet");
		expect(within(sheet).getByTestId("stand-in-amount")).toHaveAttribute(
			"data-price",
			"29000",
		);
		await waitFor(() =>
			expect(screen.getByTestId("pay-step")).toHaveAttribute(
				"data-view",
				"waiting",
			),
		);
		expect(screen.getByTestId("pay-waiting")).toHaveAttribute(
			"data-note",
			"opened",
		);
		expect(till.placements()).toBe(1);
		expect(till.attempts()).toBe(1);
		expect(screen.queryByTestId("order")).toBeNull();
		fireEvent.click(within(sheet).getByTestId("stand-in-pay"));
		const order = await acceptedOrder();
		expect(order).toHaveAttribute("data-payment", "paid");
		expect(screen.getByTestId("order-number")).toHaveTextContent(/#\d{3}/);
		expect(till.placements()).toBe(1);
	}, 60_000);

	it("goes to C11 when the gateway fails the attempt, and Thử lại opens a new one that pays", async () => {
		const { till, submit } = await toCheckout();
		choose("zalo_checkout");
		fireEvent.click(submit);
		await screen.findByTestId("stand-in-sheet");
		act(() => {
			till.walletResult(undefined, "failed");
		});
		const result = await screen.findByTestId("payment-result", {}, POLL_WAIT);
		expect(result).toHaveAttribute("data-state", "failed");
		expect(screen.getByTestId("payment-body")).toHaveTextContent(
			/Thanh toán chưa hoàn tất\. Đơn của bạn được giữ đến \d{2}:\d{2}: bạn có thể thử lại hoặc chọn trả tại quầy\./,
		);
		expect(screen.getByTestId("pay-counter")).toBeEnabled();
		fireEvent.click(screen.getByTestId("payment-retry"));
		const sheet = await screen.findByTestId("stand-in-sheet");
		expect(till.attempts()).toBe(2);
		fireEvent.click(within(sheet).getByTestId("stand-in-pay"));
		await acceptedOrder();
		expect(till.placements()).toBe(1);
	}, 60_000);

	it("words the sheet closed without paying as no method chosen, the order still held", async () => {
		const { submit } = await toCheckout();
		choose("zalo_checkout");
		fireEvent.click(submit);
		fireEvent.click(await screen.findByTestId("stand-in-cancel"));
		const result = await screen.findByTestId("payment-result");
		expect(result).toHaveAttribute("data-state", "left");
		expect(screen.getByTestId("payment-body")).toHaveTextContent(
			/Bạn chưa chọn cách thanh toán\. Đơn vẫn được giữ đến \d{2}:\d{2}\./,
		);
		expect(screen.getByTestId("payment-retry")).toBeEnabled();
	}, 60_000);

	it("never shows paid when the client claims success and the gateway heard nothing", async () => {
		const { till, submit } = await toCheckout(`${TABLE}&wallet=claim`);
		choose("zalo_checkout");
		fireEvent.click(submit);
		fireEvent.click(await screen.findByTestId("stand-in-pay"));
		await waitFor(() =>
			expect(screen.getByTestId("pay-waiting")).toHaveAttribute(
				"data-note",
				"claimed",
			),
		);
		await act(() => new Promise((resolve) => setTimeout(resolve, 4000)));
		expect(screen.getByTestId("pay-step")).toHaveAttribute(
			"data-view",
			"waiting",
		);
		expect(screen.queryByTestId("order")).toBeNull();
		expect(till.status()).toBe("awaiting_payment");
	}, 60_000);

	it("makes one order and one attempt for a double tap, and resumes the same attempt from the order screen", async () => {
		const { till, submit } = await toCheckout();
		choose("zalo_checkout");
		fireEvent.click(submit);
		fireEvent.click(submit);
		await screen.findByTestId("stand-in-sheet");
		expect(till.placements()).toBe(1);
		expect(till.attempts()).toBe(1);
		fireEvent.click(screen.getByTestId("stand-in-cancel"));
		await screen.findByTestId("payment-result");
		fireEvent.click(screen.getByTestId("payment-to-order"));
		const order = await screen.findByTestId("order");
		expect(order).toHaveAttribute("data-status", "awaiting_payment");
		expect(screen.getByTestId("order-headline")).toHaveTextContent(
			"Đơn đang chờ thanh toán",
		);
		fireEvent.click(screen.getByTestId("order-pay"));
		fireEvent.click(await screen.findByTestId("stand-in-pay"));
		await acceptedOrder();
		expect(till.attempts()).toBe(1);
	}, 60_000);

	it("words too many attempts on C11 and leaves the counter as the way to pay", async () => {
		const { world, submit } = await toCheckout();
		choose("zalo_checkout");
		fireEvent.click(submit);
		fireEvent.click(await screen.findByTestId("stand-in-cancel"));
		await screen.findByTestId("payment-result");
		const real = world.functionFetch;
		Object.assign(world, {
			functionFetch: async () =>
				new Response(
					JSON.stringify({
						state: "refused",
						refusal: "too_many_attempts",
						replayed: false,
						payment: null,
					}),
					{ status: 200 },
				),
		});
		fireEvent.click(screen.getByTestId("payment-retry"));
		expect(
			await screen.findByTestId("payment-retry-problem"),
		).toHaveTextContent(
			"Đơn này đã thử thanh toán nhiều lần. Bạn trả tại quầy giúp quán.",
		);
		Object.assign(world, { functionFetch: real });
		expect(screen.getByTestId("pay-counter")).toBeEnabled();
	}, 60_000);
});

describe("paying by bank transfer", () => {
	it("shows the VietQR with its amount, bank, account and reference, and the exact transfer pays the order", async () => {
		const { till, submit } = await toCheckout();
		choose("vietqr");
		fireEvent.click(submit);
		const transfer = await screen.findByTestId("transfer");
		expect(
			screen.getByTestId("transfer-qr").getAttribute("data-payload"),
		).toMatch(/^000201/);
		expect(screen.getByTestId("transfer-amount")).toHaveAttribute(
			"data-price",
			"29000",
		);
		expect(within(transfer).getByTestId("transfer-bank")).toHaveTextContent(
			"Ngân hàng Mẫu",
		);
		expect(screen.getByTestId("transfer-account-value")).toHaveTextContent(
			"0123456789",
		);
		expect(screen.getByTestId("transfer-name")).toHaveTextContent(
			"CUA HANG MAU",
		);
		const reference = till.reference();
		expect(reference).not.toBeNull();
		expect(screen.getByTestId("transfer-reference-value")).toHaveTextContent(
			reference ?? "",
		);
		expect(screen.getByTestId("transfer-countdown")).toHaveTextContent(
			/Mã còn hiệu lực (15:00|14:5\d)/,
		);
		act(() => {
			expect(till.bankTransfer(reference ?? "", 29000)).toBe("paid");
		});
		const order = await acceptedOrder();
		expect(order).toHaveAttribute("data-payment", "paid");
	}, 60_000);

	it("keeps waiting on another amount; when the time runs out C11 says expired and Trả tại quầy places a counter order", async () => {
		const { till, submit } = await toCheckout();
		choose("vietqr");
		fireEvent.click(submit);
		await screen.findByTestId("transfer");
		const first = till.latestOrder();
		act(() => {
			expect(till.bankTransfer(till.reference() ?? "", 20000)).toBe("held");
		});
		await act(() => new Promise((resolve) => setTimeout(resolve, 3500)));
		expect(screen.getByTestId("pay-step")).toHaveAttribute(
			"data-view",
			"transfer",
		);
		act(() => {
			till.expirePayment();
		});
		const result = await screen.findByTestId("payment-result", {}, POLL_WAIT);
		expect(result).toHaveAttribute("data-state", "expired");
		expect(screen.getByTestId("payment-body")).toHaveTextContent(
			"Hết thời gian thanh toán nên đơn đã được hủy. Bạn chưa bị trừ tiền.",
		);
		expect(screen.queryByTestId("payment-retry")).toBeNull();
		fireEvent.click(screen.getByTestId("pay-counter"));
		const order = await screen.findByTestId("order");
		expect(order).toHaveAttribute("data-status", "accepted");
		expect(order).toHaveAttribute("data-payment", "unpaid");
		expect(screen.getByTestId("order-headline")).toHaveTextContent(
			"Mời bạn ra quầy thanh toán",
		);
		expect(till.placements()).toBe(2);
		expect(till.latestOrder()).not.toBe(first);
		expect(till.status(first ?? undefined)).toBe("cancelled");
	}, 60_000);
});

describe("the ways to pay with the flag on", () => {
	it("keeps the online methods disabled where the store offers only the counter", async () => {
		const { submit } = await toCheckout(TABLE, {});
		expect(
			screen
				.getAllByTestId("payment-method")
				.map((element) => element.getAttribute("data-ready")),
		).toEqual(["false", "false", "true"]);
		expect(screen.getAllByTestId("payment-not-ready")).toHaveLength(2);
		fireEvent.click(within(method("vietqr")).getByRole("radio"));
		expect(method("counter")).toHaveAttribute("data-selected", "true");
		fireEvent.click(submit);
		expect(await screen.findByTestId("order")).toHaveAttribute(
			"data-status",
			"accepted",
		);
	}, 60_000);
});
