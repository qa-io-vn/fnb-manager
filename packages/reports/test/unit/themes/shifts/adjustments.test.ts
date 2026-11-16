import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import {
	buildAdjustmentsCard,
	byAdjustmentRank,
	largerZ,
} from "../../../../src/themes/shifts/cards/adjustments.js";
import {
	adjustmentReasonsKey,
	shiftsKeys,
} from "../../../../src/themes/shifts/keys.js";
import { shiftsCalls } from "../../../../src/themes/shifts/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	adjustmentRow,
	cardInput,
	EMAIL_LIKE,
	LOGIN,
	settingsRow,
} from "./support.js";

const rows = [
	adjustmentRow({
		shift_id: "quiet",
		shift_external_id: "Q",
		opened_at: "2026-10-20T00:00:00Z",
		void_z_score: 0.4,
		removed_z_score: -0.2,
	}),
	adjustmentRow({
		shift_id: "late-edit",
		shift_external_id: "L",
		opened_at: "2026-10-20T08:00:00Z",
		void_z_score: null,
		removed_z_score: null,
		trailing_shifts: 2,
		edits: 3,
		edits_after_close: 2,
		changed_after_close: true,
		flagged: true,
		reasons: ["after_close"],
	}),
	adjustmentRow({
		shift_id: "voids",
		shift_external_id: "V",
		business_date: "2026-10-21",
		opened_at: "2026-10-21T00:00:00Z",
		shift_name: LOGIN,
		cashier_name: LOGIN,
		voids: 6,
		void_rate: 0.047619,
		void_z_score: 3.1,
		removed_z_score: 2.4,
		removed_lines: 5,
		removed_line_rate: 0.027778,
		flagged: true,
		reasons: ["voids", "removed_lines"],
	}),
	adjustmentRow({
		shift_id: "removed",
		shift_external_id: "R",
		business_date: "2026-10-21",
		opened_at: "2026-10-21T08:00:00Z",
		void_z_score: 1.2,
		removed_z_score: 3.1,
		edits_after_close: 1,
		flagged: true,
		reasons: ["removed_lines", "after_close"],
	}),
	adjustmentRow({
		shift_id: "no-score",
		shift_external_id: "N",
		business_date: "2026-10-22",
		opened_at: "2026-10-22T00:00:00Z",
		void_z_score: null,
		removed_z_score: null,
	}),
];

describe("the Ca & két tiền adjustments card", () => {
	it("takes the higher of the two z-scores, null when neither exists", () => {
		expect(largerZ(rows[2] as (typeof rows)[number])).toBe(3.1);
		expect(largerZ(rows[0] as (typeof rows)[number])).toBe(0.4);
		expect(largerZ(rows[1] as (typeof rows)[number])).toBeNull();
	});

	it("ranks by the higher z-score, then by edits after close, shifts without a score last", () => {
		expect(byAdjustmentRank(rows).map((row) => row.shift_id)).toEqual([
			"removed",
			"voids",
			"quiet",
			"late-edit",
			"no-score",
		]);
	});

	it("counts only the shifts the function flags and names the top-ranked one with its masked cashier and reasons", () => {
		const card = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: rows,
			}),
		);
		expect(card.headline.value).toBe(3);
		expect(card.headline.caption).toEqual({
			key: paymentsKeys.drawer.caption,
			values: { count: { kind: "count", value: 5 } },
		});
		expect(card.metricId).toBe("shift_void_rate");
		expect(card.relatedMetricIds).toEqual([
			"shift_void_rate_zscore",
			"removed_line_rate",
			"removed_line_rate_zscore",
			"edits_after_close",
			"edit_rate",
		]);
		const [main, basis] = card.narrative;
		expect(main?.key).toBe(shiftsKeys.adjustments.main);
		expect(main?.values.count).toEqual({ kind: "count", value: 3 });
		expect(main?.values.reasons).toEqual({
			kind: "message",
			value: shiftsKeys.reasons.removed_lines_after_close,
		});
		expect(main?.values.cashier).toEqual({ kind: "text", value: "Lan" });
		const shift = main?.values.shift;
		expect(shift?.kind === "part" ? shift.value.values.date : null).toEqual({
			kind: "date",
			value: "2026-10-21",
		});
		expect(basis).toEqual({
			key: shiftsKeys.adjustments.basis,
			values: { days: { kind: "count", value: 56 } },
		});
	});

	it("shows each shift as Ca n with its rates, z-scores (null as a dash) and reasons, and never an e-mail address", () => {
		const card = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: rows,
			}),
		);
		const table = card.tables[0];
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["date", "date"],
			["shift", "shift"],
			["cashier", "label"],
			["orders", "count"],
			["voids", "count"],
			["voidRate", "percent"],
			["voidZ", "decimal"],
			["removedLines", "count"],
			["removedRate", "percent"],
			["removedZ", "decimal"],
			["edits", "count"],
			["editsAfterClose", "count"],
			["reasons", "message"],
		]);
		const byId = new Map(table?.rows.map((row) => [row.id, row.cells]));
		expect(byId.get("voids")).toMatchObject({
			shift: 1,
			cashier: reportKeys.label.unknownCashier,
			voids: 6,
			voidRate: 0.047619,
			voidZ: 3.1,
			removedZ: 2.4,
			reasons: shiftsKeys.reasons.voids_removed_lines,
		});
		expect(byId.get("removed")?.shift).toBe(2);
		expect(byId.get("quiet")).toMatchObject({ shift: 1, reasons: null });
		expect(byId.get("late-edit")).toMatchObject({
			shift: 2,
			voidZ: null,
			removedZ: null,
			editsAfterClose: 2,
			reasons: shiftsKeys.reasons.after_close,
		});
		expect(
			JSON.stringify([card.narrative, card.tables, card.chart]),
		).not.toMatch(EMAIL_LIKE);
	});

	it("explains the dash whenever a z-score is missing, for too few earlier shifts or for earlier rates without spread", () => {
		const notice = {
			tone: "info",
			part: {
				key: shiftsKeys.adjustments.unscored,
				values: { count: { kind: "count", value: 3 } },
			},
			action: null,
		};
		const young = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [rows[1]],
			}),
		);
		expect(young.notice).toEqual(notice);
		const noSpread = adjustmentRow({
			shift_id: "no-spread",
			trailing_shifts: 12,
			void_z_score: 0.8,
			removed_z_score: null,
		});
		const flat = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [rows[0], noSpread],
			}),
		);
		expect(noSpread.trailing_shifts).toBeGreaterThanOrEqual(3);
		expect(flat.notice).toEqual(notice);
		expect(
			flat.tables[0]?.rows.find((row) => row.id === "no-spread")?.cells
				.removedZ,
		).toBeNull();
		const scored = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [rows[0], rows[2], rows[3]],
			}),
		);
		expect(scored.notice).toBeNull();
	});

	it("charts the higher z-score of the flagged shifts that have one, against the tenant's z threshold", () => {
		const card = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[shiftsCalls.adjustments]: rows,
				[shiftsCalls.settings]: [settingsRow({ z_threshold: 2.5 })],
			}),
		);
		expect(card.chart?.series[0]?.values).toEqual([3.1, 3.1]);
		expect(card.chart?.categories).toHaveLength(2);
		const afterCloseOnly = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [
					...rows,
					adjustmentRow({
						shift_id: "closed-edit",
						business_date: "2026-10-23",
						void_z_score: -0.4,
						removed_z_score: -0.3,
						edits_after_close: 1,
						flagged: true,
						reasons: ["after_close"],
					}),
				],
			}),
		);
		expect(afterCloseOnly.headline.value).toBe(4);
		expect(afterCloseOnly.chart?.series[0]?.values).toEqual([3.1, 3.1]);
		expect(card.chart?.markLines).toEqual([
			{
				label: { key: shiftsKeys.adjustments.threshold, values: {} },
				value: 2.5,
				axis: "left",
			},
		]);
		expect(card.tables[0]?.columns[0]?.key).toBe("store");
	});

	it("says no measured shift stood out, never claims so when nothing could be measured, and says when there was no shift", () => {
		const quiet = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [rows[0]],
			}),
		);
		expect(quiet.headline.value).toBe(0);
		expect(quiet.narrative[0]).toEqual({
			key: shiftsKeys.adjustments.none,
			values: {
				measured: { kind: "count", value: 1 },
				count: { kind: "count", value: 1 },
			},
		});
		expect(quiet.chart).toBeNull();
		const partly = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [rows[0], rows[4]],
			}),
		);
		expect(partly.narrative[0]?.values).toEqual({
			measured: { kind: "count", value: 1 },
			count: { kind: "count", value: 2 },
		});
		const unmeasured = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [rows[4]],
			}),
		);
		expect(unmeasured.headline.value).toBe(0);
		expect(unmeasured.narrative[0]).toEqual({
			key: shiftsKeys.adjustments.unmeasured,
			values: { count: { kind: "count", value: 1 } },
		});
		expect(unmeasured.narrative[0]?.key).not.toBe(shiftsKeys.adjustments.none);
		const empty = buildAdjustmentsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.adjustments]: [],
			}),
		);
		expect(empty.headline.value).toBeNull();
		expect(empty.narrative.map((part) => part.key)).toEqual([
			shiftsKeys.noData,
		]);
		expect(empty.notice?.part.key).toBe(shiftsKeys.noShifts);
	});

	it("names every combination of reasons with one message, in a fixed order", () => {
		expect(adjustmentReasonsKey([])).toBeNull();
		expect(adjustmentReasonsKey(null)).toBeNull();
		expect(adjustmentReasonsKey(["after_close", "voids"])).toBe(
			shiftsKeys.reasons.voids_after_close,
		);
		expect(
			adjustmentReasonsKey(["after_close", "removed_lines", "voids"]),
		).toBe(shiftsKeys.reasons.voids_removed_lines_after_close);
	});
});
