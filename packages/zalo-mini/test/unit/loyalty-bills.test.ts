// Test design for the staff-mode answers of the customer contract (bill verification without the POS, path E):
// - equivalence partitioning of each answer's states (confirmed, queued, awaiting_customer, refused; reversed and
//   refused; awaiting_staff, confirmed and refused) and of known and unknown refusal words;
// - boundary values: evidence level 0 and 3 (4 is refused), a deadline equal to the recording time, a bill number
//   of 40 and 41 characters, a counter QR token of 11, 12 and 13 characters;
// - decision table: refused x refusal present (a refusal is required exactly when the state is refused);
// - error guessing on malformed answers (a wrong type, a missing bill id, a non-uuid bill id, an unknown mode);
// - security: a staff total in a bill row is never carried to the app, and the arguments carry no more than the
//   database's parameter names.
import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	BILL_REFUSALS,
	CLAIM_REASONS,
	COUNTER_CLAIM_RECORD_STATES,
	COUNTER_CLAIM_REFUSALS,
	COUNTER_QR_PATTERN,
	CUSTOMER_FUNCTIONS,
	counterClaimArgs,
	knownBillRefusal,
	knownClaimReason,
	knownCounterClaimRefusal,
	MATCHED_PATHS,
	readBillConfirmResult,
	readBillDisputeResult,
	readBillToConfirm,
	readCounterClaimRecord,
	readCounterClaimResult,
	readCounterQr,
	readCustomerStore,
	readLedgerEntry,
	readWallet,
} from "../../src/loyalty/contract";
import { createRestLoyaltyClient } from "../../src/loyalty/rest-loyalty-client";

const BILL_ID = "00000000-0000-4000-8000-00000000b001";
const BILL = {
	id: BILL_ID,
	store_name: "Cửa hàng Mẫu 1",
	bill_no: "HD0457",
	recorded_at: "2026-11-19T03:00:00Z",
	confirm_by: "2026-11-20T03:00:00Z",
};

const WALLET = {
	card: {
		programme_name: "Thành viên Mẫu",
		display_name: "Khách thử",
		phone_masked: "•••• ••• 789",
		member_since: "2026-10-10",
		purchases: 2,
	},
	stamp_cards: [],
	points: { balance: 0, pending: 85 },
	tier: null,
	marketing_consent: false,
	history: [],
	claims: [],
	claims_today: 0,
	claims_per_day: 3,
};

const STORE = {
	code: "mau-1",
	name: "Cửa hàng Mẫu 1",
	address: null,
	opening_hours: {},
};

const LIVE_QR = "fnb-counter:1:mau-1:K7M2Q9TXH3N7";

describe("a store's confirmation mode", () => {
	it("defaults to pos_sync without counter claims when the answer predates the mode", () => {
		expect(readCustomerStore(STORE)).toMatchObject({
			confirmation: "pos_sync",
			counterClaims: false,
		});
		expect(
			readCustomerStore({ ...STORE, confirmation: null, counter_claims: null }),
		).toMatchObject({ confirmation: "pos_sync", counterClaims: false });
	});

	it("reads each mode and the counter claim flag", () => {
		expect(
			readCustomerStore({
				...STORE,
				confirmation: "staff",
				counter_claims: true,
			}),
		).toMatchObject({ confirmation: "staff", counterClaims: true });
		expect(
			readCustomerStore({
				...STORE,
				confirmation: "pos_sync",
				counter_claims: false,
			}),
		).toMatchObject({ confirmation: "pos_sync", counterClaims: false });
	});

	it("refuses an unknown mode or a flag that is not a boolean", () => {
		expect(() =>
			readCustomerStore({ ...STORE, confirmation: "hybrid" }),
		).toThrow(/store confirmation/);
		expect(() => readCustomerStore({ ...STORE, confirmation: 1 })).toThrow(
			/store confirmation/,
		);
		expect(() =>
			readCustomerStore({ ...STORE, counter_claims: "true" }),
		).toThrow(/counter claims/);
	});
});

describe("the bills waiting for the customer", () => {
	it("default to none in a wallet that predates them", () => {
		expect(readWallet(WALLET).billsToConfirm).toEqual([]);
		expect(
			readWallet({ ...WALLET, bills_to_confirm: null }).billsToConfirm,
		).toEqual([]);
	});

	it("read store, number and times, and never a total the row might carry", () => {
		const read = readWallet({
			...WALLET,
			bills_to_confirm: [{ ...BILL, total: 85_000, staff_total: 85_000 }],
		}).billsToConfirm;
		expect(read).toEqual([
			{
				id: BILL_ID,
				storeName: "Cửa hàng Mẫu 1",
				billNo: "HD0457",
				recordedAt: "2026-11-19T03:00:00Z",
				confirmBy: "2026-11-20T03:00:00Z",
			},
		]);
		expect(JSON.stringify(read)).not.toContain("85000");
	});

	it("accept a bill number of 40 characters and refuse 41, a space or none", () => {
		const forty = "A".repeat(40);
		expect(readBillToConfirm({ ...BILL, bill_no: forty }).billNo).toBe(forty);
		for (const billNo of ["A".repeat(41), "HD 0457", "", null]) {
			expect(() => readBillToConfirm({ ...BILL, bill_no: billNo })).toThrow(
				/bill number/,
			);
		}
	});

	it("refuse a bill id that is not a uuid, a bad time, or a deadline not after the recording", () => {
		expect(() => readBillToConfirm({ ...BILL, id: "b-1" })).toThrow(/bill id/);
		expect(() => readBillToConfirm({ ...BILL, recorded_at: "soon" })).toThrow(
			/bill time/,
		);
		expect(() =>
			readBillToConfirm({ ...BILL, confirm_by: BILL.recorded_at }),
		).toThrow(/bill deadline/);
		expect(() => readBillToConfirm({ ...BILL, store_name: "" })).toThrow(
			/bill store/,
		);
		expect(() => readWallet({ ...WALLET, bills_to_confirm: {} })).toThrow(
			/bills to confirm/,
		);
	});

	it("show a path E earn in the history as a bill", () => {
		expect(MATCHED_PATHS).toContain("bill");
		expect(
			readLedgerEntry({
				id: "e-1",
				at: "2026-11-19T03:00:00Z",
				kind: "earn",
				state: "pending",
				stamps: 1,
				points: 85,
				matched_path: "bill",
			}).matchedPath,
		).toBe("bill");
	});
});

describe("the counter claims in the wallet (G-92)", () => {
	const CLAIM = {
		id: "00000000-0000-4000-8000-00000000c001",
		store_name: "Cửa hàng Mẫu 1",
		bill_no: "C-0457",
		submitted_at: "2026-11-19T03:00:00Z",
		state: "awaiting_staff",
		waiting_until: "2026-11-19T09:00:00Z",
		decided_at: null,
	};

	it("default to none in a wallet that predates them", () => {
		expect(readWallet(WALLET).counterClaims).toEqual([]);
		expect(
			readWallet({ ...WALLET, counter_claims: null }).counterClaims,
		).toEqual([]);
	});

	it("read a waiting claim with its deadline, and never a total the row might carry", () => {
		const read = readWallet({
			...WALLET,
			counter_claims: [{ ...CLAIM, total: 85_000 }],
		}).counterClaims;
		expect(read).toEqual([
			{
				id: CLAIM.id,
				storeName: "Cửa hàng Mẫu 1",
				billNo: "C-0457",
				submittedAt: "2026-11-19T03:00:00Z",
				state: "awaiting_staff",
				waitingUntil: "2026-11-19T09:00:00Z",
				decidedAt: null,
			},
		]);
		expect(JSON.stringify(read)).not.toContain("85000");
	});

	it.each(
		COUNTER_CLAIM_RECORD_STATES.filter((state) => state !== "awaiting_staff"),
	)("read a claim in state %s without a deadline", (state) => {
		expect(
			readCounterClaimRecord({
				...CLAIM,
				state,
				waiting_until: null,
				decided_at: state === "queued" ? null : "2026-11-19T04:00:00Z",
			}).state,
		).toBe(state);
	});

	it("need a deadline exactly while the claim waits for the staff (decision table)", () => {
		expect(() =>
			readCounterClaimRecord({ ...CLAIM, waiting_until: null }),
		).toThrow(/counter claim deadline/);
		expect(() =>
			readCounterClaimRecord({ ...CLAIM, state: "confirmed" }),
		).toThrow(/counter claim deadline/);
	});

	it("refuse an unknown state, a bad id, number or time, or a list that is not one", () => {
		expect(() =>
			readCounterClaimRecord({ ...CLAIM, state: "awaiting_customer" }),
		).toThrow(/counter claim state/);
		expect(() => readCounterClaimRecord({ ...CLAIM, id: "c-1" })).toThrow(
			/counter claim id/,
		);
		expect(() =>
			readCounterClaimRecord({ ...CLAIM, bill_no: "C 0457" }),
		).toThrow(/counter claim number/);
		expect(() =>
			readCounterClaimRecord({ ...CLAIM, submitted_at: "soon" }),
		).toThrow(/counter claim time/);
		expect(() => readWallet({ ...WALLET, counter_claims: {} })).toThrow(
			/counter claims/,
		);
	});
});

describe("an answer sent a second time (G-92)", () => {
	it("is read like the first: the replayed flag changes nothing the app shows", () => {
		expect(
			readBillConfirmResult({
				state: "confirmed",
				refusal: null,
				evidence_level: 2,
				replayed: true,
			}),
		).toEqual({ state: "confirmed", refusal: null, evidenceLevel: 2 });
		expect(
			readBillDisputeResult({
				state: "reversed",
				refusal: null,
				replayed: true,
			}),
		).toEqual({ state: "reversed", refusal: null });
		expect(
			readCounterClaimResult({
				state: "awaiting_staff",
				refusal: null,
				bill_id: BILL_ID,
				evidence_level: 0,
				expires_at: "2026-11-19T09:00:00Z",
				replayed: true,
			}),
		).toMatchObject({ state: "awaiting_staff", billId: BILL_ID });
	});
});

describe("the answer to a blind total", () => {
	it.each([
		["confirmed", 2],
		["queued", 0],
		["awaiting_customer", 1],
	] as const)("reads %s with its evidence level", (state, level) => {
		expect(
			readBillConfirmResult({ state, refusal: null, evidence_level: level }),
		).toEqual({ state, refusal: null, evidenceLevel: level });
	});

	it("reads each refusal, without an evidence level", () => {
		for (const refusal of BILL_REFUSALS) {
			expect(readBillConfirmResult({ state: "refused", refusal })).toEqual({
				state: "refused",
				refusal,
				evidenceLevel: null,
			});
			expect(knownBillRefusal(refusal)).toBe(refusal);
		}
		expect(knownBillRefusal("newer_reason")).toBeNull();
		expect(knownBillRefusal(null)).toBeNull();
	});

	it("needs a refusal exactly when refused (decision table)", () => {
		expect(() => readBillConfirmResult({ state: "refused" })).toThrow(
			/bill refusal/,
		);
		expect(() =>
			readBillConfirmResult({ state: "confirmed", refusal: "too_late" }),
		).toThrow(/bill refusal/);
		expect(() =>
			readBillConfirmResult({ state: "refused", refusal: "Too Late" }),
		).toThrow(/bill refusal/);
	});

	it("accepts evidence levels 0 to 3 and refuses 4, -1 and 1.5", () => {
		expect(
			readBillConfirmResult({ state: "confirmed", evidence_level: 3 })
				.evidenceLevel,
		).toBe(3);
		for (const level of [4, -1, 1.5, "2"]) {
			expect(() =>
				readBillConfirmResult({ state: "confirmed", evidence_level: level }),
			).toThrow(/evidence level/);
		}
	});

	it("refuses an unknown state or an answer that is not an object", () => {
		expect(() => readBillConfirmResult({ state: "agreed" })).toThrow(
			/bill answer state/,
		);
		expect(() => readBillConfirmResult(null)).toThrow(/bill answer/);
		expect(() => readBillConfirmResult([])).toThrow(/bill answer/);
	});
});

describe("the answer to a dispute", () => {
	it("reads a reversal and each refusal", () => {
		expect(readBillDisputeResult({ state: "reversed", refusal: null })).toEqual(
			{ state: "reversed", refusal: null },
		);
		expect(
			readBillDisputeResult({ state: "refused", refusal: "already_answered" }),
		).toEqual({ state: "refused", refusal: "already_answered" });
	});

	it("refuses a refusal without its word, a reversal with one, or another state", () => {
		expect(() => readBillDisputeResult({ state: "refused" })).toThrow(
			/dispute refusal/,
		);
		expect(() =>
			readBillDisputeResult({ state: "reversed", refusal: "unknown_bill" }),
		).toThrow(/dispute refusal/);
		expect(() => readBillDisputeResult({ state: "confirmed" })).toThrow(
			/dispute state/,
		);
	});
});

describe("the counter QR", () => {
	it("reads the store code of a well-formed payload, trimmed as the server reads it", () => {
		expect(COUNTER_QR_PATTERN.test(LIVE_QR)).toBe(true);
		expect(readCounterQr(`  ${LIVE_QR}\n`)).toEqual({
			payload: LIVE_QR,
			storeCode: "mau-1",
		});
	});

	it("accepts a token of 12 allowed characters and refuses 11, 13 and the look-alikes I, O, 0 and 1", () => {
		const base = "fnb-counter:1:mau-1:";
		expect(readCounterQr(`${base}ABCDEFGHJKLM`)).not.toBeNull();
		expect(readCounterQr(`${base}23456789PQRZ`)).not.toBeNull();
		for (const token of [
			"K7M2Q9TXH3N",
			"K7M2Q9TXH3N7A",
			"K7M2Q9TXH3NI",
			"K7M2Q9TXH3NO",
			"K7M2Q9TXH3N0",
			"K7M2Q9TXH3N1",
			"k7m2q9txh3n7",
		]) {
			expect(readCounterQr(`${base}${token}`), token).toBeNull();
		}
	});

	it("refuses another prefix, version, a member or reward code, and a store code that breaks its pattern", () => {
		for (const raw of [
			"fnb-counter:2:mau-1:K7M2Q9TXH3N7",
			"fnb-member:1:mau-1:123456",
			"fnb-redeem:1:K7M2Q9TX",
			"fnb-counter:1::K7M2Q9TXH3N7",
			"fnb-counter:1:-mau:K7M2Q9TXH3N7",
			"fnb-counter:1:mau 1:K7M2Q9TXH3N7",
			"https://example.invalid/?q=fnb-counter:1:mau-1:K7M2Q9TXH3N7",
			"",
		]) {
			expect(readCounterQr(raw), raw).toBeNull();
		}
	});
});

describe("the answer to a counter claim", () => {
	it("reads a claim waiting for the staff member, with its deadline", () => {
		expect(
			readCounterClaimResult({
				state: "awaiting_staff",
				refusal: null,
				bill_id: BILL_ID,
				evidence_level: 0,
				expires_at: "2026-11-19T09:00:00Z",
			}),
		).toEqual({
			state: "awaiting_staff",
			refusal: null,
			billId: BILL_ID,
			evidenceLevel: 0,
			stampsEarned: null,
			pointsEarned: null,
			expiresAt: Date.parse("2026-11-19T09:00:00Z"),
			retryAt: null,
		});
	});

	it("reads an auto-approved claim with what it earned", () => {
		expect(
			readCounterClaimResult({
				state: "confirmed",
				refusal: null,
				bill_id: BILL_ID,
				evidence_level: 0,
				stamps_earned: 1,
				points_earned: 45,
			}),
		).toMatchObject({ state: "confirmed", stampsEarned: 1, pointsEarned: 45 });
	});

	it("reads every refusal the server words, and the lock's retry time", () => {
		for (const refusal of COUNTER_CLAIM_REFUSALS) {
			expect(
				readCounterClaimResult({ state: "refused", refusal, bill_id: null }),
			).toMatchObject({ state: "refused", refusal, billId: null });
			expect(knownCounterClaimRefusal(refusal)).toBe(refusal);
		}
		expect(
			readCounterClaimResult({
				state: "refused",
				refusal: "locked",
				bill_id: null,
				retry_at: "2026-11-19T03:15:00Z",
			}).retryAt,
		).toBe(Date.parse("2026-11-19T03:15:00Z"));
		expect(
			readCounterClaimResult({ state: "refused", refusal: "staff_shift_cap" })
				.refusal,
		).toBe("staff_shift_cap");
		expect(knownCounterClaimRefusal("staff_shift_cap")).toBeNull();
	});

	it("refuses a malformed answer", () => {
		expect(() =>
			readCounterClaimResult({ state: "confirmed", refusal: null }),
		).toThrow(/counter claim bill/);
		expect(() => readCounterClaimResult({ state: "refused" })).toThrow(
			/counter claim refusal/,
		);
		expect(() =>
			readCounterClaimResult({
				state: "awaiting_staff",
				bill_id: BILL_ID,
				expires_at: "later",
			}),
		).toThrow(/counter claim deadline/);
		expect(() =>
			readCounterClaimResult({
				state: "confirmed",
				bill_id: BILL_ID,
				stamps_earned: -1,
			}),
		).toThrow(/stamps earned/);
		expect(() => readCounterClaimResult({ state: "matched" })).toThrow(
			/counter claim state/,
		);
	});
});

describe("the receipt claim at a staff-mode store", () => {
	it("knows staff_mode as a reason the app words", () => {
		expect(CLAIM_REASONS).toContain("staff_mode");
		expect(knownClaimReason("staff_mode")).toBe("staff_mode");
	});
});

describe("the REST loyalty client's staff-mode calls", () => {
	it("call each function with the database's parameter names only", async () => {
		const calls: [string, unknown][] = [];
		const answers: Record<string, unknown> = {
			[CUSTOMER_FUNCTIONS.confirmBill]: {
				state: "confirmed",
				refusal: null,
				evidence_level: 2,
			},
			[CUSTOMER_FUNCTIONS.disputeBill]: { state: "reversed", refusal: null },
			[CUSTOMER_FUNCTIONS.submitCounterClaim]: {
				state: "refused",
				refusal: "code_expired",
				bill_id: null,
			},
		};
		const rest: RestClient = {
			select: async () => [],
			rpc: async (fn, args) => {
				calls.push([fn, args]);
				return answers[fn];
			},
		};
		const client = createRestLoyaltyClient(rest);
		expect(await client.confirmBill(BILL_ID, 85_000)).toEqual({
			state: "confirmed",
			refusal: null,
			evidenceLevel: 2,
		});
		expect(await client.disputeBill(BILL_ID)).toEqual({
			state: "reversed",
			refusal: null,
		});
		expect(
			await client.submitCounterClaim({
				qr: ` ${LIVE_QR} `,
				billNo: " HD0457 ",
				total: 45_000,
			}),
		).toMatchObject({ state: "refused", refusal: "code_expired" });
		expect(calls).toEqual([
			["customer_confirm_bill", { p_bill_id: BILL_ID, p_total: 85_000 }],
			["customer_dispute_bill", { p_bill_id: BILL_ID }],
			[
				"customer_submit_counter_claim",
				{ p_qr: LIVE_QR, p_bill_no: "HD0457", p_total: 45_000 },
			],
		]);
		expect(
			Object.keys(counterClaimArgs({ qr: LIVE_QR, billNo: "1", total: 1 })),
		).toEqual(["p_qr", "p_bill_no", "p_total"]);
	});

	it("reject a malformed answer instead of showing it", async () => {
		const rest: RestClient = {
			select: async () => [],
			rpc: async () => ({ state: "confirmed", refusal: "too_late" }),
		};
		await expect(
			createRestLoyaltyClient(rest).confirmBill(BILL_ID, 1),
		).rejects.toThrow(/bill refusal/);
	});
});
