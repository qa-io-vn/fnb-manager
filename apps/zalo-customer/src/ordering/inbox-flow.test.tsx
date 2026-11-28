import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_SIZES } from "../demo/ordering-fixtures";
import { renderOrderingApp } from "../test/render-ordering";

// Component integration of C12 Thông báo on the demo world (design spec C12, GA-063 to GA-066):
// - use case: the bell on C01 counts the unread items and names the count, opens C12; a row opens its order (C06) and
//   is read when the customer comes back; the filters (aria-pressed) show orders or offers, each with its empty state;
// - state transitions of the switch: off -> the opt-in sheet ("Để sau" changes nothing; "Đồng ý" records the consent)
//   -> on -> the follow-the-shop offer -> followed; on -> the existing stop sheet -> off; a visitor is offered joining
//   instead of a switch;
// - accessibility: the unread dot is spoken "chưa đọc", the switch is a named role="switch" with its state word;
// - regression: Tôi keeps its rows and the settings, with the new row naming the unread count.

const TEA = DEMO_SIZES.lotusTea;

afterEach(() => {
	vi.restoreAllMocks();
});

/** An order of the customer still open at the counter, which the till then pays and brings to the table. */
function servedOrder(
	till: ReturnType<typeof renderOrderingApp>["till"],
): string {
	const order = till.pastOrder({
		status: "accepted",
		daysAgo: 0,
		lines: [{ size: TEA, qty: 2 }],
	});
	till.act("pay", order);
	till.act("start", order);
	till.act("done", order);
	return order;
}

describe("the bell and the list", () => {
	it("counts the unread items on C01, names the count, and opens C12 with the rows newest first", async () => {
		const { till } = renderOrderingApp();
		servedOrder(till);
		const bell = await screen.findByRole("button", {
			name: "Thông báo, 2 chưa đọc",
		});
		expect(within(bell).getByTestId("inbox-bell-badge")).toHaveTextContent("2");
		fireEvent.click(bell);
		await screen.findByTestId("inbox");
		const rows = await screen.findAllByTestId("inbox-row");
		expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
			"order_ready",
			"order_receipt",
		]);
		expect(rows[0]).toHaveAttribute("data-unread", "true");
		expect(rows[0]).toHaveTextContent("Món của bạn đã xong");
		expect(rows[0]).toHaveTextContent(
			"Trà sen và 1 món khác đang trên đường ra Bàn 12",
		);
		expect(within(rows[0] as HTMLElement).getByText("chưa đọc")).toHaveClass(
			"sr-only",
		);
		// the receipt's amount is a PriceText, never words
		expect(
			rows[1]?.querySelector("[data-price]")?.getAttribute("data-price"),
		).toBe("98000");
	});

	it("opens the order from its row and shows it read on return", async () => {
		// from C01: a screen opened with ?route= stays the one the address names
		const { till } = renderOrderingApp();
		const order = servedOrder(till);
		fireEvent.click(
			await screen.findByRole("button", { name: "Thông báo, 2 chưa đọc" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: /Món của bạn đã xong/ }),
		);
		const opened = await screen.findByTestId("order");
		expect(opened).toHaveAttribute("data-status", "serving");
		expect(till.inbox()).toEqual(["order_ready", "order_receipt"]);
		fireEvent.click(screen.getByRole("button", { name: /Trang chủ/ }));
		expect(
			await screen.findByRole("button", { name: "Thông báo, 1 chưa đọc" }),
		).toBeInTheDocument();
		expect(order).toMatch(/^99999999-/);
	});

	it("filters orders and offers, each with its empty state", async () => {
		const { till } = renderOrderingApp({ search: "?route=/thong-bao" });
		servedOrder(till);
		await screen.findAllByTestId("inbox-row");
		const offers = screen.getByRole("button", { name: "Ưu đãi" });
		fireEvent.click(offers);
		expect(offers).toHaveAttribute("aria-pressed", "true");
		expect(await screen.findByTestId("inbox-empty")).toHaveTextContent(
			"Chưa có thông báo nào.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Đơn hàng" }));
		await waitFor(() =>
			expect(screen.getAllByTestId("inbox-row")).toHaveLength(2),
		);
	});
});

describe("Nhận tin ưu đãi qua Zalo", () => {
	it("offers a visitor joining instead of a switch", async () => {
		renderOrderingApp({ search: "?route=/thong-bao" });
		expect(await screen.findByTestId("inbox-marketing-join")).toHaveTextContent(
			"Tham gia thành viên",
		);
		expect(screen.queryByRole("switch")).toBeNull();
	});

	it("turns on behind the opt-in sheet, then offers to follow the shop; Để sau changes nothing", async () => {
		const { world } = renderOrderingApp({
			search: "?route=/thong-bao",
			settings: { member: true },
		});
		const toggle = await screen.findByRole("switch", {
			name: /Nhận tin ưu đãi qua Zalo/,
		});
		expect(toggle).toHaveAttribute("aria-checked", "false");
		expect(screen.getByText("Đang tắt")).toBeInTheDocument();
		expect(screen.getByTestId("inbox-marketing-card")).toHaveTextContent(
			"Tối đa 2 tin mỗi tuần",
		);
		fireEvent.click(toggle);
		const sheet = await screen.findByTestId("inbox-opt-in");
		expect(sheet).toHaveTextContent(
			"Quán gửi tối đa 2 tin mỗi tuần, tắt lúc nào cũng được.",
		);
		fireEvent.click(within(sheet).getByTestId("inbox-opt-in-later"));
		await waitFor(() =>
			expect(screen.queryByTestId("inbox-opt-in")).toBeNull(),
		);
		expect(world.marketing()).toBe(false);
		fireEvent.click(toggle);
		fireEvent.click(await screen.findByTestId("inbox-opt-in-accept"));
		expect(await screen.findByTestId("inbox-opt-in-done")).toHaveTextContent(
			"Đã bật nhận tin ưu đãi qua Zalo.",
		);
		expect(world.marketing()).toBe(true);
		expect(
			screen.getByRole("switch", { name: /Nhận tin ưu đãi qua Zalo/ }),
		).toHaveAttribute("aria-checked", "true");
		fireEvent.click(screen.getByTestId("inbox-follow"));
		expect(
			await screen.findByText("Bạn đã theo dõi Zalo của quán."),
		).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("inbox-opt-in-close"));
		await waitFor(() =>
			expect(screen.queryByTestId("inbox-opt-in")).toBeNull(),
		);
	});

	it("turns off with the existing stop sheet", async () => {
		const { world } = renderOrderingApp({
			search: "?route=/thong-bao",
			settings: { member: true, marketing: true },
		});
		const toggle = await screen.findByRole("switch", {
			name: /Nhận tin ưu đãi qua Zalo/,
		});
		await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
		fireEvent.click(toggle);
		const sheet = await screen.findByTestId("inbox-stop");
		expect(sheet).toHaveTextContent("Dừng nhận tin khuyến mãi?");
		fireEvent.click(within(sheet).getByTestId("inbox-stop-confirm"));
		await waitFor(() =>
			expect(
				screen.getByRole("switch", { name: /Nhận tin ưu đãi qua Zalo/ }),
			).toHaveAttribute("aria-checked", "false"),
		);
		expect(world.marketing()).toBe(false);
	});

	it("shows a campaign's offer to a member who consented", async () => {
		const { till } = renderOrderingApp({
			search: "?route=/thong-bao",
			settings: { member: true, marketing: true },
		});
		await screen.findByTestId("inbox");
		till.offer("Ưu đãi cuối tuần", "Giảm giá cho khách ghé trước 10 giờ");
		fireEvent.click(screen.getByRole("button", { name: "Ưu đãi" }));
		const row = await screen.findByTestId("inbox-row");
		expect(row).toHaveAttribute("data-kind", "offer");
		expect(row).toHaveTextContent("Ưu đãi cuối tuần");
	});
});

describe("regression: Tôi", () => {
	it("keeps its rows and the settings, and names the unread count on the new row", async () => {
		const { till } = renderOrderingApp({
			search: "?route=/tai-khoan",
			settings: { member: true },
		});
		servedOrder(till);
		const rows = await screen.findAllByTestId("account-row");
		expect(rows.map((row) => row.getAttribute("data-row"))).toEqual([
			"orders",
			"code",
			"company",
			"requests",
			"inbox",
			"data",
		]);
		await waitFor(() =>
			expect(
				rows.find((row) => row.getAttribute("data-row") === "inbox"),
			).toHaveTextContent("2 chưa đọc"),
		);
		expect(await screen.findByTestId("settings-marketing")).toBeInTheDocument();
	});
});
