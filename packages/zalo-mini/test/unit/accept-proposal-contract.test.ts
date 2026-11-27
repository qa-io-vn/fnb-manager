import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	ACCOUNT_FUNCTIONS,
	acceptProposalArgs,
	readAcceptProposalAnswer,
	readCustomerRequests,
} from "../../src/ordering/account-contract";
import { createRestOrderingClient } from "../../src/ordering/rest-ordering-client";

// Test design (ISTQB) for "Đồng ý giờ mới" (customer_accept_proposal, docs/api.md, native-till.md 18.2):
// - equivalence partitions of the answer: accepted, a replay (the request as it is now, a manager's cancel since
//   included), each refusal the server names (proposal_expired and not_allowed with the request, unknown_request and
//   request_conflict without), a refusal it may add later; malformed answers (no state, an unknown state, a refusal
//   that is not a code, an accepted answer without a request) are refused;
// - the request's customer_accepted_at: read when present, null when absent or null, a malformed instant refused;
// - the client calls the function and the two parameter names the SQL declares; the request and the attempt must be
//   UUIDs, refused before any call (error guessing: injection, an empty id, a swapped order is still two UUIDs).

const REQUEST = "77777777-7777-4777-8777-777777777701";
const ATTEMPT = "88888888-8888-4888-8888-888888888801";

const CONFIRMED = {
	id: REQUEST,
	kind: "booking",
	store: "mau-1",
	status: "confirmed",
	party_size: 4,
	requested_for: "2026-11-29T12:30:00Z",
	proposed_for: "2026-11-29T12:30:00Z",
	subject: null,
	note: null,
	created_at: "2026-11-28T05:00:00Z",
	answered_at: "2026-11-28T05:05:00Z",
	answer_message: "Giờ đó đã kín bàn.",
	cancelled_at: null,
	cancelled_by: null,
	customer_accepted_at: "2026-11-28T05:10:00Z",
	version: 3,
	contact_name: "Khách Mẫu",
};

describe("the acceptance answer (EP)", () => {
	it("reads an acceptance: the request confirmed at the time proposed, with the moment", () => {
		expect(
			readAcceptProposalAnswer({
				state: "accepted",
				refusal: null,
				replayed: false,
				request: CONFIRMED,
			}),
		).toEqual({
			state: "accepted",
			replayed: false,
			request: expect.objectContaining({
				id: REQUEST,
				status: "confirmed",
				requestedFor: "2026-11-29T12:30:00Z",
				customerAcceptedAt: "2026-11-28T05:10:00Z",
			}),
		});
	});

	it("reads a replay, even of a request a manager cancelled since", () => {
		const answer = readAcceptProposalAnswer({
			state: "accepted",
			refusal: null,
			replayed: true,
			request: { ...CONFIRMED, status: "cancelled" },
		});
		expect(answer).toMatchObject({
			state: "accepted",
			replayed: true,
			request: { status: "cancelled" },
		});
	});

	it.each([
		["proposal_expired", { ...CONFIRMED, status: "proposed" }],
		["not_allowed", { ...CONFIRMED, status: "declined" }],
		["unknown_request", null],
		["request_conflict", null],
		["something_new", null],
	])("reads the refusal %s", (refusal, request) => {
		const answer = readAcceptProposalAnswer({
			state: "refused",
			refusal,
			replayed: false,
			request,
		});
		expect(answer).toMatchObject({ state: "refused", refusal });
		expect(answer.request === null).toBe(request === null);
	});

	it("refuses a malformed answer", () => {
		for (const bad of [
			null,
			"accepted",
			{},
			{ state: "maybe" },
			{ state: "accepted", replayed: false },
			{ state: "accepted", request: { ...CONFIRMED, id: "1" } },
			{ state: "refused", refusal: "Not A Code", request: null },
			{ state: "refused", refusal: null, request: null },
		])
			expect(
				() => readAcceptProposalAnswer(bad),
				JSON.stringify(bad),
			).toThrow();
	});
});

describe("customer_accepted_at on a request", () => {
	it("is read when present and null when absent or null", () => {
		const { customer_accepted_at: _absent, ...older } = CONFIRMED;
		const { requests } = readCustomerRequests({
			requests: [
				CONFIRMED,
				older,
				{ ...CONFIRMED, customer_accepted_at: null },
			],
		});
		expect(requests.map((entry) => entry.customerAcceptedAt)).toEqual([
			"2026-11-28T05:10:00Z",
			null,
			null,
		]);
	});

	it("refuses a malformed instant", () => {
		expect(() =>
			readCustomerRequests({
				requests: [{ ...CONFIRMED, customer_accepted_at: "yesterday" }],
			}),
		).toThrow();
	});
});

describe("the REST client's acceptance", () => {
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

	it("calls customer_accept_proposal with p_request and p_request_id", async () => {
		const { calls, client } = recording({
			state: "accepted",
			refusal: null,
			replayed: false,
			request: CONFIRMED,
		});
		const answer = await client.acceptProposal(REQUEST, ATTEMPT);
		expect(answer.state).toBe("accepted");
		expect(ACCOUNT_FUNCTIONS.acceptProposal).toBe("customer_accept_proposal");
		expect(calls).toEqual([
			{
				fn: "customer_accept_proposal",
				args: { p_request: REQUEST, p_request_id: ATTEMPT },
			},
		]);
	});

	it("refuses ids that are not UUIDs before any call (error guessing)", async () => {
		const { calls, client } = recording(null);
		await expect(client.acceptProposal("1 or 1=1", ATTEMPT)).rejects.toThrow();
		await expect(client.acceptProposal(REQUEST, "")).rejects.toThrow();
		await expect(
			client.acceptProposal(REQUEST, `${ATTEMPT}x`),
		).rejects.toThrow();
		expect(calls).toEqual([]);
		expect(() => acceptProposalArgs("../x", ATTEMPT)).toThrow();
		expect(acceptProposalArgs(ATTEMPT, REQUEST)).toEqual({
			p_request: ATTEMPT,
			p_request_id: REQUEST,
		});
	});
});
