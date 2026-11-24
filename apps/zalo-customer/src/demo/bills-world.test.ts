// Test design for the demo world's staff-mode answers (the stand-in of customer_confirm_bill, customer_dispute_bill,
// customer_submit_counter_claim and the staff_mode refusal of customer_submit_claim), read through the real contract:
// - equivalence partitioning: a total within the tolerance, outside it; a bill of the member, an unknown one;
// - boundary values: ?bill=0, 1, 3 and 4; a total equal to the staff total +/- the tolerance and one đồng beyond;
//   totals 0, 1 and 100,000,001; the deadline itself (too late at confirm_by); the 5th failed code locks;
// - state transitions of a bill: awaiting_customer -> confirmed | queued | reversed; the same answer sent again gets the
//   first outcome back (G-92), a crossing answer (a dispute after a total, a total after a dispute) is already_answered;
// - decision table of the counter claim: code (live, stale, unknown, other store) x store mode x reuse x totals;
// - security: the wallet never carries the staff total, a replayed counter QR is refused, malformed input is 22023.
import {
	createMemoryStorage,
	createZaloCustomerSessionClient,
	RestError,
} from "@fnb/zalo-mini";
import {
	createRestLoyaltyClient,
	type LoyaltyClient,
	REFUSAL_INVALID,
} from "@fnb/zalo-mini/loyalty";
import { describe, expect, it } from "vitest";
import {
	DEMO_BILL_RULES,
	DEMO_COUNTER_QR,
	DEMO_LIVE_COUNTER_QRS,
	DEMO_STAFF_BILLS,
	DEMO_STALE_COUNTER_QR,
} from "./fixtures";
import {
	createDemoWorld,
	DEMO_DEFAULTS,
	type DemoSettings,
	demoSettingsFrom,
} from "./world";

const START = Date.UTC(2026, 10, 19, 3, 0, 0);
const [FIRST, SECOND] = DEMO_STAFF_BILLS;
if (FIRST === undefined || SECOND === undefined)
	throw new Error("the demo needs two staff bills");

async function member(settings: Partial<DemoSettings> = {}) {
	let clock = START;
	const world = createDemoWorld(
		{ ...DEMO_DEFAULTS, member: true, ...settings },
		() => clock,
	);
	const session = createZaloCustomerSessionClient({
		endpoint: "demo",
		brandKey: "brand-1",
		publishableKey: "demo",
		storage: createMemoryStorage(),
		getAccessToken: async () => "mock-zalo-access-token",
		fetch: world.sessionFetch,
		now: () => clock,
	});
	const state = await session.connect();
	if (state.status !== "ready") throw new Error("no session");
	const client: LoyaltyClient = createRestLoyaltyClient(
		world.rest(state.session.accessToken),
	);
	return {
		client,
		tick: (ms: number) => {
			clock += ms;
		},
	};
}

async function refusalOf(call: Promise<unknown>): Promise<string | null> {
	try {
		await call;
		return null;
	} catch (error) {
		return error instanceof RestError ? error.code : "not a RestError";
	}
}

describe("the staff-mode demo settings", () => {
	it("seed 1 to 3 bills for a member only, and imply staff mode (boundary values)", () => {
		expect(demoSettingsFrom("?member=1&bill=0")).toMatchObject({
			bills: 0,
			staffMode: false,
		});
		expect(demoSettingsFrom("?member=1&bill=1")).toMatchObject({
			bills: 1,
			staffMode: true,
		});
		expect(demoSettingsFrom("?member=1&bill=3").bills).toBe(3);
		expect(demoSettingsFrom("?member=1&bill=4").bills).toBe(3);
		expect(demoSettingsFrom("?member=1&bill=-1").bills).toBe(0);
		expect(demoSettingsFrom("?member=1&bill=x").bills).toBe(0);
		expect(demoSettingsFrom("?bill=1")).toMatchObject({
			bills: 0,
			staffMode: false,
		});
		expect(demoSettingsFrom("?staff=1").staffMode).toBe(true);
		expect(demoSettingsFrom("?staff=yes").staffMode).toBe(false);
	});
});

describe("the demo bills waiting for the customer", () => {
	it("show the store's mode on the home and list the bill without its total", async () => {
		const { client } = await member({ bills: 1, staffMode: true });
		const stores = (await client.home()).stores;
		expect(
			stores.map((store) => [
				store.code,
				store.confirmation,
				store.counterClaims,
			]),
		).toEqual([
			["mau-1", "staff", true],
			["mau-2", "pos_sync", false],
		]);
		const wallet = await client.wallet();
		expect(wallet.billsToConfirm).toEqual([
			{
				id: FIRST.id,
				storeName: "Cửa hàng Mẫu 1",
				billNo: FIRST.billNo,
				recordedAt: new Date(START - FIRST.minutesAgo * 60_000).toISOString(),
				confirmBy: new Date(
					START -
						FIRST.minutesAgo * 60_000 +
						DEMO_BILL_RULES.unconfirmedHours * 3_600_000,
				).toISOString(),
			},
		]);
		expect(JSON.stringify(wallet)).not.toContain(String(FIRST.staffTotal));
		expect(wallet.history[0]).toMatchObject({
			state: "pending",
			matchedPath: "bill",
			receiptNo: FIRST.billNo,
		});
	});

	it("keep every store on POS sync and no bill by default", async () => {
		const { client } = await member();
		expect(
			(await client.home()).stores.every(
				(store) => store.confirmation === "pos_sync" && !store.counterClaims,
			),
		).toBe(true);
		expect((await client.wallet()).billsToConfirm).toEqual([]);
	});

	it.each([
		[0, "confirmed", 2],
		[DEMO_BILL_RULES.tolerance, "confirmed", 2],
		[-DEMO_BILL_RULES.tolerance, "confirmed", 2],
		[DEMO_BILL_RULES.tolerance + 1, "queued", 0],
		[-DEMO_BILL_RULES.tolerance - 1, "queued", 0],
	] as const)(
		"answer a total %i đồng from the staff total with %s (boundary values)",
		async (gap, state, level) => {
			const { client } = await member({ bills: 1 });
			expect(
				await client.confirmBill(FIRST.id, FIRST.staffTotal + gap),
			).toEqual({
				state,
				refusal: null,
				evidenceLevel: level,
			});
			const wallet = await client.wallet();
			expect(wallet.billsToConfirm).toEqual([]);
			expect(wallet.history[0]?.state).toBe(
				state === "confirmed" ? "confirmed" : "pending",
			);
		},
	);

	it("take one answer per bill: a second confirm gets the first outcome back, a dispute after it is already answered (state transition, G-92)", async () => {
		const { client } = await member({ bills: 2 });
		await client.confirmBill(FIRST.id, 1);
		expect(await client.confirmBill(FIRST.id, FIRST.staffTotal)).toEqual({
			state: "queued",
			refusal: null,
			evidenceLevel: 0,
		});
		expect(await client.disputeBill(FIRST.id)).toEqual({
			state: "refused",
			refusal: "already_answered",
		});
		expect(
			(await client.wallet()).billsToConfirm.map((bill) => bill.id),
		).toEqual([SECOND.id]);
	});

	it("reverse a disputed bill and its pending earn", async () => {
		const { client } = await member({ bills: 1 });
		const before = (await client.wallet()).points.pending;
		expect(await client.disputeBill(FIRST.id)).toEqual({
			state: "reversed",
			refusal: null,
		});
		const wallet = await client.wallet();
		expect(wallet.history[0]).toMatchObject({
			state: "reversed",
			matchedPath: "bill",
		});
		expect(wallet.points.pending).toBe(before - FIRST.staffTotal / 1000);
		expect(await client.disputeBill(FIRST.id)).toEqual({
			state: "reversed",
			refusal: null,
		});
		expect((await client.wallet()).points.pending).toBe(
			before - FIRST.staffTotal / 1000,
		);
		expect(await client.confirmBill(FIRST.id, FIRST.staffTotal)).toMatchObject({
			refusal: "already_answered",
		});
	});

	it("give a lost confirmation's outcome back when it is sent again, whatever total comes the second time (G-92)", async () => {
		const { client } = await member({ bills: 1 });
		const first = await client.confirmBill(FIRST.id, FIRST.staffTotal);
		expect(first).toEqual({
			state: "confirmed",
			refusal: null,
			evidenceLevel: 2,
		});
		const history = (await client.wallet()).history;
		expect(await client.confirmBill(FIRST.id, FIRST.staffTotal)).toEqual(first);
		expect(await client.confirmBill(FIRST.id, 1)).toEqual(first);
		expect((await client.wallet()).history).toEqual(history);
	});

	it("refuse a bill that is not the member's, and a confirmation at the deadline", async () => {
		const { client, tick } = await member({ bills: 1 });
		const other = "00000000-0000-4000-8000-00000000ffff";
		expect(await client.confirmBill(other, 1000)).toMatchObject({
			refusal: "unknown_bill",
		});
		expect(await client.disputeBill(other)).toMatchObject({
			refusal: "unknown_bill",
		});
		tick(
			DEMO_BILL_RULES.unconfirmedHours * 3_600_000 -
				FIRST.minutesAgo * 60_000 -
				1,
		);
		expect((await client.wallet()).billsToConfirm).toHaveLength(1);
		tick(1);
		expect((await client.wallet()).billsToConfirm).toEqual([]);
		expect(await client.confirmBill(FIRST.id, FIRST.staffTotal)).toMatchObject({
			refusal: "too_late",
		});
	});

	it("refuse a total out of range with 22023 and a malformed bill id (negative tests)", async () => {
		const { client } = await member({ bills: 1 });
		for (const total of [0, -1, 100_000_001, Number.NaN]) {
			expect(await refusalOf(client.confirmBill(FIRST.id, total))).toBe(
				REFUSAL_INVALID,
			);
		}
		expect(await refusalOf(client.confirmBill(FIRST.id, 1))).toBeNull();
		expect(await refusalOf(client.confirmBill("b-1", 1000))).toBe("22P02");
		expect(await refusalOf(client.disputeBill("' or 1=1 --"))).toBe("22P02");
	});
});

describe("the demo counter claims", () => {
	const claim = (
		client: LoyaltyClient,
		billNo: string,
		total: number,
		qr = DEMO_COUNTER_QR,
	) => client.submitCounterClaim({ qr, billNo, total });

	it("confirm a small total at once (auto approval) and leave a larger one for the staff", async () => {
		const { client } = await member({ staffMode: true });
		expect(
			await claim(client, "HD0500", DEMO_BILL_RULES.autoApproveMax),
		).toMatchObject({
			state: "confirmed",
			evidenceLevel: 0,
			stampsEarned: 1,
			pointsEarned: DEMO_BILL_RULES.autoApproveMax / 1000,
		});
		const wallet = await client.wallet();
		expect(wallet.history[0]).toMatchObject({
			state: "confirmed",
			matchedPath: "bill",
			receiptNo: "HD0500",
		});
	});

	it("leave a total one đồng above auto approval waiting for the staff, 6 hours", async () => {
		const { client } = await member({ staffMode: true });
		const answer = await claim(
			client,
			"HD0501",
			DEMO_BILL_RULES.autoApproveMax + 1,
		);
		expect(answer).toMatchObject({
			state: "awaiting_staff",
			refusal: null,
			expiresAt: START + DEMO_BILL_RULES.awaitingStaffHours * 3_600_000,
		});
		expect(answer.billId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("refuse a replayed code, an expired one, an unknown one and one of another store (decision table)", async () => {
		const { client } = await member({ staffMode: true });
		await claim(client, "HD0502", 50_000);
		expect(await claim(client, "HD0503", 50_000)).toMatchObject({
			refusal: "code_used",
		});
		expect(
			await claim(client, "HD0504", 50_000, DEMO_STALE_COUNTER_QR),
		).toMatchObject({ refusal: "code_expired" });
		expect(
			await claim(client, "HD0505", 50_000, "fnb-counter:1:mau-1:ABCDEFGHJKLM"),
		).toMatchObject({ refusal: "code_unknown" });
		expect(
			await claim(
				client,
				"HD0506",
				50_000,
				DEMO_COUNTER_QR.replace(":mau-1:", ":mau-2:"),
			),
		).toMatchObject({ refusal: "wrong_store" });
	});

	it("give a lost claim's outcome back when the same bill comes again with the same code, and nothing twice (G-92)", async () => {
		const { client } = await member({ staffMode: true });
		const waiting = await claim(
			client,
			"HD0512",
			DEMO_BILL_RULES.autoApproveMax + 1,
		);
		expect(
			await claim(client, "hd0512", DEMO_BILL_RULES.autoApproveMax + 5),
		).toEqual(waiting);
		expect(await claim(client, "HD0513", 50_000)).toMatchObject({
			refusal: "code_used",
		});
		const wallet = await client.wallet();
		expect(wallet.counterClaims).toEqual([
			{
				id: waiting.billId,
				storeName: "Cửa hàng Mẫu 1",
				billNo: "HD0512",
				submittedAt: new Date(START).toISOString(),
				state: "awaiting_staff",
				waitingUntil: new Date(
					START + DEMO_BILL_RULES.awaitingStaffHours * 3_600_000,
				).toISOString(),
				decidedAt: null,
			},
		]);
		expect(JSON.stringify(wallet.counterClaims)).not.toContain(
			String(DEMO_BILL_RULES.autoApproveMax + 1),
		);
	});

	it("list a confirmed claim for 7 days, then drop it (boundary value)", async () => {
		const { client, tick } = await member({ staffMode: true });
		const confirmed = await claim(client, "HD0514", 50_000);
		expect(confirmed).toMatchObject({ state: "confirmed" });
		expect(await claim(client, "HD0514", 50_000)).toEqual(confirmed);
		expect((await client.wallet()).counterClaims).toMatchObject([
			{ billNo: "HD0514", state: "confirmed", waitingUntil: null },
		]);
		tick(7 * 24 * 3_600_000 - 1);
		expect((await client.wallet()).counterClaims).toHaveLength(1);
		tick(1);
		expect((await client.wallet()).counterClaims).toEqual([]);
	});

	it("say not_available at a store on POS sync", async () => {
		const { client } = await member();
		expect(await claim(client, "HD0507", 50_000)).toMatchObject({
			state: "refused",
			refusal: "not_available",
		});
	});

	it("refuse a bill already recorded with the same total, leading zeros and case aside", async () => {
		const { client } = await member({ bills: 1 });
		expect(
			await claim(client, `00${FIRST.billNo.toLowerCase()}`, FIRST.staffTotal),
		).toMatchObject({ refusal: "bill_used" });
	});

	it("flag a bill recorded with another total as a conflict", async () => {
		const { client } = await member({ bills: 1 });
		expect(await claim(client, FIRST.billNo, 50_000)).toMatchObject({
			refusal: "bill_conflict",
		});
	});

	it("refuse a total below the minimum or above the bill limit (boundary values)", async () => {
		const { client } = await member({ staffMode: true });
		expect(
			await claim(client, "HD0508", DEMO_BILL_RULES.minimum - 1),
		).toMatchObject({ refusal: "below_minimum" });
		expect(
			await claim(client, "HD0509", DEMO_BILL_RULES.maxBill + 1),
		).toMatchObject({ refusal: "over_bill_limit" });
	});

	it("lock after the 5th wrong code until the lock ends", async () => {
		const { client, tick } = await member({ staffMode: true });
		const wrong = "fnb-counter:1:mau-1:ABCDEFGHJKLM";
		for (let attempt = 1; attempt <= DEMO_BILL_RULES.lockAfter; attempt += 1) {
			expect(await claim(client, "HD0510", 50_000, wrong)).toMatchObject({
				refusal: "code_unknown",
			});
		}
		const locked = await claim(client, "HD0510", 50_000);
		expect(locked).toMatchObject({
			refusal: "locked",
			retryAt: START + DEMO_BILL_RULES.lockMinutes * 60_000,
		});
		tick(DEMO_BILL_RULES.lockMinutes * 60_000);
		expect(await claim(client, "HD0510", 50_000)).toMatchObject({
			state: "confirmed",
		});
	});

	it("refuse a malformed QR, bill number or total with 22023 (negative tests)", async () => {
		const { client } = await member({ staffMode: true });
		for (const qr of [
			"fnb-member:1:mau-1:123456",
			"fnb-counter:1:mau-1:K7M2Q9TXH3N",
			"",
		]) {
			expect(await refusalOf(claim(client, "HD0511", 50_000, qr))).toBe(
				REFUSAL_INVALID,
			);
		}
		expect(await refusalOf(claim(client, "HD 0511", 50_000))).toBe(
			REFUSAL_INVALID,
		);
		expect(await refusalOf(claim(client, "A".repeat(41), 50_000))).toBe(
			REFUSAL_INVALID,
		);
		expect(await refusalOf(claim(client, "HD0511", 0))).toBe(REFUSAL_INVALID);
	});

	it("allow 3 counter claims a day with fresh codes, then daily_limit (boundary value)", async () => {
		const { client } = await member({ staffMode: true });
		const [first, second, third, fourth] = DEMO_LIVE_COUNTER_QRS;
		if (fourth === undefined) throw new Error("the demo needs 4 live codes");
		for (const [index, qr] of [first, second, third].entries()) {
			expect(await claim(client, `HD052${index}`, 50_000, qr)).toMatchObject({
				state: "confirmed",
			});
		}
		expect(await claim(client, "HD0523", 50_000, fourth)).toMatchObject({
			refusal: "daily_limit",
		});
	});
});

describe("the receipt claim at a staff-mode store", () => {
	it("is refused with staff_mode and stores nothing, while a POS-sync store still takes it", async () => {
		const { client } = await member({ staffMode: true });
		const refused = await client.submitClaim({
			store: "mau-1",
			receiptNo: "1001",
			amount: 85_000,
			businessDate: "2026-11-19",
		});
		expect(refused).toEqual({
			claimId: null,
			state: "rejected",
			reason: "staff_mode",
			claimsLeftToday: 3,
		});
		expect((await client.wallet()).claims).toEqual([]);
		expect(
			(
				await client.submitClaim({
					store: "mau-2",
					receiptNo: "5555",
					amount: 42_000,
					businessDate: "2026-11-19",
				})
			).state,
		).toBe("pending");
	});
});
