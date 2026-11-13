import { shiftIsoDate, wallClockIn } from "@fnb/core";
import type { AnalyticsRow } from "@fnb/reports";

export const DAY_RULE_KEYS = [
	"revenue_below_baseline",
	"ticket_drop",
	"drawer_variance",
	"unverified_day",
	"zero_sales_day",
] as const;

export type DayRuleKey = (typeof DAY_RULE_KEYS)[number];

export type SkipReason =
	| "rule_disabled"
	| "closed_day"
	| "holiday"
	| "building_baseline"
	| "no_sales"
	| "few_invoices"
	| "unmatched"
	| "unsettled"
	| "young_store";

export interface EffectiveRule {
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, unknown>>;
}

export interface EffectiveRuleSet {
	readonly tenant: Readonly<Partial<Record<string, EffectiveRule>>>;
	readonly stores: Readonly<
		Record<string, Readonly<Partial<Record<string, EffectiveRule>>>>
	>;
}

export const DAY_RULE_DEFAULTS: Readonly<Record<DayRuleKey, EffectiveRule>> = {
	revenue_below_baseline: {
		enabled: true,
		params: { ratio: 0.75, min_sample_days: 4 },
	},
	ticket_drop: {
		enabled: true,
		params: {
			drop: 0.1,
			reference: "baseline",
			min_invoices: 20,
			min_sample_days: 4,
		},
	},
	drawer_variance: { enabled: true, params: { max_lines: 3 } },
	unverified_day: { enabled: true, params: {} },
	zero_sales_day: { enabled: true, params: {} },
};

export function defaultRuleSet(): EffectiveRuleSet {
	return { tenant: { ...DAY_RULE_DEFAULTS }, stores: {} };
}

export function effectiveRule(
	rules: EffectiveRuleSet,
	ruleKey: DayRuleKey,
	storeId: string,
): EffectiveRule {
	return (
		rules.stores[storeId]?.[ruleKey] ??
		rules.tenant[ruleKey] ??
		DAY_RULE_DEFAULTS[ruleKey]
	);
}

export interface StoreDayFacts {
	readonly storeId: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDate: string;
	readonly current: AnalyticsRow<"period_compare_by_store"> | null;
	readonly previous: AnalyticsRow<"period_compare_by_store"> | null;
	readonly baseline: AnalyticsRow<"period_compare_by_store"> | null;
	readonly shifts: readonly AnalyticsRow<"shift_review">[];
	readonly coverage: AnalyticsRow<"store_coverage"> | null;
	readonly series: AnalyticsRow<"period_series"> | null;
	readonly openingMinutes: number | null;
	readonly settled: boolean;
}

export type DayRuleValues = Readonly<Record<string, number | string>>;

export type DayRuleOutcome =
	| {
			readonly kind: "hit";
			readonly ruleKey: DayRuleKey;
			readonly storeId: string;
			readonly values: DayRuleValues;
	  }
	| {
			readonly kind: "skip";
			readonly ruleKey: DayRuleKey;
			readonly storeId: string;
			readonly reason: SkipReason;
	  }
	| {
			readonly kind: "pass";
			readonly ruleKey: DayRuleKey;
			readonly storeId: string;
	  };

function numberParam(
	rule: EffectiveRule,
	name: string,
	fallback: number,
): number {
	const value = rule.params[name];
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function textParam(
	rule: EffectiveRule,
	name: string,
	fallback: string,
): string {
	const value = rule.params[name];
	return typeof value === "string" && value !== "" ? value : fallback;
}

function localClock(instant: string | null, timeZone: string): string {
	if (instant === null) {
		return "…";
	}
	const parsed = new Date(instant);
	if (Number.isNaN(parsed.getTime())) {
		return "…";
	}
	const clock = wallClockIn(parsed, timeZone);
	return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

function isHoliday(facts: StoreDayFacts): boolean {
	return (facts.series?.excluded_days ?? 0) > 0;
}

function hasSales(facts: StoreDayFacts): boolean {
	return (facts.current?.days_with_data ?? 0) > 0;
}

function isClosed(facts: StoreDayFacts): boolean {
	return facts.openingMinutes === 0;
}

function isUnmatched(facts: StoreDayFacts): boolean {
	return (facts.coverage?.unmatched_days ?? 0) > 0;
}

interface RuleContext {
	readonly facts: StoreDayFacts;
	readonly rule: EffectiveRule;
	readonly key: DayRuleKey;
}

function hit(context: RuleContext, values: DayRuleValues): DayRuleOutcome {
	return {
		kind: "hit",
		ruleKey: context.key,
		storeId: context.facts.storeId,
		values,
	};
}

function skip(context: RuleContext, reason: SkipReason): DayRuleOutcome {
	return {
		kind: "skip",
		ruleKey: context.key,
		storeId: context.facts.storeId,
		reason,
	};
}

function pass(context: RuleContext): DayRuleOutcome {
	return { kind: "pass", ruleKey: context.key, storeId: context.facts.storeId };
}

function commonSkip(context: RuleContext): SkipReason | null {
	if (!context.rule.enabled) {
		return "rule_disabled";
	}
	if (!context.facts.settled) {
		return "unsettled";
	}
	if (isUnmatched(context.facts)) {
		return "unmatched";
	}
	return null;
}

function unverifiedDay(context: RuleContext): DayRuleOutcome[] {
	if (!context.rule.enabled) {
		return [skip(context, "rule_disabled")];
	}
	if (!context.facts.settled) {
		return [skip(context, "unsettled")];
	}
	if (isUnmatched(context.facts)) {
		return [
			hit(context, {
				variant: "unmatched",
				unmatched_days: context.facts.coverage?.unmatched_days ?? 0,
			}),
		];
	}
	if ((context.facts.coverage?.unchecked_sales_days ?? 0) > 0) {
		return [
			hit(context, {
				variant: "unchecked",
				unchecked_days: context.facts.coverage?.unchecked_sales_days ?? 0,
			}),
		];
	}
	return [pass(context)];
}

function zeroSalesDay(context: RuleContext): DayRuleOutcome[] {
	const common = commonSkip(context);
	if (common !== null) {
		return [skip(context, common)];
	}
	const { facts } = context;
	if (isClosed(facts)) {
		return [skip(context, "closed_day")];
	}
	if (isHoliday(facts)) {
		return [skip(context, "holiday")];
	}
	if (hasSales(facts)) {
		return [pass(context)];
	}
	const historyStart = facts.coverage?.history_start ?? null;
	if (
		historyStart === null ||
		historyStart > shiftIsoDate(facts.businessDate, -1)
	) {
		return [skip(context, "young_store")];
	}
	const expectedOpen =
		(facts.openingMinutes !== null && facts.openingMinutes > 0) ||
		(facts.openingMinutes === null && (facts.baseline?.invoices ?? 0) > 0);
	return expectedOpen ? [hit(context, {})] : [pass(context)];
}

function salesSkip(context: RuleContext): SkipReason | null {
	const common = commonSkip(context);
	if (common !== null) {
		return common;
	}
	if (isClosed(context.facts)) {
		return "closed_day";
	}
	if (isHoliday(context.facts)) {
		return "holiday";
	}
	if (!hasSales(context.facts)) {
		return "no_sales";
	}
	return null;
}

function revenueBelowBaseline(context: RuleContext): DayRuleOutcome[] {
	const reason = salesSkip(context);
	if (reason !== null) {
		return [skip(context, reason)];
	}
	const { facts, rule } = context;
	const ratio = numberParam(rule, "ratio", 0.75);
	const minSample = numberParam(rule, "min_sample_days", 4);
	const sample = facts.baseline?.days_with_data ?? 0;
	const reference = facts.baseline?.net_amount ?? null;
	if (sample < minSample || reference === null) {
		return [skip(context, "building_baseline")];
	}
	const current = facts.current?.net_amount ?? 0;
	if (reference <= 0 || current >= ratio * reference) {
		return [pass(context)];
	}
	return [
		hit(context, {
			current,
			reference,
			ratio: current / reference,
			threshold: ratio,
			sample_weeks: sample,
		}),
	];
}

function ticketDrop(context: RuleContext): DayRuleOutcome[] {
	const reason = salesSkip(context);
	if (reason !== null) {
		return [skip(context, reason)];
	}
	const { facts, rule } = context;
	const drop = numberParam(rule, "drop", 0.1);
	const minInvoices = numberParam(rule, "min_invoices", 20);
	const minSample = numberParam(rule, "min_sample_days", 4);
	const reference =
		textParam(rule, "reference", "baseline") === "previous"
			? "previous"
			: "baseline";
	if ((facts.current?.invoices ?? 0) < minInvoices) {
		return [skip(context, "few_invoices")];
	}
	let referenceValue: number | null;
	if (reference === "baseline") {
		if ((facts.baseline?.days_with_data ?? 0) < minSample) {
			return [skip(context, "building_baseline")];
		}
		referenceValue = facts.baseline?.avg_ticket ?? null;
	} else {
		referenceValue = facts.previous?.avg_ticket ?? null;
	}
	const ticket = facts.current?.avg_ticket ?? null;
	if (
		referenceValue === null ||
		referenceValue <= 0 ||
		ticket === null ||
		ticket >= (1 - drop) * referenceValue
	) {
		return [pass(context)];
	}
	return [
		hit(context, {
			ticket,
			reference_value: referenceValue,
			drop: 1 - ticket / referenceValue,
			threshold: drop,
			reference,
		}),
	];
}

function variance(row: AnalyticsRow<"shift_review">): number {
	return row.variance_amount ?? 0;
}

function openedAtMillis(row: AnalyticsRow<"shift_review">): number {
	const millis =
		row.opened_at === null ? Number.NaN : Date.parse(row.opened_at);
	return Number.isNaN(millis) ? Number.POSITIVE_INFINITY : millis;
}

export function shiftNumbers(
	shifts: readonly AnalyticsRow<"shift_review">[],
): ReadonlyMap<string, number> {
	const ordered = [...shifts].sort(
		(left, right) =>
			openedAtMillis(left) - openedAtMillis(right) ||
			left.shift_external_id.localeCompare(right.shift_external_id),
	);
	return new Map(
		ordered.map((row, index) => [row.shift_external_id, index + 1]),
	);
}

function drawerVariance(context: RuleContext): DayRuleOutcome[] {
	const common = commonSkip(context);
	if (common !== null) {
		return [skip(context, common)];
	}
	const { facts, rule } = context;
	const maxLines = Math.max(1, Math.floor(numberParam(rule, "max_lines", 3)));
	const storeShifts = facts.shifts.filter(
		(row) => row.store_id === facts.storeId,
	);
	const numbers = shiftNumbers(storeShifts);
	const flagged = storeShifts
		.filter((row) => row.flagged)
		.sort(
			(left, right) =>
				Math.abs(variance(right)) - Math.abs(variance(left)) ||
				left.shift_external_id.localeCompare(right.shift_external_id),
		);
	if (flagged.length === 0) {
		return [pass(context)];
	}
	return flagged.map((row, index) =>
		hit(context, {
			shift_number: numbers.get(row.shift_external_id) ?? 0,
			shift_external_id: row.shift_external_id,
			from: localClock(row.opened_at, facts.timeZone),
			to: localClock(row.closed_at, facts.timeZone),
			variance: variance(row),
			rank: index + 1,
			max_lines: maxLines,
			flagged_total: flagged.length,
		}),
	);
}

const EVALUATORS: Readonly<
	Record<DayRuleKey, (context: RuleContext) => DayRuleOutcome[]>
> = {
	revenue_below_baseline: revenueBelowBaseline,
	ticket_drop: ticketDrop,
	drawer_variance: drawerVariance,
	unverified_day: unverifiedDay,
	zero_sales_day: zeroSalesDay,
};

export function evaluateDayRules(
	rules: EffectiveRuleSet,
	facts: readonly StoreDayFacts[],
): readonly DayRuleOutcome[] {
	return facts.flatMap((store) =>
		DAY_RULE_KEYS.flatMap((key) =>
			EVALUATORS[key]({
				facts: store,
				rule: effectiveRule(rules, key, store.storeId),
				key,
			}),
		),
	);
}

export function dayRuleHits(
	outcomes: readonly DayRuleOutcome[],
): readonly Extract<DayRuleOutcome, { kind: "hit" }>[] {
	return outcomes.filter(
		(outcome): outcome is Extract<DayRuleOutcome, { kind: "hit" }> =>
			outcome.kind === "hit",
	);
}
