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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "../i18n/catalog";
import type { Inbox, StoreRequest } from "./requests";
import { RequestsPage } from "./requests-page";

// counter:component/requests-accepted (M01 with native-till.md 18.2: a customer accepted the time proposed in the app):
// - the inbox lists it right after the new requests in "Chưa xử lý", with its own mark (a dot and words for screen
//   readers) and "Khách đồng ý giờ mới", counts it with the unread ones and says how many were accepted;
// - state transition: opening it records the reading (manager_request_read clears accepted_unseen) and the inbox is
//   asked again; a request already seen is opened without a call;
// - error guessing (security): a customer's name with markup is shown as text, never as markup.

const STORE = "11111111-0000-4000-8000-00000000000a";

const state = vi.hoisted(() => ({
	inbox: null as unknown,
	calls: [] as { fn: string; args: unknown }[],
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({
		client: {
			rpc: async (fn: string, args: Record<string, unknown>) => {
				state.calls.push({ fn, args });
				if (fn === "manager_requests")
					return { data: state.inbox, error: null };
				if (fn === "manager_request_read") {
					const box = state.inbox as Inbox;
					const request = box.requests.find(
						(entry) => entry.id === args.p_request,
					);
					return {
						data: {
							state: "read",
							request: { ...request, accepted_unseen: false },
						},
						error: null,
					};
				}
				return { data: null, error: null };
			},
		},
	}),
}));
vi.mock("../lib/store", () => ({
	useStore: () => ({ store: { id: STORE, name: "Cửa hàng mẫu A" } }),
}));
vi.mock("../ui/toast", () => ({ useToast: () => ({ show: () => undefined }) }));

const MARKUP = '<img src=x onerror="alert(1)">';

function request(overrides: Partial<StoreRequest>): StoreRequest {
	return {
		id: "33333333-0000-4000-8000-000000000001",
		kind: "booking",
		status: "new",
		channel: "app",
		party_size: 4,
		requested_for: "2026-11-29T12:00:00Z",
		proposed_for: null,
		subject: null,
		note: null,
		created_at: "2026-11-28T04:50:00Z",
		answered_at: null,
		answer_message: null,
		version: 1,
		contact_name: "Khách Mới",
		contact_phone: "0900000000",
		answer_due_at: "2099-11-28T05:20:00Z",
		overdue: false,
		read_at: null,
		read_by: null,
		customer_accepted_at: null,
		accepted_unseen: false,
		accept_seen_at: null,
		accept_seen_by: null,
		...overrides,
	};
}

const ACCEPTED = "33333333-0000-4000-8000-000000000002";
const SEEN = "33333333-0000-4000-8000-000000000004";

function inbox(): Inbox {
	return {
		requests: [
			request({
				id: "33333333-0000-4000-8000-000000000003",
				status: "proposed",
				contact_name: "Khách Chờ",
				proposed_for: "2026-11-29T12:30:00Z",
				created_at: "2026-11-28T04:59:00Z",
				read_at: "2026-11-28T04:59:30Z",
			}),
			request({
				id: SEEN,
				status: "confirmed",
				contact_name: "Khách Đã Xem",
				proposed_for: "2026-11-29T11:30:00Z",
				requested_for: "2026-11-29T11:30:00Z",
				customer_accepted_at: "2026-11-28T04:40:00Z",
				accept_seen_at: "2026-11-28T04:41:00Z",
				read_at: "2026-11-28T04:30:00Z",
				created_at: "2026-11-28T04:20:00Z",
			}),
			request({
				id: ACCEPTED,
				status: "confirmed",
				contact_name: MARKUP,
				proposed_for: "2026-11-29T13:30:00Z",
				requested_for: "2026-11-29T13:30:00Z",
				customer_accepted_at: "2026-11-28T05:00:00Z",
				accepted_unseen: true,
				read_at: "2026-11-28T04:52:00Z",
				created_at: "2026-11-28T04:45:00Z",
				version: 3,
			}),
			request({}),
		],
		new: 1,
		unread: 1,
		accepted_unseen: 1,
		overdue: 0,
	};
}

function show() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<I18nProvider language="vi" catalogs={catalogs}>
				<RequestsPage />
			</I18nProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	state.inbox = inbox();
	state.calls = [];
});

afterEach(() => {
	cleanup();
});

describe("a customer's acceptance in the inbox", () => {
	it("is listed right after the new requests, marked, worded and counted with the unread ones", async () => {
		show();
		await screen.findAllByTestId("request-row");
		const rows = screen.getAllByTestId("request-row");
		expect(rows.map((row) => row.getAttribute("data-status"))).toEqual([
			"new",
			"confirmed",
			"proposed",
		]);
		const accepted = rows[1] as HTMLElement;
		expect(accepted).toHaveAttribute("data-accepted-unseen", "true");
		expect(accepted).toHaveAttribute("data-unread", "false");
		expect(
			within(accepted).getByTestId("request-accepted-unseen"),
		).toHaveTextContent("khách đã đồng ý giờ mới, chưa xem");
		expect(accepted).toHaveTextContent("Khách đồng ý giờ mới");
		expect(screen.getByTestId("requests-unread")).toHaveTextContent(
			"2 chưa đọc",
		);
		expect(screen.getByTestId("requests-accepted")).toHaveTextContent(
			"1 khách đồng ý giờ mới",
		);
		// the request already seen is not in Chưa xử lý
		expect(screen.queryByText("Khách Đã Xem")).toBeNull();
	});

	it("shows a name with markup as text (security)", async () => {
		show();
		const rows = await screen.findAllByTestId("request-row");
		expect(rows[1]).toHaveTextContent(MARKUP);
		expect(document.querySelector("img")).toBeNull();
	});

	it("is read on opening: manager_request_read with its id, the acceptance worded, the inbox asked again", async () => {
		show();
		const rows = await screen.findAllByTestId("request-row");
		const before = state.calls.filter(
			(call) => call.fn === "manager_requests",
		).length;
		fireEvent.click(rows[1] as HTMLElement);
		const dialog = await screen.findByTestId("request-dialog");
		expect(
			within(dialog).getByTestId("request-customer-accepted"),
		).toHaveTextContent(
			"Khách đã đồng ý giờ mới trong ứng dụng lúc 28/11 12:00.",
		);
		await waitFor(() =>
			expect(state.calls).toContainEqual({
				fn: "manager_request_read",
				args: { p_request: ACCEPTED },
			}),
		);
		await waitFor(() =>
			expect(
				state.calls.filter((call) => call.fn === "manager_requests").length,
			).toBeGreaterThan(before),
		);
		// a confirmed request offers its cancel only
		expect(within(dialog).getByTestId("answer-cancelled")).toBeVisible();
		expect(within(dialog).queryByTestId("answer-confirmed")).toBeNull();
	});

	it("opens a request already seen without recording anything (Đã xử lý)", async () => {
		show();
		await screen.findAllByTestId("request-row");
		fireEvent.click(screen.getByRole("button", { name: "Đã xử lý" }));
		const seen = await screen.findByText("Khách Đã Xem");
		fireEvent.click(seen.closest("button") as HTMLElement);
		const dialog = await screen.findByTestId("request-dialog");
		expect(
			within(dialog).getByTestId("request-customer-accepted"),
		).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(state.calls.some((call) => call.fn === "manager_request_read")).toBe(
			false,
		);
	});
});
