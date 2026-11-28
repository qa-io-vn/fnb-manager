import { I18nProvider } from "@fnb/zalo-mini/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "../i18n/catalog";
import {
	PAYMENT_EXCEPTIONS_PATH,
	PaymentExceptionsLine,
	PaymentExceptionsPage,
} from "./payment-exceptions-page";

// counter:component/payment-exceptions (Quản lý → Tiền chờ xử lý, ADR-068) with the server faked at client.rpc:
// - use case: the open list shows each exception's provider, kind in words, amount (and the order's), reference,
//   linked order, time and the account that received it (the store's own bank account, the brand's shared one, the
//   brand's wallet; no line when the server says nothing); a resolved one its resolution, who (the name the server
//   gives, an owner's too, else "Quản lý hoặc chủ quán") and when, with the note; each filter is one call (open,
//   resolved, all); each filter's empty line;
// - state transitions of the resolution dialog: form → (Tiếp tục) confirmation → (Quay lại) form with the focus on the
//   note → confirmation → (Ghi xử lý) one call, a toast and the list asked again; the confirmation ignores taps for
//   CONFIRM_ARMING_MS, so a double tap on Tiếp tục never confirms, and a double tap on Ghi xử lý makes one call;
// - boundary values and errors of the form: nothing chosen and an empty note each said under their field, linked by
//   aria-describedby with aria-invalid, the focus on the first; a note of 201 characters refused, 200 taken;
// - decision table of the server's answers worded: done, replayed, already_resolved (closed, said on the page, the list
//   reloaded), 42501 (another store's or tenant's), 22023 (back to the form, the note marked), the network (the same
//   confirmation tries again);
// - security (error guessing): a list refused 42501 says "managers only"; markup in a note, an order number, a
//   reference, a resolver's name and a bank's name, control characters and a 300-character reference are written as
//   text; nothing is sent before the confirmation;
// - Đối soát ngày's line: none at 0 open, "1 khoản tiền chờ xử lý…" at 1 (BVA), a link to the page.

const STORE = "11111111-0000-4000-8000-00000000000a";
const ME = "88888888-0000-4000-8000-0000000000aa";
const OTHER = "88888888-0000-4000-8000-0000000000bb";
const MARKUP = '<img src=x onerror="alert(1)">';

type Answer = unknown | ((args: Record<string, unknown>) => unknown);

const state = vi.hoisted(() => ({
	lists: {} as Record<string, unknown>,
	resolveAnswers: [] as unknown[],
	calls: [] as { fn: string; args: Record<string, unknown> }[],
	toasts: [] as string[],
	listError: null as { code: string; message: string } | null,
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({
		client: {
			rpc: async (fn: string, args: Record<string, unknown>) => {
				state.calls.push({ fn, args });
				if (fn === "manager_payment_exceptions") {
					if (state.listError !== null)
						return { data: null, error: state.listError };
					const key = (args.p_status as string | null) ?? "all";
					return {
						data: state.lists[key] ?? { open: 0, exceptions: [] },
						error: null,
					};
				}
				const next = state.resolveAnswers.shift() as Answer;
				const value = typeof next === "function" ? next(args) : next;
				if (value instanceof TypeError) throw value;
				if (
					typeof value === "object" &&
					value !== null &&
					"error" in (value as Record<string, unknown>)
				)
					return { data: null, error: (value as { error: unknown }).error };
				return { data: value, error: null };
			},
		},
	}),
}));
vi.mock("../lib/store", () => ({
	useStore: () => ({ store: { id: STORE, name: "Cửa hàng mẫu A" } }),
}));
vi.mock("../ui/toast", () => ({
	useToast: () => ({ show: (text: string) => state.toasts.push(text) }),
}));

const STORE_ACCOUNT = {
	scope: "store",
	bank_name: "Ngân hàng mẫu",
	account_tail: "6789",
};

function exception(overrides: Record<string, unknown> = {}) {
	return {
		id: "77777777-0000-4000-8000-000000000001",
		reason: "amount_differs",
		method: "vietqr",
		amount: 28_000,
		expected_amount: 29_000,
		reference: "FNBABCDEFGH",
		order_id: "99999999-0000-4000-8000-000000000042",
		order_no: "#042",
		source: "webhook",
		received_at: "2026-11-28T07:05:00+00:00",
		status: "open",
		resolved_at: null,
		resolved_by: null,
		resolved_by_name: null,
		resolution_note: null,
		account: STORE_ACCOUNT,
		...overrides,
	};
}

const RESOLVED_BY_ME = exception({
	id: "77777777-0000-4000-8000-000000000002",
	reason: "duplicate",
	amount: 29_000,
	status: "refunded",
	resolved_at: "2026-11-28T08:10:00+00:00",
	resolved_by: ME,
	resolved_by_name: "Quản lý mẫu",
	resolution_note: `Đã chuyển lại ${MARKUP}`,
});
// the brand's wallet, resolved by another manager
const RESOLVED_BY_OTHER = exception({
	id: "77777777-0000-4000-8000-000000000003",
	reason: "unknown_reference",
	method: "zalo_checkout",
	amount: 50_000,
	expected_amount: null,
	reference: null,
	order_id: null,
	order_no: null,
	status: "dismissed",
	received_at: "2026-11-28T06:00:00+00:00",
	resolved_at: "2026-11-28T06:30:00+00:00",
	resolved_by: OTHER,
	resolved_by_name: "Quản lý khác",
	resolution_note: "Chuyển thử",
	account: { scope: "brand", bank_name: null, account_tail: null },
});
// the owner (never on the roster), named by the server; the money went to the brand's shared account
const RESOLVED_BY_OWNER = exception({
	id: "77777777-0000-4000-8000-000000000004",
	reason: "late",
	expected_amount: 28_000,
	status: "dismissed",
	received_at: "2026-11-28T05:00:00+00:00",
	resolved_at: "2026-11-28T05:30:00+00:00",
	resolved_by: "88888888-0000-4000-8000-0000000000cc",
	resolved_by_name: "Chủ quán mẫu",
	resolution_note: "Khách để lại",
	account: {
		scope: "brand",
		bank_name: "Ngân hàng chung",
		account_tail: "3210",
	},
});
// someone the server can no longer name, in an answer that says nothing of the account
const RESOLVED_UNNAMED = exception({
	id: "77777777-0000-4000-8000-000000000005",
	reason: "late",
	expected_amount: 28_000,
	status: "refunded",
	received_at: "2026-11-28T04:00:00+00:00",
	resolved_at: "2026-11-28T04:30:00+00:00",
	resolved_by: "88888888-0000-4000-8000-0000000000dd",
	resolved_by_name: null,
	resolution_note: "Đã trả tiền mặt",
	account: null,
});

function wrap(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider language="vi" catalogs={catalogs}>
				<MemoryRouter>{children}</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>,
	);
}

const resolveCalls = () =>
	state.calls.filter((call) => call.fn === "manager_resolve_payment_exception");
const listCalls = () =>
	state.calls.filter((call) => call.fn === "manager_payment_exceptions");

beforeEach(() => {
	state.lists = { open: { open: 1, exceptions: [exception()] } };
	state.resolveAnswers = [];
	state.calls = [];
	state.toasts = [];
	state.listError = null;
});

afterEach(() => {
	cleanup();
});

describe("the list (use case)", () => {
	it("shows an open exception's provider, kind, amounts, reference, order and time", async () => {
		wrap(<PaymentExceptionsPage />);
		const row = await screen.findByTestId("payment-exception-row");
		expect(row).toHaveAttribute("data-status", "open");
		expect(within(row).getByTestId("payment-exception-kind")).toHaveTextContent(
			"Sai số tiền",
		);
		expect(
			within(row).getByTestId("payment-exception-amount"),
		).toHaveTextContent("28.000đ");
		expect(
			within(row).getByTestId("payment-exception-expected"),
		).toHaveTextContent("Đơn cần 29.000đ");
		expect(
			within(row).getByTestId("payment-exception-method"),
		).toHaveTextContent("VietQR");
		expect(
			within(row).getByTestId("payment-exception-reference"),
		).toHaveTextContent("Mã FNBABCDEFGH");
		const order = within(row).getByTestId("payment-exception-order");
		expect(order).toHaveTextContent("Đơn #042");
		expect(order).toHaveAttribute(
			"href",
			"/don/99999999-0000-4000-8000-000000000042",
		);
		expect(within(row).getByTestId("payment-exception-time")).toHaveTextContent(
			"Nhận lúc 28/11 14:05",
		);
		const account = within(row).getByTestId("payment-exception-account");
		expect(account).toHaveTextContent(
			"Tiền vào Ngân hàng mẫu ···6789 (tài khoản của cửa hàng)",
		);
		expect(account).toHaveAttribute("data-scope", "store");
		expect(
			within(row).getByTestId("payment-exception-status"),
		).toHaveTextContent("Chờ xử lý");
		expect(
			within(row).getByRole("button", {
				name: "Xử lý khoản 28.000đ nhận lúc 28/11 14:05",
			}),
		).toBeVisible();
		expect(screen.getByTestId("payment-exceptions-open")).toHaveTextContent(
			"1",
		);
		expect(listCalls()[0]?.args).toEqual({
			p_store: STORE,
			p_status: "open",
			p_limit: 100,
		});
	});

	it("shows who resolved each one (an owner too), when, the note and the account; one call per filter", async () => {
		const resolved = [
			RESOLVED_BY_ME,
			RESOLVED_BY_OTHER,
			RESOLVED_BY_OWNER,
			RESOLVED_UNNAMED,
		];
		state.lists = {
			open: { open: 0, exceptions: [] },
			resolved: { open: 0, exceptions: resolved },
			all: { open: 0, exceptions: resolved },
		};
		wrap(<PaymentExceptionsPage />);
		expect(
			await screen.findByTestId("payment-exceptions-empty"),
		).toHaveTextContent("Không có khoản tiền nào chờ xử lý.");
		fireEvent.click(screen.getByRole("button", { name: "Đã xử lý" }));
		await waitFor(() =>
			expect(screen.getAllByTestId("payment-exception-row")).toHaveLength(4),
		);
		const rows = screen.getAllByTestId("payment-exception-row");
		expect(rows.map((row) => row.getAttribute("data-exception"))).toEqual(
			resolved.map((exception) => exception.id),
		);
		const [mine, other, owner, unnamed] = rows as HTMLElement[];
		expect(
			within(other as HTMLElement).getByTestId("payment-exception-resolution"),
		).toHaveTextContent("Đã bỏ qua · Quản lý khác · 28/11 13:30");
		expect(
			within(mine as HTMLElement).getByTestId("payment-exception-resolution"),
		).toHaveTextContent("Đã trả lại khách · Quản lý mẫu · 28/11 15:10");
		expect(
			within(owner as HTMLElement).getByTestId("payment-exception-resolution"),
		).toHaveTextContent("Đã bỏ qua · Chủ quán mẫu · 28/11 12:30");
		expect(
			within(unnamed as HTMLElement).getByTestId(
				"payment-exception-resolution",
			),
		).toHaveTextContent(
			"Đã trả lại khách · Quản lý hoặc chủ quán · 28/11 11:30",
		);
		// which account received each: the brand's wallet, the brand's bank account, none said
		expect(
			within(other as HTMLElement).getByTestId("payment-exception-account"),
		).toHaveTextContent("Tiền vào Ví Zalo (tài khoản chung của thương hiệu)");
		expect(
			within(owner as HTMLElement).getByTestId("payment-exception-account"),
		).toHaveTextContent(
			"Tiền vào Ngân hàng chung ···3210 (tài khoản chung của thương hiệu)",
		);
		expect(
			within(unnamed as HTMLElement).queryByTestId("payment-exception-account"),
		).not.toBeInTheDocument();
		// a resolved one has no button; an unknown reference says so and has no order
		for (const row of rows) {
			expect(
				within(row).queryByTestId("payment-exception-resolve"),
			).not.toBeInTheDocument();
		}
		expect(
			within(other as HTMLElement).getByTestId("payment-exception-kind"),
		).toHaveTextContent("Không rõ đơn");
		expect(
			within(other as HTMLElement).getByTestId("payment-exception-method"),
		).toHaveTextContent("Ví Zalo");
		expect(
			within(other as HTMLElement).getByTestId("payment-exception-reference"),
		).toHaveTextContent("Không có mã");
		expect(
			within(other as HTMLElement).getByTestId("payment-exception-order"),
		).toHaveTextContent("Chưa gắn đơn nào");
		expect(
			within(other as HTMLElement).queryByTestId("payment-exception-expected"),
		).not.toBeInTheDocument();
		// the same amount as the order's is not repeated
		expect(
			within(owner as HTMLElement).queryByTestId("payment-exception-expected"),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
		await waitFor(() =>
			expect(listCalls().map((call) => call.args.p_status)).toEqual([
				"open",
				"resolved",
				null,
			]),
		);
		// no other read: the names come with the list
		expect(
			state.calls.every((call) => call.fn === "manager_payment_exceptions"),
		).toBe(true);
	});

	it("says each filter's empty list", async () => {
		state.lists = {};
		wrap(<PaymentExceptionsPage />);
		expect(
			await screen.findByTestId("payment-exceptions-empty"),
		).toHaveTextContent("Không có khoản tiền nào chờ xử lý.");
		fireEvent.click(screen.getByRole("button", { name: "Đã xử lý" }));
		await waitFor(() =>
			expect(screen.getByTestId("payment-exceptions-empty")).toHaveTextContent(
				"Chưa có khoản nào đã xử lý.",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
		await waitFor(() =>
			expect(screen.getByTestId("payment-exceptions-empty")).toHaveTextContent(
				"Chưa có khoản tiền nào bị giữ lại.",
			),
		);
	});

	it("says managers only when the database refuses the list (staff, another store)", async () => {
		state.listError = { code: "42501", message: "only owners and managers" };
		wrap(<PaymentExceptionsPage />);
		expect(
			await screen.findByTestId("payment-exceptions-failed"),
		).toHaveTextContent("Mục này chỉ dành cho quản lý và chủ quán.");
		expect(
			screen.queryByTestId("payment-exceptions-list"),
		).not.toBeInTheDocument();
	});

	it("writes markup, control characters and a long reference as text (error guessing)", async () => {
		const long = `FNB${"ABCDEFGHJK".repeat(30)}`;
		state.lists = {
			open: {
				open: 1,
				exceptions: [
					exception({
						reference: `${long}${MARKUP}`,
						order_no: `#${MARKUP}`,
					}),
				],
			},
			resolved: {
				open: 1,
				exceptions: [
					exception({
						...RESOLVED_BY_ME,
						resolution_note: `${MARKUP}\u0007\u001b[31m`,
						resolved_by_name: `<b>${MARKUP}</b>`,
						account: {
							scope: "store",
							bank_name: `<i>${MARKUP}</i>`,
							account_tail: "<u>",
						},
					}),
				],
			},
		};
		const { container } = wrap(<PaymentExceptionsPage />);
		const row = await screen.findByTestId("payment-exception-row");
		expect(
			within(row).getByTestId("payment-exception-reference"),
		).toHaveTextContent(`Mã ${long}${MARKUP}`);
		expect(within(row).getByTestId("payment-exception-reference")).toHaveClass(
			"break-all",
		);
		expect(
			within(row).getByTestId("payment-exception-order"),
		).toHaveTextContent(`Đơn #${MARKUP}`);
		fireEvent.click(screen.getByRole("button", { name: "Đã xử lý" }));
		const note = await screen.findByTestId("payment-exception-note");
		expect(note.textContent).toBe(`Ghi chú: ${MARKUP}\u0007\u001b[31m`);
		expect(
			screen.getByTestId("payment-exception-resolution"),
		).toHaveTextContent(`<b>${MARKUP}</b>`);
		expect(screen.getByTestId("payment-exception-account").textContent).toBe(
			`Tiền vào <i>${MARKUP}</i> ···<u> (tài khoản của cửa hàng)`,
		);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("b, i, u")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
	});

	it("says when the list reaches its limit (BVA)", async () => {
		state.lists = {
			open: {
				open: 100,
				exceptions: Array.from({ length: 100 }, (_, index) =>
					exception({
						id: `77777777-0000-4000-8000-${String(index).padStart(12, "0")}`,
					}),
				),
			},
		};
		wrap(<PaymentExceptionsPage />);
		expect(
			await screen.findByTestId("payment-exceptions-limited"),
		).toHaveTextContent("Chỉ hiện 100 khoản mới nhất.");
	});
});

describe("the resolution dialog (state transitions, BVA, decision table)", () => {
	async function open() {
		wrap(<PaymentExceptionsPage />);
		fireEvent.click(await screen.findByTestId("payment-exception-resolve"));
		return screen.getByTestId("resolve-dialog");
	}

	async function toConfirmation(
		resolution: "refunded" | "dismissed",
		note: string,
	) {
		const dialog = await open();
		fireEvent.click(within(dialog).getByTestId(`resolve-${resolution}`));
		fireEvent.change(within(dialog).getByTestId("resolve-note"), {
			target: { value: note },
		});
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		return dialog;
	}

	it("says what is missing under each field, linked to it, with the focus on the first; nothing is sent", async () => {
		const dialog = await open();
		expect(within(dialog).getByTestId("resolve-refunded")).toHaveFocus();
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		const choiceError = within(dialog).getByTestId("resolve-choice-error");
		expect(choiceError).toHaveTextContent("Chọn một cách xử lý.");
		for (const value of ["refunded", "dismissed"]) {
			const radio = within(dialog).getByTestId(`resolve-${value}`);
			expect(radio).toHaveAttribute("aria-invalid", "true");
			expect(radio.getAttribute("aria-describedby")?.split(" ")).toContain(
				choiceError.id,
			);
		}
		expect(within(dialog).getByTestId("resolve-refunded")).toHaveFocus();
		const note = within(dialog).getByTestId("resolve-note");
		const noteError = within(dialog).getByTestId("resolve-note-error");
		expect(noteError).toHaveTextContent(
			"Cần ghi chú để biết khoản này đã được xử lý thế nào.",
		);
		expect(note).toHaveAttribute("aria-invalid", "true");
		expect(note.getAttribute("aria-describedby")?.split(" ")).toContain(
			noteError.id,
		);
		// a choice made: the focus goes to the note
		fireEvent.click(within(dialog).getByTestId("resolve-dismissed"));
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(note).toHaveFocus();
		expect(within(dialog).queryByTestId("resolve-choice-error")).toBeNull();
		expect(resolveCalls()).toEqual([]);
	});

	it("refuses a note of 201 characters and takes 200 (BVA)", async () => {
		const dialog = await open();
		fireEvent.click(within(dialog).getByTestId("resolve-refunded"));
		const note = within(dialog).getByTestId("resolve-note");
		fireEvent.change(note, { target: { value: "a".repeat(201) } });
		fireEvent.blur(note);
		expect(within(dialog).getByTestId("resolve-note-error")).toHaveTextContent(
			"Ghi chú tối đa 200 ký tự. Đang có 201.",
		);
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(within(dialog).queryByTestId("resolve-confirmation")).toBeNull();
		fireEvent.change(note, { target: { value: "a".repeat(200) } });
		expect(within(dialog).queryByTestId("resolve-note-error")).toBeNull();
		expect(note).toHaveAttribute("aria-invalid", "false");
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(within(dialog).getByTestId("resolve-confirmation")).toBeVisible();
		expect(resolveCalls()).toEqual([]);
	});

	it("confirms before the call: Quay lại goes back to the note; a double tap on Tiếp tục never confirms", async () => {
		const dialog = await toConfirmation(
			"refunded",
			"  Đã chuyển lại lúc 15:00  ",
		);
		expect(within(dialog).getByTestId("resolve-question")).toHaveTextContent(
			"Ghi khoản 28.000đ là “Đã trả lại khách”?",
		);
		expect(within(dialog).getByTestId("resolve-question")).toHaveFocus();
		expect(within(dialog).getByTestId("resolve-note-shown")).toHaveTextContent(
			"Ghi chú: Đã chuyển lại lúc 15:00",
		);
		// the second tap of a double tap lands on a confirmation that is not armed yet
		const confirm = within(dialog).getByTestId("resolve-confirm");
		expect(confirm).toBeDisabled();
		fireEvent.click(confirm);
		expect(resolveCalls()).toEqual([]);
		fireEvent.click(within(dialog).getByTestId("resolve-back"));
		expect(within(dialog).getByTestId("resolve-note")).toHaveFocus();
		expect(within(dialog).getByTestId("resolve-note")).toHaveValue(
			"  Đã chuyển lại lúc 15:00  ",
		);
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(within(dialog).getByTestId("resolve-confirm")).toBeDisabled();
		expect(resolveCalls()).toEqual([]);
	});

	it("records once for a double tap, says it, and asks for the list again", async () => {
		state.resolveAnswers = [
			{ state: "refunded", replayed: false, refusal: null },
		];
		const dialog = await toConfirmation(
			"refunded",
			"  Đã chuyển lại lúc 15:00  ",
		);
		const confirm = within(dialog).getByTestId("resolve-confirm");
		await waitFor(() => expect(confirm).toBeEnabled());
		const before = listCalls().length;
		fireEvent.click(confirm);
		fireEvent.click(confirm);
		await waitFor(() =>
			expect(screen.queryByTestId("resolve-dialog")).toBeNull(),
		);
		expect(resolveCalls().map((call) => call.args)).toEqual([
			{
				p_exception: "77777777-0000-4000-8000-000000000001",
				p_resolution: "refunded",
				p_note: "Đã chuyển lại lúc 15:00",
			},
		]);
		expect(state.toasts).toEqual(["Đã ghi khoản 28.000đ: Đã trả lại khách."]);
		await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
	});

	it("words a replay as recorded before", async () => {
		state.resolveAnswers = [
			{ state: "dismissed", replayed: true, refusal: null },
		];
		const dialog = await toConfirmation("dismissed", "Chuyển thử");
		const confirm = within(dialog).getByTestId("resolve-confirm");
		await waitFor(() => expect(confirm).toBeEnabled());
		fireEvent.click(confirm);
		await waitFor(() =>
			expect(state.toasts).toEqual([
				"Khoản 28.000đ đã được ghi “Bỏ qua, không trả lại” từ trước, ghi chú cũ được giữ.",
			]),
		);
	});

	it("says on the page that another manager resolved it first, and reloads", async () => {
		state.resolveAnswers = [
			{ state: "dismissed", replayed: false, refusal: "already_resolved" },
		];
		const dialog = await toConfirmation("refunded", "Đã chuyển lại");
		const confirm = within(dialog).getByTestId("resolve-confirm");
		await waitFor(() => expect(confirm).toBeEnabled());
		const before = listCalls().length;
		fireEvent.click(confirm);
		await waitFor(() =>
			expect(
				screen.getByTestId("payment-exceptions-message"),
			).toHaveTextContent(
				"Khoản này đã được xử lý trước đó: Đã bỏ qua. Danh sách đã được tải lại.",
			),
		);
		expect(screen.queryByTestId("resolve-dialog")).toBeNull();
		expect(state.toasts).toEqual([]);
		await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
	});

	it("words 42501 (another store's or tenant's exception) in the dialog", async () => {
		state.resolveAnswers = [{ error: { code: "42501", message: "denied" } }];
		const dialog = await toConfirmation("refunded", "Đã chuyển lại");
		const confirm = within(dialog).getByTestId("resolve-confirm");
		await waitFor(() => expect(confirm).toBeEnabled());
		fireEvent.click(confirm);
		expect(
			await within(dialog).findByTestId("resolve-message"),
		).toHaveTextContent(
			"Chỉ quản lý và chủ quán của cửa hàng có khoản này mới xử lý được.",
		);
		expect(within(dialog).getByTestId("resolve-message")).toHaveAttribute(
			"role",
			"alert",
		);
	});

	it("goes back to the form with the note marked when the server refuses it (22023)", async () => {
		state.resolveAnswers = [{ error: { code: "22023", message: "a note" } }];
		const dialog = await toConfirmation("dismissed", "Ghi chú hai dòng");
		const confirm = within(dialog).getByTestId("resolve-confirm");
		await waitFor(() => expect(confirm).toBeEnabled());
		fireEvent.click(confirm);
		const note = await within(dialog).findByTestId("resolve-note");
		await waitFor(() => expect(note).toHaveFocus());
		expect(note).toHaveAttribute("aria-invalid", "true");
		expect(within(dialog).getByTestId("resolve-note-error")).toHaveTextContent(
			"Máy chủ không nhận ghi chú này. Ghi một dòng, từ 1 đến 200 ký tự.",
		);
		// Tiếp tục stays on the form until the note changes
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(within(dialog).queryByTestId("resolve-confirmation")).toBeNull();
		fireEvent.change(note, { target: { value: "Chuyển thử" } });
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(within(dialog).getByTestId("resolve-confirmation")).toBeVisible();
	});

	it("tries again from the same confirmation after a lost answer", async () => {
		state.resolveAnswers = [
			new TypeError("Failed to fetch"),
			{ state: "refunded", replayed: true, refusal: null },
		];
		const dialog = await toConfirmation("refunded", "Đã chuyển lại");
		const confirm = within(dialog).getByTestId("resolve-confirm");
		await waitFor(() => expect(confirm).toBeEnabled());
		fireEvent.click(confirm);
		expect(
			await within(dialog).findByTestId("resolve-message"),
		).toHaveTextContent("Không có mạng. Thử lại khi có mạng.");
		fireEvent.click(within(dialog).getByTestId("resolve-confirm"));
		await waitFor(() =>
			expect(screen.queryByTestId("resolve-dialog")).toBeNull(),
		);
		expect(resolveCalls()).toHaveLength(2);
		expect(resolveCalls()[0]?.args).toEqual(resolveCalls()[1]?.args);
	});

	it("refuses control characters in the note before any call", async () => {
		const dialog = await open();
		fireEvent.click(within(dialog).getByTestId("resolve-refunded"));
		fireEvent.change(within(dialog).getByTestId("resolve-note"), {
			target: { value: "Đã trả\tlại" },
		});
		fireEvent.click(within(dialog).getByTestId("resolve-next"));
		expect(within(dialog).getByTestId("resolve-note-error")).toHaveTextContent(
			"Ghi chú chỉ một dòng, không chứa ký tự điều khiển.",
		);
		expect(within(dialog).queryByTestId("resolve-confirmation")).toBeNull();
		expect(resolveCalls()).toEqual([]);
	});
});

describe("Đối soát ngày's line (BVA)", () => {
	it("says nothing while no money waits", async () => {
		state.lists = { open: { open: 0, exceptions: [] } };
		const { container } = wrap(<PaymentExceptionsLine />);
		await waitFor(() => expect(listCalls()).toHaveLength(1));
		expect(listCalls()[0]?.args).toEqual({
			p_store: STORE,
			p_status: "open",
			p_limit: 1,
		});
		expect(container).toBeEmptyDOMElement();
	});

	it("links to the page with the count from 1", async () => {
		state.lists = { open: { open: 1, exceptions: [exception()] } };
		wrap(<PaymentExceptionsLine />);
		const link = await screen.findByTestId("reconciliation-payment-exceptions");
		expect(link).toHaveTextContent(
			"1 khoản tiền chờ xử lý, chưa tính vào đối soát →",
		);
		expect(link).toHaveAttribute("href", PAYMENT_EXCEPTIONS_PATH);
	});
});
