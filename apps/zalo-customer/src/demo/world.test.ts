import {
	createMemoryStorage,
	createZaloCustomerSessionClient,
	RestError,
} from "@fnb/zalo-mini";
import {
	createRestLoyaltyClient,
	type LoyaltyClient,
	MAX_CLAIMS_PER_DAY,
} from "@fnb/zalo-mini/loyalty";
import { describe, expect, it } from "vitest";
import { addDays, isoDateIn } from "../data/dates";
import { failureOf } from "../data/source";
import { DEMO_PHONE_TOKEN, DEMO_POLICY_VERSION } from "./fixtures";
import {
	createDemoWorld,
	DEMO_DEFAULTS,
	type DemoSettings,
	demoSettingsFrom,
} from "./world";

const START = Date.UTC(2026, 10, 19, 3, 0, 0);

function setup(settings: Partial<DemoSettings> = {}) {
	let clock = START;
	const world = createDemoWorld({ ...DEMO_DEFAULTS, ...settings }, () => clock);
	const session = createZaloCustomerSessionClient({
		endpoint: "demo",
		brandKey: "brand-1",
		publishableKey: "demo",
		storage: createMemoryStorage(),
		getAccessToken: async () => "mock-zalo-access-token",
		fetch: world.sessionFetch,
		now: () => clock,
	});
	return {
		world,
		session,
		tick: (ms: number) => {
			clock += ms;
		},
		client: (token: string): LoyaltyClient =>
			createRestLoyaltyClient(world.rest(token)),
	};
}

const JOIN = {
	phoneToken: DEMO_PHONE_TOKEN,
	loyaltyConsent: true,
	marketingConsent: false,
	policyVersion: DEMO_POLICY_VERSION,
	screenVersion: "join-1",
	store: null,
	shownAt: START,
} as const;

describe("demo settings", () => {
	it("read the address's switches", () => {
		expect(demoSettingsFrom("")).toEqual(DEMO_DEFAULTS);
		expect(
			demoSettingsFrom(
				"?member=1&marketing=1&claims=9&dataDelay=50000&session=failed",
			),
		).toEqual({
			member: true,
			marketing: true,
			sessionFailure: true,
			claimsUsed: MAX_CLAIMS_PER_DAY,
			delayMs: 10_000,
		});
		expect(demoSettingsFrom("?marketing=1").marketing).toBe(false);
	});
});

describe("the demo source", () => {
	it("answers a visitor session with the home only, every answer readable by the contract", async () => {
		const demo = setup();
		const state = await demo.session.connect();
		if (state.status !== "ready") throw new Error("no session");
		expect(state.session.customer).toEqual({
			tenantId: "00000000-0000-4000-8000-0000000000c1",
			customerId: null,
			displayName: "Khách thử",
		});
		const client = demo.client(state.session.accessToken);
		const home = await client.home();
		expect(home.stores.map((store) => store.code)).toEqual(["mau-1", "mau-2"]);
		expect(home.legal.policyVersion).toBe(DEMO_POLICY_VERSION);
		const refusal = await client.wallet().catch((error: unknown) => error);
		expect(refusal).toBeInstanceOf(RestError);
		expect(failureOf(refusal)).toBe("not-member");
		await expect(demo.client("forged").home()).rejects.toMatchObject({
			status: 401,
		});
	});

	it("joins with the welcome stamp, refuses a missing consent, an old policy and a spent phone token", async () => {
		const demo = setup();
		await demo.session.connect();
		expect(
			await demo.session.join({ ...JOIN, policyVersion: "privacy-old" }),
		).toEqual({
			ok: false,
			failure: "policy_outdated",
		});
		expect(await demo.session.join({ ...JOIN, phoneToken: "spent" })).toEqual({
			ok: false,
			failure: "phone_token_refused",
		});
		expect(await demo.session.join({ ...JOIN, store: "mau-9" })).toEqual({
			ok: false,
			failure: "unknown_store",
		});
		expect(demo.world.joined()).toBe(false);
		const joined = await demo.session.join(JOIN);
		if (!joined.ok) throw new Error("not joined");
		expect(joined.joined).toEqual({
			membershipId: "00000000-0000-4000-8000-0000000000c3",
			welcomeStamps: 1,
			alreadyMember: false,
		});
		const wallet = await demo.client(joined.session.accessToken).wallet();
		expect(wallet.stampCards[0]?.stamps).toBe(1);
		expect(
			wallet.history.map((entry) => [
				entry.kind,
				entry.state,
				entry.matchedPath,
			]),
		).toEqual([["welcome", "confirmed", "welcome"]]);
		expect(wallet.marketingConsent).toBe(false);
		const again = await demo.session.join(JOIN);
		expect(again.ok && again.joined).toEqual({
			membershipId: "00000000-0000-4000-8000-0000000000c3",
			welcomeStamps: 0,
			alreadyMember: true,
		});
	});

	it("issues a store-bound code that changes every 60 seconds and lasts 2 minutes", async () => {
		const demo = setup({ member: true });
		const state = await demo.session.connect();
		if (state.status !== "ready") throw new Error("no session");
		const client = demo.client(state.session.accessToken);
		const first = await client.memberCode("mau-1");
		expect(first.refreshAt - first.issuedAt).toBe(60_000);
		expect(first.expiresAt - first.issuedAt).toBe(120_000);
		expect(first.storeName).toBe("Cửa hàng Mẫu 1");
		expect((await client.memberCode("mau-1")).code).toBe(first.code);
		expect((await client.memberCode("mau-2")).code).not.toBe(first.code);
		demo.tick(60_000);
		expect((await client.memberCode("mau-1")).code).not.toBe(first.code);
		await expect(client.memberCode("mau-9")).rejects.toMatchObject({
			code: "22023",
		});
	});

	it("matches, keeps pending and refuses claims with the server's reasons, every submission counting toward the 3 a day", async () => {
		const demo = setup({ member: true });
		const state = await demo.session.connect();
		if (state.status !== "ready") throw new Error("no session");
		const client = demo.client(state.session.accessToken);
		const today = isoDateIn(START);
		const claim = (
			receiptNo: string,
			amount = 50_000,
			businessDate = today,
		) => {
			demo.tick(1000);
			return client.submitClaim({
				store: "mau-1",
				receiptNo,
				amount,
				businessDate,
			});
		};
		expect(await claim("1001", 85_000)).toMatchObject({
			state: "matched",
			claimsLeftToday: 2,
		});
		expect(await claim("01001", 85_000)).toMatchObject({
			state: "rejected",
			reason: "already_claimed",
			claimsLeftToday: 1,
		});
		expect(await claim("A2", 50_000, addDays(today, -4))).toMatchObject({
			state: "rejected",
			reason: "outside_window",
			claimsLeftToday: 0,
		});
		expect(await claim("A3")).toMatchObject({
			state: "rejected",
			reason: "daily_cap",
			claimsLeftToday: 0,
		});
		const wallet = await client.wallet();
		expect(wallet.claimsToday).toBe(4);
		expect(wallet.claims.map((entry) => [entry.state, entry.reason])).toEqual([
			["rejected", "daily_cap"],
			["rejected", "outside_window"],
			["rejected", "already_claimed"],
			["matched", null],
		]);
		expect(wallet.history[0]).toMatchObject({
			matchedPath: "receipt_claim",
			receiptNo: "1001",
		});
		await expect(
			client.submitClaim({
				store: "mau-9",
				receiptNo: "1",
				amount: 1,
				businessDate: today,
			}),
		).rejects.toMatchObject({ code: "22023" });
	});

	it("keeps an unknown receipt pending and refuses a different amount", async () => {
		const demo = setup({ member: true });
		const state = await demo.session.connect();
		if (state.status !== "ready") throw new Error("no session");
		const client = demo.client(state.session.accessToken);
		const today = isoDateIn(START);
		expect(
			await client.submitClaim({
				store: "mau-1",
				receiptNo: "7777",
				amount: 30_000,
				businessDate: today,
			}),
		).toMatchObject({ state: "pending", reason: null, claimsLeftToday: 2 });
		expect(
			await client.submitClaim({
				store: "mau-1",
				receiptNo: "1001",
				amount: 80_000,
				businessDate: today,
			}),
		).toMatchObject({ state: "rejected", reason: "amount_mismatch" });
	});

	it("stops marketing and opens a deletion request", async () => {
		const demo = setup({ member: true, marketing: true });
		const state = await demo.session.connect();
		if (state.status !== "ready") throw new Error("no session");
		const client = demo.client(state.session.accessToken);
		expect((await client.wallet()).marketingConsent).toBe(true);
		expect(await client.stopMarketing()).toEqual({
			marketingConsent: false,
			stoppedAt: new Date(START).toISOString(),
		});
		expect((await client.wallet()).marketingConsent).toBe(false);
		expect(await client.requestDeletion()).toMatchObject({
			status: "received",
		});
	});

	it("fails like a lost connection when asked to", async () => {
		const demo = setup({ sessionFailure: true });
		expect(await demo.session.connect()).toEqual({
			status: "failed",
			reason: "network",
		});
	});
});
