import { createRpcAnalyticsSource } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	buildDigest,
	type DayRuleKey,
	type DayRuleOutcome,
	defaultRuleSet,
	type EffectiveRuleSet,
	evaluateDayRules,
	recordingSource,
	type StoreDayFacts,
} from "../../../src/index.js";
import {
	coverageRow,
	DAY,
	dueFor,
	ngayClient,
	STORE_A,
	shiftRow,
	storesOf,
	TWO_STORES,
	totalsRow,
	ZONE,
} from "../../fixtures/ngay-rows.js";

function facts(overrides: Partial<StoreDayFacts> = {}): StoreDayFacts {
	return {
		storeId: STORE_A,
		name: "Cửa hàng A",
		timeZone: ZONE,
		businessDate: DAY,
		current: totalsRow(STORE_A, "current", {
			net_amount: 5_000_000,
			invoices: 100,
			avg_ticket: 50_000,
		}),
		previous: totalsRow(STORE_A, "previous", { avg_ticket: 50_000 }),
		baseline: totalsRow(STORE_A, "baseline", {
			days_with_data: 8,
			net_amount: 5_000_000,
			invoices: 100,
			avg_ticket: 50_000,
		}),
		shifts: [],
		coverage: coverageRow(STORE_A),
		series: null,
		openingMinutes: null,
		settled: true,
		...overrides,
	};
}

function outcome(
	outcomes: readonly DayRuleOutcome[],
	ruleKey: DayRuleKey,
): DayRuleOutcome | undefined {
	return outcomes.find((entry) => entry.ruleKey === ruleKey);
}

function withRule(
	ruleKey: DayRuleKey,
	enabled: boolean,
	params: Record<string, unknown> = {},
	store = false,
): EffectiveRuleSet {
	const rules = defaultRuleSet();
	const rule = { enabled, params };
	return store
		? { ...rules, stores: { [STORE_A]: { [ruleKey]: rule } } }
		: { ...rules, tenant: { ...rules.tenant, [ruleKey]: rule } };
}

function current(net: number, extra: Record<string, unknown> = {}) {
	return totalsRow(STORE_A, "current", { net_amount: net, ...extra });
}

describe("revenue_below_baseline", () => {
	it("fires strictly below 75 % of the baseline", () => {
		const run = (net: number) =>
			outcome(
				evaluateDayRules(defaultRuleSet(), [facts({ current: current(net) })]),
				"revenue_below_baseline",
			);
		expect(run(3_740_000)).toMatchObject({
			kind: "hit",
			values: { threshold: 0.75, sample_weeks: 8, reference: 5_000_000 },
		});
		expect(run(3_750_000)?.kind).toBe("pass");
		expect(run(4_000_000)?.kind).toBe("pass");
	});

	it("skips a disabled rule, a young baseline, a closed day, a holiday and no sales", () => {
		const low = { current: current(1_000_000) };
		const reason = (
			rules: EffectiveRuleSet,
			overrides: Partial<StoreDayFacts>,
		) => {
			const found = outcome(
				evaluateDayRules(rules, [facts({ ...low, ...overrides })]),
				"revenue_below_baseline",
			);
			return found?.kind === "skip" ? found.reason : found?.kind;
		};
		const defaults = defaultRuleSet();
		expect(reason(withRule("revenue_below_baseline", false), {})).toBe(
			"rule_disabled",
		);
		expect(
			reason(withRule("revenue_below_baseline", false, {}, true), {}),
		).toBe("rule_disabled");
		expect(
			reason(defaults, {
				baseline: totalsRow(STORE_A, "baseline", { days_with_data: 3 }),
			}),
		).toBe("building_baseline");
		expect(reason(defaults, { openingMinutes: 0 })).toBe("closed_day");
		expect(
			reason(defaults, {
				series: { ...seriesRow(), excluded_days: 1, holiday_kind: "public" },
			}),
		).toBe("holiday");
		expect(
			reason(defaults, {
				current: totalsRow(STORE_A, "current", {
					days_with_data: 0,
					net_amount: 0,
				}),
			}),
		).toBe("no_sales");
		expect(
			reason(withRule("revenue_below_baseline", true, { ratio: 0.1 }), {}),
		).toBe("pass");
	});
});

function seriesRow() {
	return {
		...totalsRow(STORE_A, "current"),
		bucket_start: DAY,
		bucket_end: DAY,
		iso_year: 2026,
		iso_week: 45,
		weekday: 6,
		calendar_days: 1,
		excluded_days: 0,
		tet_days: 0,
		holiday_kind: null,
		checked_days: 1,
		matched_days: 1,
	};
}

describe("ticket_drop", () => {
	it("compares with the baseline by default and with the previous day on request", () => {
		const low = current(4_400_000, { avg_ticket: 44_000, invoices: 100 });
		const hit = outcome(
			evaluateDayRules(defaultRuleSet(), [facts({ current: low })]),
			"ticket_drop",
		);
		expect(hit).toMatchObject({
			kind: "hit",
			values: {
				reference: "baseline",
				reference_value: 50_000,
				ticket: 44_000,
			},
		});
		const atThreshold = current(4_500_000, { avg_ticket: 45_000 });
		expect(
			outcome(
				evaluateDayRules(defaultRuleSet(), [facts({ current: atThreshold })]),
				"ticket_drop",
			)?.kind,
		).toBe("pass");
		const previous = outcome(
			evaluateDayRules(
				withRule("ticket_drop", true, { reference: "previous", drop: 0.1 }),
				[
					facts({
						current: low,
						previous: totalsRow(STORE_A, "previous", { avg_ticket: 60_000 }),
						baseline: totalsRow(STORE_A, "baseline", { days_with_data: 1 }),
					}),
				],
			),
			"ticket_drop",
		);
		expect(previous).toMatchObject({
			kind: "hit",
			values: { reference: "previous", reference_value: 60_000 },
		});
	});

	it("needs at least 20 invoices", () => {
		const few = current(440_000, { avg_ticket: 22_000, invoices: 19 });
		const found = outcome(
			evaluateDayRules(defaultRuleSet(), [facts({ current: few })]),
			"ticket_drop",
		);
		expect(found).toMatchObject({ kind: "skip", reason: "few_invoices" });
	});
});

describe("drawer_variance", () => {
	const shifts = [
		shiftRow(STORE_A, {
			shift_external_id: "s-rel",
			shift_name: "Ca sáng",
			opened_at: "2026-11-06T23:00:00+00:00",
			variance_amount: -20_000,
			over_rel_threshold: true,
			flagged: true,
		}),
		shiftRow(STORE_A, {
			shift_external_id: "s-abs",
			shift_name: "Ca chiều",
			variance_amount: -62_000,
			over_abs_threshold: true,
			flagged: true,
		}),
		shiftRow(STORE_A, {
			shift_external_id: "s-big-unflagged",
			opened_at: "2026-11-07T01:00:00+00:00",
			variance_amount: 900_000,
			flagged: false,
		}),
		shiftRow(STORE_A, {
			shift_external_id: "s-3",
			opened_at: "2026-11-07T02:00:00+00:00",
			variance_amount: 55_000,
			flagged: true,
		}),
		shiftRow(STORE_A, {
			shift_external_id: "s-4",
			opened_at: "2026-11-07T03:00:00+00:00",
			variance_amount: 51_000,
			flagged: true,
		}),
	];

	it("lists exactly the flagged rows, largest variance first, with the shift times", () => {
		const hits = evaluateDayRules(defaultRuleSet(), [facts({ shifts })]).filter(
			(entry) => entry.ruleKey === "drawer_variance" && entry.kind === "hit",
		);
		expect(
			hits.map((entry) =>
				entry.kind === "hit" ? entry.values.shift_external_id : null,
			),
		).toEqual(["s-abs", "s-3", "s-4", "s-rel"]);
		expect(hits[0]).toMatchObject({
			values: {
				shift_number: 2,
				from: "07:00",
				to: "15:00",
				variance: -62_000,
				rank: 1,
				max_lines: 3,
				flagged_total: 4,
			},
		});
	});

	it("numbers the shifts by opening time and never carries the POS shift or cashier name", () => {
		const cashier = "cashier@example.com";
		const named = [
			...shifts,
			shiftRow(STORE_A, {
				shift_external_id: "s-cashier",
				shift_name: `Ca tối ${cashier}`,
				cashier_name: cashier,
				opened_at: "2026-11-07T04:00:00+00:00",
				variance_amount: -70_000,
				over_abs_threshold: true,
				flagged: true,
			}),
		];
		const hits = evaluateDayRules(defaultRuleSet(), [
			facts({ shifts: named }),
		]).filter(
			(entry) => entry.ruleKey === "drawer_variance" && entry.kind === "hit",
		);
		expect(
			hits.map((entry) =>
				entry.kind === "hit"
					? [entry.values.shift_external_id, entry.values.shift_number]
					: null,
			),
		).toEqual([
			["s-cashier", 6],
			["s-abs", 2],
			["s-3", 4],
			["s-4", 5],
			["s-rel", 1],
		]);
		const serialised = JSON.stringify(hits);
		expect(serialised).not.toContain(cashier);
		expect(serialised).not.toContain("@");
		expect(serialised).not.toContain("Ca tối");
		expect(serialised).not.toContain("Ca chiều");
		expect(serialised).not.toContain("Synthetic cashier");
	});

	it("counts the same flagged shifts as the Ngày shifts card", async () => {
		const scenario = {
			...TWO_STORES,
			stores: [{ ...(TWO_STORES.stores[0] ?? TWO_STORES.stores[1]), shifts }],
		};
		const ids = [STORE_A];
		const result = await buildDigest(
			{
				due: dueFor(ids, { allStores: false }),
				stores: storesOf(scenario as typeof TWO_STORES, ids),
				rules: defaultRuleSet(),
				openAlerts: [],
				appBaseUrl: null,
				now: new Date("2026-11-07T21:00:00.000Z"),
			},
			recordingSource(
				createRpcAnalyticsSource(
					ngayClient(scenario as typeof TWO_STORES),
					"postgres",
				),
			),
		);
		const card = result.cards.find((entry) => entry.id === "shifts");
		const drawer = result.model.findings.filter(
			(finding) => finding.ruleKey === "drawer_variance",
		);
		expect(drawer).toHaveLength(card?.headline.value ?? -1);
		expect(drawer).toHaveLength(4);
	});
});

describe("unverified_day, zero_sales_day and precedence", () => {
	it("hides the business lines of an unmatched store and keeps them, marked, for an unchecked one", () => {
		const low = current(1_000_000);
		const unmatched = evaluateDayRules(defaultRuleSet(), [
			facts({
				current: low,
				coverage: coverageRow(STORE_A, { unmatched_days: 1 }),
			}),
		]);
		expect(outcome(unmatched, "unverified_day")).toMatchObject({
			kind: "hit",
			values: { variant: "unmatched" },
		});
		expect(outcome(unmatched, "revenue_below_baseline")).toMatchObject({
			kind: "skip",
			reason: "unmatched",
		});
		const unchecked = evaluateDayRules(defaultRuleSet(), [
			facts({
				current: low,
				coverage: coverageRow(STORE_A, { unchecked_sales_days: 1 }),
			}),
		]);
		expect(outcome(unchecked, "unverified_day")).toMatchObject({
			kind: "hit",
			values: { variant: "unchecked" },
		});
		expect(outcome(unchecked, "revenue_below_baseline")?.kind).toBe("hit");
	});

	it("suppresses everything for an unsettled store, then zero sales before revenue", () => {
		const unsettled = evaluateDayRules(defaultRuleSet(), [
			facts({ settled: false, current: current(1_000_000) }),
		]);
		for (const entry of unsettled) {
			expect(entry).toMatchObject({ kind: "skip", reason: "unsettled" });
		}
		const empty = totalsRow(STORE_A, "current", {
			days_with_data: 0,
			net_amount: 0,
			invoices: 0,
			avg_ticket: null,
		});
		const zero = evaluateDayRules(defaultRuleSet(), [
			facts({ current: empty }),
		]);
		expect(outcome(zero, "zero_sales_day")?.kind).toBe("hit");
		expect(outcome(zero, "revenue_below_baseline")).toMatchObject({
			kind: "skip",
			reason: "no_sales",
		});
		expect(
			outcome(
				evaluateDayRules(defaultRuleSet(), [
					facts({ current: empty, openingMinutes: 0 }),
				]),
				"zero_sales_day",
			),
		).toMatchObject({ kind: "skip", reason: "closed_day" });
		expect(
			outcome(
				evaluateDayRules(defaultRuleSet(), [
					facts({
						current: empty,
						coverage: coverageRow(STORE_A, { history_start: DAY }),
					}),
				]),
				"zero_sales_day",
			),
		).toMatchObject({ kind: "skip", reason: "young_store" });
		expect(
			outcome(
				evaluateDayRules(defaultRuleSet(), [
					facts({
						current: empty,
						baseline: totalsRow(STORE_A, "baseline", { invoices: 0 }),
					}),
				]),
				"zero_sales_day",
			)?.kind,
		).toBe("pass");
	});
});
