import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	ACCOUNT_FUNCTIONS,
	readCancelRequestAnswer,
	readCustomerRequests,
	readDataExport,
	readDeleteAccountAnswer,
	readStampCodeAnswer,
	requestIdArgs,
} from "../../src/ordering/account-contract";
import { readOrderList, readStampCard } from "../../src/ordering/contract";
import { createRestOrderingClient } from "../../src/ordering/rest-ordering-client";

// Test design (ISTQB) for the customer's account functions (native-till.md 16.5, 16.6, 16.8; docs/api.md):
// - equivalence partitions per answer: issued and refused member codes, deleted and refused deletions, the requests
//   with a proposed time, a cancellation, an export; malformed answers (a QR of another version or length, a number
//   of 7 or 9 digits, a shown number that is not the number, times out of order, an unknown status) are refused;
// - boundary values: the token of 21, 22 and 23 characters, the number of 7, 8 and 9 digits, refresh = issue and
//   expiry = refresh accepted, expiry before refresh refused;
// - the client calls the functions and parameter names the SQL declares; a request id that is not a UUID is refused
//   before any call.

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";
const REQUEST = "77777777-7777-4777-8777-777777777701";

const ISSUED = {
	state: "issued",
	refusal: null,
	code: {
		qr_payload: `fnb-stamp:1:${TOKEN}`,
		number: "48217368",
		display_number: "4821 7368",
		issued_at: "2026-11-28T05:00:00Z",
		refresh_at: "2026-11-28T05:09:00Z",
		expires_at: "2026-11-28T05:10:00Z",
	},
};

const REQUEST_JSON = {
	id: REQUEST,
	kind: "booking",
	store: "mau-1",
	status: "proposed",
	party_size: 4,
	requested_for: "2026-11-29T12:00:00Z",
	proposed_for: "2026-11-29T12:30:00Z",
	subject: null,
	note: null,
	created_at: "2026-11-28T05:00:00Z",
	answered_at: "2026-11-28T05:05:00Z",
	answer_message: "Giờ đó đã kín bàn.",
	cancelled_at: null,
	cancelled_by: null,
	version: 2,
	contact_name: "Khách Mẫu",
};

describe("the member code answer", () => {
	it("reads an issued code", () => {
		expect(readStampCodeAnswer(ISSUED)).toEqual({
			state: "issued",
			code: {
				qrPayload: `fnb-stamp:1:${TOKEN}`,
				number: "48217368",
				displayNumber: "4821 7368",
				issuedAt: "2026-11-28T05:00:00Z",
				refreshAt: "2026-11-28T05:09:00Z",
				expiresAt: "2026-11-28T05:10:00Z",
			},
		});
	});

	it("reads the refusals with the time to try again", () => {
		expect(
			readStampCodeAnswer({
				state: "refused",
				refusal: "rate_limited",
				retry_at: "2026-11-28T05:15:00Z",
				code: null,
			}),
		).toEqual({
			state: "refused",
			refusal: "rate_limited",
			retryAt: "2026-11-28T05:15:00Z",
		});
		expect(
			readStampCodeAnswer({
				state: "refused",
				refusal: "stamps_off",
				code: null,
			}),
		).toEqual({ state: "refused", refusal: "stamps_off", retryAt: null });
	});

	it("refuses a malformed code (BVA of the token and the number, the times' order)", () => {
		const with_ = (code: Record<string, unknown>) => ({
			...ISSUED,
			code: { ...ISSUED.code, ...code },
		});
		for (const bad of [
			with_({ qr_payload: `fnb-stamp:1:${TOKEN.slice(1)}` }),
			with_({ qr_payload: `fnb-stamp:1:${TOKEN}A` }),
			with_({ qr_payload: `fnb-stamp:2:${TOKEN}` }),
			with_({ number: "4821736", display_number: "4821 736" }),
			with_({ number: "482173680", display_number: "4821 73680" }),
			with_({ display_number: "4821 7369" }),
			with_({ expires_at: "2026-11-28T05:08:00Z" }),
			with_({ refresh_at: "2026-11-28T04:59:00Z" }),
			with_({ issued_at: "not a time" }),
			{ state: "maybe" },
			null,
		])
			expect(() => readStampCodeAnswer(bad)).toThrow();
		expect(
			readStampCodeAnswer(
				with_({
					refresh_at: "2026-11-28T05:00:00Z",
					expires_at: "2026-11-28T05:00:00Z",
				}),
			).state,
		).toBe("issued");
	});
});

describe("the deletion answer", () => {
	it("reads a deletion and each refusal", () => {
		expect(
			readDeleteAccountAnswer({
				state: "deleted",
				refusal: null,
				deleted: true,
				deleted_at: "2026-11-28T05:00:00Z",
				counts: { orders: 2 },
			}),
		).toEqual({ state: "deleted", deletedAt: "2026-11-28T05:00:00Z" });
		expect(
			readDeleteAccountAnswer({
				state: "refused",
				refusal: "open_orders",
				deleted: false,
				orders: 1,
			}),
		).toEqual({ state: "refused", refusal: "open_orders", orders: 1 });
		expect(
			readDeleteAccountAnswer({
				state: "refused",
				refusal: "member_request",
				deleted: false,
			}),
		).toEqual({ state: "refused", refusal: "member_request", orders: null });
	});

	it("refuses a deletion that does not say deleted, and a malformed refusal", () => {
		expect(() =>
			readDeleteAccountAnswer({
				state: "deleted",
				deleted: false,
				deleted_at: "2026-11-28T05:00:00Z",
			}),
		).toThrow();
		expect(() =>
			readDeleteAccountAnswer({ state: "refused", refusal: "Open Orders" }),
		).toThrow();
		expect(() =>
			readDeleteAccountAnswer({
				state: "refused",
				refusal: "open_orders",
				orders: -1,
			}),
		).toThrow();
	});
});

describe("the customer's requests", () => {
	it("read a proposed time and the store's message, never a phone", () => {
		const { requests } = readCustomerRequests({ requests: [REQUEST_JSON] });
		expect(requests[0]).toMatchObject({
			id: REQUEST,
			status: "proposed",
			proposedFor: "2026-11-29T12:30:00Z",
			answerMessage: "Giờ đó đã kín bàn.",
			partySize: 4,
		});
		expect(Object.keys(requests[0] ?? {})).not.toContain("phone");
	});

	it("refuse an unknown status or kind and a malformed id", () => {
		for (const bad of [
			{ ...REQUEST_JSON, status: "maybe" },
			{ ...REQUEST_JSON, kind: "party" },
			{ ...REQUEST_JSON, id: "1" },
			{ ...REQUEST_JSON, proposed_for: "tomorrow" },
		])
			expect(() => readCustomerRequests({ requests: [bad] })).toThrow();
		expect(() => readCustomerRequests({})).toThrow();
	});

	it("read a cancellation and its refusals", () => {
		expect(
			readCancelRequestAnswer({
				state: "cancelled",
				refusal: null,
				replayed: false,
				request: { ...REQUEST_JSON, status: "cancelled" },
			}),
		).toMatchObject({
			state: "cancelled",
			replayed: false,
			request: { status: "cancelled" },
		});
		expect(
			readCancelRequestAnswer({
				state: "refused",
				refusal: "unknown_request",
				replayed: false,
				request: null,
			}),
		).toEqual({ state: "refused", refusal: "unknown_request", request: null });
	});
});

describe("the data export", () => {
	const EXPORT = {
		generated_at: "2026-11-28T05:00:00Z",
		login: { zalo_user_id: "z-1", brand: "Mẫu", joined: false },
		customer: null,
		orders: [{ id: "x", lines: [{ item_name: "<b>Trà</b>" }] }],
		not_kept: ["location"],
		counts: { orders: 1 },
	};

	it("keeps the answer's sections in order, without the time, and the whole answer to copy", () => {
		const read = readDataExport(EXPORT);
		expect(read.generatedAt).toBe("2026-11-28T05:00:00Z");
		expect(read.sections.map((section) => section.key)).toEqual([
			"login",
			"customer",
			"orders",
			"not_kept",
			"counts",
		]);
		expect(read.raw).toEqual(EXPORT);
	});

	it("refuses an answer without its frame or with a value JSON cannot carry", () => {
		expect(() => readDataExport({ ...EXPORT, generated_at: "x" })).toThrow();
		expect(() => readDataExport({ ...EXPORT, login: null })).toThrow();
		expect(() => readDataExport({ ...EXPORT, counts: [] })).toThrow();
		expect(() =>
			readDataExport({ ...EXPORT, extra: Number.POSITIVE_INFINITY }),
		).toThrow();
	});
});

describe("the stamp card's attached orders and the ready time of a summary", () => {
	it("read the counter's attachments (C20 frame 5) and the summary's ready_estimate_at", () => {
		const card = readStampCard({
			enabled: true,
			stamps: 4,
			stamps_per_reward: 9,
			reward_name: "Ly miễn phí",
			attached: [
				{
					order_no: "#027",
					store_name: "Cửa hàng mẫu",
					status: "accepted",
					attached_at: "2026-11-28T05:00:00Z",
					stamps: 3,
				},
			],
		});
		expect(card.attached).toEqual([
			{
				orderNo: "#027",
				storeName: "Cửa hàng mẫu",
				status: "accepted",
				attachedAt: "2026-11-28T05:00:00Z",
				stamps: 3,
			},
		]);
		expect(
			readStampCard({
				enabled: true,
				stamps: 0,
				stamps_per_reward: 9,
				reward_name: "Ly miễn phí",
			}).attached,
		).toEqual([]);
		const summary = {
			id: "66666666-6666-4666-8666-666666666601",
			display_no: "#001",
			store_name: "Cửa hàng mẫu",
			type: "table",
			table_label: "Bàn 1",
			status: "accepted",
			payment_status: "unpaid",
			total: 29000,
			placed_at: "2026-11-28T05:00:00Z",
			items: 1,
		};
		expect(
			readOrderList({
				orders: [{ ...summary, ready_estimate_at: "2026-11-28T05:10:00Z" }],
				next_before: null,
			}).orders[0]?.readyEstimateAt,
		).toBe("2026-11-28T05:10:00Z");
		expect(
			readOrderList({ orders: [summary], next_before: null }).orders[0]
				?.readyEstimateAt,
		).toBeNull();
		expect(() =>
			readOrderList({
				orders: [{ ...summary, ready_estimate_at: "soon" }],
				next_before: null,
			}),
		).toThrow();
	});
});

describe("the REST client's account calls", () => {
	function recording(answer: unknown) {
		const calls: { fn: string; args: unknown }[] = [];
		const rest: RestClient = {
			select: async () => [],
			rpc: async (fn, args) => {
				calls.push({ fn, args });
				return answer;
			},
		};
		return { calls, client: createRestOrderingClient(rest) };
	}

	it("call the functions and parameter names the SQL declares", async () => {
		const code = recording(ISSUED);
		await code.client.stampCode();
		expect(code.calls[0]?.fn).toBe(ACCOUNT_FUNCTIONS.stampCode);
		expect(code.calls[0]?.args ?? {}).toEqual({});
		const deletion = recording({
			state: "refused",
			refusal: "member_request",
			deleted: false,
		});
		await deletion.client.deleteAccount();
		expect(deletion.calls[0]).toEqual({
			fn: "customer_delete_account",
			args: { p_confirm: true },
		});
		const requests = recording({ requests: [] });
		await requests.client.requests();
		expect(requests.calls[0]?.fn).toBe("customer_requests");
		const cancel = recording({
			state: "cancelled",
			refusal: null,
			replayed: false,
			request: REQUEST_JSON,
		});
		await cancel.client.cancelRequest(REQUEST);
		expect(cancel.calls[0]).toEqual({
			fn: "customer_cancel_request",
			args: { p_request: REQUEST },
		});
		const exported = recording({
			generated_at: "2026-11-28T05:00:00Z",
			login: {},
			counts: {},
		});
		await exported.client.exportData();
		expect(exported.calls[0]?.fn).toBe("customer_export_data");
	});

	it("refuse a request id that is not a UUID before any call", async () => {
		const cancel = recording(null);
		await expect(cancel.client.cancelRequest("1 or 1=1")).rejects.toThrow();
		expect(cancel.calls).toEqual([]);
		expect(() => requestIdArgs("../x")).toThrow();
	});
});
