// Test design (ISTQB): state transition testing of the demo bill world that the browser demo and the screen tests run
// on, mirroring migration bill_captures: awaiting_customer -> confirmed (agreeing blind total) / queued (disagreeing) /
// reversed (dispute, manager within the window), a refused reversal after the window, counter claims awaiting_staff ->
// confirmed / queued / rejected and a second answer refused, the manager queue (own_bill for a manager, allowed for an
// owner, audits passed / failed), and rewards held -> confirmed -> cancelled with the void window and the
// earn-by-one-redeem-by-another rule. Negative paths: role checks (staff get 42501 for manager actions), malformed
// input (22023), single-use member codes, a POS-synced store refusing everything staff mode.
import { RestError } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	createDemoBillsClient,
	DEMO_BILL_CODES,
	DEMO_BILL_KNOBS,
	DEMO_BILLS,
	DEMO_CLAIM_TOTALS,
	DEMO_STAFF_STORE_ID,
	type DemoBillsOptions,
} from "./bills-demo";

const STORE = DEMO_STAFF_STORE_ID;
const OTHER_STORE = "00000000-0000-4000-8000-0000000005a2";
const START = new Date("2026-11-21T05:00:00Z").getTime();
const MINUTE = 60_000;

function world(overrides: Partial<DemoBillsOptions> = {}) {
	let now = START;
	const client = createDemoBillsClient({
		storeMode: "staff",
		role: "manager",
		clock: () => new Date(now),
		redemptionOf: (id) =>
			id === "r-member"
				? { storeId: STORE, phone: "0900001234", discountName: "Tặng 1 ly" }
				: id === "r-second"
					? { storeId: STORE, phone: "0900005678", discountName: null }
					: id === "r-other"
						? { storeId: OTHER_STORE, phone: "0900001234", discountName: null }
						: undefined,
		...overrides,
	});
	return {
		client,
		advance(minutes: number) {
			now += minutes * MINUTE;
		},
	};
}

async function rejects(work: Promise<unknown>, code: string) {
	await expect(work).rejects.toBeInstanceOf(RestError);
	await expect(work).rejects.toMatchObject({ code });
}

async function billByNo(
	client: ReturnType<typeof world>["client"],
	billNo: string,
) {
	const found = (await client.recent(STORE)).bills.find(
		(bill) => bill.billNo === billNo,
	);
	if (found === undefined) throw new Error(`no bill ${billNo}`);
	return found;
}

describe("a staff-recorded bill", () => {
	it("waits for the customer, then an agreeing blind total confirms it", async () => {
		const { client } = world();
		const answer = await client.submit({
			storeId: STORE,
			code: `fnb-member:1:Q1:${DEMO_BILL_CODES.member[0]}`,
			billNo: "HD-0040",
			total: 185_000,
		});
		expect(answer).toMatchObject({
			outcome: "recorded",
			state: "awaiting_customer",
			evidenceLevel: 0,
			stampsEarned: 1,
			pointsEarned: 18,
			confirmBy: new Date(START + 24 * 60 * MINUTE).toISOString(),
		});
		if (answer.outcome !== "recorded") return;
		expect(answer.member.phoneMasked).toBe("•••• ••• 234");
		expect(client.customerConfirm(answer.billId, 185_000 + 1_000)).toBe(
			"confirmed",
		);
		expect((await billByNo(client, "HD-0040")).state).toBe("confirmed");
		expect(client.customerConfirm(answer.billId, 185_000)).toBe("refused");
	});

	it("queues a disagreeing blind total for a manager", async () => {
		const { client } = world();
		const answer = await client.submit({
			storeId: STORE,
			code: DEMO_BILL_CODES.member[0],
			billNo: "HD-0041",
			total: 185_000,
		});
		if (answer.outcome !== "recorded") throw new Error("not recorded");
		expect(client.customerConfirm(answer.billId, 185_000 - 1_001)).toBe(
			"queued",
		);
		const queue = await client.queue(STORE);
		expect(queue.bills.find((bill) => bill.billNo === "HD-0041")).toMatchObject(
			{
				queueReason: "disagreement",
				staffTotal: 185_000,
				customerTotal: 183_999,
				own: true,
			},
		);
	});

	it("is reversed by the customer's dispute", async () => {
		const { client } = world();
		const answer = await client.submit({
			storeId: STORE,
			code: DEMO_BILL_CODES.member[0],
			billNo: "HD-0042",
			total: 50_000,
		});
		if (answer.outcome !== "recorded") throw new Error("not recorded");
		expect(client.customerDispute(answer.billId)).toBe("reversed");
		expect(await billByNo(client, "HD-0042")).toMatchObject({
			state: "reversed",
			reversalReason: "disputed",
		});
	});

	it("is confirmed at once at required level 0, and queued above the approval threshold", async () => {
		const { client } = world({ requiredLevel: 0 });
		expect(
			await client.submit({
				storeId: STORE,
				code: DEMO_BILL_CODES.member[0],
				billNo: "HD-0043",
				total: DEMO_BILL_KNOBS.approvalAbove,
			}),
		).toMatchObject({
			outcome: "recorded",
			state: "confirmed",
			confirmBy: null,
		});
		expect(
			await client.submit({
				storeId: STORE,
				code: DEMO_BILL_CODES.member[1],
				billNo: "HD-0044",
				total: DEMO_BILL_KNOBS.approvalAbove + 1,
			}),
		).toMatchObject({ outcome: "recorded", state: "queued" });
	});

	it("refuses each documented case", async () => {
		const { client } = world();
		const submit = (code: string, billNo: string, total: number) =>
			client.submit({ storeId: STORE, code, billNo, total });
		const refusal = async (promise: ReturnType<typeof submit>) => {
			const answer = await promise;
			return answer.outcome === "refused" ? answer.refusal : answer.state;
		};
		expect(await refusal(submit(DEMO_BILL_CODES.expired, "A1", 50_000))).toBe(
			"code_expired",
		);
		expect(
			await refusal(submit(DEMO_BILL_CODES.otherStore, "A1", 50_000)),
		).toBe("wrong_store");
		expect(await refusal(submit("999999", "A1", 50_000))).toBe("code_unknown");
		expect(await refusal(submit(DEMO_BILL_CODES.suspended, "A1", 50_000))).toBe(
			"membership_inactive",
		);
		expect(
			await refusal(submit(DEMO_BILL_CODES.staffPhone, "A1", 50_000)),
		).toBe("staff_phone");
		expect(
			await refusal(
				submit(DEMO_BILL_CODES.member[0], "A1", DEMO_BILL_KNOBS.maxBill + 1),
			),
		).toBe("over_bill_limit");
		// a refused bill leaves the code live; a recorded one spends it
		expect(await refusal(submit(DEMO_BILL_CODES.member[0], "A2", 50_000))).toBe(
			"awaiting_customer",
		);
		expect(await refusal(submit(DEMO_BILL_CODES.member[0], "A3", 50_000))).toBe(
			"code_used",
		);
		expect(
			await refusal(
				submit(DEMO_BILL_CODES.member[1], DEMO_BILLS.awaiting, 185_000),
			),
		).toBe("bill_used");
		expect(
			await refusal(
				submit(DEMO_BILL_CODES.member[2], `00${DEMO_BILLS.awaiting}`, 999_000),
			),
		).toBe("bill_conflict");
		expect(await refusal(submit(DEMO_BILL_CODES.member[3], "A4", 9_999))).toBe(
			"below_minimum",
		);
	});

	it("stops a member at the daily limit", async () => {
		const { client } = world();
		for (const [index, code] of DEMO_BILL_CODES.member.entries()) {
			const answer = await client.submit({
				storeId: STORE,
				code,
				billNo: `D${index}`,
				total: 40_000,
			});
			expect(answer.outcome === "refused" ? answer.refusal : "recorded").toBe(
				index < DEMO_BILL_KNOBS.dailyCap ? "recorded" : "daily_limit",
			);
		}
	});

	it("locks after five wrong codes and says until when", async () => {
		const { client } = world();
		for (let index = 0; index < DEMO_BILL_KNOBS.lockAfter; index += 1)
			await client.submit({
				storeId: STORE,
				code: `90000${index}`,
				billNo: "L1",
				total: 50_000,
			});
		expect(
			await client.submit({
				storeId: STORE,
				code: DEMO_BILL_CODES.member[0],
				billNo: "L1",
				total: 50_000,
			}),
		).toEqual({
			outcome: "refused",
			refusal: "locked",
			retryAt: new Date(
				START + DEMO_BILL_KNOBS.lockMinutes * MINUTE,
			).toISOString(),
		});
	});

	it("refuses a malformed bill as 22023 and staff mode at a POS-synced store", async () => {
		const { client } = world();
		await rejects(
			client.submit({ storeId: STORE, code: "12", billNo: "A", total: 1 }),
			"22023",
		);
		await rejects(
			client.submit({
				storeId: STORE,
				code: "246810",
				billNo: "A B",
				total: 1,
			}),
			"22023",
		);
		await rejects(
			client.submit({ storeId: STORE, code: "246810", billNo: "A", total: 0 }),
			"22023",
		);
		expect(
			await client.submit({
				storeId: OTHER_STORE,
				code: "246810",
				billNo: "A",
				total: 50_000,
			}),
		).toMatchObject({ outcome: "refused", refusal: "not_staff_mode" });
		expect(await client.mode(OTHER_STORE)).toEqual({
			mode: "pos_sync",
			selfClaim: false,
			isManager: true,
		});
		const off = world({ storeMode: "pos_sync" }).client;
		expect((await off.mode(STORE)).mode).toBe("pos_sync");
		expect(await off.counterCode(STORE)).toEqual({
			state: "refused",
			refusal: "not_available",
		});
	});
});

describe("reversal by a manager", () => {
	it("works within the window and is refused after it or on a reversed bill", async () => {
		const { client, advance } = world();
		const mine = await billByNo(client, DEMO_BILLS.mine);
		expect(mine.reversible).toBe(true);
		const old = await billByNo(client, DEMO_BILLS.old);
		expect(old.reversible).toBe(false);
		expect(await client.reverse(old.id, "Ghi nhầm")).toEqual({
			state: "refused",
			refusal: "window_passed",
		});
		expect(await client.reverse(mine.id, "Ghi nhầm")).toEqual({
			state: "reversed",
		});
		expect(await client.reverse(mine.id, "Lần nữa")).toEqual({
			state: "refused",
			refusal: "not_reversible",
		});
		const waiting = await billByNo(client, DEMO_BILLS.awaiting);
		advance(DEMO_BILL_KNOBS.reverseWindowMinutes - 12);
		expect((await billByNo(client, DEMO_BILLS.awaiting)).reversible).toBe(true);
		advance(1);
		expect(await client.reverse(waiting.id, "Muộn")).toEqual({
			state: "refused",
			refusal: "window_passed",
		});
	});

	it("is refused to staff (42501) and needs a reason (22023)", async () => {
		const staff = world({ role: "staff" }).client;
		const visible = (await staff.recent(STORE)).bills;
		expect(visible.every((bill) => bill.byMe)).toBe(true);
		expect(visible.every((bill) => !bill.reversible)).toBe(true);
		await rejects(staff.reverse(visible[0]?.id ?? "", "Ghi nhầm"), "42501");
		const manager = world().client;
		const mine = await billByNo(manager, DEMO_BILLS.mine);
		await rejects(manager.reverse(mine.id, "   "), "22023");
		await rejects(manager.reverse(mine.id, "x".repeat(201)), "22023");
	});
});

describe("counter claims", () => {
	it("list waiting claims oldest first without any total", async () => {
		const { client } = world({ role: "staff" });
		const claims = await client.counterClaims(STORE);
		expect(claims.map((claim) => claim.billNo)).toEqual([
			DEMO_BILLS.claimHoa,
			DEMO_BILLS.claimMinh,
		]);
		expect(JSON.stringify(claims)).not.toMatch(/65000|240000|0900/);
	});

	it("confirm on an agreeing blind total and refuse a second answer", async () => {
		const { client } = world({ role: "staff" });
		const [claim] = await client.counterClaims(STORE);
		if (claim === undefined) throw new Error("no claim");
		const total = DEMO_CLAIM_TOTALS[DEMO_BILLS.claimHoa] ?? 0;
		expect(await client.answerClaim({ billId: claim.id, total })).toEqual({
			state: "confirmed",
			evidenceLevel: 2,
			stampsEarned: 1,
			pointsEarned: 6,
		});
		expect(await client.answerClaim({ billId: claim.id, total })).toEqual({
			state: "refused",
			refusal: "already_answered",
		});
		expect(await client.counterClaims(STORE)).toHaveLength(1);
	});

	it("queue a disagreeing total, reject with a reason, and expire after six hours", async () => {
		const { client, advance } = world();
		const [first, second] = await client.counterClaims(STORE);
		if (first === undefined || second === undefined) throw new Error("claims");
		expect(
			await client.answerClaim({ billId: first.id, total: 60_000 }),
		).toMatchObject({ state: "queued" });
		expect(
			(await client.queue(STORE)).bills.find(
				(bill) => bill.billNo === DEMO_BILLS.claimHoa,
			),
		).toMatchObject({ queueReason: "disagreement", source: "counter_claim" });
		expect(
			await client.answerClaim({ billId: second.id, rejectReason: "Không có" }),
		).toMatchObject({ state: "rejected" });
		const late = client.customerClaim(STORE, {
			billNo: "HD-0099",
			total: 80_000,
			phone: "0900001234",
		});
		advance(DEMO_BILL_KNOBS.claimHours * 60);
		expect(await client.answerClaim({ billId: late, total: 80_000 })).toEqual({
			state: "refused",
			refusal: "expired",
		});
	});

	it("refuses both or neither of total and reason", async () => {
		const { client } = world();
		const [claim] = await client.counterClaims(STORE);
		if (claim === undefined) throw new Error("no claim");
		await rejects(
			client.answerClaim({ billId: claim.id, rejectReason: " " }),
			"22023",
		);
		await rejects(client.answerClaim({ billId: claim.id, total: 0 }), "22023");
	});

	it("give a rotating counter QR, the same one until half its life", async () => {
		const { client, advance } = world({ role: "staff" });
		const first = await client.counterCode(STORE);
		if (first.state !== "ready") throw new Error("no code");
		expect(first.qrPayload).toMatch(/^fnb-counter:1:Q1:[A-HJ-NP-Z2-9]{12}$/);
		expect(Date.parse(first.refreshAt) - START).toBe(45_000);
		advance(0.5);
		expect(await client.counterCode(STORE)).toEqual(first);
		advance(0.5);
		const second = await client.counterCode(STORE);
		expect(second.state === "ready" && second.qrPayload).not.toBe(
			first.qrPayload,
		);
		expect(await world({ selfClaim: false }).client.counterCode(STORE)).toEqual(
			{ state: "refused", refusal: "not_available" },
		);
	});
});

describe("the manager queue", () => {
	it("approves another's bill, refuses a manager's own, lets an owner approve it", async () => {
		const { client } = world();
		const queue = await client.queue(STORE);
		const over = queue.bills.find((b) => b.billNo === DEMO_BILLS.overApproval);
		const own = queue.bills.find(
			(b) => b.billNo === DEMO_BILLS.ownDisagreement,
		);
		if (over === undefined || own === undefined) throw new Error("queue");
		expect(own.own).toBe(true);
		expect(await client.decide(own.id, "approved", "Đã xem")).toEqual({
			state: "refused",
			refusal: "own_bill",
		});
		expect(await client.decide(over.id, "approved", "Đã xem")).toEqual({
			state: "approved",
			billState: "confirmed",
		});
		expect(await client.decide(over.id, "rejected", "Lần nữa")).toEqual({
			state: "refused",
			refusal: "not_queued",
		});
		expect(await client.decide(own.id, "rejected", "Sai số")).toEqual({
			state: "rejected",
			billState: "reversed",
		});
		const owner = world({ role: "owner" }).client;
		const ownerQueue = await owner.queue(STORE);
		const ownForOwner = ownerQueue.bills.find((b) => b.own);
		expect(
			await owner.decide(ownForOwner?.id ?? "", "approved", "Chủ duyệt"),
		).toMatchObject({ state: "approved" });
	});

	it("closes an audit failed with a note (reversing the bill) and refuses a closed one", async () => {
		const { client } = world();
		const [audit] = (await client.queue(STORE)).audits;
		if (audit === undefined) throw new Error("no audit");
		await rejects(client.closeAudit(audit.id, "failed", null), "22023");
		expect(await client.closeAudit(audit.id, "failed", "Không khớp")).toEqual({
			state: "failed",
		});
		expect(await client.closeAudit(audit.id, "passed", null)).toEqual({
			state: "refused",
			refusal: "closed",
		});
		expect(await billByNo(client, DEMO_BILLS.audited)).toMatchObject({
			state: "reversed",
			reversalReason: "audit_failed",
		});
		expect((await client.queue(STORE)).audits).toEqual([]);
	});

	it("is closed to staff (42501)", async () => {
		const { client } = world({ role: "staff" });
		await rejects(client.queue(STORE), "42501");
		await rejects(client.decide("x", "approved", "x"), "42501");
		await rejects(client.closeAudit("x", "passed", null), "42501");
	});
});

describe("staff-confirmed rewards", () => {
	it("go held -> confirmed -> cancelled, then refuse again", async () => {
		const { client } = world();
		expect(await client.confirmRedemption("r-member")).toEqual({
			state: "confirmed",
			voidUntil: new Date(
				START + DEMO_BILL_KNOBS.reverseWindowMinutes * MINUTE,
			).toISOString(),
			posDiscountName: "Tặng 1 ly",
		});
		expect(await client.confirmRedemption("r-member")).toEqual({
			state: "refused",
			refusal: "used",
		});
		expect(await client.voidRedemption("r-member", "Khách đổi ý")).toEqual({
			state: "voided",
		});
		expect(await client.voidRedemption("r-member", "Lần nữa")).toEqual({
			state: "refused",
			refusal: "already_voided",
		});
		expect(await client.confirmRedemption("r-member")).toEqual({
			state: "refused",
			refusal: "released",
		});
	});

	it("refuses a void after the window and of a reward not confirmed by staff", async () => {
		const { client, advance } = world();
		expect(await client.voidRedemption("r-member", "Sớm")).toEqual({
			state: "refused",
			refusal: "not_staff_confirmed",
		});
		await client.confirmRedemption("r-member");
		advance(DEMO_BILL_KNOBS.reverseWindowMinutes + 1);
		expect(await client.voidRedemption("r-member", "Muộn")).toEqual({
			state: "refused",
			refusal: "window_passed",
		});
	});

	it("refuse the staff member who recorded a bill for the member today, and a POS-synced store", async () => {
		const { client } = world();
		// the seeded bill HD-0029 was recorded by this user for the second member
		expect(await client.confirmRedemption("r-second")).toEqual({
			state: "refused",
			refusal: "same_staff",
		});
		expect(await client.confirmRedemption("r-other")).toEqual({
			state: "refused",
			refusal: "not_staff_mode",
		});
		await rejects(client.confirmRedemption("unknown"), "42501");
		await rejects(
			world({ role: "staff" }).client.voidRedemption("r-member", "x"),
			"42501",
		);
	});
});
