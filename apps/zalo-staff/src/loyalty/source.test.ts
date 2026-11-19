import { type RestClient, RestError, type StoredSession } from "@fnb/zalo-mini";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoLoyaltyClient, DEMO_CODES, DEMO_PHONES } from "./demo";
import { STAND_IN_SCANS, standInScanTools } from "./scan";
import {
	createRestLoyaltyClient,
	LOCAL_LOOP_LOYALTY_VARIABLE,
	localLoopLoyalty,
	loyaltyModeFrom,
	loyaltySourceFor,
	sampleLoyaltyContext,
} from "./source";

const STORE = "00000000-0000-4000-8000-0000000005a1";
const ITEM = "00000000-0000-4000-8000-00000000d001";
const AT = "2026-11-19T05:00:00Z";
const NOW = new Date(AT);

interface Call {
	readonly fn: string;
	readonly args: unknown;
}

function fakeRest(answers: Readonly<Record<string, unknown>>) {
	const calls: Call[] = [];
	const rest: RestClient = {
		async select() {
			throw new Error("no table reads here");
		},
		async rpc(fn, args = {}) {
			calls.push({ fn, args });
			const answer = answers[fn];
			if (answer instanceof Error) throw answer;
			return answer;
		},
	};
	return { rest, calls };
}

function session(role: "staff" | "manager"): StoredSession {
	return {
		accessToken: `token-${role}-${Math.random()}`,
		refreshToken: "refresh",
		expiresAt: Date.now() + 3600_000,
		member: { displayName: "Thành viên thử", role, stores: ["Cửa hàng Mẫu 1"] },
	};
}

afterEach(() => {
	window.history.replaceState({}, "", "/");
});

describe("the REST loyalty client", () => {
	it("calls each function by its contract name with the contract's arguments", async () => {
		const { rest, calls } = fakeRest({
			staff_record_checkin: {
				checkin_id: ITEM,
				state: "queued",
				recorded_at: AT,
				member: { phone_masked: "•••• ••• 234" },
			},
			staff_verify_redemption: { state: "refused", refusal: "expired" },
			staff_member_lookup: { found: false },
			staff_request: { request_id: ITEM, kind: "dispute", state: "pending" },
			staff_loyalty_queue: [],
			resolve_loyalty_queue_item: { state: "dismissed", entry_id: null },
			staff_decide_loyalty_request: { state: "refused" },
			staff_my_loyalty_requests: [],
		});
		const client = createRestLoyaltyClient(rest);
		expect(
			await client.recordCheckin({
				storeId: STORE,
				entry: { kind: "code", code: "246810", payload: null },
			}),
		).toMatchObject({ outcome: "recorded", state: "queued" });
		expect(await client.verifyRedemption(STORE, "UD2468")).toMatchObject({
			outcome: "refused",
			refusal: "expired",
		});
		expect(
			await client.lookupMember(STORE, { kind: "phone", phone: "0900001234" }),
		).toEqual({ found: false });
		expect(
			await client.request({
				kind: "dispute",
				storeId: STORE,
				membershipId: ITEM,
				reason: "Thiếu dấu.",
				stamps: 1,
				points: 0,
			}),
		).toEqual({ requestId: ITEM, kind: "dispute", state: "pending" });
		expect(await client.queue(STORE)).toEqual([]);
		expect(
			await client.act({
				kind: "match",
				itemId: ITEM,
				invoiceId: null,
				reason: "Không khớp.",
			}),
		).toEqual({ state: "dismissed", refusal: null });
		expect(
			await client.act({
				kind: "decide",
				itemId: ITEM,
				decision: "refused",
				reason: "Không đúng.",
				stamps: 0,
				points: 0,
			}),
		).toEqual({ state: "refused", refusal: null });
		expect(await client.myRequests()).toEqual([]);
		expect(calls.map((call) => call.fn)).toEqual([
			"staff_record_checkin",
			"staff_verify_redemption",
			"staff_member_lookup",
			"staff_request",
			"staff_loyalty_queue",
			"resolve_loyalty_queue_item",
			"staff_decide_loyalty_request",
			"staff_my_loyalty_requests",
		]);
		expect(calls[0]?.args).toEqual({ p_store_id: STORE, p_code: "246810" });
		expect(calls[2]?.args).toEqual({
			p_store_id: STORE,
			p_phone: "0900001234",
		});
		expect(calls[7]?.args).toEqual({});
	});

	it("passes the database's refusal through and refuses a malformed answer", async () => {
		const refused = new RestError(403, "42501");
		const { rest } = fakeRest({
			staff_loyalty_queue: refused,
			staff_member_lookup: { found: true, card: { membership_id: ITEM } },
			staff_my_loyalty_requests: { not: "rows" },
		});
		const client = createRestLoyaltyClient(rest);
		await expect(client.queue(STORE)).rejects.toBe(refused);
		await expect(
			client.lookupMember(STORE, { kind: "phone", phone: "0900001234" }),
		).rejects.toThrow("member phone");
		await expect(client.myRequests()).rejects.toThrow("own requests");
	});
});

describe("choosing the loyalty source", () => {
	it("uses the live functions in the Zalo runtime, and in the local loop when its stack has them", () => {
		expect(LOCAL_LOOP_LOYALTY_VARIABLE).toBe("VITE_STAFF_LOYALTY");
		expect(localLoopLoyalty("live")).toBe("live");
		expect(localLoopLoyalty("demo")).toBe("demo");
		expect(localLoopLoyalty(undefined)).toBe("demo");
		expect(loyaltyModeFrom("", "browser", "live")).toBe("live");
		expect(loyaltyModeFrom("?loyalty=demo", "browser", "live")).toBe("demo");
		expect(loyaltyModeFrom("?loyalty=other", "browser", "live")).toBe("live");
		expect(loyaltyModeFrom("", "zalo")).toBe("live");
		expect(loyaltyModeFrom("?loyalty=demo", "zalo")).toBe("live");
		expect(loyaltyModeFrom("", "browser")).toBe("demo");
		expect(loyaltyModeFrom("?loyalty=live", "browser")).toBe("live");
		expect(loyaltyModeFrom("?loyalty=other", "browser")).toBe("demo");
	});

	it("gives the stand-in session the demo without a badge, and keeps one source per session", () => {
		const signedIn = session("staff");
		const source = loyaltySourceFor({ kind: "stand-in" }, signedIn);
		expect(source.sampleBadge).toBe(false);
		expect(loyaltySourceFor({ kind: "stand-in" }, signedIn)).toBe(source);
		expect(loyaltySourceFor({ kind: "stand-in" }, session("staff"))).not.toBe(
			source,
		);
	});

	it("marks demo data over a real session, and uses the functions when asked", async () => {
		const endpoint = {
			kind: "supabase" as const,
			url: "http://127.0.0.1:1",
			publishableKey: "sb_publishable_test",
		};
		const demo = loyaltySourceFor(endpoint, session("staff"));
		expect(demo.sampleBadge).toBe(true);
		expect(
			(
				await demo.client.lookupMember(STORE, {
					kind: "phone",
					phone: DEMO_PHONES.member,
				})
			).found,
		).toBe(true);
		window.history.replaceState({}, "", "/?loyalty=live");
		const live = loyaltySourceFor(endpoint, session("staff"));
		expect(live.sampleBadge).toBe(false);
		expect("nameStores" in live.client).toBe(false);
		expect("nameStores" in demo.client).toBe(true);
	});

	it("gives the sample stores the member may see", () => {
		const context = sampleLoyaltyContext(
			{
				role: "staff",
				tenantId: null,
				storeIds: null,
				storeNames: ["Cửa hàng Mẫu 2"],
			},
			NOW,
		);
		expect(context.stores.map((store) => store.name)).toEqual([
			"Cửa hàng Mẫu 2",
		]);
	});
});

describe("the demo client", () => {
	it("is deterministic: the same entries give the same answers on a fixed clock", async () => {
		const clock = () => NOW;
		const answers = async () => {
			const client = createDemoLoyaltyClient({
				settings: { delayMs: 0 },
				role: "staff",
				clock,
			});
			return [
				await client.recordCheckin({
					storeId: STORE,
					entry: { kind: "code", code: DEMO_CODES.live, payload: null },
				}),
				await client.verifyRedemption(STORE, DEMO_CODES.posReward),
				await client.lookupMember(STORE, {
					kind: "phone",
					phone: DEMO_PHONES.member,
				}),
			].map((answer) => {
				const {
					checkinId: _c,
					redemptionId: _r,
					...rest
				} = answer as Record<string, unknown>;
				return rest;
			});
		};
		expect(await answers()).toEqual(await answers());
	});

	it("keeps staff out of the queue and requires a reason from a manager", async () => {
		const staff = createDemoLoyaltyClient({
			settings: { delayMs: 0 },
			role: "staff",
		});
		await expect(staff.queue(STORE)).rejects.toMatchObject({ code: "42501" });
		await expect(
			staff.act({ kind: "match", itemId: ITEM, invoiceId: null, reason: "x" }),
		).rejects.toMatchObject({ code: "42501" });
		const manager = createDemoLoyaltyClient({
			settings: { delayMs: 0 },
			role: "manager",
		});
		const [first] = await manager.queue(STORE);
		await expect(
			manager.act({
				kind: "match",
				itemId: first?.id ?? "",
				invoiceId: null,
				reason: "  ",
			}),
		).rejects.toMatchObject({ code: "22023" });
		const receipt = await manager.request({
			kind: "adjustment",
			storeId: STORE,
			membershipId: "00000000-0000-4000-8000-c00000000001",
			reason: "Quản lý điều chỉnh.",
			stamps: 5,
			points: 0,
		});
		expect(receipt.state).toBe("applied");
	});
});

describe("the stand-in scanner", () => {
	it("answers the demo codes, a chosen code, a refusal or a cancel from the address", async () => {
		expect(await standInScanTools("").scan("member")).toEqual({
			kind: "content",
			content: STAND_IN_SCANS.member,
		});
		expect(STAND_IN_SCANS.member).toContain(DEMO_CODES.live);
		expect(await standInScanTools("").scan("redemption")).toEqual({
			kind: "content",
			content: STAND_IN_SCANS.redemption,
		});
		expect(await standInScanTools("?scanCode=135790").scan("member")).toEqual({
			kind: "content",
			content: "135790",
		});
		expect(await standInScanTools("?scan=refused").scan("member")).toEqual({
			kind: "refused",
		});
		expect(await standInScanTools("?scan=cancel").scan("member")).toEqual({
			kind: "cancelled",
		});
	});
});
