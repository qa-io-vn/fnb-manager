import {
	COUNTER_CLAIM_RECORD_STATES,
	type CounterClaimRecord,
	type CounterClaimRecordState,
} from "@fnb/zalo-mini/loyalty";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCustomerApp, setSearch } from "../test/render-app";
import { ringSegments } from "./stamps-ring";
import { CounterClaimsCard } from "./wallet-screen";

afterEach(() => setSearch(""));

async function openWallet() {
	await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
	fireEvent.click(screen.getByText("Thẻ thành viên"));
	return screen.findByTestId("wallet");
}

describe("the stamps ring", () => {
	it("fills confirmed stamps, then pending ones, then the rest", () => {
		expect(ringSegments(3, 1, 10).map((segment) => segment.state)).toEqual([
			"filled",
			"filled",
			"filled",
			"pending",
			"empty",
			"empty",
			"empty",
			"empty",
			"empty",
			"empty",
		]);
		expect(
			ringSegments(12, 4, 5).every((segment) => segment.state === "filled"),
		).toBe(true);
		expect(ringSegments(0, 0, 1)).toHaveLength(1);
	});
});

describe("the wallet", () => {
	it("shows the card content the law asks for, stamps, points, tier, expiry and history", async () => {
		renderCustomerApp({ settings: { member: true } });
		const wallet = within(await openWallet());
		const card = within(wallet.getByTestId("member-card"));
		expect(card.getByTestId("card-programme")).toHaveTextContent(
			"Thành viên Quán Mẫu Một",
		);
		expect(card.getByTestId("card-name")).toHaveTextContent("Khách thử");
		expect(card.getByTestId("card-phone")).toHaveTextContent("•••• ••• 789");
		expect(card.getByTestId("card-purchases")).toHaveTextContent(
			"Số lần mua: 2",
		);
		expect(wallet.getByTestId("stamp-count")).toHaveTextContent("3/10 dấu");
		expect(wallet.getByTestId("stamps-pending")).toHaveTextContent(
			"1 dấu đang chờ xác nhận",
		);
		expect(
			wallet.getByRole("img", {
				name: /3 trên 10 dấu, 1 dấu đang chờ xác nhận/,
			}),
		).toBeInTheDocument();
		expect(wallet.getByTestId("points-balance")).toHaveTextContent("105");
		expect(wallet.getByTestId("points-pending")).toHaveTextContent(
			"30 điểm đang chờ xác nhận",
		);
		expect(wallet.getByTestId("points-expiring")).toHaveTextContent(
			"45 điểm có hạn đến hết ngày",
		);
		expect(wallet.getByTestId("tier")).toHaveTextContent(
			"Hạng Thành viên. Còn 395 điểm để lên hạng Bạc.",
		);
		const items = wallet.getAllByTestId("history-item");
		expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
			"pending",
			"confirmed",
			"reversed",
			"confirmed",
			"confirmed",
		]);
		expect(items[0]).toHaveTextContent("Đang chờ xác nhận");
		expect(items[0]).toHaveTextContent("Qua mã thành viên");
		expect(items[1]).toHaveTextContent("Qua mã thành viên");
		expect(items[2]).toHaveTextContent("Đã hoàn lại");
		expect(items[3]).toHaveTextContent("Qua số điện thoại");
		expect(items[3]).toHaveTextContent("Hóa đơn 0101");
		expect(items[4]).toHaveTextContent("Dấu chào mừng");
	});

	it("stops promotions after a confirmation", async () => {
		const app = renderCustomerApp({
			settings: { member: true, marketing: true },
		});
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByText("Tài khoản"));
		expect(await screen.findByTestId("marketing-state")).toHaveTextContent(
			"Bạn đang nhận tin khuyến mãi qua Zalo.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Dừng nhận tin" }));
		const dialog = within(await screen.findByRole("dialog"));
		expect(app.world.marketing()).toBe(true);
		fireEvent.click(dialog.getByRole("button", { name: "Dừng nhận tin" }));
		expect(await screen.findByText("Đã dừng nhận tin")).toBeInTheDocument();
		expect(app.world.marketing()).toBe(false);
		expect(await screen.findByTestId("marketing-state")).toHaveTextContent(
			"Bạn không nhận tin khuyến mãi.",
		);
		expect(
			screen.queryByRole("button", { name: "Dừng nhận tin" }),
		).not.toBeInTheDocument();
	});

	it("states the last valid day of a credit, a date and never a time (ADR-047)", async () => {
		renderCustomerApp({ settings: { member: true } });
		const wallet = within(await openWallet());
		expect(wallet.getByTestId("stamps-valid-through").textContent).toMatch(
			/^Dấu có hạn đến hết ngày \d{2}\/\d{2}\/\d{4}$/,
		);
		expect(wallet.getByTestId("points-expiring").textContent).toMatch(
			/^45 điểm có hạn đến hết ngày \d{2}\/\d{2}\/\d{4}$/,
		);
	});

	it("follows the instant a credit ends while the wallet is open: the notice goes and the wallet is read again (ADR-047)", async () => {
		vi.useFakeTimers({
			shouldAdvanceTime: true,
			now: Date.parse("2026-11-23T03:00:00Z"),
		});
		try {
			renderCustomerApp({ settings: { member: true } });
			const wallet = within(await openWallet());
			expect(wallet.getByTestId("points-expiring")).toBeInTheDocument();
			const before = Number(wallet.getByTestId("points-balance").textContent);
			expect(before).toBeGreaterThan(0);
			// past the end of every credit of the demo member (points last twelve months)
			vi.setSystemTime(Date.now() + 400 * 86_400_000);
			await act(() => vi.advanceTimersByTimeAsync(31_000));
			await waitFor(() =>
				expect(screen.queryByTestId("points-expiring")).toBeNull(),
			);
			await waitFor(() =>
				expect(
					Number(screen.getByTestId("points-balance").textContent),
				).toBeLessThan(before),
			);
			expect(screen.queryByTestId("stamps-valid-through")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("offers joining to a visitor on the account tab", async () => {
		renderCustomerApp();
		await screen.findByRole("heading", { name: "Thành viên Quán Mẫu Một" });
		fireEvent.click(screen.getByText("Tài khoản"));
		const visitor = within(await screen.findByTestId("settings-visitor"));
		expect(
			visitor.getByRole("button", { name: "Tham gia thành viên" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Dừng nhận tin" }),
		).not.toBeInTheDocument();
	});
});

// G-92. Equivalence partitioning of a counter claim's state (each has its own words and tone), the decision of the
// deadline line (only while the claim waits for the staff), and security: a total never reaches the screen.
describe("the counter claims of the wallet", () => {
	const claim = (
		state: CounterClaimRecordState,
		index: number,
	): CounterClaimRecord => ({
		id: `00000000-0000-4000-8000-00000000c00${index}`,
		storeName: "Cửa hàng Mẫu 1",
		billNo: `HD07${index}`,
		submittedAt: "2026-11-19T03:00:00.000Z",
		state,
		waitingUntil:
			state === "awaiting_staff" ? "2026-11-19T09:00:00.000Z" : null,
		decidedAt: null,
	});

	it("words every state, and gives a deadline only to a claim waiting for the staff", async () => {
		const claims = COUNTER_CLAIM_RECORD_STATES.map(claim);
		renderCustomerApp({
			settings: { member: true },
			routes: [{ path: "/", element: <CounterClaimsCard claims={claims} /> }],
		});
		const card = await screen.findByTestId("counter-claims");
		expect(
			within(card).getByRole("heading", { name: "Hóa đơn gửi tại quầy" }),
		).toBeInTheDocument();
		const items = within(card).getAllByTestId("counter-claim-item");
		expect(items.map((item) => item.getAttribute("data-state"))).toEqual([
			...COUNTER_CLAIM_RECORD_STATES,
		]);
		expect(items.map((item) => item.textContent)).toEqual(
			[
				"Chờ nhân viên đối chiếu",
				"Quản lý đang kiểm tra",
				"Đã cộng điểm",
				"Không nhận",
				"Hết thời gian chờ",
				"Đã hủy",
			].map((state) => expect.stringContaining(state)),
		);
		expect(items[0]).toHaveTextContent("Hóa đơn HD070");
		expect(items[0]).toHaveTextContent(
			/Cửa hàng Mẫu 1, gửi lúc \d\d:\d\d \d\d\/\d\d\/\d{4}/,
		);
		expect(
			within(items[0] as HTMLElement).getByTestId("counter-claim-deadline"),
		).toHaveTextContent(
			/^Nhân viên đối chiếu trước \d\d:\d\d \d\d\/\d\d\/\d{4}$/,
		);
		expect(within(card).getAllByTestId("counter-claim-deadline")).toHaveLength(
			1,
		);
	});

	it("shows nothing when there is no claim", async () => {
		renderCustomerApp({
			settings: { member: true },
			routes: [
				{
					path: "/",
					element: (
						<>
							<p>loaded</p>
							<CounterClaimsCard claims={[]} />
						</>
					),
				},
			],
		});
		await screen.findByText("loaded");
		expect(screen.queryByTestId("counter-claims")).toBeNull();
	});
});
