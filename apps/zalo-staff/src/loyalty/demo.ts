import { type MemberRole, REFUSAL, RestError } from "@fnb/zalo-mini";
import { SAMPLE_STORES } from "../home/sample";
import { canManage } from "../shift/model";
import {
	type DemoRedemption,
	type DemoStoreMode,
	demoStoreModeFrom,
} from "./bills-demo";
import {
	type AdjustLimits,
	ALREADY_VERIFIED,
	type CheckinAnswer,
	type LookupAnswer,
	type LoyaltyClient,
	MAX_REASON_LENGTH,
	type MemberCard,
	type MyRequest,
	type QueueItem,
	type RedemptionAnswer,
	type RequestReceipt,
	type Visit,
	type VisitPath,
} from "./contract";
import { maskPhone, nationalPhone, needsManager } from "./model";

export const DEMO_PHONES = {
	member: "0900001234",
	second: "0900005678",
	capped: "0900003333",
	suspended: "0900004444",
	staff: "0900000000",
} as const;

export const DEMO_CODES = {
	live: "246810",
	expired: "135790",
	otherStore: "975310",
	posReward: "UD2468",
	voucherReward: "UD3579",
	used: "UD1111",
	expiredReward: "UD0000",
	otherStoreReward: "UD9753",
	releasedReward: "UD5555",
	verifiedByOther: "UD4444",
} as const;

export const DEMO_VOUCHER_CODE = "VC8F3K2Q";
export const DEMO_DISCOUNT_NAME = "Thành viên - Tặng 1 ly";
export const DEMO_LIMITS: AdjustLimits = { stamps: 2, points: 20 };
export const DEMO_CONFIRM_MINUTES = 10;
export const DEMO_HOLD_MINUTES = 30;
export const DEMO_CHECKIN_WINDOW_MINUTES = 15;
export const DEMO_DAILY_CAP = 3;
export const DEMO_OTHER_STORE_NAME = "Cửa hàng Mẫu 2";
const MAX_DEMO_DELAY_MS = 10_000;
const MINUTE = 60_000;

export interface LoyaltyDemoSettings {
	readonly delayMs: number;
	/** "staff" puts the first sample store in staff mode with self claims (`?storeMode=staff`); absent or "pos_sync" keeps every store POS-synced */
	readonly storeMode?: DemoStoreMode;
}

export function loyaltyDemoSettingsFrom(search: string): LoyaltyDemoSettings {
	const delay = Number(new URLSearchParams(search).get("dataDelay") ?? "0");
	const storeMode = demoStoreModeFrom(search);
	return {
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_DEMO_DELAY_MS)
				: 0,
		...(storeMode === "staff" ? { storeMode } : {}),
	};
}

interface DemoMember {
	readonly membershipId: string;
	readonly phone: string;
	readonly memberSince: string;
	readonly tierName: string | null;
	readonly status: MemberCard["status"];
	stamps: number;
	points: number;
}

interface DemoReward {
	readonly rewardName: string;
	readonly instruction:
		| { readonly kind: "pos_discount" }
		| { readonly kind: "voucher_code"; readonly voucherCode: string };
	readonly minBillAmount: number | null;
	readonly phone: string;
}

const REWARDS: Readonly<Record<string, DemoReward>> = {
	[DEMO_CODES.posReward]: {
		rewardName: "Tặng 1 ly cà phê sữa",
		instruction: { kind: "pos_discount" },
		minBillAmount: null,
		phone: DEMO_PHONES.member,
	},
	[DEMO_CODES.voucherReward]: {
		rewardName: "Giảm 20.000 ₫ cho hóa đơn",
		instruction: { kind: "voucher_code", voucherCode: DEMO_VOUCHER_CODE },
		minBillAmount: 50_000,
		phone: DEMO_PHONES.second,
	},
};

function demoId(kind: string, n: number): string {
	return `00000000-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, "0")}`;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function refuse(code: string, status = 400): never {
	throw new RestError(status, code);
}

function seedMembers(): DemoMember[] {
	return [
		{
			membershipId: demoId("c", 1),
			phone: DEMO_PHONES.member,
			memberSince: "2026-09-02",
			tierName: "Bạc",
			status: "active",
			stamps: 5,
			points: 120,
		},
		{
			membershipId: demoId("c", 2),
			phone: DEMO_PHONES.second,
			memberSince: "2026-06-15",
			tierName: "Vàng",
			status: "active",
			stamps: 7,
			points: 340,
		},
		{
			membershipId: demoId("c", 3),
			phone: DEMO_PHONES.capped,
			memberSince: "2026-10-20",
			tierName: null,
			status: "active",
			stamps: 3,
			points: 45,
		},
		{
			membershipId: demoId("c", 4),
			phone: DEMO_PHONES.suspended,
			memberSince: "2026-08-08",
			tierName: null,
			status: "suspended",
			stamps: 2,
			points: 30,
		},
	];
}

interface DemoVisit extends Visit {
	readonly membershipId: string;
}

interface StoreWorld {
	readonly visits: DemoVisit[];
	readonly usedCodes: Set<string>;
	readonly verified: Map<string, string>;
	readonly redemptionIds: Map<string, string>;
	queue: QueueItem[];
}

export interface DemoLoyaltyOptions {
	readonly settings: LoyaltyDemoSettings;
	readonly role: MemberRole;
	readonly clock?: () => Date;
	/** the confirmation source per store: a staff-mode store refuses the till check-in (staff_mode) */
	readonly storeModeOf?: (storeId: string) => DemoStoreMode;
}

export interface DemoLoyaltyClient extends LoyaltyClient {
	nameStores(stores: readonly { id: string; name: string }[]): void;
	/** a reward verified at the till, for the staff-mode confirmation */
	redemptionOf(redemptionId: string): DemoRedemption | undefined;
}

export function createDemoLoyaltyClient(
	options: DemoLoyaltyOptions,
): DemoLoyaltyClient {
	const clock = options.clock ?? (() => new Date());
	const role = options.role;
	const members = seedMembers();
	const worlds = new Map<string, StoreWorld>();
	const names = new Map<string, string>(
		SAMPLE_STORES.map((store) => [store.id, store.name]),
	);
	const requests: MyRequest[] = [];
	const redemptions = new Map<string, DemoRedemption>();
	let sequence = 100;
	const next = (kind: string) => {
		sequence += 1;
		return demoId(kind, sequence);
	};
	const pause = () =>
		options.settings.delayMs > 0
			? wait(options.settings.delayMs)
			: Promise.resolve();
	const at = (minutesAgo: number) =>
		new Date(clock().getTime() - minutesAgo * MINUTE).toISOString();
	const memberByPhone = (phone: string) =>
		members.find((member) => member.phone === phone);
	const memberById = (id: string) =>
		members.find((member) => member.membershipId === id);
	const storeName = (storeId: string) => names.get(storeId) ?? null;

	requests.push(
		{
			id: demoId("e", 1),
			kind: "adjustment",
			createdAt: at(26 * 60),
			phoneMasked: maskPhone(DEMO_PHONES.second),
			reason: "Máy POS lỗi, khách mua 2 ly chưa được tích.",
			stamps: 2,
			points: 12,
			state: "approved",
			decidedAt: at(25 * 60),
			decisionReason: "Đã đối chiếu hóa đơn trên máy POS.",
			storeName: SAMPLE_STORES[0]?.name ?? null,
		},
		{
			id: demoId("e", 2),
			kind: "dispute",
			createdAt: at(30 * 60),
			phoneMasked: maskPhone(DEMO_PHONES.member),
			reason: "Khách báo hóa đơn tuần trước chưa được tích dấu.",
			stamps: 1,
			points: 0,
			state: "refused",
			decidedAt: at(28 * 60),
			decisionReason: "Hóa đơn đó đã được tích ở cửa hàng khác.",
			storeName: SAMPLE_STORES[0]?.name ?? null,
		},
	);

	function world(storeId: string): StoreWorld {
		const known = worlds.get(storeId);
		if (known !== undefined) return known;
		const first = members[0];
		const capped = members[2];
		const created: StoreWorld = {
			visits: [],
			usedCodes: new Set(),
			verified: new Map(),
			redemptionIds: new Map(),
			queue: [],
		};
		if (first !== undefined)
			created.visits.push({
				membershipId: first.membershipId,
				at: at(200),
				state: "confirmed",
				path: "member_code",
				stamps: 1,
				points: 6,
				receiptNo: "HD-0007",
			});
		if (capped !== undefined)
			for (const minutes of [260, 180, 95])
				created.visits.push({
					membershipId: capped.membershipId,
					at: at(minutes),
					state: "confirmed",
					path: "phone",
					stamps: 1,
					points: 5,
					receiptNo: null,
				});
		const suffix = storeId.slice(-4);
		created.queue = [
			{
				id: `00000000-0000-4000-8000-0000d${suffix}001`,
				kind: "match",
				storeId,
				createdAt: at(35),
				phoneMasked: maskPhone(DEMO_PHONES.member),
				requestedBy: null,
				reason: null,
				stamps: 0,
				points: 0,
				match: {
					path: "member_code",
					recordedAt: at(40),
					amount: null,
					receiptNo: null,
					candidates: [
						{
							invoiceId: `00000000-0000-4000-8000-0000f${suffix}012`,
							receiptNo: "HD-0012",
							soldAt: at(42),
							amount: 85_000,
						},
						{
							invoiceId: `00000000-0000-4000-8000-0000f${suffix}013`,
							receiptNo: "HD-0013",
							soldAt: at(39),
							amount: 85_000,
						},
					],
				},
			},
			{
				id: `00000000-0000-4000-8000-0000d${suffix}002`,
				kind: "dispute",
				storeId,
				createdAt: at(50 * 60),
				phoneMasked: maskPhone(DEMO_PHONES.second),
				requestedBy: "Nhân viên thử",
				reason: "Khách báo hóa đơn hôm kia chưa được tích dấu.",
				stamps: 1,
				points: 8,
				match: null,
			},
			{
				id: `00000000-0000-4000-8000-0000d${suffix}003`,
				kind: "adjustment",
				storeId,
				createdAt: at(180),
				phoneMasked: maskPhone(DEMO_PHONES.member),
				requestedBy: "Nhân viên thử",
				reason: "Máy POS lỗi lúc trưa, khách mua 3 ly chưa được tích.",
				stamps: 3,
				points: 0,
				match: null,
			},
		];
		worlds.set(storeId, created);
		return created;
	}

	function earningToday(storeWorld: StoreWorld, membershipId: string): number {
		return storeWorld.visits.filter(
			(visit) =>
				visit.membershipId === membershipId &&
				visit.path !== "manual" &&
				visit.state !== "rejected",
		).length;
	}

	function card(member: DemoMember, storeWorld: StoreWorld): MemberCard {
		const pending = storeWorld.visits.filter(
			(visit) =>
				visit.membershipId === member.membershipId && visit.state === "pending",
		);
		return {
			membershipId: member.membershipId,
			phoneMasked: maskPhone(member.phone),
			displayName: null,
			memberSince: member.memberSince,
			status: member.status,
			tierName: member.tierName,
			stamps: member.stamps,
			stampsPerCard: 8,
			stampsPending: pending.reduce((sum, visit) => sum + visit.stamps, 0),
			points: member.points,
			pointsPending: pending.reduce((sum, visit) => sum + visit.points, 0),
		};
	}

	function recordFor(
		storeId: string,
		member: DemoMember,
		path: VisitPath,
	): CheckinAnswer {
		const storeWorld = world(storeId);
		if (member.status !== "active")
			return {
				outcome: "refused",
				refusal: "membership_inactive",
				textKey: null,
			};
		const now = clock();
		// the database refuses the same member recorded again while the first visit still waits for its receipt
		if (
			storeWorld.visits.some(
				(visit) =>
					visit.membershipId === member.membershipId &&
					visit.state === "pending" &&
					now.getTime() - new Date(visit.at).getTime() <=
						DEMO_CHECKIN_WINDOW_MINUTES * MINUTE,
			)
		)
			return {
				outcome: "refused",
				refusal: "already_recorded",
				textKey: null,
			};
		if (earningToday(storeWorld, member.membershipId) >= DEMO_DAILY_CAP)
			return { outcome: "refused", refusal: "daily_limit", textKey: null };
		storeWorld.visits.push({
			membershipId: member.membershipId,
			at: now.toISOString(),
			state: "pending",
			path,
			stamps: 1,
			points: 0,
			receiptNo: null,
		});
		return {
			outcome: "recorded",
			checkinId: next("a"),
			state: "pending",
			recordedAt: now.toISOString(),
			confirmBy: new Date(
				now.getTime() + DEMO_CONFIRM_MINUTES * MINUTE,
			).toISOString(),
			member: {
				membershipId: member.membershipId,
				phoneMasked: maskPhone(member.phone),
				displayName: null,
				stamps: member.stamps,
				stampsPerCard: 8,
				points: member.points,
			},
		};
	}

	function accepted(
		storeId: string,
		code: string,
		reward: DemoReward,
		verifiedAt: Date,
		first: boolean,
	): RedemptionAnswer {
		const storeWorld = world(storeId);
		const redemptionId = storeWorld.redemptionIds.get(code) ?? next("b");
		storeWorld.redemptionIds.set(code, redemptionId);
		redemptions.set(redemptionId, {
			storeId,
			phone: reward.phone,
			discountName:
				reward.instruction.kind === "pos_discount" ? DEMO_DISCOUNT_NAME : null,
		});
		return {
			outcome: "accepted",
			redemptionId,
			rewardName: reward.rewardName,
			rewardKind: "free_item",
			rewardPercent: null,
			firstVerification: first,
			verifiedAt: verifiedAt.toISOString(),
			rail:
				reward.instruction.kind === "pos_discount"
					? "pos_payment_discount"
					: "crm_code_pool",
			instruction:
				reward.instruction.kind === "pos_discount"
					? { kind: "pos_discount", discountName: DEMO_DISCOUNT_NAME }
					: {
							kind: "voucher_code",
							voucherCode: reward.instruction.voucherCode,
						},
			minBillAmount: reward.minBillAmount,
			holdUntil: new Date(
				verifiedAt.getTime() + DEMO_HOLD_MINUTES * MINUTE,
			).toISOString(),
			confirmBy: new Date(
				verifiedAt.getTime() + DEMO_CONFIRM_MINUTES * MINUTE,
			).toISOString(),
			phoneMasked: maskPhone(reward.phone),
		};
	}

	function managerOnly(): void {
		if (!canManage(role)) refuse(REFUSAL.notAllowed, 403);
	}

	function checkedReason(reason: string): string {
		const trimmed = reason.trim();
		if (trimmed === "" || trimmed.length > MAX_REASON_LENGTH)
			refuse(REFUSAL.invalid);
		return trimmed;
	}

	function applyAdjustment(
		storeId: string,
		membershipId: string,
		stamps: number,
		points: number,
	): void {
		const member = memberById(membershipId);
		if (member === undefined) return;
		member.stamps += stamps;
		member.points += points;
		world(storeId).visits.push({
			membershipId,
			at: clock().toISOString(),
			state: "confirmed",
			path: "manual",
			stamps,
			points,
			receiptNo: null,
		});
	}

	return {
		nameStores(stores) {
			for (const store of stores) names.set(store.id, store.name);
		},
		redemptionOf(redemptionId) {
			return redemptions.get(redemptionId);
		},
		async recordCheckin(input) {
			await pause();
			if (options.storeModeOf?.(input.storeId) === "staff")
				return { outcome: "refused", refusal: "staff_mode", textKey: null };
			const storeWorld = world(input.storeId);
			if (input.entry.kind === "phone") {
				const phone = nationalPhone(input.entry.phone);
				if (phone === null)
					return {
						outcome: "refused",
						refusal: "invalid_phone",
						textKey: null,
					};
				if (phone === DEMO_PHONES.staff)
					return { outcome: "refused", refusal: "staff_phone", textKey: null };
				const member = memberByPhone(phone);
				if (member === undefined)
					return { outcome: "refused", refusal: "not_member", textKey: null };
				return recordFor(input.storeId, member, "phone");
			}
			const code = input.entry.code;
			if (code === DEMO_CODES.expired)
				return { outcome: "refused", refusal: "code_expired", textKey: null };
			if (code === DEMO_CODES.otherStore)
				return { outcome: "refused", refusal: "wrong_store", textKey: null };
			if (code !== DEMO_CODES.live)
				return { outcome: "refused", refusal: "code_unknown", textKey: null };
			if (storeWorld.usedCodes.has(code))
				return { outcome: "refused", refusal: "code_used", textKey: null };
			const member = members[0];
			if (member === undefined)
				return { outcome: "refused", refusal: "code_unknown", textKey: null };
			const answer = recordFor(input.storeId, member, "member_code");
			if (answer.outcome === "recorded") storeWorld.usedCodes.add(code);
			return answer;
		},
		async verifyRedemption(storeId, code): Promise<RedemptionAnswer> {
			await pause();
			const storeWorld = world(storeId);
			const refused = (
				refusal: Extract<RedemptionAnswer, { outcome: "refused" }>["refusal"],
				extra: Partial<Extract<RedemptionAnswer, { outcome: "refused" }>> = {},
			): RedemptionAnswer => ({
				outcome: "refused",
				refusal,
				reason: null,
				textKey: null,
				usedAt: null,
				usedStoreName: null,
				expiredAt: null,
				...extra,
			});
			const verifiedAt = storeWorld.verified.get(code);
			const earlier = REWARDS[code];
			// the same staff member checking again (a lost answer, a second tap) gets the same answer as the database gives
			if (verifiedAt !== undefined && earlier !== undefined)
				return accepted(storeId, code, earlier, new Date(verifiedAt), false);
			switch (code) {
				case DEMO_CODES.verifiedByOther:
					return refused("used", {
						reason: ALREADY_VERIFIED,
						usedAt: at(20),
						usedStoreName: storeName(storeId),
					});
				case DEMO_CODES.used:
					return refused("used", {
						usedAt: at(165),
						usedStoreName: DEMO_OTHER_STORE_NAME,
					});
				case DEMO_CODES.expiredReward:
					return refused("expired", { expiredAt: at(24 * 60) });
				case DEMO_CODES.otherStoreReward:
					return refused("wrong_store");
				case DEMO_CODES.releasedReward:
					return refused("released");
			}
			const reward = REWARDS[code];
			if (reward === undefined) return refused("unknown");
			const now = clock();
			storeWorld.verified.set(code, now.toISOString());
			return accepted(storeId, code, reward, now, true);
		},
		async lookupMember(storeId, query): Promise<LookupAnswer> {
			await pause();
			const storeWorld = world(storeId);
			const member =
				query.kind === "phone"
					? memberByPhone(nationalPhone(query.phone) ?? "")
					: memberById(query.membershipId);
			if (member === undefined) return { found: false };
			return {
				found: true,
				card: card(member, storeWorld),
				storeName: storeName(storeId),
				today: storeWorld.visits
					.filter((visit) => visit.membershipId === member.membershipId)
					.map(({ membershipId: _, ...visit }) => visit)
					.sort((a, b) => b.at.localeCompare(a.at)),
				limits: DEMO_LIMITS,
			};
		},
		async request(input): Promise<RequestReceipt> {
			await pause();
			const reason = checkedReason(input.reason);
			const member = memberById(input.membershipId);
			if (member === undefined) refuse(REFUSAL.invalid);
			if (
				input.kind === "adjustment" &&
				input.stamps === 0 &&
				input.points === 0
			)
				refuse(REFUSAL.invalid);
			const requestId = next("e");
			const state =
				input.kind === "dispute"
					? "pending"
					: needsManager(role, input.stamps, input.points, DEMO_LIMITS)
						? "pending"
						: "applied";
			if (state === "applied")
				applyAdjustment(
					input.storeId,
					input.membershipId,
					input.stamps,
					input.points,
				);
			requests.unshift({
				id: requestId,
				kind: input.kind,
				createdAt: clock().toISOString(),
				phoneMasked: maskPhone(member.phone),
				reason,
				stamps: input.stamps,
				points: input.points,
				state,
				decidedAt: state === "applied" ? clock().toISOString() : null,
				decisionReason: null,
				storeName: storeName(input.storeId),
			});
			return { requestId, kind: input.kind, state };
		},
		async queue(storeId) {
			await pause();
			managerOnly();
			return [...world(storeId).queue];
		},
		async act(action) {
			await pause();
			managerOnly();
			checkedReason(action.reason);
			const owner = [...worlds.values()].find((candidate) =>
				candidate.queue.some((item) => item.id === action.itemId),
			);
			const item = owner?.queue.find(
				(candidate) => candidate.id === action.itemId,
			);
			if (owner === undefined || item === undefined) refuse(REFUSAL.invalid);
			const close = () => {
				owner.queue = owner.queue.filter(
					(candidate) => candidate.id !== item.id,
				);
			};
			if (action.kind === "match") {
				if (item.kind !== "match" || item.match === null)
					refuse(REFUSAL.invalid);
				if (
					action.invoiceId !== null &&
					!item.match.candidates.some(
						(candidate) => candidate.invoiceId === action.invoiceId,
					)
				)
					refuse(REFUSAL.invalid);
				close();
				return {
					state: action.invoiceId === null ? "dismissed" : "resolved",
					refusal: null,
				};
			}
			if (item.kind === "match") refuse(REFUSAL.invalid);
			const member = members.find(
				(candidate) => maskPhone(candidate.phone) === item.phoneMasked,
			);
			if (action.decision === "approved" && member !== undefined)
				applyAdjustment(
					item.storeId,
					member.membershipId,
					action.stamps,
					action.points,
				);
			close();
			return { state: action.decision, refusal: null };
		},
		async myRequests() {
			await pause();
			return requests.map((request) => ({ ...request }));
		},
	};
}
