import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_ITEMS } from "../demo/ordering-fixtures";
import { renderOrderingApp } from "../test/render-ordering";

// Component integration of the customer app's phase-1 screens on the demo world (native-till.md 16.4 to 16.8):
// - C20 (use case, state transitions): the member code of a visitor (no membership needed), its QR and 8 digits with a
//   valid check digit, the refresh making a new code, the counter's attach announced; security: the code is in no
//   attribute, no address and no text but the number itself;
// - C19 (use case, decision table): a visitor deletes at once behind the confirmation; an open order blocks it; the
//   export is shown section by section and copied; security: markup in the data is shown as text, never as markup;
// - C06/C14: "Dự kiến xong lúc HH:MM" once the order is accepted and paid;
// - requests (state transitions new → proposed → cancelled): the proposed time and the store's message, and cancel.

const TABLE = "?store=mau-1&src=table&t=demo-table-12";

function luhnOk(number: string): boolean {
	const digits = number.replace(/\D/g, "");
	let sum = 0;
	for (let index = 0; index < 7; index += 1) {
		const digit = Number(digits[6 - index]);
		const doubled = index % 2 === 0 ? digit * 2 : digit;
		sum += doubled > 9 ? doubled - 9 : doubled;
	}
	return (10 - (sum % 10)) % 10 === Number(digits[7]);
}

async function placeBlackCoffee(note?: string) {
	if (note === undefined) {
		const row = (await screen.findAllByTestId("menu-item")).find(
			(element) =>
				element.getAttribute("data-item-id") === DEMO_ITEMS.blackCoffee,
		);
		if (row === undefined) throw new Error("no black coffee");
		fireEvent.click(
			within(row).getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }),
		);
	} else {
		fireEvent.click(await screen.findByRole("button", { name: /^Cà phê đen/ }));
		fireEvent.change(await screen.findByTestId("item-note"), {
			target: { value: note },
		});
		fireEvent.click(screen.getByTestId("item-add"));
	}
	fireEvent.click(
		within(await screen.findByTestId("cart-bar")).getByRole("button"),
	);
	fireEvent.click(await screen.findByTestId("cart-continue"));
	const submit = await screen.findByTestId("checkout-submit");
	await waitFor(() => expect(submit).toBeEnabled());
	fireEvent.click(submit);
	await screen.findByTestId("order");
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("C20 the member code of the stamp card", () => {
	it("shows a visitor the QR and an 8-digit number with its check digit, makes a new one on refresh, and keeps it out of attributes and the address", async () => {
		const { till } = renderOrderingApp({ search: "?route=/ma-thanh-vien" });
		const number = await screen.findByTestId("stamp-number");
		expect(number.textContent).toMatch(/^\d{4} \d{4}$/);
		expect(luhnOk(number.textContent ?? "")).toBe(true);
		expect(screen.getByTestId("code-countdown")).toHaveTextContent(
			/Mã làm mới sau 0[89]:\d\d/,
		);
		expect(screen.getByTestId("member-code-screen")).toHaveAttribute(
			"data-phase",
			"fresh",
		);
		expect(till.stampCodes()).toBe(1);
		const first = number.textContent;
		fireEvent.click(screen.getByTestId("code-refresh"));
		await waitFor(() => expect(till.stampCodes()).toBe(2));
		await waitFor(() =>
			expect(screen.getByTestId("stamp-number").textContent).not.toBe(first),
		);
		// security: the QR payload is drawn, never written anywhere
		const html = document.body.innerHTML;
		expect(html).not.toContain("fnb-stamp:");
		expect(
			screen.getByTestId("stamp-qr").getAttribute("data-payload"),
		).toBeNull();
		expect(window.location.href).not.toContain(
			(screen.getByTestId("stamp-number").textContent ?? "").replace(" ", ""),
		);
		fireEvent.click(screen.getByTestId("code-enlarge"));
		expect(
			screen.getByRole("dialog", { name: "Đưa mã cho thu ngân" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("code-shrink"));
		expect(screen.queryByTestId("code-enlarged")).toBeNull();
	});

	it("announces an order the counter attached to the card, with the stamps it will earn", async () => {
		const { till } = renderOrderingApp({ search: "?route=/ma-thanh-vien" });
		await screen.findByTestId("stamp-number");
		till.attachToCard(3);
		fireEvent.click(screen.getByTestId("code-refresh"));
		// the card is read again while the code screen is open
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10_500));
		});
		const notice = await screen.findByTestId("code-attached");
		expect(notice).toHaveTextContent("Quầy đã gắn đơn");
		expect(notice).toHaveTextContent("Đơn xong thì 3 dấu vào thẻ.");
	}, 30_000);
});

describe("C19 the customer's data", () => {
	it("deletes a visitor's login at once after the confirmation, and says what was kept", async () => {
		renderOrderingApp({ search: "?route=/du-lieu" });
		fireEvent.click(await screen.findByTestId("data-delete"));
		fireEvent.click(await screen.findByTestId("data-continue"));
		const confirm = await screen.findByTestId("data-confirm-delete");
		expect(confirm).toBeDisabled();
		fireEvent.click(screen.getByTestId("data-confirm-check"));
		fireEvent.click(confirm);
		const done = await screen.findByTestId("data-deleted");
		expect(done).toHaveTextContent("Đã xóa tài khoản");
		expect(screen.getByTestId("data-deleted-facts")).toHaveTextContent(
			"Bản sao lưu xóa hết trước",
		);
	});

	it("blocks the deletion while an order is open (decision table: open order)", async () => {
		renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		await placeBlackCoffee();
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Tôi", { exact: true }),
		);
		fireEvent.click(
			(await screen.findAllByTestId("account-row")).find(
				(row) => row.getAttribute("data-row") === "data",
			) as HTMLElement,
		);
		fireEvent.click(await screen.findByTestId("data-delete"));
		expect(await screen.findByTestId("data-blocked")).toHaveTextContent(
			"Bạn còn 1 đơn chưa xong",
		);
		expect(screen.queryByTestId("data-continue")).toBeNull();
	}, 30_000);

	it("shows the copy of the data section by section, as text, and copies it as JSON", async () => {
		const written: string[] = [];
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: {
				writeText: async (text: string) => {
					written.push(text);
				},
			},
		});
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		await placeBlackCoffee('<img src=x onerror="alert(1)">');
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Tôi", { exact: true }),
		);
		fireEvent.click(
			(await screen.findAllByTestId("account-row")).find(
				(row) => row.getAttribute("data-row") === "data",
			) as HTMLElement,
		);
		fireEvent.click(await screen.findByTestId("data-export"));
		expect(screen.getByTestId("data-export-how")).toHaveTextContent(
			"không lưu tệp vào máy được",
		);
		fireEvent.click(screen.getByTestId("data-export-load"));
		const view = await screen.findByTestId("data-export-view");
		expect(view).toHaveTextContent("Tài khoản Zalo");
		expect(view).toHaveTextContent("Đơn hàng");
		expect(view).toHaveTextContent("Yêu cầu đặt chỗ");
		// security: the note is shown as text; nothing of the data becomes markup
		expect(view).toHaveTextContent('<img src=x onerror="alert(1)">');
		expect(view.querySelector("img")).toBeNull();
		fireEvent.click(screen.getByTestId("data-export-copy"));
		expect(await screen.findByTestId("data-export-copied")).toHaveTextContent(
			"Đã sao chép",
		);
		expect(JSON.parse(written[0] ?? "{}")).toMatchObject({
			login: { zalo_user_id: "demo-zalo-user" },
		});
	}, 30_000);
});

describe("C06 and C14 the ready time", () => {
	it("says when the order should be ready once it is accepted and paid, on the order and in the history", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		await placeBlackCoffee();
		expect(screen.queryByTestId("order-eta")).toBeNull();
		till.act("pay");
		const eta = await screen.findByTestId("order-eta", {}, { timeout: 8000 });
		expect(eta).toHaveAttribute("data-ready", "at");
		expect(eta).toHaveTextContent(
			/Dự kiến xong lúc \d\d:\d\d, khoảng 10 phút nữa/,
		);
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Tôi", { exact: true }),
		);
		fireEvent.click(
			(await screen.findAllByTestId("account-row")).find(
				(row) => row.getAttribute("data-row") === "orders",
			) as HTMLElement,
		);
		expect(await screen.findByTestId("order-row-ready")).toHaveTextContent(
			/Dự kiến xong lúc \d\d:\d\d/,
		);
	}, 30_000);
});

describe("the customer's requests", () => {
	it("say so when there is none", async () => {
		renderOrderingApp({ search: "?route=/yeu-cau-cua-ban" });
		expect(await screen.findByTestId("my-requests-empty")).toHaveTextContent(
			"Bạn chưa có yêu cầu đặt chỗ nào.",
		);
	});

	it("show the time the store proposed with its message, and cancel (new → proposed → cancelled)", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		till.addRequest();
		till.proposeRequest();
		fireEvent.click(
			within(screen.getByRole("navigation")).getByText("Tôi", { exact: true }),
		);
		await screen.findAllByTestId("account-row");
		fireEvent.click(
			screen
				.getAllByTestId("account-row")
				.find(
					(row) => row.getAttribute("data-row") === "requests",
				) as HTMLElement,
		);
		const card = await screen.findByTestId("my-request");
		expect(within(card).getByTestId("my-request-status")).toHaveTextContent(
			"Quán đề xuất giờ khác",
		);
		expect(within(card).getByTestId("my-request-proposed")).toHaveTextContent(
			/Quán đề xuất: 19:30/,
		);
		expect(card).toHaveTextContent("Giờ đó đã kín bàn");
		fireEvent.click(within(card).getByTestId("my-request-cancel"));
		fireEvent.click(await screen.findByTestId("my-request-confirm-cancel"));
		await waitFor(() =>
			expect(screen.getByTestId("my-request-status")).toHaveTextContent(
				"Đã hủy",
			),
		);
		expect(screen.queryByTestId("my-request-cancel")).toBeNull();
	});
});
