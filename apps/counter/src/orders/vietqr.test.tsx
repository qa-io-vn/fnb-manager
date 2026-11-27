import { I18nProvider } from "@fnb/zalo-mini/i18n";
import { vietQrPayload } from "@fnb/zalo-mini/ordering";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CounterEnvironment } from "../env";
import { catalogs } from "../i18n/catalog";
import { PaymentDialog } from "./payment-dialog";
import type { Order } from "./types";

// counter:component/vietqr (Q01 "Thu tiền", the VietQR tab) against a stubbed checkout-order and counter_order:
// - decision table of the tab: the store offers VietQR (shown) or not (no tab); provider_off hides it for the dialog;
// - state transitions: starting → the QR (amount, reference, bank, account, countdown, "Chờ khách chuyển khoản…") →
//   "Đã nhận tiền" only once counter_order answers paid → the paid order handed back; a cancelled order is worded;
//   already_paid reads the order and hands it back;
// - error guessing: a lost answer retried with the same key (the same attempt), an expired code made again with a new
//   key, a malformed answer (a QR of another amount) refused, too_many_attempts worded;
// - security: the request carries the staff session's bearer token and only ids, the method and `for: "counter"` (no
//   price); nothing is recorded by hand (no counter_record_payment), the server alone says paid.

const ORDER_ID = "99999999-0000-4000-8000-000000000042";
const PAYMENT_ID = "77777777-0000-4000-8000-000000000042";
const ENV: CounterEnvironment = {
	supabaseUrl: "http://127.0.0.1:54321",
	publishableKey: "sb_publishable_synthetic",
	sessionUrl: "http://127.0.0.1:5767",
	checkoutUrl: "http://127.0.0.1:54321/functions/v1/checkout-order",
	brand: "brand-1",
};

const state = vi.hoisted(() => ({
	offers: true,
	orderAnswer: null as unknown,
	rpcCalls: [] as string[],
	toasts: [] as string[],
}));

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: ORDER_ID,
		order_no: 42,
		display_no: "#042",
		business_date: "2026-11-27",
		source: "counter",
		type: "takeaway",
		table: null,
		pickup_at: null,
		status: "accepted",
		payment_status: "unpaid",
		payment_method: "counter",
		version: 1,
		subtotal: 58000,
		discount_amount: 0,
		total: 58000,
		note: null,
		placed_at: "2026-11-27T03:00:00.000Z",
		accepted_at: "2026-11-27T03:00:00.000Z",
		preparing_at: null,
		done_at: null,
		completed_at: null,
		paid_at: null,
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
		...overrides,
	};
}

const session = vi.hoisted(() => ({
	client: {
		auth: {
			getSession: async () => ({
				data: { session: { access_token: "staff-token" } },
			}),
		},
		rpc: async (fn: string) => {
			state.rpcCalls.push(fn);
			return { data: state.orderAnswer, error: null };
		},
	},
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({ client: session.client, environment: ENV }),
}));
vi.mock("../shift/shift-context", () => ({
	useShift: () => ({ current: null, refresh: async () => undefined }),
}));
vi.mock("../lib/store", () => ({
	useStore: () => ({ store: { id: "store-a", name: "Cửa hàng mẫu A" } }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => undefined }));
vi.mock("../ui/toast", () => ({
	useToast: () => ({ show: (text: string) => state.toasts.push(text) }),
}));
vi.mock("./board-context", () => ({
	useBoardOffersVietQr: () => state.offers,
}));

interface Sent {
	readonly url: string;
	readonly headers: Record<string, string>;
	readonly body: Record<string, unknown>;
}

function attempt(overrides: Record<string, unknown> = {}, amount = 58000) {
	return {
		state: "pending",
		refusal: null,
		replayed: false,
		payment: {
			id: PAYMENT_ID,
			order_id: ORDER_ID,
			method: "vietqr",
			amount: 58000,
			reference: "FNB12345678",
			expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
			mode: "sandbox",
			checkout: null,
			qr: {
				payload: vietQrPayload({
					bankBin: "970400",
					accountNumber: "0123456789",
					amount,
					reference: "FNB12345678",
				}),
				bank_bin: "970400",
				bank_name: "Ngân hàng Mẫu",
				account_number: "0123456789",
				account_name: "CUA HANG MAU",
				amount: 58000,
				reference: "FNB12345678",
				popup_method: "BANK_SANDBOX",
			},
			...overrides,
		},
	};
}

function stubFunction(...answers: (unknown | Error)[]): Sent[] {
	const sent: Sent[] = [];
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			sent.push({
				url: String(input),
				headers: init?.headers as Record<string, string>,
				body: JSON.parse(String(init?.body)),
			});
			const next = answers[Math.min(sent.length, answers.length) - 1];
			if (next instanceof Error) throw next;
			return new Response(JSON.stringify(next), { status: 200 });
		},
	);
	return sent;
}

function open(onPaid = vi.fn()) {
	const errors = vi.spyOn(console, "error");
	render(
		<I18nProvider language="vi" catalogs={catalogs}>
			<PaymentDialog order={order()} onClose={vi.fn()} onPaid={onPaid} />
		</I18nProvider>,
	);
	return { onPaid, errors };
}

beforeEach(() => {
	state.offers = true;
	state.orderAnswer = order();
	state.rpcCalls = [];
	state.toasts = [];
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("the VietQR tab of Thu tiền", () => {
	it("is not there when the store does not offer VietQR", () => {
		state.offers = false;
		open();
		expect(screen.getByTestId("pay-cash")).toBeInTheDocument();
		expect(screen.getByTestId("pay-card")).toBeInTheDocument();
		expect(screen.queryByTestId("pay-vietqr")).toBeNull();
	});

	it("shows the QR with the amount, the reference and the countdown, and hands the order back only once the server says paid", async () => {
		const sent = stubFunction(attempt());
		const { onPaid, errors } = open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		const panel = await screen.findByTestId("vietqr");
		expect(panel).toHaveAttribute("data-reference", "FNB12345678");
		expect(
			screen.getByTestId("vietqr-code").getAttribute("data-payload"),
		).toMatch(/^000201/);
		expect(screen.getByTestId("vietqr-amount")).toHaveAttribute(
			"data-price",
			"58000",
		);
		expect(screen.getByTestId("vietqr-reference")).toHaveTextContent(
			"FNB12345678",
		);
		expect(screen.getByTestId("vietqr-account")).toHaveTextContent(
			"0123456789 · CUA HANG MAU",
		);
		expect(screen.getByTestId("vietqr-countdown")).toHaveTextContent(
			/Mã còn (15:00|14:5\d)/,
		);
		expect(screen.getByTestId("vietqr-waiting")).toHaveTextContent(
			"Chờ khách chuyển khoản…",
		);
		expect(screen.getByTestId("vietqr-sandbox")).toBeInTheDocument();
		expect(screen.queryByTestId("pay-submit")).toBeNull();
		expect(screen.getByTestId("pay-qr-close")).toBeInTheDocument();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(ENV.checkoutUrl);
		expect(sent[0]?.headers.Authorization).toBe("Bearer staff-token");
		expect(sent[0]?.headers.apikey).toBe(ENV.publishableKey);
		expect(sent[0]?.body).toEqual({
			action: "start",
			order_id: ORDER_ID,
			method: "vietqr",
			idempotency_key: expect.stringMatching(/^[A-Za-z0-9_-]{8,100}$/),
			for: "counter",
		});
		// a poll that still says unpaid changes nothing
		await waitFor(() => expect(state.rpcCalls).toContain("counter_order"), {
			timeout: 4000,
		});
		expect(screen.queryByTestId("vietqr-paid")).toBeNull();
		state.orderAnswer = order({
			payment_status: "paid",
			paid_at: "2026-11-27T03:05:00.000Z",
			version: 2,
		});
		expect(
			await screen.findByTestId("vietqr-paid", {}, { timeout: 4000 }),
		).toHaveTextContent("Đã nhận tiền");
		await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1), {
			timeout: 3000,
		});
		expect(onPaid.mock.calls[0]?.[0]).toMatchObject({
			id: ORDER_ID,
			payment_status: "paid",
		});
		expect(state.toasts).toEqual(["Đã thu 58.000đ."]);
		expect(state.rpcCalls).not.toContain("counter_record_payment");
		expect(errors).not.toHaveBeenCalled();
	}, 15_000);

	it("goes back to cash with a note when the provider is off", async () => {
		stubFunction({
			state: "refused",
			refusal: "provider_off",
			replayed: false,
			payment: null,
		});
		open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		expect(await screen.findByTestId("pay-qr-off")).toHaveTextContent(
			"Cửa hàng chưa bật VietQR. Thu tiền mặt hoặc thẻ.",
		);
		expect(screen.queryByTestId("pay-vietqr")).toBeNull();
		expect(screen.getByTestId("pay-cash")).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("reads an order already paid and hands it back", async () => {
		stubFunction({
			state: "refused",
			refusal: "already_paid",
			replayed: false,
			payment: null,
		});
		state.orderAnswer = order({ payment_status: "paid" });
		const { onPaid } = open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		expect(await screen.findByTestId("vietqr-paid")).toBeInTheDocument();
		await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1), {
			timeout: 3000,
		});
	});

	it("words too many attempts", async () => {
		stubFunction({
			state: "refused",
			refusal: "too_many_attempts",
			replayed: false,
			payment: null,
		});
		open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		expect(await screen.findByTestId("vietqr-refused")).toHaveTextContent(
			"Đã tạo mã quá số lần cho phép. Thu tiền mặt hoặc thẻ.",
		);
	});

	it("retries a lost answer with the same key, so it is the same attempt", async () => {
		const sent = stubFunction(new TypeError("offline"), attempt());
		open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		expect(await screen.findByTestId("vietqr-error")).toHaveTextContent(
			"Không có mạng. Thử lại khi có mạng.",
		);
		fireEvent.click(screen.getByTestId("vietqr-retry"));
		expect(await screen.findByTestId("vietqr")).toBeInTheDocument();
		expect(sent).toHaveLength(2);
		expect(sent[1]?.body.idempotency_key).toBe(sent[0]?.body.idempotency_key);
	});

	it("makes a new code with a new key once the code expired", async () => {
		const sent = stubFunction(
			attempt({ expires_at: new Date(Date.now() - 1000).toISOString() }),
			attempt(),
		);
		open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		expect(await screen.findByTestId("vietqr-countdown")).toHaveTextContent(
			"Mã đã hết hạn.",
		);
		fireEvent.click(screen.getByTestId("vietqr-new"));
		await waitFor(() => expect(sent).toHaveLength(2));
		expect(sent[1]?.body.idempotency_key).not.toBe(
			sent[0]?.body.idempotency_key,
		);
		await waitFor(() =>
			expect(screen.getByTestId("vietqr-countdown")).toHaveTextContent(
				/Mã còn/,
			),
		);
	});

	it("refuses a malformed answer (a QR of another amount) and shows no code", async () => {
		stubFunction(attempt({}, 1000));
		open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		expect(await screen.findByTestId("vietqr-error")).toHaveTextContent(
			"Chưa làm được. Thử lại.",
		);
		expect(screen.queryByTestId("vietqr-code")).toBeNull();
	});

	it("words an order cancelled while the code waits", async () => {
		stubFunction(attempt());
		open();
		fireEvent.click(screen.getByTestId("pay-vietqr"));
		await screen.findByTestId("vietqr");
		state.orderAnswer = order({ status: "cancelled" });
		expect(
			await screen.findByTestId("vietqr-refused", {}, { timeout: 4000 }),
		).toHaveTextContent("Đơn đã bị hủy.");
	}, 10_000);
});
