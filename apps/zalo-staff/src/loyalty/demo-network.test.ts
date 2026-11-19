import { RestError } from "@fnb/zalo-mini";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoLoyaltyClient, DEMO_PHONES } from "./demo";
import { demoNetworkFrom, withDemoNetwork } from "./demo-network";

const NOW = new Date("2026-11-19T12:00:00+07:00");
const STORE = "00000000-0000-4000-8000-000000000001";
const ENTRY = { kind: "phone", phone: DEMO_PHONES.member } as const;

function client(search: string) {
	return withDemoNetwork(
		createDemoLoyaltyClient({
			settings: { delayMs: 0 },
			role: "staff",
			clock: () => NOW,
		}),
		demoNetworkFrom(search),
	);
}

afterEach(() => vi.unstubAllGlobals());

describe("the stand-in network (equivalence classes of ?net=)", () => {
	it("is off unless asked for: the client is returned unchanged", () => {
		expect(demoNetworkFrom("")).toEqual({
			fault: "none",
			delayMs: 0,
			answerDelayMs: 0,
		});
		expect(demoNetworkFrom("?net=banana").fault).toBe("none");
		const base = createDemoLoyaltyClient({
			settings: { delayMs: 0 },
			role: "staff",
		});
		expect(withDemoNetwork(base, demoNetworkFrom(""))).toBe(base);
	});

	it("reads the delays and caps them at ten seconds", () => {
		expect(
			demoNetworkFrom("?net=strict&dataDelay=250&answerDelay=99999"),
		).toEqual({
			fault: "strict",
			delayMs: 250,
			answerDelayMs: 10_000,
		});
	});

	it("fails a call made offline before it commits, and records once when online", async () => {
		vi.stubGlobal("navigator", { onLine: false });
		const demo = client("?net=strict");
		await expect(
			demo.recordCheckin({ storeId: STORE, entry: ENTRY }),
		).rejects.toMatchObject({ status: 0 });
		vi.stubGlobal("navigator", { onLine: true });
		const first = await demo.recordCheckin({ storeId: STORE, entry: ENTRY });
		expect(first.outcome).toBe("recorded");
	});

	it("loses the answer of the first change once, and the database refuses the same member again", async () => {
		const demo = client("?net=lost-once");
		await expect(
			demo.recordCheckin({ storeId: STORE, entry: ENTRY }),
		).rejects.toBeInstanceOf(RestError);
		const again = await demo.recordCheckin({ storeId: STORE, entry: ENTRY });
		expect(again).toMatchObject({
			outcome: "refused",
			refusal: "already_recorded",
		});
	});

	it("refuses the first change once with a server error, then works", async () => {
		const demo = client("?net=error-once");
		await expect(
			demo.recordCheckin({ storeId: STORE, entry: ENTRY }),
		).rejects.toMatchObject({ status: 500 });
		expect(
			(await demo.recordCheckin({ storeId: STORE, entry: ENTRY })).outcome,
		).toBe("recorded");
	});

	it("gives the same staff member the same reward answer again after a lost answer", async () => {
		const demo = client("?net=lost-once");
		await expect(demo.verifyRedemption(STORE, "UD2468")).rejects.toMatchObject({
			status: 0,
		});
		const retry = await demo.verifyRedemption(STORE, "UD2468");
		expect(retry).toMatchObject({
			outcome: "accepted",
			firstVerification: false,
		});
	});
});
