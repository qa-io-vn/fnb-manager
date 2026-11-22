import type {
	LoyaltyParameters,
	LoyaltyRefusalReason,
} from "../schemas/loyalty.js";

export function normalizeLoyaltyPhone(
	value: string | null | undefined,
): string | null {
	let phone = (value ?? "").replace(/[\s().-]/g, "");
	if (phone === "") {
		return null;
	}
	if (phone.startsWith("00")) {
		phone = `+${phone.slice(2)}`;
	} else if (/^0[1-9][0-9]{8,9}$/.test(phone)) {
		phone = `+84${phone.slice(1)}`;
	} else if (/^84[1-9][0-9]{8,9}$/.test(phone)) {
		phone = `+${phone}`;
	}
	return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}

export type EarnParameters = Pick<
	LoyaltyParameters,
	| "stampMinBillAmount"
	| "pointUnitAmount"
	| "pointsPerUnit"
	| "welcomeStamps"
	| "earningInvoicesPerPhonePerDay"
	| "excludedOrderSources"
>;

export interface EarnAmounts {
	readonly stamps: number;
	readonly points: number;
}

export function earnForAmount(
	netAmount: number,
	parameters: Pick<
		EarnParameters,
		"stampMinBillAmount" | "pointUnitAmount" | "pointsPerUnit"
	>,
): EarnAmounts {
	const stamps = netAmount >= parameters.stampMinBillAmount ? 1 : 0;
	const units = Math.max(Math.floor(netAmount / parameters.pointUnitAmount), 0);
	return { stamps, points: units * parameters.pointsPerUnit };
}

export type ReplayInvoiceStatus = "completed" | "edited" | "voided";

export interface ReplayInvoice {
	readonly externalId: string;
	readonly businessDate: string;
	readonly soldAt: string;
	readonly netAmount: number;
	readonly phone: string | null;
	readonly source: string | null;
	readonly status: ReplayInvoiceStatus;
	readonly voidedLater: boolean;
	/**
	 * When the clawback of a voided earn is written. A clawed-back earn does
	 * not count toward the daily cap from that moment on (the SQL rule, G-42).
	 * Left out, the void is taken to come after every sale of the replay, so the
	 * earn still counted when later invoices were decided.
	 */
	readonly voidedAt?: string | null;
}

export interface LedgerReplayInput {
	readonly parameters: EarnParameters;
	readonly members: readonly string[];
	readonly staffPhones: readonly string[];
	readonly invoices: readonly ReplayInvoice[];
}

export interface MemberTotals {
	stamps: number;
	points: number;
	earns: number;
	clawbacks: number;
}

export type RefusalCounts = Record<LoyaltyRefusalReason, number>;

export interface ExpectedLedger {
	readonly earns: number;
	readonly clawbacks: number;
	readonly stamps: number;
	readonly points: number;
	readonly refusals: RefusalCounts;
	readonly members: Readonly<Record<string, MemberTotals>>;
}

function emptyRefusals(): RefusalCounts {
	return {
		below_minimum: 0,
		daily_cap: 0,
		excluded_phone: 0,
		excluded_source: 0,
		already_earned: 0,
		invoice_not_completed: 0,
		programme_inactive: 0,
		membership_inactive: 0,
		staff_mode: 0,
	};
}

function compareInvoices(left: ReplayInvoice, right: ReplayInvoice): number {
	const byTime = Date.parse(left.soldAt) - Date.parse(right.soldAt);
	if (byTime !== 0) {
		return byTime;
	}
	if (left.externalId === right.externalId) {
		return 0;
	}
	return left.externalId < right.externalId ? -1 : 1;
}

export function computeExpectedLedger(
	input: LedgerReplayInput,
): ExpectedLedger {
	const { parameters } = input;
	const staff = new Set(input.staffPhones);
	const excludedSources = new Set(
		parameters.excludedOrderSources.map((source) => source.toLowerCase()),
	);
	const members = new Map<string, MemberTotals>();
	for (const phone of input.members) {
		members.set(phone, {
			stamps: staff.has(phone) ? 0 : parameters.welcomeStamps,
			points: 0,
			earns: 0,
			clawbacks: 0,
		});
	}
	const refusals = emptyRefusals();
	// Per phone and business date: the earns that count, each with the moment its
	// clawback is written (Infinity when it never is within the replay).
	const earnedPerDay = new Map<string, number[]>();
	const earnsByInvoice = new Map<string, { phone: string } & EarnAmounts>();
	let earns = 0;
	for (const invoice of [...input.invoices].sort(compareInvoices)) {
		const member =
			invoice.phone === null ? undefined : members.get(invoice.phone);
		if (invoice.phone === null || member === undefined) {
			continue;
		}
		const dayKey = `${invoice.phone}|${invoice.businessDate}`;
		let refusal: LoyaltyRefusalReason | null = null;
		if (invoice.status !== "completed") {
			refusal = "invoice_not_completed";
		} else if (
			invoice.source !== null &&
			excludedSources.has(invoice.source.trim().toLowerCase())
		) {
			refusal = "excluded_source";
		} else if (staff.has(invoice.phone)) {
			refusal = "excluded_phone";
		} else if (
			(earnedPerDay.get(dayKey) ?? []).filter(
				(clawedAt) => clawedAt > Date.parse(invoice.soldAt),
			).length >= parameters.earningInvoicesPerPhonePerDay
		) {
			refusal = "daily_cap";
		}
		if (refusal !== null) {
			refusals[refusal] += 1;
			continue;
		}
		const amounts = earnForAmount(invoice.netAmount, parameters);
		if (amounts.stamps === 0) {
			refusals.below_minimum += 1;
		}
		if (amounts.stamps === 0 && amounts.points === 0) {
			continue;
		}
		member.stamps += amounts.stamps;
		member.points += amounts.points;
		member.earns += 1;
		earns += 1;
		earnedPerDay.set(dayKey, [
			...(earnedPerDay.get(dayKey) ?? []),
			invoice.voidedLater && invoice.voidedAt
				? Date.parse(invoice.voidedAt)
				: Number.POSITIVE_INFINITY,
		]);
		earnsByInvoice.set(invoice.externalId, {
			phone: invoice.phone,
			...amounts,
		});
	}
	let clawbacks = 0;
	for (const invoice of input.invoices) {
		const earned = earnsByInvoice.get(invoice.externalId);
		if (!invoice.voidedLater || earned === undefined) {
			continue;
		}
		const member = members.get(earned.phone);
		if (member === undefined) {
			continue;
		}
		member.stamps -= earned.stamps;
		member.points -= earned.points;
		member.clawbacks += 1;
		clawbacks += 1;
	}
	let stamps = 0;
	let points = 0;
	const totals: Record<string, MemberTotals> = {};
	for (const [phone, member] of [...members.entries()].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		stamps += member.stamps;
		points += member.points;
		totals[phone] = member;
	}
	return { earns, clawbacks, stamps, points, refusals, members: totals };
}

export interface LiabilityInput {
	readonly outstandingPoints: number;
	readonly pointValueAmount: number;
	readonly expectedBreakageRate: number;
}

function scaled(value: number, factor: number, what: string): bigint {
	const exact = Math.round(value * factor);
	if (!Number.isFinite(value) || Math.abs(value * factor - exact) > 1e-6) {
		throw new RangeError(
			`${what} has more than ${Math.log10(factor)} decimals`,
		);
	}
	return BigInt(exact);
}

/**
 * The liability in hundredths (cents) as the database computes it, exactly:
 * `round(points * point_value_amount * (1 - rate), 2)` over `numeric(14,2)` and
 * `numeric(4,3)`, half away from zero. Integers only, so no float error can move
 * a half-cent: 1 point at 0.29 with a 0.5 rate is 0.145, which floats read as
 * 14.499999999999998 hundredths.
 */
export function pointsLiabilityCents(input: LiabilityInput): number {
	if (!Number.isSafeInteger(input.outstandingPoints)) {
		throw new RangeError("outstanding points are a whole number");
	}
	const thousandthsOfACent =
		BigInt(input.outstandingPoints) *
		scaled(input.pointValueAmount, 100, "the point value") *
		(1000n - scaled(input.expectedBreakageRate, 1000, "the breakage rate"));
	const magnitude =
		thousandthsOfACent < 0n ? -thousandthsOfACent : thousandthsOfACent;
	const cents = (magnitude + 500n) / 1000n;
	if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError("the liability does not fit a safe integer of cents");
	}
	return Number(thousandthsOfACent < 0n ? -cents : cents);
}

/** An amount in hundredths as the text `numeric(14,2)` prints, e.g. `7600.00`. */
export function formatCents(cents: number): string {
	const magnitude = Math.abs(cents);
	const whole = Math.trunc(magnitude / 100);
	const fraction = String(magnitude - whole * 100).padStart(2, "0");
	return `${cents < 0 ? "-" : ""}${whole}.${fraction}`;
}

/** A rate in thousandths as the text `numeric(4,3)` prints, e.g. `0.250`. */
export function formatThousandths(milli: number): string {
	return `${Math.trunc(milli / 1000)}.${String(milli % 1000).padStart(3, "0")}`;
}

/**
 * The observed breakage rate in thousandths: expired points over redeemed and
 * expired points, rounded half up to three decimals and capped at 1.
 */
export function observedBreakageMilli(
	expiredPoints: number,
	spentPoints: number,
): number {
	if (spentPoints <= 0) {
		throw new RangeError("an observed rate needs redeemed or expired points");
	}
	const milli = Math.floor(
		(2 * expiredPoints * 1000 + spentPoints) / (2 * spentPoints),
	);
	return Math.min(milli, 1000);
}

export function pointsLiability(input: LiabilityInput): number {
	return pointsLiabilityCents(input) / 100;
}

/** A configured rate such as 0.2 as thousandths (200), refusing a fourth decimal. */
export function breakageRateMilli(rate: number): number {
	return Number(scaled(rate, 1000, "the breakage rate"));
}

/** An amount such as 500 or 123.45 as hundredths, refusing a third decimal. */
export function amountCents(amount: number): number {
	return Number(scaled(amount, 100, "the amount"));
}
