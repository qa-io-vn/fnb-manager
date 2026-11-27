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
import type { Shift } from "../shift/api";
import { PaymentDialog } from "./payment-dialog";
import type { Order } from "./types";

// counter:component/payment-shift (Q01 "Thu tiền" with native-till.md 16.2: cash and card need an open shift at the
// order's store, the database answers shift_required otherwise):
// - decision table: method (cash, card) × the person's shift (none, open here, open at another store, awaiting a
//   manager) → the "not on shift" notice with "Vào ca", and the submit disabled unless open here;
// - error guessing: the client thought the person on shift but the server refused shift_required (closed on another
//   device): the refusal's words, "Vào ca", the shift read again, nothing paid;
// - "Vào ca" closes the dialog and opens Ca làm.

const STORE = "11111111-0000-4000-8000-00000000000a";

const state = vi.hoisted(() => ({
	shift: null as Shift | null,
	answer: null as unknown,
	calls: [] as { fn: string; args: unknown }[],
	refreshed: 0,
	navigated: [] as string[],
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({
		client: {
			rpc: async (fn: string, args: unknown) => {
				state.calls.push({ fn, args });
				return { data: state.answer, error: null };
			},
		},
	}),
}));
vi.mock("../shift/shift-context", () => ({
	useShift: () => ({
		current: state.shift,
		refresh: async () => {
			state.refreshed += 1;
		},
	}),
}));
vi.mock("../lib/store", () => ({
	useStore: () => ({ store: { id: STORE, name: "Cửa hàng mẫu A" } }),
}));
vi.mock("react-router-dom", () => ({
	useNavigate: () => (to: string) => state.navigated.push(to),
}));
vi.mock("../ui/toast", () => ({ useToast: () => ({ show: () => undefined }) }));
vi.mock("./board-context", () => ({ useBoardOffersVietQr: () => false }));

function order(): Order {
	return {
		id: "99999999-0000-4000-8000-000000000042",
		order_no: 42,
		display_no: "#042",
		business_date: "2026-11-28",
		source: "counter",
		type: "takeaway",
		table: null,
		pickup_at: null,
		status: "accepted",
		payment_status: "unpaid",
		payment_method: "counter",
		version: 3,
		subtotal: 29000,
		discount_amount: 0,
		total: 29000,
		note: null,
		placed_at: "2026-11-28T03:00:00.000Z",
		accepted_at: "2026-11-28T03:00:00.000Z",
		preparing_at: null,
		done_at: null,
		completed_at: null,
		paid_at: null,
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
	};
}

function shift(overrides: Partial<Shift> = {}): Shift {
	return {
		id: "22222222-0000-4000-8000-000000000001",
		store_id: STORE,
		business_date: "2026-11-28",
		clock_in_at: "2026-11-28T00:00:00Z",
		clock_out_at: null,
		hours: null,
		opening_cash: 0,
		counted_cash: null,
		status: "open",
		closed_at: null,
		close_note: null,
		version: 1,
		...overrides,
	};
}

function open(onClose = vi.fn()) {
	render(
		<I18nProvider language="vi" catalogs={catalogs}>
			<PaymentDialog order={order()} onClose={onClose} onPaid={vi.fn()} />
		</I18nProvider>,
	);
	return onClose;
}

beforeEach(() => {
	state.shift = null;
	state.answer = null;
	state.calls = [];
	state.refreshed = 0;
	state.navigated = [];
});

afterEach(() => {
	cleanup();
});

describe("Thu tiền needs a shift at this counter (decision table)", () => {
	const rows: readonly [string, Shift | null, boolean][] = [
		["no shift", null, true],
		["open here", shift(), false],
		[
			"open at another store",
			shift({ store_id: "11111111-0000-4000-8000-00000000000b" }),
			true,
		],
		["awaiting a manager", shift({ status: "awaiting_confirmation" }), true],
	];
	for (const method of ["cash", "card"] as const) {
		it.each(rows)(`${method}, %s`, (_name, given, notice) => {
			state.shift = given;
			open();
			fireEvent.click(screen.getByTestId(`pay-${method}`));
			if (method === "cash")
				fireEvent.click(screen.getByTestId("pay-quick-29000"));
			if (notice) {
				expect(screen.getByTestId("pay-need-shift")).toHaveTextContent(
					"Bạn chưa vào ca ở quầy này",
				);
				expect(screen.getByTestId("pay-go-shift")).toHaveTextContent("Vào ca");
				expect(screen.getByTestId("pay-submit")).toBeDisabled();
			} else {
				expect(screen.queryByTestId("pay-need-shift")).toBeNull();
				expect(screen.getByTestId("pay-submit")).toBeEnabled();
			}
		});
	}
});

describe("the server's shift_required (error guessing)", () => {
	it("words the refusal, offers Vào ca and reads the shift again; nothing is paid", async () => {
		state.shift = shift();
		state.answer = {
			state: "refused",
			refusal: "shift_required",
			replayed: false,
			order: order(),
		};
		const onClose = open();
		fireEvent.click(screen.getByTestId("pay-card"));
		fireEvent.click(screen.getByTestId("pay-submit"));
		const notice = await screen.findByTestId("pay-need-shift");
		expect(notice).toHaveTextContent(
			"Bạn chưa vào ca ở quầy này. Vào ca rồi thu tiền.",
		);
		expect(notice).toHaveAttribute("role", "alert");
		expect(screen.getByTestId("pay-submit")).toBeDisabled();
		await waitFor(() => expect(state.refreshed).toBe(1));
		expect(state.calls).toHaveLength(1);
		expect(state.calls[0]).toEqual({
			fn: "counter_record_payment",
			args: {
				p_order: order().id,
				p_method: "card",
				p_amount: 29000,
				p_expected_version: 3,
			},
		});
		fireEvent.click(screen.getByTestId("pay-go-shift"));
		expect(onClose).toHaveBeenCalled();
		expect(state.navigated).toEqual(["/ca"]);
	});
});
