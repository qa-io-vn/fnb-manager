import { describe, expect, it } from "vitest";
import { COVERAGE_CALL_KEY } from "../../../../src/definition.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import type { ReportCallSpec } from "../../../../src/themes/definition.js";
import {
	customRange,
	resolveRange,
	SHIFT_THEME_RANGE_DAYS,
} from "../../../../src/themes/range.js";
import { shiftsTheme } from "../../../../src/themes/shifts/definition.js";
import { shiftsCalls } from "../../../../src/themes/shifts/support.js";
import { STORE_A } from "../../fixtures.js";
import { THEME_AS_OF, themeContext } from "../fixtures.js";

function callOf(
	calls: readonly ReportCallSpec[],
	key: string,
): ReportCallSpec | undefined {
	return calls.find((call) => call.key === key);
}

describe("the Ca & két tiền definition", () => {
	it("opens on 28 days, allows at most 92 and lists its four cards", () => {
		expect(shiftsTheme.slug).toBe("ca-ket-tien");
		expect(shiftsTheme.defaultPreset).toBe("28d");
		expect(shiftsTheme.maxRangeDays).toBe(SHIFT_THEME_RANGE_DAYS);
		expect(SHIFT_THEME_RANGE_DAYS).toBe(92);
		expect(shiftsTheme.params).toEqual([]);
		expect(shiftsTheme.cards.map((card) => card.id)).toEqual([
			"shift_sales",
			"drawer",
			"adjustments",
			"cashiers",
		]);
	});

	it("calls coverage, shift_review and shift_adjustments over the range without thresholds, and the tenant's settings", () => {
		const context = themeContext("28d", [STORE_A]);
		const calls = shiftsTheme.primaryCalls(context);
		expect(calls.map((call) => call.key)).toEqual([
			COVERAGE_CALL_KEY,
			shiftsCalls.shifts,
			shiftsCalls.adjustments,
			shiftsCalls.settings,
		]);
		const span = {
			store_ids: [STORE_A],
			from_date: context.range.from,
			to_date: context.range.to,
		};
		expect(callOf(calls, shiftsCalls.shifts)).toEqual({
			key: shiftsCalls.shifts,
			name: "shift_review",
			args: span,
		});
		expect(callOf(calls, shiftsCalls.adjustments)).toEqual({
			key: shiftsCalls.adjustments,
			name: "shift_adjustments",
			args: span,
		});
		expect(callOf(calls, shiftsCalls.settings)).toEqual({
			key: shiftsCalls.settings,
			name: "report_settings_of",
			args: { store_ids: [STORE_A] },
		});
		expect(
			shiftsTheme.followUpCalls(context, coverageModel([], context), {
				rows: () => undefined,
			}),
		).toEqual([]);
	});

	it("plans every call each card needs", () => {
		const planned = new Set(
			shiftsTheme.primaryCalls(themeContext("28d")).map((call) => call.key),
		);
		for (const card of shiftsTheme.cards) {
			for (const need of card.needs) {
				expect(planned.has(need), `${card.id} ${need}`).toBe(true);
			}
		}
	});

	it("clamps a range longer than 92 days to its last 92 days, and never asks the functions for more", () => {
		const limits = {
			defaultPreset: shiftsTheme.defaultPreset,
			maxDays: shiftsTheme.maxRangeDays,
		};
		for (const request of [
			{ preset: "364d" },
			{ preset: "this_year" },
			{ from: "2026-01-01", to: THEME_AS_OF },
		]) {
			const resolved = resolveRange(request, THEME_AS_OF, limits);
			expect(resolved.rangeClamped).toBe(true);
			expect(resolved.range.days).toBe(92);
			expect(resolved.range.to).toBe(THEME_AS_OF);
		}
		const within = resolveRange({ preset: "91d" }, THEME_AS_OF, limits);
		expect(within.rangeClamped).toBe(false);
		const year = {
			...themeContext("28d"),
			range: customRange("2025-11-07", THEME_AS_OF, THEME_AS_OF),
		};
		for (const call of shiftsTheme.primaryCalls(year)) {
			if (call.key === COVERAGE_CALL_KEY || call.key === shiftsCalls.settings)
				continue;
			expect(call.args).toMatchObject({
				from_date: "2026-08-07",
				to_date: THEME_AS_OF,
			});
		}
	});
});
