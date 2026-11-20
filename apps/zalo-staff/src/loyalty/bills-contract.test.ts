// Test design (ISTQB): equivalence partitioning and boundary value analysis for the readers of the staff-mode bill
// answers (valid and invalid partitions per field: states, refusals, levels 0-3, totals 0 / 1 / 100,000,000 /
// 100,000,001), error guessing on malformed answers (arrays, nulls, wrong types, a counter QR of another kind), and
// security checks: a phone is always shown masked, a counter claim never carries the customer's total, and the REST
// client sends each function exactly the documented arguments (exactly one of total and rejection reason).
import type { RestClient } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	answerClaimArgs,
	BILL_REFUSALS,
	closeAuditArgs,
	decideArgs,
	readAuditAnswer,
	readBillQueue,
	readClaimAnswer,
	readConfirmRedemption,
	readCounterClaims,
	readCounterCode,
	readDecideAnswer,
	readRecentBills,
	readReverseAnswer,
	readStoreBillMode,
	readSubmitAnswer,
	readVoidRedemption,
	STAFF_BILL_FUNCTIONS,
	submitArgs,
} from "./bills-contract";
import { createRestBillsClient } from "./source";

const STORE = "00000000-0000-4000-8000-0000000005a1";
const BILL = "00000000-0000-4000-8000-0000000b0001";
const AT = "2026-11-21T05:00:00Z";
const LATER = "2026-11-22T05:00:00Z";
const PAYLOAD = "fnb-counter:1:Q1:ABCDEFGHJK23";

const RECORDED = {
	state: "awaiting_customer",
	refusal: null,
	bill_id: BILL,
	evidence_level: 0,
	stamps_earned: 1,
	points_earned: 18,
	recorded_at: AT,
	confirm_by: LATER,
	reverse_until: LATER,
	member: {
		membership_id: "00000000-0000-4000-8000-c00000000001",
		phone_masked: "0900001234",
		display_name: null,
		stamps: 5,
		stamps_per_card: 8,
		points: 120,
	},
};

function recentBill(overrides: Record<string, unknown> = {}) {
	return {
		id: BILL,
		created_at: AT,
		bill_no: "HD-0031",
		total: "185000.00",
		source: "staff_scan",
		state: "confirmed",
		queue_reason: null,
		reversal_reason: null,
		evidence_level: 2,
		by_me: true,
		recorded_by_name: "Nhân viên Lan",
		phone_masked: "•••• ••• 234",
		stamps: 1,
		points: 18,
		reverse_until: LATER,
		reversible: true,
		shadow_state: null,
		...overrides,
	};
}

describe("what the staff app sends", () => {
	it("names the eleven functions of migration bill_captures", () => {
		expect(Object.values(STAFF_BILL_FUNCTIONS).sort()).toEqual(
			[
				"staff_answer_counter_claim",
				"staff_bill_queue",
				"staff_close_bill_audit",
				"staff_confirm_redemption",
				"staff_counter_claims",
				"staff_counter_code",
				"staff_decide_bill",
				"staff_recent_bills",
				"staff_reverse_bill",
				"staff_submit_bill",
				"staff_void_redemption",
			].sort(),
		);
	});

	it("sends exactly one of the total and the rejection reason, the other null", () => {
		expect(answerClaimArgs({ billId: BILL, total: 65_000 })).toEqual({
			p_bill_id: BILL,
			p_total: 65_000,
			p_reject_reason: null,
		});
		expect(answerClaimArgs({ billId: BILL, rejectReason: "Sai số" })).toEqual({
			p_bill_id: BILL,
			p_total: null,
			p_reject_reason: "Sai số",
		});
		expect(
			submitArgs({
				storeId: STORE,
				code: "246810",
				billNo: "HD-1",
				total: 1,
			}),
		).toEqual({
			p_store_id: STORE,
			p_code: "246810",
			p_bill_no: "HD-1",
			p_total: 1,
		});
		expect(decideArgs(BILL, "approved", "Đã xem")).toEqual({
			p_bill_id: BILL,
			p_decision: "approved",
			p_reason: "Đã xem",
		});
		expect(closeAuditArgs(BILL, "passed", null)).toEqual({
			p_audit_id: BILL,
			p_result: "passed",
			p_note: null,
		});
	});

	it("calls each function by name through the REST client and reads each answer", async () => {
		const calls: { fn: string; args: unknown }[] = [];
		const answers: Record<string, unknown> = {
			staff_submit_bill: RECORDED,
			staff_recent_bills: {
				mode: "staff",
				self_claim: true,
				is_manager: false,
				bills: [recentBill()],
			},
			staff_reverse_bill: { state: "reversed", refusal: null },
			staff_counter_code: {
				state: "ready",
				qr_payload: PAYLOAD,
				expires_at: LATER,
				refresh_at: AT,
			},
			staff_counter_claims: [],
			staff_answer_counter_claim: { state: "rejected", refusal: null },
			staff_bill_queue: { bills: [], audits: [] },
			staff_decide_bill: { state: "rejected", bill_state: "reversed" },
			staff_close_bill_audit: { state: "failed", refusal: null },
			staff_confirm_redemption: {
				state: "confirmed",
				void_until: LATER,
				pos_discount_name: "Thành viên - Tặng 1 ly",
			},
			staff_void_redemption: { state: "voided", refusal: null },
		};
		const rest: RestClient = {
			async select() {
				throw new Error("no table reads");
			},
			async rpc(fn, args = {}) {
				calls.push({ fn, args });
				return answers[fn];
			},
		};
		const client = createRestBillsClient(rest);
		await client.submit({
			storeId: STORE,
			code: "fnb-member:1:Q1:246810",
			billNo: "HD-1",
			total: 185_000,
		});
		expect((await client.recent(STORE)).bills).toHaveLength(1);
		expect(await client.mode(STORE)).toEqual({
			mode: "staff",
			selfClaim: true,
			isManager: false,
		});
		await client.reverse(BILL, "Ghi nhầm");
		await client.counterCode(STORE);
		await client.counterClaims(STORE);
		await client.answerClaim({ billId: BILL, rejectReason: "Không có" });
		await client.queue(STORE);
		await client.decide(BILL, "rejected", "Sai");
		await client.closeAudit(BILL, "failed", "Không khớp");
		await client.confirmRedemption(BILL);
		await client.voidRedemption(BILL, "Khách đổi ý");
		expect(calls.map((call) => call.fn)).toEqual([
			"staff_submit_bill",
			"staff_recent_bills",
			"staff_recent_bills",
			"staff_reverse_bill",
			"staff_counter_code",
			"staff_counter_claims",
			"staff_answer_counter_claim",
			"staff_bill_queue",
			"staff_decide_bill",
			"staff_close_bill_audit",
			"staff_confirm_redemption",
			"staff_void_redemption",
		]);
		expect(calls[0]?.args).toEqual({
			p_store_id: STORE,
			p_code: "fnb-member:1:Q1:246810",
			p_bill_no: "HD-1",
			p_total: 185_000,
		});
		expect(calls[3]?.args).toEqual({ p_bill_id: BILL, p_reason: "Ghi nhầm" });
		expect(calls[11]?.args).toEqual({
			p_redemption_id: BILL,
			p_reason: "Khách đổi ý",
		});
	});
});

describe("readSubmitAnswer", () => {
	it("reads a recorded bill in each state and masks the member phone", () => {
		for (const state of ["awaiting_customer", "confirmed", "queued"]) {
			const read = readSubmitAnswer({ ...RECORDED, state });
			expect(read.outcome).toBe("recorded");
			if (read.outcome !== "recorded") continue;
			expect(read.state).toBe(state);
			expect(read.member.phoneMasked).toBe("•••• ••• 234");
			expect(JSON.stringify(read)).not.toContain("0900001234");
		}
	});

	it("reads every documented refusal, an unknown one as null, and the lock time", () => {
		for (const refusal of BILL_REFUSALS) {
			expect(
				readSubmitAnswer({ state: "refused", refusal, bill_id: null }),
			).toEqual({ outcome: "refused", refusal, retryAt: null });
		}
		expect(
			readSubmitAnswer({ state: "refused", refusal: "brand_new_reason" }),
		).toEqual({ outcome: "refused", refusal: null, retryAt: null });
		expect(
			readSubmitAnswer({ state: "refused", refusal: "locked", retry_at: AT }),
		).toEqual({ outcome: "refused", refusal: "locked", retryAt: AT });
	});

	it("takes the evidence level from 0 to 3 and refuses 4 or a negative one", () => {
		for (const level of [0, 3])
			expect(
				readSubmitAnswer({ ...RECORDED, evidence_level: level }).outcome,
			).toBe("recorded");
		for (const level of [4, -1, 1.5, "two"])
			expect(() =>
				readSubmitAnswer({ ...RECORDED, evidence_level: level }),
			).toThrow(/evidence level/);
	});

	it("refuses a malformed answer instead of showing half of it", () => {
		expect(() => readSubmitAnswer(null)).toThrow();
		expect(() => readSubmitAnswer([])).toThrow();
		expect(() => readSubmitAnswer({ ...RECORDED, state: "pending" })).toThrow(
			/bill state/,
		);
		expect(() => readSubmitAnswer({ ...RECORDED, bill_id: "" })).toThrow(
			/bill id/,
		);
		expect(() => readSubmitAnswer({ ...RECORDED, member: null })).toThrow(
			/member/,
		);
		expect(() =>
			readSubmitAnswer({ ...RECORDED, recorded_at: "yesterday" }),
		).toThrow(/bill time/);
		expect(() => readSubmitAnswer({ ...RECORDED, stamps_earned: -1 })).toThrow(
			/stamps/,
		);
	});
});

describe("readRecentBills", () => {
	it("reads the mode, the self-claim and manager flags and each bill", () => {
		const read = readRecentBills({
			mode: "staff",
			self_claim: true,
			is_manager: true,
			bills: [
				recentBill(),
				recentBill({
					id: "b2",
					state: "reversed",
					reversal_reason: "audit_failed",
					reversible: false,
					source: "counter_claim",
					shadow_state: "matched",
				}),
			],
		});
		expect(read.mode).toBe("staff");
		expect(read.bills[0]?.total).toBe(185_000);
		expect(read.bills[1]?.reversalReason).toBe("audit_failed");
		expect(read.bills[1]?.shadowState).toBe("matched");
	});

	it("reads a store without settings as POS-synced and an empty list", () => {
		expect(readRecentBills({ mode: null, bills: null })).toEqual({
			mode: "pos_sync",
			selfClaim: false,
			isManager: false,
			bills: [],
		});
		expect(readStoreBillMode({ mode: "pos_sync" }).mode).toBe("pos_sync");
	});

	it("takes a total of 1 and 100,000,000 and refuses 0 and 100,000,001", () => {
		for (const total of [1, 100_000_000, "100000000.00"])
			expect(
				readRecentBills({ mode: "staff", bills: [recentBill({ total })] })
					.bills[0]?.total,
			).toBe(Number(total));
		for (const total of [0, 100_000_001, null, "abc"])
			expect(() =>
				readRecentBills({ mode: "staff", bills: [recentBill({ total })] }),
			).toThrow(/bill total/);
	});

	it("refuses an unknown mode, state, source or reason", () => {
		expect(() => readRecentBills({ mode: "manual", bills: [] })).toThrow(
			/store mode/,
		);
		for (const [field, value] of [
			["state", "pending"],
			["source", "pos"],
			["queue_reason", "late"],
			["reversal_reason", "oops"],
			["by_me", "yes"],
		] as const)
			expect(() =>
				readRecentBills({
					mode: "staff",
					bills: [recentBill({ [field]: value })],
				}),
			).toThrow();
	});
});

describe("readCounterCode", () => {
	it("reads a ready code and refuses a QR that is not a counter QR", () => {
		expect(
			readCounterCode({
				state: "ready",
				qr_payload: PAYLOAD,
				expires_at: LATER,
				refresh_at: AT,
			}),
		).toEqual({
			state: "ready",
			qrPayload: PAYLOAD,
			expiresAt: LATER,
			refreshAt: AT,
		});
		for (const qr of [
			"fnb-member:1:Q1:246810",
			"fnb-counter:1:Q1:ABCDEFGHJK2",
			"fnb-counter:1:Q1:ABCDEFGHJK231",
			"fnb-counter:1:Q1:ABCDEFGHJKI0",
			"https://example.invalid/claim",
		])
			expect(() =>
				readCounterCode({
					state: "ready",
					qr_payload: qr,
					expires_at: LATER,
					refresh_at: AT,
				}),
			).toThrow(/counter QR/);
	});

	it("refuses a refresh after the expiry and reads both refusals", () => {
		expect(() =>
			readCounterCode({
				state: "ready",
				qr_payload: PAYLOAD,
				expires_at: AT,
				refresh_at: LATER,
			}),
		).toThrow(/refresh/);
		expect(
			readCounterCode({ state: "refused", refusal: "not_available" }),
		).toEqual({ state: "refused", refusal: "not_available" });
		expect(
			readCounterCode({ state: "refused", refusal: "no_store_code" }),
		).toEqual({ state: "refused", refusal: "no_store_code" });
	});
});

describe("readCounterClaims", () => {
	it("keeps no total, even when an answer carries one", () => {
		const claims = readCounterClaims([
			{
				id: BILL,
				created_at: AT,
				expires_at: LATER,
				bill_no: "HD-0033",
				phone_masked: "0900005678",
				display_name: "Chị Hoa",
				total: 65_000,
				customer_total: 65_000,
			},
		]);
		expect(claims).toEqual([
			{
				id: BILL,
				createdAt: AT,
				expiresAt: LATER,
				billNo: "HD-0033",
				phoneMasked: "•••• ••• 678",
				displayName: "Chị Hoa",
			},
		]);
		expect(JSON.stringify(claims)).not.toMatch(/65000|0900005678/);
	});

	it("reads an empty list and refuses a claim without a bill number", () => {
		expect(readCounterClaims([])).toEqual([]);
		expect(readCounterClaims(null)).toEqual([]);
		expect(() =>
			readCounterClaims([
				{ id: BILL, created_at: AT, expires_at: LATER, phone_masked: "x" },
			]),
		).toThrow(/bill number/);
	});
});

describe("the answers to the manager and redemption actions", () => {
	it("reads each state and each refusal, unknown refusals as null", () => {
		expect(readClaimAnswer({ state: "confirmed", evidence_level: 2 })).toEqual({
			state: "confirmed",
			evidenceLevel: 2,
			stampsEarned: 0,
			pointsEarned: 0,
		});
		expect(
			readClaimAnswer({ state: "refused", refusal: "already_answered" }),
		).toEqual({ state: "refused", refusal: "already_answered" });
		expect(
			readClaimAnswer({ state: "refused", refusal: "staff_amount_cap" }),
		).toEqual({ state: "refused", refusal: "staff_amount_cap" });
		expect(
			readReverseAnswer({ state: "refused", refusal: "window_passed" }),
		).toEqual({ state: "refused", refusal: "window_passed" });
		expect(readDecideAnswer({ state: "refused", refusal: "own_bill" })).toEqual(
			{ state: "refused", refusal: "own_bill" },
		);
		expect(
			readDecideAnswer({ state: "approved", bill_state: "confirmed" }),
		).toEqual({ state: "approved", billState: "confirmed" });
		expect(readAuditAnswer({ state: "refused", refusal: "closed" })).toEqual({
			state: "refused",
			refusal: "closed",
		});
		expect(readAuditAnswer({ state: "passed" })).toEqual({ state: "passed" });
		expect(
			readConfirmRedemption({ state: "refused", refusal: "same_staff" }),
		).toEqual({ state: "refused", refusal: "same_staff" });
		expect(
			readConfirmRedemption({ state: "confirmed", pos_discount_name: null }),
		).toEqual({ state: "confirmed", voidUntil: null, posDiscountName: null });
		expect(
			readVoidRedemption({ state: "refused", refusal: "something" }),
		).toEqual({ state: "refused", refusal: null });
	});

	it("refuses a state outside the contract", () => {
		expect(() => readClaimAnswer({ state: "approved" })).toThrow();
		expect(() => readReverseAnswer({ state: "done" })).toThrow();
		expect(() => readDecideAnswer({ state: "passed" })).toThrow();
		expect(() => readAuditAnswer({ state: "approved" })).toThrow();
		expect(() => readConfirmRedemption({ state: "voided" })).toThrow();
		expect(() => readVoidRedemption({ state: "confirmed" })).toThrow();
		expect(() => readVoidRedemption("voided")).toThrow();
	});

	it("reads the manager queue with both readings and the audits, phones masked", () => {
		const queue = readBillQueue({
			bills: [
				{
					id: BILL,
					created_at: AT,
					bill_no: "HD-0025",
					source: "staff_scan",
					queue_reason: "disagreement",
					evidence_level: 0,
					staff_total: 150_000,
					customer_total: "105000.00",
					recorded_by_name: null,
					own: true,
					phone_masked: "0900003333",
				},
			],
			audits: [
				{
					id: "a1",
					bill_id: BILL,
					opened_at: AT,
					bill_no: "HD-0019",
					total: 120_000,
					evidence_level: 2,
					has_photo: false,
					recorded_by_name: "Nhân viên Lan",
					phone_masked: "•••• ••• 678",
				},
			],
		});
		expect(queue.bills[0]).toMatchObject({
			staffTotal: 150_000,
			customerTotal: 105_000,
			own: true,
			phoneMasked: "•••• ••• 333",
		});
		expect(queue.audits[0]?.billNo).toBe("HD-0019");
		expect(readBillQueue({})).toEqual({ bills: [], audits: [] });
		expect(() =>
			readBillQueue({
				bills: [
					{ id: BILL, created_at: AT, bill_no: "x", source: "staff_scan" },
				],
			}),
		).toThrow(/queue reason/);
	});
});
