import {
	analyticsFunctions,
	daysBetween,
	isAnalyticsFunctionName,
	METRIC_WINDOW_LIMITS,
	type ReportSource,
	themeFunctions,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { calendarOf } from "../../src/pack/calendar.js";
import {
	CALL_KEYS,
	limitedReportSource,
	packCalls,
	profilesCall,
	SCOPED_CALLS,
} from "../../src/pack/calls.js";
import { trackableMetricIds } from "../../src/pack/kpi-ids.js";
import type { ResolvedPackRequest } from "../../src/pack/request.js";

function storeId(index: number): string {
	return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

function resolved(
	count: number,
	overrides: Partial<ResolvedPackRequest> = {},
): ResolvedPackRequest {
	return {
		stores: Array.from({ length: count }, (_, index) => ({
			id: storeId(index + 1),
			label: `S${index + 1}`,
		})),
		asOf: "2026-11-11",
		horizon: "12m",
		language: "vi",
		focus: null,
		ownerNote: null,
		sample: false,
		currency: "VND",
		...overrides,
	};
}

function argsOf(spec: { args: unknown }): Record<string, unknown> {
	return spec.args as Record<string, unknown>;
}

describe("packCalls", () => {
	it("lists the store profiles first, then the pack-wide calls, then each scope's", () => {
		const calls = packCalls(resolved(2));
		expect(calls[0]).toEqual(profilesCall([storeId(2), storeId(1)]));
		expect(calls.map((spec) => spec.key)).toEqual([
			...Object.values(CALL_KEYS),
			...["ALL", "S1", "S2"].flatMap((scope) =>
				SCOPED_CALLS.map((kind) => `${kind}/${scope}`),
			),
		]);
		expect(new Set(calls.map((spec) => spec.key)).size).toBe(calls.length);
	});

	it("plans one scope and no store rows for a one-store pack", () => {
		const calls = packCalls(resolved(1));
		expect(
			calls.filter((spec) => spec.key.includes("/")).map((spec) => spec.key),
		).toEqual(SCOPED_CALLS.map((kind) => `${kind}/ALL`));
		for (const spec of calls.filter(
			(entry) => entry.name === "period_series",
		)) {
			expect(argsOf(spec).include_stores).toBe(false);
		}
		for (const spec of packCalls(resolved(2)).filter(
			(entry) => entry.name === "period_series",
		)) {
			expect(argsOf(spec).include_stores).toBe(true);
		}
	});

	it("passes every call's arguments through its contract, within each function's limits", () => {
		for (const count of [1, 2, 10]) {
			const request = resolved(count);
			const calendar = calendarOf(request.asOf, request.horizon);
			for (const spec of packCalls(request)) {
				const schema = isAnalyticsFunctionName(spec.name)
					? analyticsFunctions[spec.name].args
					: themeFunctions[spec.name as keyof typeof themeFunctions].args;
				expect(schema.safeParse(spec.args).success, spec.key).toBe(true);
				const args = argsOf(spec);
				if (
					typeof args.from_date === "string" &&
					typeof args.to_date === "string"
				) {
					const days = daysBetween(args.from_date, args.to_date) + 1;
					const limit =
						spec.name === "shift_review" || spec.name === "basket_pairs"
							? 92
							: spec.name === "period_series"
								? 1100
								: 400;
					expect(days, spec.key).toBeLessThanOrEqual(limit);
				}
			}
			const monthly = packCalls(request).find(
				(spec) => spec.key === CALL_KEYS.monthly,
			);
			expect(argsOf(monthly ?? { args: {} }).from_date).toBe(
				calendar.months.from,
			);
			expect(27 * (count + 1)).toBeLessThanOrEqual(900);
		}
	});

	it("asks metric_windows for the 18 trackable ids over the eleven KPI windows", () => {
		const kpi = packCalls(resolved(2)).find((spec) => spec.key === "kpi/S2");
		const args = argsOf(kpi ?? { args: {} });
		expect(args.store_ids).toEqual([storeId(2)]);
		expect(args.metric_ids).toEqual(trackableMetricIds());
		expect(args.from_dates).toHaveLength(11);
		expect((args.metric_ids as string[]).length).toBeLessThanOrEqual(
			METRIC_WINDOW_LIMITS.metricIds,
		);
		expect((args.from_dates as string[]).length).toBeLessThanOrEqual(
			METRIC_WINDOW_LIMITS.ranges,
		);
		expect(18 * 11).toBeLessThanOrEqual(300);
	});
});

describe("limitedReportSource", () => {
	it("never runs more calls at once than its limit and runs them all", async () => {
		let active = 0;
		let peak = 0;
		const base = {
			kind: "supabase",
			async call() {
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 2));
				active -= 1;
				return [];
			},
			async callTheme() {
				return [];
			},
		} as unknown as ReportSource;
		let settled = 0;
		const limited = limitedReportSource(base, 3, () => {
			settled += 1;
		});
		await Promise.all(
			Array.from({ length: 10 }, () =>
				limited.call("store_coverage", {
					store_ids: [],
					from_date: "2026-01-01",
					to_date: "2026-01-02",
				}),
			),
		);
		expect(peak).toBe(3);
		expect(settled).toBe(10);
	});
});
