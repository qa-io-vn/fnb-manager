import {
	formatIsoDate,
	shiftIsoDate,
	wallClockIn,
	zonedInstant,
} from "./business-date.js";
import {
	type LedgerEntry,
	type LedgerRules,
	REDEMPTION_RELEASED,
} from "./loyalty-ledger.js";
import { addMonthsUtc } from "./loyalty-months.js";
import {
	amountCents,
	breakageRateMilli,
	formatCents,
	formatThousandths,
	observedBreakageMilli,
	pointsLiabilityCents,
} from "./loyalty-rules.js";

export interface LiabilityProgramme {
	/** numeric(14,2) */
	readonly pointValueAmount: number;
	/** numeric(4,3), the rate used until six months of expiry data exist */
	readonly expectedBreakageRate: number;
}

export interface LiabilityCohort {
	/** YYYY-MM, local */
	readonly month: string;
	readonly issued: number;
	readonly expired: number;
}

/** One row of `loyalty_liability_daily`, money and rates as the database prints them. */
export interface LiabilityRow {
	readonly asOfDate: string;
	readonly members: number;
	readonly outstandingPoints: number;
	readonly outstandingStamps: number;
	readonly pointValueAmount: string;
	readonly expectedBreakageRate: string;
	readonly breakageSource: "configured" | "observed";
	readonly liabilityAmount: string;
	readonly pointsIssued: number;
	readonly pointsRedeemed: number;
	readonly pointsExpired: number;
	readonly pointsClawedBack: number;
	readonly deferredRevenueReleasedAmount: string;
	readonly breakageByCohort: readonly LiabilityCohort[];
}

export interface LiabilityInputs {
	readonly entries: readonly LedgerEntry[];
	/** Joined moments by member, so the members counted are those joined by `asOf`. */
	readonly joinedAt: ReadonlyMap<string, number>;
	readonly rules: LedgerRules;
	readonly programme: LiabilityProgramme;
	readonly asOf: number;
}

const FIRST_EXPIRY_MATURITY_MONTHS = 6;
const OBSERVATION_MONTHS = 12;

function localMonth(instant: number, timezone: string): string {
	const wall = wallClockIn(new Date(instant), timezone);
	return `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}`;
}

function monthMinus(month: string, months: number): string {
	const [year, number] = month.split("-").map(Number) as [number, number];
	const total = year * 12 + (number - 1) - months;
	return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * The month an expiry row is reported under when it cannot be traced to the
 * credits it expired: the month of the moment it ran, less the expiry period.
 * It is the issue month only when the run follows the expiry moment within the
 * same month, so it is the fallback of `expiredByIssueMonth`, not the rule.
 */
export function expiryCohortMonth(
	expiredAt: number,
	rules: LedgerRules,
): string {
	return monthMinus(
		localMonth(expiredAt, rules.timezone),
		rules.pointsExpiryMonths,
	);
}

/**
 * The expired points of a programme by the month their credit was issued
 * (ADR-048, G-104). An `expire` row is one row per member and carries no link to
 * an earn, so it is traced the way it was written: first in first out. At the
 * moment of the run the credits past their expiry (net of their clawbacks) are
 * lined up oldest expiry first; every spent point took the front of the line, so
 * the points that expired are the last ones, and each credit is charged with its
 * share of them. A row that cannot be traced (no credit past its expiry, for
 * example an opening balance) is reported under `expiryCohortMonth`.
 */
export function expiredByIssueMonth(
	entries: readonly LedgerEntry[],
	rules: LedgerRules,
	asOf: number,
): Map<string, number> {
	const byMonth = new Map<string, number>();
	const add = (month: string, points: number) => {
		if (points > 0) {
			byMonth.set(month, (byMonth.get(month) ?? 0) + points);
		}
	};
	const upTo = entries.filter((row) => row.occurredAt <= asOf);
	for (const expiry of upTo) {
		if (expiry.kind !== "expire" || expiry.pointDelta >= 0) {
			continue;
		}
		const at = expiry.occurredAt;
		const expired = -expiry.pointDelta;
		const line = upTo
			.filter(
				(credit) =>
					credit.member === expiry.member &&
					credit.pointDelta > 0 &&
					(credit.kind === "earn" || credit.kind === "adjust") &&
					credit.reason !== REDEMPTION_RELEASED &&
					credit.expiresAt !== null &&
					credit.expiresAt <= at &&
					credit.occurredAt <= at,
			)
			.map((credit) => ({
				credit,
				net:
					credit.pointDelta +
					upTo
						.filter(
							(row) =>
								row.kind === "clawback" &&
								row.sourceId === credit.id &&
								row.occurredAt <= at,
						)
						.reduce((sum, row) => sum + row.pointDelta, 0),
			}))
			.sort(
				(a, b) =>
					(a.credit.expiresAt ?? 0) - (b.credit.expiresAt ?? 0) ||
					a.credit.occurredAt - b.credit.occurredAt ||
					a.credit.id - b.credit.id,
			);
		const total = line.reduce((sum, item) => sum + item.net, 0);
		const first = Math.max(total - expired, 0);
		let before = 0;
		let traced = 0;
		for (const { credit, net } of line) {
			const after = before + net;
			const part = Math.max(
				Math.min(after, total) - Math.max(before, first),
				0,
			);
			add(localMonth(credit.occurredAt, rules.timezone), part);
			traced += part;
			before = after;
		}
		add(expiryCohortMonth(at, rules), expired - traced);
	}
	return byMonth;
}

/**
 * The nightly row of `app.loyalty_liability(programme, asOf)`: outstanding
 * confirmed points (the positive balances of the members joined by then) times
 * the point value times one minus the breakage rate, with the flows of the
 * closed previous local day (ADR-048, G-104: a run at 03:23 and one at 23:30 of
 * the same day report the same complete day) and the issued and expired points
 * by issue month. The breakage rate is the
 * configured one until the programme's first expiry is six months old, then
 * expired over redeemed and expired points of the last 12 months.
 */
export function computeLiabilityRow(input: LiabilityInputs): LiabilityRow {
	const { entries, rules, asOf } = input;
	const upTo = entries.filter((row) => row.occurredAt <= asOf);
	const wall = wallClockIn(new Date(asOf), rules.timezone);
	const asOfDate = formatIsoDate(wall.year, wall.month, wall.day);
	const dayStart = zonedInstant(asOfDate, 0, rules.timezone).getTime();
	const flowStart = zonedInstant(
		shiftIsoDate(asOfDate, -1),
		0,
		rules.timezone,
	).getTime();

	const confirmedAt = new Map<number, number>();
	for (const row of upTo) {
		if (row.kind === "confirm" && row.sourceId !== null) {
			confirmedAt.set(row.sourceId, row.occurredAt);
		}
	}
	const unconfirmed = new Set(
		upTo
			.filter(
				(row) => row.kind === "earn" && row.pending && !confirmedAt.has(row.id),
			)
			.map((row) => row.id),
	);
	const balances = new Map<string, { stamps: number; points: number }>();
	for (const [member, joined] of input.joinedAt) {
		if (joined <= asOf) {
			balances.set(member, { stamps: 0, points: 0 });
		}
	}
	for (const row of upTo) {
		const balance = balances.get(row.member);
		const waits =
			unconfirmed.has(row.id) ||
			(row.sourceId !== null && unconfirmed.has(row.sourceId));
		if (balance !== undefined && !waits) {
			balance.stamps += row.stampDelta;
			balance.points += row.pointDelta;
		}
	}
	let outstandingPoints = 0;
	let outstandingStamps = 0;
	for (const balance of balances.values()) {
		outstandingPoints += Math.max(balance.points, 0);
		outstandingStamps += Math.max(balance.stamps, 0);
	}

	const firstExpiry = upTo
		.filter((row) => row.kind === "expire" && row.pointDelta < 0)
		.reduce<number | null>(
			(first, row) =>
				first === null || row.occurredAt < first ? row.occurredAt : first,
			null,
		);
	let rateMilli = breakageRateMilli(input.programme.expectedBreakageRate);
	let breakageSource: "configured" | "observed" = "configured";
	if (
		firstExpiry !== null &&
		firstExpiry <= addMonthsUtc(asOf, -FIRST_EXPIRY_MATURITY_MONTHS)
	) {
		const since = addMonthsUtc(asOf, -OBSERVATION_MONTHS);
		let expired = 0;
		let spent = 0;
		for (const row of upTo) {
			if (row.occurredAt <= since) {
				continue;
			}
			if (row.kind === "expire") {
				expired -= row.pointDelta;
			}
			if (
				row.kind === "redeem" ||
				row.kind === "expire" ||
				(row.kind === "adjust" && row.reason === REDEMPTION_RELEASED)
			) {
				spent -= row.pointDelta;
			}
		}
		if (spent > 0) {
			rateMilli = observedBreakageMilli(expired, spent);
			breakageSource = "observed";
		}
	}

	let pointsIssued = 0;
	let pointsRedeemed = 0;
	let pointsExpired = 0;
	let pointsClawedBack = 0;
	for (const row of upTo) {
		if (row.occurredAt < flowStart || row.occurredAt >= dayStart) {
			continue;
		}
		if (
			row.pointDelta > 0 &&
			(row.kind === "earn" || row.kind === "adjust") &&
			row.reason !== REDEMPTION_RELEASED
		) {
			pointsIssued += row.pointDelta;
		}
		if (
			row.kind === "redeem" ||
			(row.kind === "adjust" && row.reason === REDEMPTION_RELEASED)
		) {
			pointsRedeemed -= row.pointDelta;
		}
		if (row.kind === "expire") {
			pointsExpired -= row.pointDelta;
		}
		if (row.kind === "clawback") {
			pointsClawedBack -= row.pointDelta;
		}
	}

	const cohorts = new Map<string, { issued: number; expired: number }>();
	const cohort = (month: string) => {
		const existing = cohorts.get(month);
		if (existing !== undefined) {
			return existing;
		}
		const created = { issued: 0, expired: 0 };
		cohorts.set(month, created);
		return created;
	};
	for (const row of upTo) {
		if (
			row.pointDelta > 0 &&
			(row.kind === "earn" || row.kind === "adjust") &&
			row.reason !== REDEMPTION_RELEASED
		) {
			cohort(localMonth(row.occurredAt, rules.timezone)).issued +=
				row.pointDelta;
		}
	}
	for (const [month, points] of expiredByIssueMonth(entries, rules, asOf)) {
		cohort(month).expired += points;
	}

	const valueCents = amountCents(input.programme.pointValueAmount);
	return {
		asOfDate,
		members: balances.size,
		outstandingPoints,
		outstandingStamps,
		pointValueAmount: formatCents(valueCents),
		expectedBreakageRate: formatThousandths(rateMilli),
		breakageSource,
		liabilityAmount: formatCents(
			pointsLiabilityCents({
				outstandingPoints,
				pointValueAmount: input.programme.pointValueAmount,
				expectedBreakageRate: rateMilli / 1000,
			}),
		),
		pointsIssued,
		pointsRedeemed,
		pointsExpired,
		pointsClawedBack,
		deferredRevenueReleasedAmount: formatCents(pointsRedeemed * valueCents),
		breakageByCohort: [...cohorts.entries()]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([month, totals]) => ({ month, ...totals })),
	};
}
