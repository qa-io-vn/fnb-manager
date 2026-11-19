import { describe, expect, it } from "vitest";
import {
	actionCall,
	checkinArgs,
	checkinRefusalOf,
	lookupArgs,
	queueArgs,
	readCheckinAnswer,
	readLookupAnswer,
	readMyRequest,
	readQueueItem,
	readQueueOutcome,
	readRedemptionAnswer,
	readRequestReceipt,
	requestArgs,
	STAFF_LOYALTY_FUNCTIONS,
	verifyArgs,
} from "./contract";

const STORE = "00000000-0000-4000-8000-0000000005a1";
const MEMBERSHIP = "00000000-0000-4000-8000-c00000000001";
const ITEM = "00000000-0000-4000-8000-00000000d001";
const INVOICE = "00000000-0000-4000-8000-00000000f012";
const AT = "2026-11-19T05:00:00Z";

describe("the staff loyalty contract", () => {
	it("names the functions of ticket #255 and the queue functions it needs", () => {
		expect(STAFF_LOYALTY_FUNCTIONS).toEqual({
			recordCheckin: "staff_record_checkin",
			verifyRedemption: "staff_verify_redemption",
			memberLookup: "staff_member_lookup",
			request: "staff_request",
			queue: "staff_loyalty_queue",
			decide: "staff_decide_loyalty_request",
			myRequests: "staff_my_loyalty_requests",
			resolveMatch: "resolve_loyalty_queue_item",
		});
	});

	it("sends the store with either the phone or the code, never both", () => {
		expect(
			checkinArgs({
				storeId: STORE,
				entry: { kind: "phone", phone: "0900001234" },
			}),
		).toEqual({ p_store_id: STORE, p_phone: "0900001234" });
		expect(
			checkinArgs({
				storeId: STORE,
				entry: {
					kind: "code",
					code: "246810",
					payload: "fnb-member:1:q1:246810",
				},
			}),
		).toEqual({ p_store_id: STORE, p_code: "246810" });
		expect(verifyArgs(STORE, "UD2468")).toEqual({
			p_store_id: STORE,
			p_code: "UD2468",
		});
		expect(lookupArgs(STORE, { kind: "phone", phone: "0900001234" })).toEqual({
			p_store_id: STORE,
			p_phone: "0900001234",
		});
		expect(
			lookupArgs(STORE, { kind: "membership", membershipId: MEMBERSHIP }),
		).toEqual({ p_store_id: STORE, p_membership_id: MEMBERSHIP });
		expect(queueArgs(STORE)).toEqual({ p_store_id: STORE });
	});

	it("sends a request and each queue action with its reason", () => {
		expect(
			requestArgs({
				kind: "adjustment",
				storeId: STORE,
				membershipId: MEMBERSHIP,
				reason: "Máy POS lỗi.",
				stamps: 3,
				points: -5,
			}),
		).toEqual({
			p_kind: "adjustment",
			p_store_id: STORE,
			p_membership_id: MEMBERSHIP,
			p_reason: "Máy POS lỗi.",
			p_stamps: 3,
			p_points: -5,
		});
		expect(
			actionCall({
				kind: "match",
				itemId: ITEM,
				invoiceId: null,
				reason: "Không phải khách này.",
			}),
		).toEqual({
			fn: "resolve_loyalty_queue_item",
			args: {
				p_item_id: ITEM,
				p_choice: null,
				p_reason: "Không phải khách này.",
			},
		});
		expect(
			actionCall({
				kind: "decide",
				itemId: ITEM,
				decision: "approved",
				reason: "Đúng.",
				stamps: 1,
				points: 8,
			}),
		).toEqual({
			fn: "staff_decide_loyalty_request",
			args: {
				p_request_id: ITEM,
				p_decision: "approved",
				p_reason: "Đúng.",
				p_stamps: 1,
				p_points: 8,
			},
		});
	});

	it("reads a pending check-in and masks a full phone in it", () => {
		expect(
			readCheckinAnswer([
				{
					checkin_id: ITEM,
					state: "pending",
					recorded_at: AT,
					confirm_by: "2026-11-19T05:10:00Z",
					member: {
						membership_id: MEMBERSHIP,
						phone_masked: "0900001234",
						stamps: "5",
						stamps_per_card: 8,
						points: 120,
					},
				},
			]),
		).toEqual({
			outcome: "recorded",
			checkinId: ITEM,
			state: "pending",
			recordedAt: AT,
			confirmBy: "2026-11-19T05:10:00Z",
			member: {
				membershipId: MEMBERSHIP,
				phoneMasked: "•••• ••• 234",
				displayName: null,
				stamps: 5,
				stampsPerCard: 8,
				points: 120,
			},
		});
	});

	it("reads refusals, keeping an unknown reason as unknown", () => {
		expect(
			readCheckinAnswer({
				state: "refused",
				refusal: "code_expired",
				text_key: "loyalty.code_expired",
			}),
		).toEqual({
			outcome: "refused",
			refusal: "code_expired",
			textKey: "loyalty.code_expired",
		});
		expect(readCheckinAnswer({ refusal: "brand_new_reason" })).toEqual({
			outcome: "refused",
			refusal: null,
			textKey: null,
		});
		expect(
			readRedemptionAnswer({
				state: "refused",
				refusal: "used",
				used_at: AT,
				used_store_name: "Cửa hàng Mẫu 2",
			}),
		).toEqual({
			outcome: "refused",
			refusal: "used",
			reason: null,
			textKey: null,
			usedAt: AT,
			usedStoreName: "Cửa hàng Mẫu 2",
			expiredAt: null,
		});
	});

	it("reads every refusal of staff_record_checkin, the earn refusals of a check-in matched at once included", () => {
		for (const refusal of [
			"invalid_phone",
			"not_member",
			"staff_phone",
			"code_unknown",
			"code_expired",
			"code_used",
			"wrong_store",
			"no_programme",
			"membership_inactive",
			"already_recorded",
			"daily_limit",
			"below_minimum",
			"excluded_source",
			"programme_inactive",
			"already_earned",
			"invoice_not_completed",
		]) {
			expect(
				readCheckinAnswer({
					state: "refused",
					refusal,
					text_key: `checkin.refusal.${refusal}`,
					checkin_id: null,
				}),
			).toEqual({
				outcome: "refused",
				refusal,
				textKey: `checkin.refusal.${refusal}`,
			});
		}
		expect(checkinRefusalOf("daily_cap")).toBe("daily_limit");
		expect(checkinRefusalOf("excluded_phone")).toBe("staff_phone");
		expect(checkinRefusalOf("a_reason_from_tomorrow")).toBeNull();
	});

	it("reads staff_verify_redemption's answers as the database gives them", () => {
		expect(
			readRedemptionAnswer({
				state: "verified",
				refusal: null,
				text_key: "redeem.valid",
				first_verification: false,
				redemption_id: ITEM,
				reward_name: "Giảm 10%",
				reward_kind: "percent_off",
				reward_percent: 10,
				rail: "pos_payment_discount",
				pos_discount_name: "Quà thành viên 10%",
				pos_free_item_external_id: null,
				voucher_code: null,
				min_bill_amount: null,
				hold_until: AT,
				confirm_by: AT,
				verified_at: AT,
				phone_masked: "•••• ••• 789",
			}),
		).toEqual({
			outcome: "accepted",
			redemptionId: ITEM,
			rewardName: "Giảm 10%",
			rewardKind: "percent_off",
			rewardPercent: 10,
			firstVerification: false,
			verifiedAt: AT,
			rail: "pos_payment_discount",
			instruction: { kind: "pos_discount", discountName: "Quà thành viên 10%" },
			minBillAmount: null,
			holdUntil: AT,
			confirmBy: AT,
			phoneMasked: "•••• ••• 789",
		});
		expect(
			readRedemptionAnswer({
				state: "refused",
				refusal: "used",
				reason: "already_verified",
				text_key: "redeem.refusal.used",
				used_at: AT,
				used_store_name: "Synthetic store 1",
				expired_at: null,
			}),
		).toEqual({
			outcome: "refused",
			refusal: "used",
			reason: "already_verified",
			textKey: "redeem.refusal.used",
			usedAt: AT,
			usedStoreName: "Synthetic store 1",
			expiredAt: null,
		});
	});

	it("reads the rail instruction: a POS discount name or a voucher code", () => {
		expect(
			readRedemptionAnswer({
				redemption_id: ITEM,
				reward_name: "Tặng 1 ly",
				rail: "pos_payment_discount",
				pos_discount_name: "Thành viên - Tặng 1 ly",
				min_bill_amount: "50000.00",
				hold_until: AT,
				phone_masked: "•••• ••• 234",
			}),
		).toMatchObject({
			outcome: "accepted",
			rail: "pos_payment_discount",
			instruction: {
				kind: "pos_discount",
				discountName: "Thành viên - Tặng 1 ly",
			},
			minBillAmount: 50_000,
			confirmBy: null,
		});
		for (const rail of ["crm_code_pool", "crm_callback"])
			expect(
				readRedemptionAnswer({
					redemption_id: ITEM,
					reward_name: "Giảm 20.000 ₫",
					rail,
					voucher_code: "VC8F3K2Q",
				}),
			).toMatchObject({
				instruction: { kind: "voucher_code", voucherCode: "VC8F3K2Q" },
				phoneMasked: null,
			});
		expect(() =>
			readRedemptionAnswer({
				redemption_id: ITEM,
				reward_name: "Giảm",
				rail: "pos_payment_discount",
			}),
		).toThrow("POS discount name");
		expect(() =>
			readRedemptionAnswer({
				redemption_id: ITEM,
				reward_name: "Giảm",
				rail: "cash",
			}),
		).toThrow("rail");
	});

	it("reads a member card with today's visits, path letters included", () => {
		expect(
			readLookupAnswer({
				found: true,
				store_name: "Cửa hàng Mẫu 1",
				card: {
					membership_id: MEMBERSHIP,
					phone_masked: "•••• ••• 234",
					member_since: "2026-09-02T00:00:00Z",
					tier_name: "Bạc",
					stamps: 5,
					stamps_per_card: 8,
					points: -10,
				},
				today: [
					{ at: AT, state: "pending", path: "B", stamps: 1, points: 0 },
					{
						at: AT,
						state: "confirmed",
						path: "manual",
						stamps: -1,
						receipt_no: null,
					},
				],
				adjust_limit_stamps: 2,
				adjust_limit_points: 20,
			}),
		).toEqual({
			found: true,
			storeName: "Cửa hàng Mẫu 1",
			card: {
				membershipId: MEMBERSHIP,
				phoneMasked: "•••• ••• 234",
				displayName: null,
				memberSince: "2026-09-02",
				status: "active",
				tierName: "Bạc",
				stamps: 5,
				stampsPerCard: 8,
				stampsPending: 0,
				points: -10,
				pointsPending: 0,
			},
			today: [
				{
					at: AT,
					state: "pending",
					path: "member_code",
					stamps: 1,
					points: 0,
					receiptNo: null,
				},
				{
					at: AT,
					state: "confirmed",
					path: "manual",
					stamps: -1,
					points: 0,
					receiptNo: null,
				},
			],
			limits: { stamps: 2, points: 20 },
		});
		expect(readLookupAnswer({ found: false })).toEqual({ found: false });
		expect(readLookupAnswer(null)).toEqual({ found: false });
		expect(readLookupAnswer([])).toEqual({ found: false });
	});

	it("reads queue items, requiring two candidates for a match", () => {
		const match = {
			id: ITEM,
			kind: "match",
			store_id: STORE,
			created_at: AT,
			phone_masked: "0900001234",
			match: {
				path: "B",
				recorded_at: AT,
				candidates: [
					{
						invoice_id: INVOICE,
						receipt_no: "HD-1",
						sold_at: AT,
						amount: 85000,
					},
					{ invoice_id: ITEM, sold_at: AT, amount: "85000.00" },
				],
			},
		};
		expect(readQueueItem(match)).toMatchObject({
			kind: "match",
			phoneMasked: "•••• ••• 234",
			stamps: 0,
			match: {
				path: "member_code",
				candidates: [
					{ invoiceId: INVOICE, receiptNo: "HD-1", amount: 85_000 },
					{ invoiceId: ITEM, receiptNo: null, amount: 85_000 },
				],
			},
		});
		expect(() =>
			readQueueItem({
				...match,
				match: { ...match.match, candidates: [match.match.candidates[0]] },
			}),
		).toThrow("candidates");
		expect(
			readQueueItem({
				id: ITEM,
				kind: "dispute",
				store_id: STORE,
				created_at: AT,
				phone_masked: "•••• ••• 678",
				requested_by_name: "Nhân viên thử",
				reason: "Thiếu dấu.",
				stamps: 1,
				points: 8,
			}),
		).toMatchObject({ kind: "dispute", match: null, stamps: 1, points: 8 });
	});

	it("reads the outcomes and the requester's own requests", () => {
		expect(
			readQueueOutcome({ state: "resolved", entry_id: ITEM, refusal: null }),
		).toEqual({ state: "resolved", refusal: null });
		expect(
			readRequestReceipt({
				request_id: ITEM,
				kind: "adjustment",
				state: "applied",
			}),
		).toEqual({ requestId: ITEM, kind: "adjustment", state: "applied" });
		expect(() =>
			readRequestReceipt({
				request_id: ITEM,
				kind: "adjustment",
				state: "done",
			}),
		).toThrow("request state");
		expect(
			readMyRequest({
				id: ITEM,
				kind: "dispute",
				created_at: AT,
				phone_masked: "•••• ••• 234",
				reason: "Thiếu dấu.",
				state: "refused",
				decided_at: AT,
				decision_reason: "Đã tích ở cửa hàng khác.",
			}),
		).toMatchObject({
			state: "refused",
			decisionReason: "Đã tích ở cửa hàng khác.",
			stamps: 0,
			storeName: null,
		});
	});
});
