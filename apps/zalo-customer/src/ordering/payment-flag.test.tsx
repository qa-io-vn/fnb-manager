import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_ITEMS } from "../demo/ordering-fixtures";
import { renderOrderingApp } from "../test/render-ordering";
import { ONLINE_PAYMENT_ENABLED } from "./flag";

// Regression of a build without VITE_ONLINE_PAYMENT (every build until the providers are live): even where the store
// offers the online ways to pay (?payments=online), C05 shows them disabled with the note, the counter stays chosen,
// and the order is placed to pay at the counter. ISTQB: equivalence partition "flag off × offered", decision table row
// of methodSelectable seen through the screen.

describe("online payment without the build flag", () => {
	it("is off in this build", () => {
		expect(ONLINE_PAYMENT_ENABLED).toBe(false);
	});

	it("keeps Ví ZaloPay and Chuyển khoản QR disabled although the store offers them", async () => {
		const { till } = renderOrderingApp({
			search: "?store=mau-1&src=table&t=demo-table-12",
			settings: { onlinePayments: true },
		});
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
		const methods = screen.getAllByTestId("payment-method");
		expect(methods.map((method) => method.getAttribute("data-ready"))).toEqual([
			"false",
			"false",
			"true",
		]);
		expect(screen.getAllByTestId("payment-not-ready")).toHaveLength(2);
		for (const method of methods.slice(0, 2))
			expect(within(method).getByRole("radio")).toBeDisabled();
		fireEvent.click(submit);
		expect(await screen.findByTestId("order")).toHaveAttribute(
			"data-status",
			"accepted",
		);
		expect(till.attempts()).toBe(0);
		expect(screen.queryByTestId("order-pay")).toBeNull();
	}, 30_000);
});
