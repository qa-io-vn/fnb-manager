import {
	createMemoryStorage,
	createZaloCustomerSessionClient,
	RestError,
} from "@fnb/zalo-mini";
import {
	ACCOUNT_FUNCTIONS,
	createRestOrderingClient,
	type OrderingClient,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { createOrderingWorld } from "./ordering-world";
import { createDemoWorld, DEMO_DEFAULTS } from "./world";

// Test design (ISTQB) for the demo world's "Đồng ý giờ mới" (customer_accept_proposal), the stand-in of the server the
// browser tests run on (it must answer as docs/api.md specifies, or the app is tested against a fiction):
// - state transitions: new → (the store proposes) proposed → (the customer accepts) confirmed at the time proposed,
//   with customer_accepted_at and the version moved on; confirmed → accept again is not_allowed;
// - equivalence partitions of the refusals, in the server's order: request_conflict (the app's id used on another
//   request), unknown_request (an unknown id: the same answer as another customer's), a replay of the same id (the
//   request as it is now, nothing written), not_allowed (new, confirmed, cancelled), proposal_expired;
// - boundary values of the time proposed: one millisecond ahead is accepted, at the instant and after it expired;
// - malformed ids are 22023 (a 400), before anything is read.

const START = Date.UTC(2026, 10, 28, 3, 0, 0); // 10:00 in Vietnam
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const id = (n: number) =>
	`12345678-1234-4234-8234-${String(n).padStart(12, "0")}`;

async function setup() {
	let clock = START;
	const world = createDemoWorld(DEMO_DEFAULTS, () => clock);
	const ordering = createOrderingWorld(world.now, null);
	world.extend(ordering);
	const sessions = createZaloCustomerSessionClient({
		endpoint: "demo",
		brandKey: "brand-1",
		publishableKey: "demo",
		storage: createMemoryStorage(),
		getAccessToken: async () => "mock-zalo-access-token",
		fetch: world.sessionFetch,
		now: () => clock,
	});
	const state = await sessions.connect();
	if (state.status !== "ready") throw new Error("no session");
	const rest = world.rest(state.session.accessToken);
	const client: OrderingClient = createRestOrderingClient(rest);
	return {
		till: ordering.till,
		client,
		rest,
		at: (time: number) => {
			clock = time;
		},
	};
}

describe("the customer accepts a time proposed (state transitions)", () => {
	it("confirms the request at the time proposed, once", async () => {
		const demo = await setup();
		const request = demo.till.addRequest();
		demo.till.proposeRequest(request);
		const before = (await demo.client.requests()).requests[0];
		expect(before?.status).toBe("proposed");
		const answer = await demo.client.acceptProposal(request, id(1));
		expect(answer).toMatchObject({
			state: "accepted",
			replayed: false,
			request: {
				id: request,
				status: "confirmed",
				requestedFor: before?.proposedFor,
				proposedFor: before?.proposedFor,
				customerAcceptedAt: new Date(START).toISOString(),
				version: (before?.version ?? 0) + 1,
			},
		});
		expect(demo.till.requestStatus(request)).toBe("confirmed");
		expect(demo.till.acceptances()).toBe(1);
		// the list reads it confirmed at the new time
		expect((await demo.client.requests()).requests[0]).toMatchObject({
			status: "confirmed",
			requestedFor: before?.proposedFor,
		});
	});

	it("answers the same id again as a replay, writing nothing", async () => {
		const demo = await setup();
		const request = demo.till.addRequest();
		demo.till.proposeRequest(request);
		await demo.client.acceptProposal(request, id(1));
		const again = await demo.client.acceptProposal(request, id(1));
		expect(again).toMatchObject({
			state: "accepted",
			replayed: true,
			request: { status: "confirmed" },
		});
		expect(demo.till.acceptances()).toBe(1);
	});

	it("refuses a second acceptance under a new id as not_allowed", async () => {
		const demo = await setup();
		const request = demo.till.addRequest();
		demo.till.proposeRequest(request);
		await demo.client.acceptProposal(request, id(1));
		expect(await demo.client.acceptProposal(request, id(2))).toMatchObject({
			state: "refused",
			refusal: "not_allowed",
			request: { status: "confirmed" },
		});
	});
});

describe("the refusals (EP)", () => {
	it("not_allowed for a new, a store-confirmed and a cancelled request", async () => {
		const demo = await setup();
		const fresh = demo.till.addRequest();
		expect(await demo.client.acceptProposal(fresh, id(1))).toMatchObject({
			state: "refused",
			refusal: "not_allowed",
		});
		const confirmed = demo.till.addRequest();
		demo.till.proposeRequest(confirmed);
		demo.till.confirmRequest(confirmed);
		expect(await demo.client.acceptProposal(confirmed, id(2))).toMatchObject({
			refusal: "not_allowed",
		});
		const cancelled = demo.till.addRequest();
		demo.till.proposeRequest(cancelled);
		await demo.client.cancelRequest(cancelled);
		expect(await demo.client.acceptProposal(cancelled, id(3))).toMatchObject({
			refusal: "not_allowed",
			request: { status: "cancelled" },
		});
		expect(demo.till.acceptances()).toBe(0);
	});

	it("unknown_request for an id that is not the customer's, without the request", async () => {
		const demo = await setup();
		expect(await demo.client.acceptProposal(UNKNOWN, id(1))).toEqual({
			state: "refused",
			refusal: "unknown_request",
			request: null,
		});
	});

	it("request_conflict for the app's id on another request", async () => {
		const demo = await setup();
		const first = demo.till.addRequest();
		const second = demo.till.addRequest();
		demo.till.proposeRequest(first);
		demo.till.proposeRequest(second);
		await demo.client.acceptProposal(first, id(1));
		expect(await demo.client.acceptProposal(second, id(1))).toEqual({
			state: "refused",
			refusal: "request_conflict",
			request: null,
		});
		expect(demo.till.requestStatus(second)).toBe("proposed");
	});

	it("22023 (a 400) for ids that are not UUIDs, before anything is read", async () => {
		const demo = await setup();
		const request = demo.till.addRequest();
		demo.till.proposeRequest(request);
		for (const args of [
			{ p_request: request, p_request_id: "not-a-uuid" },
			{ p_request: "1 or 1=1", p_request_id: id(1) },
			{ p_request: request },
		]) {
			const refused = await demo.rest
				.rpc(ACCOUNT_FUNCTIONS.acceptProposal, args)
				.then(
					() => null,
					(error: unknown) => error,
				);
			expect(refused).toBeInstanceOf(RestError);
			expect((refused as RestError).status).toBe(400);
		}
		expect(demo.till.requestStatus(request)).toBe("proposed");
		expect(demo.till.acceptances()).toBe(0);
	});
});

describe("the time proposed (BVA)", () => {
	it("is accepted one millisecond before it and expired at it and after", async () => {
		const demo = await setup();
		const requests = [1, 2, 3].map(() => {
			const request = demo.till.addRequest();
			demo.till.proposeRequest(request);
			return request;
		});
		const proposed = Date.parse(
			(await demo.client.requests()).requests[0]?.proposedFor ?? "",
		);
		demo.at(proposed - 1);
		expect(
			(await demo.client.acceptProposal(requests[0] ?? "", id(1))).state,
		).toBe("accepted");
		demo.at(proposed);
		expect(
			await demo.client.acceptProposal(requests[1] ?? "", id(2)),
		).toMatchObject({ state: "refused", refusal: "proposal_expired" });
		demo.at(proposed + 60_000);
		expect(
			await demo.client.acceptProposal(requests[2] ?? "", id(3)),
		).toMatchObject({
			state: "refused",
			refusal: "proposal_expired",
			request: { status: "proposed" },
		});
	});
});
