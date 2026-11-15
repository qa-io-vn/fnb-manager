import {
	DEFAULT_REPORT_SETTINGS,
	REPORT_SETTING_LIMITS,
	type ReportSettings,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { vndFormatters } from "../../test/render";
import {
	rangeIssueOf,
	readThreshold,
	readThresholdDraft,
	shownLimitOf,
	stateAfterSave,
	THRESHOLD_FIELDS,
	THRESHOLD_SPECS,
	type ThresholdField,
	type ThresholdFormat,
	type ThresholdSpec,
	thresholdDefaultText,
	thresholdFieldOfConstraint,
	thresholdTextsOf,
} from "./fields";

const format: ThresholdFormat = {
	formatters: vndFormatters(),
	currencyCode: "VND",
};

const DEFAULT_TEXTS = thresholdTextsOf(DEFAULT_REPORT_SETTINGS, format);

function specOf(field: ThresholdField): ThresholdSpec {
	const spec = THRESHOLD_SPECS.find((entry) => entry.field === field);
	if (spec === undefined) throw new Error(`no spec for ${field}`);
	return spec;
}

describe("the thresholds of the page", () => {
	it("are every report setting except the promotion weeks of phase 10b", () => {
		expect([...THRESHOLD_FIELDS, "promoPreWeeks"].sort()).toEqual(
			Object.keys(REPORT_SETTING_LIMITS).sort(),
		);
		expect(THRESHOLD_SPECS.map((spec) => spec.field)).toEqual([
			...THRESHOLD_FIELDS,
		]);
	});

	it("shows the defaults in the shop's formats, a share as a percentage", () => {
		expect(DEFAULT_TEXTS).toEqual({
			menuWindowDays: "28",
			menuPopularityFactor: "70",
			menuLowSampleItems: "10",
			cashAbsThreshold: "50.000",
			cashRelThreshold: "0,5",
			peakHours: "3",
			deadHourRatio: "50",
			busyHourRatio: "125",
		});
	});

	it("names each default with its unit", () => {
		expect(thresholdDefaultText(specOf("menuWindowDays"), format, "ngày")).toBe(
			"28 ngày",
		);
		expect(
			thresholdDefaultText(specOf("menuPopularityFactor"), format, null),
		).toBe("70%");
		expect(thresholdDefaultText(specOf("cashRelThreshold"), format, null)).toBe(
			"0,5%",
		);
		expect(thresholdDefaultText(specOf("busyHourRatio"), format, null)).toBe(
			"125%",
		);
		expect(thresholdDefaultText(specOf("cashAbsThreshold"), format, null)).toBe(
			format.formatters.moneyExact(50_000),
		);
	});
});

describe("readThresholdDraft", () => {
	it("finds nothing to save while every text shows the saved value", () => {
		expect(
			readThresholdDraft(DEFAULT_REPORT_SETTINGS, DEFAULT_TEXTS, format),
		).toEqual({ changes: {}, issues: {}, changed: [] });
	});

	it("hands back only the changed thresholds, a percentage as the column's fraction", () => {
		const draft = readThresholdDraft(
			DEFAULT_REPORT_SETTINGS,
			{
				...DEFAULT_TEXTS,
				menuPopularityFactor: "65",
				cashRelThreshold: "0,75",
				busyHourRatio: "130,5",
				cashAbsThreshold: "80000",
			},
			format,
		);
		expect(draft.changes).toEqual({
			menuPopularityFactor: 0.65,
			cashRelThreshold: 0.0075,
			busyHourRatio: 1.305,
			cashAbsThreshold: 80_000,
		});
		expect(draft.changed).toEqual([
			"menuPopularityFactor",
			"cashAbsThreshold",
			"cashRelThreshold",
			"busyHourRatio",
		]);
	});

	it("does not count a value written another way as a change", () => {
		const draft = readThresholdDraft(
			DEFAULT_REPORT_SETTINGS,
			{
				...DEFAULT_TEXTS,
				cashAbsThreshold: "50000 ₫",
				cashRelThreshold: "0.5%",
			},
			format,
		);
		expect(draft.changed).toEqual([]);
		expect(draft.changes).toEqual({});
	});

	it("never touches the promotion weeks of the saved row", () => {
		const saved: ReportSettings = {
			...DEFAULT_REPORT_SETTINGS,
			promoPreWeeks: 6,
		};
		const draft = readThresholdDraft(
			saved,
			{ ...thresholdTextsOf(saved, format), peakHours: "4" },
			format,
		);
		expect(draft.changes).toEqual({ peakHours: 4 });
	});

	it("accepts each shown bound and refuses one step outside it, as the database does", () => {
		for (const spec of THRESHOLD_SPECS) {
			if (spec.kind === "money") continue;
			const shown = shownLimitOf(spec);
			const step = 10 ** -shown.fractionDigits;
			const text = (value: number) =>
				String(Number(value.toFixed(shown.fractionDigits))).replace(".", ",");
			for (const value of [shown.min, shown.max]) {
				expect(
					readThreshold(spec, text(value), format).issue,
					spec.field,
				).toBeNull();
			}
			for (const value of [shown.min - step, shown.max + step]) {
				expect(
					readThreshold(spec, text(value), format).issue,
					spec.field,
				).toEqual({ key: "range", min: shown.min, max: shown.max });
			}
		}
		expect(shownLimitOf(specOf("cashRelThreshold"))).toEqual({
			min: 0,
			max: 10,
			fractionDigits: 2,
		});
		expect(shownLimitOf(specOf("deadHourRatio"))).toEqual({
			min: 10,
			max: 90,
			fractionDigits: 1,
		});
	});

	it("refuses a fraction of a đồng, a negative amount and an empty field", () => {
		const amount = specOf("cashAbsThreshold");
		expect(readThreshold(amount, "50.000,5", format).issue).toEqual({
			key: "wholeMoney",
		});
		expect(readThreshold(amount, "-1", format).issue).toEqual({
			key: "atLeast",
			min: 0,
		});
		expect(readThreshold(amount, "0", format)).toEqual({
			value: 0,
			issue: null,
		});
		expect(readThreshold(amount, "", format).issue).toEqual({
			key: "required",
		});
	});

	it("gives no settings while a field is invalid and counts it only when it was changed", () => {
		const draft = readThresholdDraft(
			DEFAULT_REPORT_SETTINGS,
			{ ...DEFAULT_TEXTS, menuWindowDays: "5" },
			format,
		);
		expect(draft.changes).toBeNull();
		expect(draft.issues).toEqual({
			menuWindowDays: { key: "range", min: 7, max: 91 },
		});
		expect(draft.changed).toEqual(["menuWindowDays"]);
		const stored: ReportSettings = {
			...DEFAULT_REPORT_SETTINGS,
			cashAbsThreshold: 50_000.5,
		};
		const untouched = readThresholdDraft(
			stored,
			thresholdTextsOf(stored, format),
			format,
		);
		expect(untouched.issues).toEqual({
			cashAbsThreshold: { key: "wholeMoney" },
		});
		expect(untouched.changed).toEqual([]);
	});
});

describe("defaults and refusals", () => {
	it("knows what a save leaves behind before the thresholds are read again", () => {
		const savedAt = "2026-11-15T06:00:00.000Z";
		const none = {
			settings: DEFAULT_REPORT_SETTINGS,
			hasRow: false,
			audit: null,
		};
		const changed = stateAfterSave(none, { peakHours: 4 }, savedAt);
		expect(changed).toEqual({
			settings: { ...DEFAULT_REPORT_SETTINGS, peakHours: 4 },
			hasRow: true,
			audit: { changedAt: savedAt, author: { kind: "you" } },
		});
		expect(stateAfterSave(changed, { peakHours: 3 }, savedAt)).toEqual(none);
	});

	it("finds the field a database constraint or the demo store names", () => {
		expect(thresholdFieldOfConstraint("report_settings_peak_hours_check")).toBe(
			"peakHours",
		);
		expect(
			thresholdFieldOfConstraint("report_settings_cash_rel_threshold_check"),
		).toBe("cashRelThreshold");
		expect(thresholdFieldOfConstraint("menuWindowDays")).toBe("menuWindowDays");
		expect(
			thresholdFieldOfConstraint("report_settings_promo_pre_weeks_check"),
		).toBeNull();
		expect(thresholdFieldOfConstraint(null)).toBeNull();
	});

	it("explains a refused field with its range, a refused amount with its floor", () => {
		expect(rangeIssueOf(specOf("peakHours"))).toEqual({
			key: "range",
			min: 1,
			max: 6,
		});
		expect(rangeIssueOf(specOf("busyHourRatio"))).toEqual({
			key: "range",
			min: 105,
			max: 300,
		});
		expect(rangeIssueOf(specOf("cashAbsThreshold"))).toEqual({
			key: "atLeast",
			min: 0,
		});
	});
});
