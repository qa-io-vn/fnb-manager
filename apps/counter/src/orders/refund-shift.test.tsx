import { I18nProvider } from "@fnb/zalo-mini/i18n";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "../i18n/catalog";
import { RefundDialog } from "./cancel-dialog";
import type { Order } from "./types";

// counter:component/refund-shift (Q03 with native-till.md 18.3: a cash refund needs the person's open shift at the
// order's store, counter_refund answers shift_required otherwise, nothing written):
// - error guessing: the refusal's words with "Vào ca" (the payment dialog's way forward), the shift read again, nothing
//   refunded; "Vào ca" closes the dialog and opens Ca làm;
// - state transitions: refused off shift → (clocked in elsewhere) the same submit refunds, the notice goes;
// - equivalence partitions of the other refusals: worded as before, without "Vào ca".

const state = vi.hoisted(() => ({
	answers: [] as unknown[],
	calls: [] as { fn: string; args: unknown }[],
	refreshed: 0,
	navigated: [] as string[],
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({
		client: {
			rpc: async (fn: string, args: unknown) => {
				state.calls.push({ fn, args });
				return { data: state.answers.shift() ?? null, error: null };
			},
		},
	}),
}));
vi.mock("../shift/shift-context", () => ({
	useShift: () => ({
		current: null,
		refresh: async () => {
			state.refreshed += 1;
		},
	}),
}));
vi.mock("react-router-dom", () => ({
	useNavigate: () => (to: string) => state.navigated.push(to),
}));

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: "99999999-0000-4000-8000-000000000042",
		order_no: 42,
		display_no: "#042",
		business_date: "2026-11-28",
		source: "counter",
		type: "takeaway",
		table: null,
		pickup_at: null,
		status: "completed",
		payment_status: "paid",
		payment_method: "cash",
		version: 6,
		subtotal: 29000,
		discount_amount: 0,
		total: 29000,
		note: null,
		placed_at: "2026-11-28T03:00:00.000Z",
		accepted_at: "2026-11-28T03:00:00.000Z",
		preparing_at: null,
		done_at: null,
		completed_at: "2026-11-28T03:10:00.000Z",
		paid_at: "2026-11-28T03:01:00.000Z",
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
		money: {
			paid: 29000,
			refunded: 0,
			refund_open: 0,
			payments: [],
			refunds: [],
		},
		...overrides,
	};
}

function open() {
	const onClose = vi.fn();
	const onDone = vi.fn();
	render(
		<I18nProvider language="vi" catalogs={catalogs}>
			<RefundDialog order={order()} onClose={onClose} onDone={onDone} />
		</I18nProvider>,
	);
	fireEvent.change(screen.getByTestId("refund-reason"), {
		target: { value: "Pha sai, khách không nhận" },
	});
	return { onClose, onDone };
}

beforeEach(() => {
	state.answers = [];
	state.calls = [];
	state.refreshed = 0;
	state.navigated = [];
});

afterEach(() => {
	cleanup();
});

describe("a cash refund off shift (error guessing)", () => {
	it("words shift_required with Vào ca, reads the shift again and refunds nothing", async () => {
		state.answers = [
			{
				state: "refused",
				refusal: "shift_required",
				order: order(),
			},
		];
		const { onClose, onDone } = open();
		expect(screen.queryByTestId("refund-need-shift")).toBeNull();
		fireEvent.click(screen.getByTestId("refund-submit"));
		const notice = await screen.findByTestId("refund-need-shift");
		expect(notice).toHaveAttribute("role", "alert");
		expect(notice).toHaveTextContent(
			"Bạn chưa vào ca ở quầy này. Vào ca rồi hoàn tiền mặt.",
		);
		expect(screen.getByTestId("refund-go-shift")).toHaveTextContent("Vào ca");
		await waitFor(() => expect(state.refreshed).toBe(1));
		expect(onDone).not.toHaveBeenCalled();
		expect(state.calls).toEqual([
			{
				fn: "counter_refund",
				args: {
					p_order: order().id,
					p_amount: 29000,
					p_reason: "Pha sai, khách không nhận",
				},
			},
		]);
		fireEvent.click(screen.getByTestId("refund-go-shift"));
		expect(onClose).toHaveBeenCalled();
		expect(state.navigated).toEqual(["/ca"]);
	});

	it("refunds with the same submit once the person clocked in elsewhere (state transition)", async () => {
		state.answers = [
			{ state: "refused", refusal: "shift_required", order: order() },
			{
				state: "succeeded",
				refusal: null,
				amount: 29000,
				order: order({ payment_status: "refunded" }),
			},
		];
		const { onDone } = open();
		fireEvent.click(screen.getByTestId("refund-submit"));
		await screen.findByTestId("refund-need-shift");
		expect(screen.getByTestId("refund-submit")).toBeEnabled();
		fireEvent.click(screen.getByTestId("refund-submit"));
		await waitFor(() => expect(onDone).toHaveBeenCalled());
		expect(onDone.mock.calls[0]?.[1]).toBe("Đã hoàn 29.000đ.");
		expect(screen.queryByTestId("refund-need-shift")).toBeNull();
	});
});

describe("the other refusals (EP)", () => {
	it.each([
		["manager_required", "Chỉ quản lý hoàn được khoản này."],
		["not_refundable", "Đơn này không có khoản nào để hoàn."],
	])("%s is worded without Vào ca", async (refusal, words) => {
		state.answers = [{ state: "refused", refusal, order: order() }];
		open();
		fireEvent.click(screen.getByTestId("refund-submit"));
		expect(await screen.findByText(words)).toBeVisible();
		expect(screen.queryByTestId("refund-need-shift")).toBeNull();
		expect(state.refreshed).toBe(0);
	});
});
