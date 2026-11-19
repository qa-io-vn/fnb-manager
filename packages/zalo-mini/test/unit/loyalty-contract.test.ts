import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	CLAIM_REASONS,
	CUSTOMER_FUNCTIONS,
	DELETION_STATUSES,
	knownClaimReason,
	parseCustomerSessionAnswer,
	readClaimResult,
	readCustomerHome,
	readDeletionRequest,
	readMemberCode,
	readOpeningHours,
	readWallet,
} from "../../src/loyalty/contract";
import { createRestLoyaltyClient } from "../../src/loyalty/rest-loyalty-client";

const HOME = {
	programme: {
		name: "Thành viên Mẫu",
		summary: "Tích dấu mỗi lần mua.",
		stamps_per_card: 10,
		stamp_rule: "Mỗi hóa đơn 1 dấu.",
		points_rule: null,
		reward_summary: "Đủ 10 dấu tặng 1 ly.",
		welcome_stamps: 1,
		retention_months: 24,
		tiers: [{ code: "member", name: "Thành viên", min_points: 0 }],
	},
	oa_id: "oa-1",
	legal: {
		entity_name: "Hộ kinh doanh Mẫu",
		policy_version: "privacy-1",
		documents: [
			{
				kind: "privacy_notice",
				language: "vi",
				version: "privacy-1",
				title: "Chính sách",
				body_markdown: "Văn bản",
				published_at: "2026-11-01T00:00:00Z",
			},
		],
	},
	stores: [
		{
			code: "mau-1",
			name: "Cửa hàng Mẫu 1",
			address: "1 Đường Mẫu",
			opening_hours: { mon: [["07:00", "22:00"]], tue: [["7:00", "x"]] },
		},
	],
	menu: [
		{
			id: "m-1",
			name: "Cà phê",
			description: null,
			category: "Cà phê",
			store_codes: null,
		},
	],
};

const WALLET = {
	card: {
		programme_name: "Thành viên Mẫu",
		display_name: "Khách thử",
		phone_masked: "•••• ••• 789",
		member_since: "2026-10-01",
		purchases: 2,
	},
	stamp_cards: [
		{
			id: "c-1",
			name: "Thẻ dấu",
			stamps: 3,
			stamps_per_card: 10,
			pending: 1,
			expires_on: "2027-03-30",
		},
	],
	points: {
		balance: 105,
		pending: 30,
		expiring: { points: 45, on: "2027-11-09" },
	},
	tier: {
		code: "member",
		name: "Thành viên",
		next_name: "Bạc",
		points_to_next: 395,
	},
	marketing_consent: false,
	history: [
		{
			id: "e-1",
			at: "2026-11-19T02:00:00Z",
			kind: "earn",
			state: "pending",
			stamps: 1,
			points: 30,
			store_name: "Cửa hàng Mẫu 1",
			receipt_no: null,
			matched_path: "member_code",
		},
		{
			id: "e-2",
			at: "2026-11-13T02:00:00Z",
			kind: "reversal",
			state: "reversed",
			stamps: -1,
			points: -25,
			store_name: null,
			receipt_no: "0099",
			matched_path: "phone",
		},
	],
	claims: [
		{
			id: "k-1",
			store_name: "Cửa hàng Mẫu 1",
			receipt_no: "1001",
			business_date: "2026-11-19",
			submitted_at: "2026-11-19T03:00:00Z",
			state: "pending",
			reason: null,
		},
	],
	claims_today: 1,
	claims_per_day: 3,
};

const CODE = {
	code: "042913",
	qr_payload: "fnb-member:1:mau-1:042913",
	store_code: "mau-1",
	store_name: "Cửa hàng Mẫu 1",
	issued_at: "2026-11-19T03:00:00Z",
	refresh_at: "2026-11-19T03:01:00Z",
	expires_at: "2026-11-19T03:02:00Z",
};

describe("the loyalty contract's readers", () => {
	it("read the home a visitor sees, with no price field and opening hours checked", () => {
		const home = readCustomerHome(HOME);
		expect(home.programme.stampsPerCard).toBe(10);
		expect(home.legal.documents[0]?.bodyMarkdown).toBe("Văn bản");
		expect(home.stores[0]?.openingHours.mon).toEqual([["07:00", "22:00"]]);
		expect(home.stores[0]?.openingHours.tue).toEqual([]);
		expect(home.menu[0]).toEqual({
			id: "m-1",
			name: "Cà phê",
			description: null,
			category: "Cà phê",
			storeCodes: null,
		});
		expect(Object.keys(home.menu[0] ?? {})).not.toContain("price");
		expect(readOpeningHours(null).sun).toEqual([]);
	});

	it("refuse a home with a bad store code, policy version or stamp count", () => {
		expect(() =>
			readCustomerHome({
				...HOME,
				stores: [{ ...HOME.stores[0], code: "Mẫu 1" }],
			}),
		).toThrow("store code");
		expect(() =>
			readCustomerHome({
				...HOME,
				legal: { ...HOME.legal, policy_version: "Privacy 1" },
			}),
		).toThrow("policy version");
		expect(() =>
			readCustomerHome({
				...HOME,
				programme: { ...HOME.programme, stamps_per_card: 0 },
			}),
		).toThrow("stamps per card");
	});

	it("read the wallet with the card content, pending and reversed states and the matched path", () => {
		const wallet = readWallet(WALLET);
		expect(wallet.card).toEqual({
			programmeName: "Thành viên Mẫu",
			displayName: "Khách thử",
			phoneMasked: "•••• ••• 789",
			memberSince: "2026-10-01",
			purchases: 2,
		});
		expect(
			wallet.history.map((entry) => [entry.state, entry.matchedPath]),
		).toEqual([
			["pending", "member_code"],
			["reversed", "phone"],
		]);
		expect(wallet.points.expiring).toEqual({ points: 45, on: "2027-11-09" });
		expect(wallet.claims[0]?.state).toBe("pending");
		expect(() =>
			readWallet({
				...WALLET,
				history: [{ ...WALLET.history[0], state: "approved" }],
			}),
		).toThrow("history state");
		expect(() => readWallet({ ...WALLET, marketing_consent: "yes" })).toThrow(
			"marketing consent",
		);
	});

	it("read a member code with its 60-second refresh and 2-minute expiry", () => {
		expect(readMemberCode(CODE)).toEqual({
			code: "042913",
			qrPayload: "fnb-member:1:mau-1:042913",
			storeCode: "mau-1",
			storeName: "Cửa hàng Mẫu 1",
			issuedAt: Date.parse("2026-11-19T03:00:00Z"),
			refreshAt: Date.parse("2026-11-19T03:01:00Z"),
			expiresAt: Date.parse("2026-11-19T03:02:00Z"),
		});
		expect(() => readMemberCode({ ...CODE, code: "12345" })).toThrow(
			"member code",
		);
		expect(() =>
			readMemberCode({ ...CODE, expires_at: "2026-11-19T03:00:30Z" }),
		).toThrow("member code times");
	});

	it("read a claim result and need a reason for a refusal", () => {
		expect(
			readClaimResult({
				claim_id: null,
				state: "rejected",
				reason: "daily_limit",
				claims_left_today: 0,
			}),
		).toEqual({
			claimId: null,
			state: "rejected",
			reason: "daily_limit",
			claimsLeftToday: 0,
		});
		expect(() =>
			readClaimResult({
				claim_id: null,
				state: "rejected",
				claims_left_today: 0,
			}),
		).toThrow("claim reason");
	});

	it("read zalo-session's customer answer, with the join outcome only for a member", () => {
		const answer = {
			status: "customer",
			access_token: "a",
			refresh_token: "r",
			expires_at: 1_800_000_000,
			customer: { tenant_id: "t", customer_id: "c", display_name: null },
			joined: { membership_id: "m", welcome_stamps: 1, already_member: false },
		};
		expect(parseCustomerSessionAnswer(answer)?.joined).toEqual({
			membershipId: "m",
			welcomeStamps: 1,
			alreadyMember: false,
		});
		expect(
			parseCustomerSessionAnswer({
				...answer,
				customer: { ...answer.customer, customer_id: null },
			}),
		).toBeNull();
		expect(
			parseCustomerSessionAnswer({ ...answer, status: "bound" }),
		).toBeNull();
	});
});

describe("the contract read against the loyalty tables", () => {
	it("reads a programme made of the loyalty_programmes columns, with the owner's texts optional", () => {
		const home = readCustomerHome({
			...HOME,
			programme: {
				name: "Synthetic programme",
				starts_on: "2026-01-01",
				ends_on: null,
				stamps_per_card: 8,
				welcome_stamps: 2,
				stamp_validity_months: 6,
				points_enabled: true,
				points_expiry_months: 12,
				receipt_claims_per_day: 3,
				receipt_claim_window_hours: 72,
			},
			stores: [
				{
					code: "sim-1",
					name: "Synthetic store 1",
					address: null,
					opening_hours: null,
				},
				{
					code: "CH.02_A",
					name: "Store",
					address: "2 Đường Mẫu",
					opening_hours: {},
				},
			],
		});
		expect(home.programme).toEqual({
			name: "Synthetic programme",
			startsOn: "2026-01-01",
			endsOn: null,
			stampsPerCard: 8,
			welcomeStamps: 2,
			stampValidityMonths: 6,
			pointsEnabled: true,
			pointsExpiryMonths: 12,
			claimsPerDay: 3,
			claimWindowHours: 72,
			summary: null,
			stampRule: null,
			pointsRule: null,
			rewardSummary: null,
			retentionMonths: null,
			tiers: [],
		});
		expect(home.stores.map((store) => [store.code, store.address])).toEqual([
			["sim-1", null],
			["CH.02_A", "2 Đường Mẫu"],
		]);
		expect(readCustomerHome(HOME).programme).toMatchObject({
			startsOn: null,
			pointsEnabled: false,
			claimsPerDay: 3,
			claimWindowHours: 72,
		});
	});

	it("keeps any reason of the server and knows the ones the app words", () => {
		for (const reason of CLAIM_REASONS) {
			expect(
				readClaimResult({
					claim_id: "c",
					state: "rejected",
					reason,
					claims_left_today: 1,
				}).reason,
			).toBe(reason);
			expect(knownClaimReason(reason)).toBe(reason);
		}
		expect(knownClaimReason("a_new_reason")).toBeNull();
		expect(
			readClaimResult({
				claim_id: "c",
				state: "queued",
				reason: null,
				claims_left_today: 2,
			}).state,
		).toBe("queued");
		expect(() =>
			readClaimResult({
				claim_id: "c",
				state: "rejected",
				reason: "Bad reason!",
				claims_left_today: 0,
			}),
		).toThrow("claim reason");
		expect(
			readWallet({
				...WALLET,
				claims: [{ ...WALLET.claims[0], state: "queued", reason: "dismissed" }],
			}).claims[0],
		).toMatchObject({ state: "queued", reason: "dismissed" });
	});

	it("fills a member code's issue and refresh times from its expiry, and the QR from the code", () => {
		expect(
			readMemberCode({
				code: "123456",
				store_code: "sim-1",
				store_name: "Synthetic store 1",
				expires_at: "2026-11-19T03:02:00Z",
			}),
		).toEqual({
			code: "123456",
			qrPayload: "123456",
			storeCode: "sim-1",
			storeName: "Synthetic store 1",
			issuedAt: Date.parse("2026-11-19T03:00:00Z"),
			refreshAt: Date.parse("2026-11-19T03:01:00Z"),
			expiresAt: Date.parse("2026-11-19T03:02:00Z"),
		});
	});

	it("reads a deletion request with its data-subject request status", () => {
		for (const status of DELETION_STATUSES) {
			expect(
				readDeletionRequest({
					request_id: "d",
					status,
					requested_at: "2026-11-19T03:00:00Z",
				}).status,
			).toBe(status);
		}
		expect(
			readDeletionRequest({
				request_id: "d",
				state: "open",
				requested_at: "2026-11-19T03:00:00Z",
			}).status,
		).toBe("received");
		expect(() =>
			readDeletionRequest({
				request_id: "d",
				status: "open",
				requested_at: "2026-11-19T03:00:00Z",
			}),
		).toThrow("deletion request status");
	});
});

describe("the REST loyalty client", () => {
	it("calls each customer function with the database's parameter names", async () => {
		const calls: [string, unknown][] = [];
		const answers: Record<string, unknown> = {
			[CUSTOMER_FUNCTIONS.home]: HOME,
			[CUSTOMER_FUNCTIONS.wallet]: WALLET,
			[CUSTOMER_FUNCTIONS.memberCode]: CODE,
			[CUSTOMER_FUNCTIONS.submitClaim]: {
				claim_id: "k-2",
				state: "pending",
				reason: null,
				claims_left_today: 1,
			},
			[CUSTOMER_FUNCTIONS.stopMarketing]: {
				marketing_consent: false,
				stopped_at: "2026-11-19T03:00:00Z",
			},
			[CUSTOMER_FUNCTIONS.requestDeletion]: {
				request_id: "d-1",
				state: "open",
				requested_at: "2026-11-19T03:00:00Z",
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
		await client.home();
		await client.wallet();
		await client.memberCode("mau-1");
		expect(
			await client.submitClaim({
				store: "mau-1",
				receiptNo: "1001",
				amount: 85_000,
				businessDate: "2026-11-19",
			}),
		).toMatchObject({ state: "pending", claimsLeftToday: 1 });
		await client.stopMarketing();
		expect(await client.requestDeletion()).toMatchObject({ requestId: "d-1" });
		expect(calls).toEqual([
			["customer_home", undefined],
			["customer_wallet", undefined],
			["customer_member_code", { p_store: "mau-1" }],
			[
				"customer_submit_claim",
				{
					p_store: "mau-1",
					p_receipt_no: "1001",
					p_amount: 85_000,
					p_business_date: "2026-11-19",
				},
			],
			["customer_stop_marketing", undefined],
			["customer_request_deletion", undefined],
		]);
	});
});
