// The staff-mode bill functions for the browser demo and the tests: an in-memory world that follows the rules of
// migration bill_captures closely enough to walk every screen (the evidence ladder, the approval threshold, the counter
// QR and blind counter claims, the manager queue and audits, reversal windows, staff confirmation of rewards). Only the
// store named "Cửa hàng Mẫu 1" runs in staff mode, and only when asked (`?storeMode=staff`, or the option in tests), so
// every earlier screen keeps its POS-synced behaviour by default. All members, names and phones are fictional.
import { type MemberRole, REFUSAL, RestError } from "@fnb/zalo-mini";
import { SAMPLE_STORES } from "../home/sample";
import { canManage } from "../shift/model";
import {
	type AuditAnswer,
	type BillAudit,
	type BillRefusal,
	type BillSource,
	type BillState,
	type BillsClient,
	type ClaimAnswer,
	type ConfirmRedemptionAnswer,
	type CounterClaim,
	type CounterCode,
	type DecideAnswer,
	MAX_BILL_REASON_LENGTH,
	MAX_BILL_TOTAL,
	type QueuedBill,
	type QueueReason,
	type RecentBill,
	type ReversalReason,
	type ReverseAnswer,
	type StoreBillMode,
	type StoreMode,
	type SubmitAnswer,
	type VoidRedemptionAnswer,
} from "./bills-contract";
import { MEMBER_PAYLOAD, maskPhone } from "./model";

export type DemoStoreMode = "staff" | "pos_sync";

export const DEMO_STAFF_STORE_ID = SAMPLE_STORES[0]?.id ?? "";
export const DEMO_STORE_CODE = "Q1";
export const DEMO_MY_NAME = "Thành viên thử";
export const DEMO_OTHER_STAFF = "Nhân viên Lan";

export const DEMO_BILL_KNOBS = {
	maxBill: 2_000_000,
	approvalAbove: 1_000_000,
	tolerance: 1_000,
	unconfirmedHours: 24,
	reverseWindowMinutes: 480,
	counterTtlSeconds: 90,
	claimHours: 6,
	dailyCap: 3,
	stampMinimum: 30_000,
	pointUnit: 10_000,
	lockAfter: 5,
	lockMinutes: 15,
} as const;

const DEMO_PHONE = {
	member: "0900001234",
	second: "0900005678",
	capped: "0900003333",
	suspended: "0900004444",
	staff: "0900000000",
} as const;

/** member codes the demo knows: each is single use, like the real dynamic code */
export const DEMO_BILL_CODES = {
	member: ["246810", "246811", "246812", "246813"],
	second: ["112358"],
	suspended: "444444",
	staffPhone: "000111",
	expired: "135790",
	otherStore: "975310",
} as const;

/** the seeded bills of the staff-mode store, for the tests and the e2e */
export const DEMO_BILLS = {
	awaiting: "HD-0031",
	mine: "HD-0029",
	old: "HD-0022",
	overApproval: "HD-0027",
	ownDisagreement: "HD-0025",
	audited: "HD-0019",
	claimHoa: "HD-0033",
	claimMinh: "HD-0034",
} as const;

export const DEMO_CLAIM_TOTALS: Readonly<Record<string, number>> = {
	[DEMO_BILLS.claimHoa]: 65_000,
	[DEMO_BILLS.claimMinh]: 240_000,
};

const MINUTE = 60_000;
const DEMO_CARD_STAMPS: Readonly<Record<string, number>> = {
	[DEMO_PHONE.member]: 5,
	[DEMO_PHONE.second]: 7,
};
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface DemoRedemption {
	readonly storeId: string;
	readonly phone: string;
	readonly discountName: string | null;
}

export interface DemoBillsOptions {
	readonly storeMode: DemoStoreMode;
	readonly role: MemberRole;
	readonly clock?: () => Date;
	readonly delayMs?: number;
	/** the evidence the store needs: 2 (the customer's blind total, the default) or 0 (the staff total confirms) */
	readonly requiredLevel?: 0 | 2;
	readonly selfClaim?: boolean;
	readonly redemptionOf?: (id: string) => DemoRedemption | undefined;
}

export interface DemoBillsClient extends BillsClient {
	modeOf(storeId: string): StoreMode;
	/** the customer's blind total in the customer app */
	customerConfirm(
		billId: string,
		total: number,
	): "confirmed" | "queued" | "refused";
	/** "Không đúng" in the customer app */
	customerDispute(billId: string): "reversed" | "refused";
	/** a claim sent with the counter QR, waiting for a staff member */
	customerClaim(
		storeId: string,
		claim: { billNo: string; total: number; phone: string },
	): string;
}

interface DemoBill {
	readonly id: string;
	readonly storeId: string;
	readonly createdAt: string;
	readonly billNo: string;
	readonly source: BillSource;
	readonly phone: string;
	readonly displayName: string | null;
	state: BillState;
	queueReason: QueueReason | null;
	reversalReason: ReversalReason | null;
	evidenceLevel: number;
	byMe: boolean;
	recordedByName: string | null;
	staffTotal: number | null;
	customerTotal: number | null;
	confirmedAt: string | null;
	confirmBy: string;
	stamps: number;
	points: number;
}

interface DemoAudit {
	readonly id: string;
	readonly billId: string;
	readonly storeId: string;
	readonly openedAt: string;
	state: "open" | "passed" | "failed";
}

interface DemoRedemptionState {
	state: "confirmed" | "cancelled";
	readonly confirmedAt: string;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function refuse(code: string, status = 400): never {
	throw new RestError(status, code);
}

function billKey(billNo: string): string {
	return billNo.trim().toUpperCase().replace(/^0+/, "");
}

function earnOf(total: number): { stamps: number; points: number } {
	return {
		stamps: total >= DEMO_BILL_KNOBS.stampMinimum ? 1 : 0,
		points: Math.floor(total / DEMO_BILL_KNOBS.pointUnit),
	};
}

function checkedReason(reason: string | null): string {
	const trimmed = (reason ?? "").trim();
	if (
		trimmed === "" ||
		trimmed.length > MAX_BILL_REASON_LENGTH ||
		/\p{Cc}/u.test(trimmed)
	)
		refuse(REFUSAL.invalid);
	return trimmed;
}

function checkedTotal(total: number): number {
	if (!Number.isFinite(total) || total <= 0 || total > MAX_BILL_TOTAL)
		refuse(REFUSAL.invalid);
	return total;
}

export function demoStoreModeFrom(search: string): DemoStoreMode {
	return new URLSearchParams(search).get("storeMode") === "staff"
		? "staff"
		: "pos_sync";
}

export function createDemoBillsClient(
	options: DemoBillsOptions,
): DemoBillsClient {
	const clock = options.clock ?? (() => new Date());
	const role = options.role;
	const manager = canManage(role);
	const requiredLevel = options.requiredLevel ?? 2;
	const selfClaim = options.selfClaim ?? true;
	const bills: DemoBill[] = [];
	const audits: DemoAudit[] = [];
	const usedCodes = new Set<string>();
	const redemptions = new Map<string, DemoRedemptionState>();
	const seeded = new Set<string>();
	let failedCodes = 0;
	let lockedUntil = 0;
	let sequence = 500;
	let counter: {
		token: string;
		issuedAt: number;
		expiresAt: number;
	} | null = null;
	const next = (kind: string) => {
		sequence += 1;
		return `00000000-0000-4000-8000-${kind}${String(sequence).padStart(12 - kind.length, "0")}`;
	};
	const pause = () =>
		(options.delayMs ?? 0) > 0 ? wait(options.delayMs ?? 0) : Promise.resolve();
	const at = (minutesAgo: number) =>
		new Date(clock().getTime() - minutesAgo * MINUTE).toISOString();
	const plus = (iso: string, minutes: number) =>
		new Date(Date.parse(iso) + minutes * MINUTE).toISOString();

	function modeOf(storeId: string): StoreMode {
		return options.storeMode === "staff" && storeId === DEMO_STAFF_STORE_ID
			? "staff"
			: "pos_sync";
	}

	function managerOnly(): void {
		if (!manager) refuse(REFUSAL.notAllowed, 403);
	}

	function seed(storeId: string): void {
		if (seeded.has(storeId) || modeOf(storeId) !== "staff") return;
		seeded.add(storeId);
		const make = (
			minutesAgo: number,
			fields: Partial<DemoBill> &
				Pick<DemoBill, "billNo" | "phone" | "state" | "source">,
		): DemoBill => {
			const createdAt = at(minutesAgo);
			const total = fields.staffTotal ?? fields.customerTotal ?? 100_000;
			const bill: DemoBill = {
				id: next("ba"),
				storeId,
				createdAt,
				displayName: null,
				queueReason: null,
				reversalReason: null,
				evidenceLevel: 0,
				byMe: false,
				recordedByName: DEMO_OTHER_STAFF,
				staffTotal: null,
				customerTotal: null,
				confirmedAt: null,
				confirmBy: plus(createdAt, DEMO_BILL_KNOBS.unconfirmedHours * 60),
				...earnOf(total),
				...fields,
			};
			bills.push(bill);
			return bill;
		};
		make(12, {
			billNo: DEMO_BILLS.awaiting,
			phone: DEMO_PHONE.second,
			state: "awaiting_customer",
			source: "staff_scan",
			staffTotal: 185_000,
		});
		make(50, {
			billNo: DEMO_BILLS.mine,
			phone: DEMO_PHONE.second,
			state: "confirmed",
			source: "staff_scan",
			evidenceLevel: 2,
			staffTotal: 95_000,
			customerTotal: 95_000,
			byMe: true,
			recordedByName: DEMO_MY_NAME,
			confirmedAt: at(45),
		});
		make(10 * 60, {
			billNo: DEMO_BILLS.old,
			phone: DEMO_PHONE.capped,
			state: "confirmed",
			source: "staff_scan",
			evidenceLevel: 2,
			staffTotal: 70_000,
			customerTotal: 70_000,
			confirmedAt: at(10 * 60 - 5),
		});
		make(25, {
			billNo: DEMO_BILLS.overApproval,
			phone: DEMO_PHONE.second,
			state: "queued",
			queueReason: "over_approval",
			source: "staff_scan",
			staffTotal: 1_250_000,
		});
		make(40, {
			billNo: DEMO_BILLS.ownDisagreement,
			phone: DEMO_PHONE.capped,
			state: "queued",
			queueReason: "disagreement",
			source: "staff_scan",
			staffTotal: 150_000,
			customerTotal: 105_000,
			byMe: true,
			recordedByName: DEMO_MY_NAME,
		});
		const audited = make(6 * 60, {
			billNo: DEMO_BILLS.audited,
			phone: DEMO_PHONE.second,
			state: "confirmed",
			source: "staff_scan",
			evidenceLevel: 2,
			staffTotal: 120_000,
			customerTotal: 120_000,
			confirmedAt: at(6 * 60 - 3),
		});
		audits.push({
			id: next("aa"),
			billId: audited.id,
			storeId,
			openedAt: at(5 * 60),
			state: "open",
		});
		for (const [minutes, billNo, phone, name] of [
			[3, DEMO_BILLS.claimHoa, DEMO_PHONE.second, "Chị Hoa"],
			[1, DEMO_BILLS.claimMinh, DEMO_PHONE.capped, null],
		] as const) {
			const createdAt = at(minutes);
			make(minutes, {
				billNo,
				phone,
				displayName: name,
				state: "awaiting_staff",
				source: "counter_claim",
				customerTotal: DEMO_CLAIM_TOTALS[billNo] ?? null,
				recordedByName: null,
				confirmBy: plus(createdAt, DEMO_BILL_KNOBS.claimHours * 60),
				stamps: 0,
				points: 0,
			});
		}
	}

	function storeBills(storeId: string): DemoBill[] {
		seed(storeId);
		return bills.filter((bill) => bill.storeId === storeId);
	}

	function billById(id: string): DemoBill {
		const bill = bills.find((candidate) => candidate.id === id);
		if (bill === undefined) refuse(REFUSAL.notAllowed, 403);
		return bill;
	}

	/** the member behind a live code; the code is spent only when a bill is recorded with it */
	function memberOfCode(code: string): {
		readonly digits: string;
		readonly phone?: string;
		readonly refusal?: BillRefusal;
	} {
		const match = MEMBER_PAYLOAD.exec(code.trim());
		const digits = match?.[1] ?? code.trim();
		if (!/^\d{6}$/.test(digits)) refuse(REFUSAL.invalid);
		if (digits === DEMO_BILL_CODES.expired)
			return { digits, refusal: "code_expired" };
		if (digits === DEMO_BILL_CODES.otherStore)
			return { digits, refusal: "wrong_store" };
		if (usedCodes.has(digits)) return { digits, refusal: "code_used" };
		let phone: string | undefined;
		if ((DEMO_BILL_CODES.member as readonly string[]).includes(digits))
			phone = DEMO_PHONE.member;
		else if ((DEMO_BILL_CODES.second as readonly string[]).includes(digits))
			phone = DEMO_PHONE.second;
		else if (digits === DEMO_BILL_CODES.suspended) phone = DEMO_PHONE.suspended;
		else if (digits === DEMO_BILL_CODES.staffPhone) phone = DEMO_PHONE.staff;
		if (phone === undefined) return { digits, refusal: "code_unknown" };
		return { digits, phone };
	}

	function live(bill: DemoBill): boolean {
		return bill.state !== "rejected" && bill.state !== "expired";
	}

	function precheck(
		storeId: string,
		phone: string,
		billNo: string,
		total: number,
		exclude: DemoBill | null,
	): BillRefusal | null {
		if (modeOf(storeId) !== "staff") return "not_staff_mode";
		if (phone === DEMO_PHONE.suspended) return "membership_inactive";
		if (phone === DEMO_PHONE.staff) return "staff_phone";
		if (total > DEMO_BILL_KNOBS.maxBill) return "over_bill_limit";
		const today = storeBills(storeId).filter(
			(bill) => bill !== exclude && live(bill),
		);
		if (exclude === null) {
			const known = today.find(
				(bill) => billKey(bill.billNo) === billKey(billNo),
			);
			if (known !== undefined) {
				const knownTotal = known.staffTotal ?? known.customerTotal ?? 0;
				return Math.abs(knownTotal - total) > DEMO_BILL_KNOBS.tolerance
					? "bill_conflict"
					: "bill_used";
			}
			const earns = today.filter(
				(bill) =>
					bill.phone === phone &&
					bill.state !== "reversed" &&
					bill.state !== "awaiting_staff",
			).length;
			if (earns >= DEMO_BILL_KNOBS.dailyCap) return "daily_limit";
		}
		const earn = earnOf(total);
		if (earn.stamps === 0 && earn.points === 0) return "below_minimum";
		return null;
	}

	function evaluate(bill: DemoBill, total: number): "confirmed" | "queued" {
		const now = clock().toISOString();
		if (total > DEMO_BILL_KNOBS.approvalAbove) {
			bill.state = "queued";
			bill.queueReason = "over_approval";
			return "queued";
		}
		bill.state = "confirmed";
		bill.confirmedAt = now;
		return "confirmed";
	}

	function reverseBill(bill: DemoBill, reason: ReversalReason): void {
		bill.state = "reversed";
		bill.reversalReason = reason;
		bill.queueReason = null;
	}

	function reverseUntil(bill: DemoBill): string {
		return plus(
			bill.confirmedAt ?? bill.createdAt,
			DEMO_BILL_KNOBS.reverseWindowMinutes,
		);
	}

	function recent(bill: DemoBill): RecentBill {
		const until = reverseUntil(bill);
		return {
			id: bill.id,
			createdAt: bill.createdAt,
			billNo: bill.billNo,
			total: bill.staffTotal ?? bill.customerTotal ?? 0,
			source: bill.source,
			state: bill.state,
			queueReason: bill.queueReason,
			reversalReason: bill.reversalReason,
			evidenceLevel: bill.evidenceLevel,
			byMe: bill.byMe,
			recordedByName: bill.recordedByName,
			phoneMasked: maskPhone(bill.phone),
			stamps: bill.stamps,
			points: bill.points,
			reverseUntil: until,
			reversible:
				manager &&
				(bill.state === "confirmed" || bill.state === "awaiting_customer") &&
				clock().getTime() <= Date.parse(until),
			shadowState: null,
		};
	}

	function storeMode(storeId: string): StoreBillMode {
		const mode = modeOf(storeId);
		return {
			mode,
			selfClaim: mode === "staff" && selfClaim,
			isManager: manager,
		};
	}

	function token(): string {
		let value = sequence * 7_919 + clock().getTime();
		let out = "";
		for (let index = 0; index < 12; index += 1) {
			out += TOKEN_ALPHABET[value % TOKEN_ALPHABET.length];
			value = Math.floor(value / TOKEN_ALPHABET.length) + index * 31 + 17;
		}
		sequence += 1;
		return out;
	}

	return {
		modeOf,
		async submit(input): Promise<SubmitAnswer> {
			await pause();
			checkedTotal(input.total);
			const billNo = input.billNo.trim();
			if (billNo === "" || billNo.length > 40 || /[\s\p{Cc}]/u.test(billNo))
				refuse(REFUSAL.invalid);
			if (modeOf(input.storeId) !== "staff")
				return { outcome: "refused", refusal: "not_staff_mode", retryAt: null };
			const now = clock();
			if (now.getTime() < lockedUntil)
				return {
					outcome: "refused",
					refusal: "locked",
					retryAt: new Date(lockedUntil).toISOString(),
				};
			const member = memberOfCode(input.code);
			if (member.refusal !== undefined || member.phone === undefined) {
				const refusal = member.refusal ?? "code_unknown";
				if (refusal === "code_unknown" || refusal === "wrong_store") {
					failedCodes += 1;
					if (failedCodes >= DEMO_BILL_KNOBS.lockAfter)
						lockedUntil = now.getTime() + DEMO_BILL_KNOBS.lockMinutes * MINUTE;
				}
				return { outcome: "refused", refusal, retryAt: null };
			}
			const refusal = precheck(
				input.storeId,
				member.phone,
				billNo,
				input.total,
				null,
			);
			if (refusal !== null)
				return { outcome: "refused", refusal, retryAt: null };
			usedCodes.add(member.digits);
			const createdAt = now.toISOString();
			const earn = earnOf(input.total);
			const bill: DemoBill = {
				id: next("bb"),
				storeId: input.storeId,
				createdAt,
				billNo,
				source: "staff_scan",
				phone: member.phone,
				displayName: null,
				state: "awaiting_customer",
				queueReason: null,
				reversalReason: null,
				evidenceLevel: 0,
				byMe: true,
				recordedByName: DEMO_MY_NAME,
				staffTotal: input.total,
				customerTotal: null,
				confirmedAt: null,
				confirmBy: plus(createdAt, DEMO_BILL_KNOBS.unconfirmedHours * 60),
				...earn,
			};
			bills.push(bill);
			if (input.total > DEMO_BILL_KNOBS.approvalAbove) {
				bill.state = "queued";
				bill.queueReason = "over_approval";
			} else if (requiredLevel === 0) {
				bill.state = "confirmed";
				bill.confirmedAt = createdAt;
			}
			return {
				outcome: "recorded",
				billId: bill.id,
				state: bill.state as "awaiting_customer" | "confirmed" | "queued",
				evidenceLevel: bill.evidenceLevel,
				stampsEarned: earn.stamps,
				pointsEarned: earn.points,
				recordedAt: createdAt,
				confirmBy: bill.state === "awaiting_customer" ? bill.confirmBy : null,
				reverseUntil: plus(createdAt, DEMO_BILL_KNOBS.reverseWindowMinutes),
				member: {
					membershipId: null,
					phoneMasked: maskPhone(member.phone),
					displayName: null,
					stamps: DEMO_CARD_STAMPS[member.phone] ?? 0,
					stampsPerCard: 8,
					points: null,
				},
			};
		},
		async recent(storeId) {
			await pause();
			const mode = storeMode(storeId);
			const since = clock().getTime() - 24 * 60 * MINUTE;
			return {
				...mode,
				bills: storeBills(storeId)
					.filter(
						(bill) =>
							Date.parse(bill.createdAt) > since &&
							Date.parse(bill.createdAt) <= clock().getTime() &&
							(manager || bill.byMe),
					)
					.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
					.map(recent),
			};
		},
		async mode(storeId) {
			await pause();
			return storeMode(storeId);
		},
		async reverse(billId, reason): Promise<ReverseAnswer> {
			await pause();
			managerOnly();
			checkedReason(reason);
			const bill = billById(billId);
			if (bill.state !== "confirmed" && bill.state !== "awaiting_customer")
				return { state: "refused", refusal: "not_reversible" };
			if (clock().getTime() > Date.parse(reverseUntil(bill)))
				return { state: "refused", refusal: "window_passed" };
			reverseBill(bill, "manager_reversed");
			return { state: "reversed" };
		},
		async counterCode(storeId): Promise<CounterCode> {
			await pause();
			if (!storeMode(storeId).selfClaim)
				return { state: "refused", refusal: "not_available" };
			const now = clock().getTime();
			const ttl = DEMO_BILL_KNOBS.counterTtlSeconds * 1000;
			if (counter === null || counter.expiresAt - now <= ttl / 2)
				counter = { token: token(), issuedAt: now, expiresAt: now + ttl };
			return {
				state: "ready",
				qrPayload: `fnb-counter:1:${DEMO_STORE_CODE}:${counter.token}`,
				expiresAt: new Date(counter.expiresAt).toISOString(),
				refreshAt: new Date(counter.issuedAt + ttl / 2).toISOString(),
			};
		},
		async counterClaims(storeId): Promise<CounterClaim[]> {
			await pause();
			const now = clock().getTime();
			return storeBills(storeId)
				.filter(
					(bill) =>
						bill.state === "awaiting_staff" &&
						Date.parse(bill.confirmBy) > now &&
						Date.parse(bill.createdAt) <= now,
				)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
				.map((bill) => ({
					id: bill.id,
					createdAt: bill.createdAt,
					expiresAt: bill.confirmBy,
					billNo: bill.billNo,
					phoneMasked: maskPhone(bill.phone),
					displayName: bill.displayName,
				}));
		},
		async answerClaim(reply): Promise<ClaimAnswer> {
			await pause();
			const bill = billById(reply.billId);
			if (bill.source !== "counter_claim") refuse(REFUSAL.notAllowed, 403);
			const total = "total" in reply ? checkedTotal(reply.total) : null;
			const reason =
				"rejectReason" in reply ? checkedReason(reply.rejectReason) : null;
			if ((total === null) === (reason === null)) refuse(REFUSAL.invalid);
			if (bill.state !== "awaiting_staff")
				return { state: "refused", refusal: "already_answered" };
			if (Date.parse(bill.confirmBy) <= clock().getTime())
				return { state: "refused", refusal: "expired" };
			if (reason !== null || total === null) {
				bill.state = "rejected";
				return {
					state: "rejected",
					evidenceLevel: null,
					stampsEarned: 0,
					pointsEarned: 0,
				};
			}
			const refusal = precheck(
				bill.storeId,
				bill.phone,
				bill.billNo,
				total,
				bill,
			);
			if (refusal !== null) return { state: "refused", refusal };
			const agrees =
				Math.abs((bill.customerTotal ?? 0) - total) <=
				DEMO_BILL_KNOBS.tolerance;
			bill.staffTotal = total;
			bill.byMe = true;
			bill.recordedByName = DEMO_MY_NAME;
			const earn = earnOf(bill.customerTotal ?? total);
			bill.stamps = earn.stamps;
			bill.points = earn.points;
			if (agrees) {
				bill.evidenceLevel = 2;
				const state = evaluate(bill, total);
				return {
					state,
					evidenceLevel: 2,
					stampsEarned: earn.stamps,
					pointsEarned: earn.points,
				};
			}
			bill.state = "queued";
			bill.queueReason = "disagreement";
			return {
				state: "queued",
				evidenceLevel: bill.evidenceLevel,
				stampsEarned: earn.stamps,
				pointsEarned: earn.points,
			};
		},
		async queue(storeId) {
			await pause();
			managerOnly();
			const list = storeBills(storeId);
			const queued: QueuedBill[] = list
				.filter((bill) => bill.state === "queued" && bill.queueReason !== null)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
				.map((bill) => ({
					id: bill.id,
					createdAt: bill.createdAt,
					billNo: bill.billNo,
					source: bill.source,
					queueReason: bill.queueReason as QueueReason,
					evidenceLevel: bill.evidenceLevel,
					staffTotal: bill.staffTotal,
					customerTotal: bill.customerTotal,
					recordedByName: bill.recordedByName,
					own: bill.byMe,
					phoneMasked: maskPhone(bill.phone),
				}));
			const open: BillAudit[] = audits
				.filter((audit) => audit.storeId === storeId && audit.state === "open")
				.sort((a, b) => a.openedAt.localeCompare(b.openedAt))
				.map((audit) => {
					const bill = billById(audit.billId);
					return {
						id: audit.id,
						billId: bill.id,
						openedAt: audit.openedAt,
						billNo: bill.billNo,
						total: bill.staffTotal ?? bill.customerTotal ?? 0,
						evidenceLevel: bill.evidenceLevel,
						hasPhoto: false,
						recordedByName: bill.recordedByName,
						phoneMasked: maskPhone(bill.phone),
					};
				});
			return { bills: queued, audits: open };
		},
		async decide(billId, decision, reason): Promise<DecideAnswer> {
			await pause();
			managerOnly();
			checkedReason(reason);
			const bill = billById(billId);
			if (bill.state !== "queued")
				return { state: "refused", refusal: "not_queued" };
			if (decision === "approved" && bill.byMe && role !== "owner")
				return { state: "refused", refusal: "own_bill" };
			if (decision === "approved") {
				bill.state = "confirmed";
				bill.queueReason = null;
				bill.confirmedAt = clock().toISOString();
			} else reverseBill(bill, "manager_rejected");
			return { state: decision, billState: bill.state };
		},
		async closeAudit(auditId, result, note): Promise<AuditAnswer> {
			await pause();
			managerOnly();
			if (result === "failed" || (note !== null && note.trim() !== ""))
				checkedReason(note);
			const audit = audits.find((candidate) => candidate.id === auditId);
			if (audit === undefined) refuse(REFUSAL.notAllowed, 403);
			if (audit.state !== "open")
				return { state: "refused", refusal: "closed" };
			const bill = billById(audit.billId);
			if (result === "passed" && bill.byMe && role !== "owner")
				return { state: "refused", refusal: "own_bill" };
			audit.state = result;
			if (result === "failed") reverseBill(bill, "audit_failed");
			return { state: result };
		},
		async confirmRedemption(redemptionId): Promise<ConfirmRedemptionAnswer> {
			await pause();
			const redemption = options.redemptionOf?.(redemptionId);
			if (redemption === undefined) refuse(REFUSAL.notAllowed, 403);
			if (modeOf(redemption.storeId) !== "staff")
				return { state: "refused", refusal: "not_staff_mode" };
			const known = redemptions.get(redemptionId);
			if (known?.state === "confirmed")
				return { state: "refused", refusal: "used" };
			if (known?.state === "cancelled")
				return { state: "refused", refusal: "released" };
			const since = clock().getTime() - 24 * 60 * MINUTE;
			if (
				storeBills(redemption.storeId).some(
					(bill) =>
						bill.byMe &&
						bill.phone === redemption.phone &&
						Date.parse(bill.createdAt) > since &&
						live(bill) &&
						bill.state !== "reversed",
				)
			)
				return { state: "refused", refusal: "same_staff" };
			const confirmedAt = clock().toISOString();
			redemptions.set(redemptionId, { state: "confirmed", confirmedAt });
			return {
				state: "confirmed",
				voidUntil: plus(confirmedAt, DEMO_BILL_KNOBS.reverseWindowMinutes),
				posDiscountName: redemption.discountName,
			};
		},
		async voidRedemption(redemptionId, reason): Promise<VoidRedemptionAnswer> {
			await pause();
			managerOnly();
			checkedReason(reason);
			const known = redemptions.get(redemptionId);
			if (known?.state === "cancelled")
				return { state: "refused", refusal: "already_voided" };
			if (known === undefined)
				return { state: "refused", refusal: "not_staff_confirmed" };
			if (
				clock().getTime() >
				Date.parse(
					plus(known.confirmedAt, DEMO_BILL_KNOBS.reverseWindowMinutes),
				)
			)
				return { state: "refused", refusal: "window_passed" };
			known.state = "cancelled";
			return { state: "voided" };
		},
		customerConfirm(billId, total) {
			const bill = billById(billId);
			if (bill.state !== "awaiting_customer" || bill.customerTotal !== null)
				return "refused";
			bill.customerTotal = total;
			if (
				Math.abs((bill.staffTotal ?? 0) - total) > DEMO_BILL_KNOBS.tolerance
			) {
				bill.state = "queued";
				bill.queueReason = "disagreement";
				return "queued";
			}
			bill.evidenceLevel = 2;
			return evaluate(bill, bill.staffTotal ?? total);
		},
		customerDispute(billId) {
			const bill = billById(billId);
			if (bill.state !== "awaiting_customer" || bill.customerTotal !== null)
				return "refused";
			reverseBill(bill, "disputed");
			return "reversed";
		},
		customerClaim(storeId, claim) {
			seed(storeId);
			const createdAt = clock().toISOString();
			const bill: DemoBill = {
				id: next("bc"),
				storeId,
				createdAt,
				billNo: claim.billNo,
				source: "counter_claim",
				phone: claim.phone,
				displayName: null,
				state: "awaiting_staff",
				queueReason: null,
				reversalReason: null,
				evidenceLevel: 0,
				byMe: false,
				recordedByName: null,
				staffTotal: null,
				customerTotal: claim.total,
				confirmedAt: null,
				confirmBy: plus(createdAt, DEMO_BILL_KNOBS.claimHours * 60),
				stamps: 0,
				points: 0,
			};
			bills.push(bill);
			return bill.id;
		},
	};
}
