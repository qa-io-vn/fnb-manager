import { I18nProvider } from "@fnb/zalo-mini/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "../i18n/catalog";
import type { Shift, ShiftReconciliation } from "./api";
import { ReconciliationDialog, ReconciliationPanel } from "./reconciliation";

// counter:component/shift-reconciliation (Q02 "Đối chiếu" after the count, native-till.md 18.4):
// - security (the blind count): the person's own open shift is never asked (no call at all, so no expected figure can
//   reach the tablet); a counted shift is asked once; a count_required answer (a race) shows words, no figure;
// - equivalence partitions of the answer: short (the difference in words with a minus), matched ("Khớp", 0đ), another
//   person's open shift read by a manager (the figures so far, "Chưa đếm", no difference);
// - the lines in the design's words and signs: the cash sales in (+), the cash refunds and paid-outs out (−), the
//   drawer's expected and counted cash, and what is not in the drawer (card, card refunds, VietQR, Zalo wallet);
// - error guessing: the network fails (worded, "Thử lại" asks again); a person's name with markup is shown as text.

const SHIFT = "22222222-0000-4000-8000-000000000001";
const ME = "44444444-0000-4000-8000-000000000001";
const SOMEONE = "44444444-0000-4000-8000-000000000002";

const state = vi.hoisted(() => ({
	answers: [] as unknown[],
	failNext: false,
	errorNext: null as string | null,
	calls: [] as { fn: string; args: unknown }[],
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({
		client: {
			rpc: async (fn: string, args: unknown) => {
				state.calls.push({ fn, args });
				if (state.failNext) {
					state.failNext = false;
					throw new TypeError("Failed to fetch");
				}
				if (state.errorNext !== null) {
					const code = state.errorNext;
					state.errorNext = null;
					return { data: null, error: { code, message: "refused" } };
				}
				return { data: state.answers.shift() ?? null, error: null };
			},
		},
	}),
}));

function shift(overrides: Partial<Shift> = {}): Shift {
	return {
		id: SHIFT,
		store_id: "11111111-0000-4000-8000-00000000000a",
		business_date: "2026-11-28",
		clock_in_at: "2026-11-28T00:00:00Z",
		clock_out_at: "2026-11-28T08:04:00Z",
		hours: 8.07,
		opening_cash: 1_000_000,
		counted_cash: 3_283_000,
		status: "awaiting_confirmation",
		closed_at: null,
		close_note: null,
		version: 2,
		...overrides,
	};
}

function reconciliation(
	overrides: Partial<ShiftReconciliation> = {},
): ShiftReconciliation {
	return {
		from: "2026-11-28T00:00:00Z",
		until: "2026-11-28T08:04:00Z",
		counted: true,
		opening_cash: 1_000_000,
		cash_sales: { count: 24, total: 2_378_000 },
		cash_refunds: { count: 1, total: 45_000 },
		paid_outs: { count: 0, total: 0 },
		expected_cash: 3_333_000,
		counted_cash: 3_283_000,
		cash_difference: -50_000,
		matched: false,
		not_in_drawer: {
			card: { count: 5, total: 312_000 },
			card_refunds: { count: 1, total: 20_000 },
			vietqr: { count: 11, total: 1_640_000 },
			zalo_checkout: { count: 14, total: 2_180_000 },
		},
		...overrides,
	};
}

const ok = (value: ShiftReconciliation, of: Shift = shift()) => ({
	state: "ok",
	refusal: null,
	shift: of,
	reconciliation: value,
});

function wrap(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider language="vi" catalogs={catalogs}>
				{children}
			</I18nProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	state.answers = [];
	state.failNext = false;
	state.errorNext = null;
	state.calls = [];
});

afterEach(() => {
	cleanup();
});

describe("the blind count (security)", () => {
	it("never asks for the person's own open shift: no call, no figure", async () => {
		wrap(
			<ReconciliationPanel
				shift={shift({ status: "open", counted_cash: null })}
				userId={null}
			/>,
		);
		expect(screen.getByTestId("recon-count-first")).toHaveTextContent(
			"Đếm két và ra ca trước",
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state.calls).toEqual([]);
		expect(document.body).not.toHaveTextContent("Dự kiến");
		expect(document.body).not.toHaveTextContent(/\d\.\d{3}đ/);
	});

	it("never asks for a manager's own open shift either", async () => {
		wrap(
			<ReconciliationPanel
				shift={shift({ status: "open", user_id: ME })}
				userId={ME}
			/>,
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state.calls).toEqual([]);
	});

	it("asks once the count is recorded, naming the shift only", async () => {
		state.answers = [ok(reconciliation())];
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		await screen.findByTestId("reconciliation-view");
		expect(state.calls).toEqual([
			{ fn: "staff_shift_reconciliation", args: { p_shift: SHIFT } },
		]);
	});

	it("shows words and no figure when the server still wants the count (a race)", async () => {
		state.answers = [
			{
				state: "refused",
				refusal: "count_required",
				shift: shift({ status: "open" }),
				reconciliation: null,
			},
		];
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		expect(await screen.findByTestId("recon-count-first")).toBeVisible();
		expect(screen.queryByTestId("reconciliation-view")).toBeNull();
		expect(document.body).not.toHaveTextContent(/\d\.\d{3}đ/);
	});
});

describe("the breakdown (EP of the answer)", () => {
	it("words a short drawer with the design's lines and signs", async () => {
		state.answers = [ok(reconciliation())];
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		await screen.findByTestId("reconciliation-view");
		expect(screen.getByTestId("recon-opening")).toHaveTextContent(
			/Tiền đầu ca\s*1\.000\.000đ/,
		);
		expect(screen.getByTestId("recon-cashSales")).toHaveTextContent(
			"Thu tiền mặt · 24 đơn+2.378.000đ",
		);
		expect(screen.getByTestId("recon-cashRefunds")).toHaveTextContent(
			"Hoàn tiền mặt · 1 đơn−45.000đ",
		);
		expect(screen.getByTestId("recon-paidOuts")).toHaveTextContent(
			"Chi từ két · 0 khoản0đ",
		);
		expect(screen.getByTestId("recon-expected")).toHaveTextContent(
			"3.333.000đ",
		);
		expect(screen.getByTestId("recon-counted")).toHaveTextContent("3.283.000đ");
		const difference = screen.getByTestId("cash-difference");
		expect(difference).toHaveAttribute("role", "status");
		expect(difference).toHaveAttribute("data-kind", "short");
		expect(difference).toHaveTextContent("Thiếu tiền");
		expect(difference).toHaveTextContent("Đã đếm ít hơn số dự kiến");
		expect(difference).toHaveTextContent("−50.000đ");
		const outside = screen.getByTestId("recon-outside");
		expect(outside).toHaveTextContent("Không nằm trong két");
		expect(screen.getByTestId("recon-card")).toHaveTextContent(
			"Thẻ tại quầy · 5 đơn312.000đ",
		);
		expect(screen.getByTestId("recon-cardRefunds")).toHaveTextContent(
			"Hoàn qua thẻ · 1 đơn−20.000đ",
		);
		expect(screen.getByTestId("recon-vietqr")).toHaveTextContent(
			"VietQR · 11 đơn1.640.000đ",
		);
		expect(screen.getByTestId("recon-zaloCheckout")).toHaveTextContent(
			"Ví Zalo · 14 đơn2.180.000đ",
		);
		expect(outside).toHaveTextContent(
			"Đối chiếu với cổng thanh toán ở báo cáo ngày.",
		);
	});

	it("words a matched drawer", async () => {
		state.answers = [
			ok(
				reconciliation({
					counted_cash: 3_333_000,
					cash_difference: 0,
					matched: true,
				}),
			),
		];
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		const difference = await screen.findByTestId("cash-difference");
		expect(difference).toHaveAttribute("data-kind", "matched");
		expect(difference).toHaveTextContent("Khớp");
		expect(difference).toHaveTextContent("Đã đếm bằng số dự kiến");
		expect(difference).toHaveTextContent("0đ");
	});

	it("words an over drawer with a plus", async () => {
		state.answers = [
			ok(
				reconciliation({
					counted_cash: 3_334_000,
					cash_difference: 1_000,
				}),
			),
		];
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		const difference = await screen.findByTestId("cash-difference");
		expect(difference).toHaveTextContent("Thừa tiền");
		expect(difference).toHaveTextContent("+1.000đ");
	});

	it("shows a manager another person's open shift as figures so far, not counted", async () => {
		const open = shift({
			status: "open",
			user_id: SOMEONE,
			clock_out_at: null,
			counted_cash: null,
		});
		state.answers = [
			ok(
				reconciliation({
					counted: false,
					counted_cash: null,
					cash_difference: null,
					matched: null,
					expected_cash: 3_333_000,
				}),
				open,
			),
		];
		wrap(<ReconciliationPanel shift={open} userId={ME} />);
		const view = await screen.findByTestId("reconciliation-view");
		expect(view).toHaveAttribute("data-counted", "false");
		expect(screen.getByTestId("recon-so-far")).toHaveTextContent(
			"Ca còn mở: số đến 15:04, chưa đếm két.",
		);
		expect(view).toHaveTextContent("Dự kiến đến giờ");
		expect(view).toHaveTextContent("Chưa đếm");
		expect(screen.queryByTestId("cash-difference")).toBeNull();
		expect(state.calls).toHaveLength(1);
	});
});

describe("failures and markup (error guessing)", () => {
	it("words a lost connection and asks again with Thử lại", async () => {
		state.failNext = true;
		state.answers = [ok(reconciliation())];
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		const failed = await screen.findByTestId("recon-failed");
		expect(failed).toHaveTextContent("Không có mạng");
		fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
		await screen.findByTestId("reconciliation-view");
		expect(state.calls).toHaveLength(2);
	});

	it("words a refusal of the server (42501: not this person's shift) and any other failure", async () => {
		state.errorNext = "42501";
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		expect(await screen.findByTestId("recon-failed")).toHaveTextContent(
			"Bạn không có quyền làm việc này.",
		);
		cleanup();
		state.errorNext = "XX000";
		wrap(<ReconciliationPanel shift={shift()} userId={null} />);
		expect(await screen.findByTestId("recon-failed")).toHaveTextContent(
			"Chưa tải được đối chiếu.",
		);
		expect(document.body).not.toHaveTextContent(/\d\.\d{3}đ/);
	});

	it("keeps the shift's own difference on screen while the breakdown loads", () => {
		wrap(
			<ReconciliationPanel
				shift={shift()}
				userId={null}
				fallback={<p data-testid="fallback">Thiếu tiền 50.000đ</p>}
			/>,
		);
		expect(screen.getByTestId("fallback")).toBeVisible();
	});

	it("shows a person's name with markup as text in the dialog's title", async () => {
		state.answers = [ok(reconciliation())];
		const onClose = vi.fn();
		wrap(
			<ReconciliationDialog
				shift={shift({ user_id: SOMEONE })}
				userId={ME}
				name={'<img src=x onerror="alert(1)">'}
				onClose={onClose}
			/>,
		);
		const dialog = await screen.findByTestId("reconciliation-dialog");
		expect(dialog).toHaveTextContent('<img src=x onerror="alert(1)">');
		expect(dialog.querySelector("img")).toBeNull();
		await screen.findByTestId("reconciliation-view");
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});
});
