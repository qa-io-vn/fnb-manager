import { describe, expect, it } from "vitest";
import { messages } from "../../i18n";
import { createFormatters } from "../../lib/format";
import {
	DEFAULT_STORE_KNOBS,
	demoStoreSettings,
} from "../../loyalty/demo-loyalty-source";
import type { LoyaltyStoreSettings } from "../../loyalty/source";
import {
	STORE_SETTING_COLUMNS,
	storeSettingsPayload,
} from "../../loyalty/store-settings-columns";
import {
	changeOf,
	draftOf,
	hasDraftIssues,
	KNOB_RANGES,
	KNOB_SPECS,
	knobMinimum,
	type NumericKnob,
	readDraft,
	readKnob,
} from "./confirmation-fields";

const vnd = createFormatters({
	currencyCode: "VND",
	uiLocale: "vi-VN",
	timeZone: "Asia/Ho_Chi_Minh",
	unitLabels: { million: "tr", billion: "tỷ" },
});
const usd = createFormatters({
	currencyCode: "USD",
	uiLocale: "en-US",
	timeZone: "America/New_York",
	unitLabels: { million: "m", billion: "bn" },
});
const VND = { formatters: vnd, currencyCode: "VND" };

const SAVED: LoyaltyStoreSettings = {
	...DEFAULT_STORE_KNOBS,
	storeId: "11111111-1111-4111-8111-111111111111",
	updatedAt: "2026-11-20T02:00:00Z",
};

function specOf(knob: NumericKnob) {
	const found = KNOB_SPECS.find((spec) => spec.knob === knob);
	if (found === undefined) throw new Error(knob);
	return found;
}

/** Plain digits, the way a person types them without grouping. */
function typed(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: String(value).replace(".", ",");
}

describe("the knobs of the counter confirmation", () => {
	it("covers every numeric column the database checks, with labels and hints in both languages", () => {
		const numeric = Object.keys(KNOB_RANGES).sort();
		expect(KNOB_SPECS.map((spec) => spec.knob).sort()).toEqual(numeric);
		for (const spec of KNOB_SPECS) {
			for (const key of [spec.labelKey, spec.hintKey]) {
				expect(messages.vi[key], key).toBeTruthy();
				expect(messages.en[key], key).toBeTruthy();
			}
		}
		expect(Object.keys(STORE_SETTING_COLUMNS)).toHaveLength(20);
	});

	// Boundary value analysis (ISTQB, two-value): for each knob the smallest and
	// largest value the check constraint of loyalty_store_settings accepts, and
	// the nearest values outside them.
	const boundaries = KNOB_SPECS.map((spec) => {
		const min = knobMinimum(spec.knob, vnd);
		const step = spec.kind === "percent" ? 0.01 : 1;
		return [spec.knob, min, spec.range.max, step] as const;
	});

	it.each(boundaries)(
		"accepts %s at its bounds %d and %d and refuses one step outside",
		(knob, min, max, step) => {
			const spec = specOf(knob);
			expect(readKnob(spec, typed(min), VND).issue, `${knob} min`).toBeNull();
			expect(readKnob(spec, typed(max), VND).issue, `${knob} max`).toBeNull();
			const below = Number((min - step).toFixed(2));
			const above = Number((max + step).toFixed(2));
			if (below >= 0) {
				expect(
					readKnob(spec, typed(below), VND).issue,
					`${knob} below`,
				).not.toBeNull();
			}
			expect(
				readKnob(spec, typed(above), VND).issue,
				`${knob} above`,
			).not.toBeNull();
		},
	);

	it("mirrors the database ranges exactly", () => {
		expect(KNOB_RANGES).toEqual({
			maxBillAmount: { min: 0, max: 100_000_000, minExclusive: true },
			billManagerApprovalAbove: {
				min: 0,
				max: 100_000_000,
				minExclusive: true,
			},
			billAmountTolerance: { min: 0, max: 100_000 },
			billUnconfirmedHours: { min: 1, max: 168 },
			billStaffShiftCap: { min: 1, max: 1_000 },
			staffAmountPerDay: { min: 0, max: 1_000_000_000, minExclusive: true },
			storeEarnsPerDay: { min: 1, max: 5_000 },
			staffRedemptionsPerDay: { min: 1, max: 1_000 },
			reverseWindowMinutes: { min: 15, max: 1_440 },
			billAuditSamplePct: { min: 0, max: 100 },
			counterCodeTtlSeconds: { min: 30, max: 600 },
			autoApproveMaxAmount: { min: 0, max: 100_000_000 },
			autoApprovePerDay: { min: 0, max: 500 },
			billPhotoRetentionDays: { min: 1, max: 365 },
		});
	});

	it("makes a positive money knob start at one đồng, or one cent where the currency has cents", () => {
		expect(knobMinimum("maxBillAmount", vnd)).toBe(1);
		expect(knobMinimum("maxBillAmount", usd)).toBe(0.01);
		expect(knobMinimum("billAmountTolerance", vnd)).toBe(0);
		expect(readKnob(specOf("maxBillAmount"), "0", VND).issue?.key).toBe(
			"atLeast",
		);
	});

	// Equivalence partitions of a typed text: empty, not a number, fraction for a
	// whole-number knob, negative, valid.
	it.each([
		["", "required"],
		["mười", "number"],
		["2,5", "integer"],
		["-1", "range"],
	] as const)("refuses %j for a count with %s", (text, key) => {
		expect(readKnob(specOf("billStaffShiftCap"), text, VND).issue?.key).toBe(
			key,
		);
	});

	it("reads grouped money and the audit share with two decimals, refusing a third", () => {
		expect(readKnob(specOf("maxBillAmount"), "1.500.000", VND)).toEqual({
			value: 1_500_000,
			issue: null,
		});
		expect(readKnob(specOf("billAuditSamplePct"), "2,55", VND)).toEqual({
			value: 2.55,
			issue: null,
		});
		expect(
			readKnob(specOf("billAuditSamplePct"), "2,555", VND).issue?.key,
		).toBe("decimals");
	});
});

describe("the draft of one store", () => {
	it("round-trips the saved row with no change and no issue", () => {
		const draft = draftOf(SAVED, vnd);
		const reading = readDraft(draft, VND);
		expect(hasDraftIssues(reading)).toBe(false);
		expect(changeOf(SAVED, reading.values)).toEqual({});
	});

	it("sends only the knobs that changed, by their column names", () => {
		const draft = draftOf(SAVED, vnd);
		const reading = readDraft(
			{
				...draft,
				confirmation: "staff",
				selfClaim: true,
				texts: { ...draft.texts, billStaffShiftCap: "30" },
			},
			VND,
		);
		const change = changeOf(SAVED, reading.values);
		expect(change).toEqual({
			confirmation: "staff",
			selfClaim: true,
			billStaffShiftCap: 30,
		});
		expect(storeSettingsPayload(change)).toEqual({
			confirmation: "staff",
			self_claim: true,
			bill_staff_shift_cap: 30,
		});
	});

	// Decision table of the two rules across knobs (the table checks of
	// loyalty_store_settings): approval threshold and auto-approval amount
	// against the largest bill.
	it.each([
		["1000000", "0", null, null],
		["2000000", "2000000", null, null],
		["2000001", "0", "atMost", null],
		["1000000", "2000001", null, "atMost"],
		["2000001", "2000001", "atMost", "atMost"],
	] as const)(
		"with the largest bill at 2,000,000, approval above %s and auto-approval up to %s give %s and %s",
		(approval, auto, approvalIssue, autoIssue) => {
			const draft = draftOf(SAVED, vnd);
			const reading = readDraft(
				{
					...draft,
					texts: {
						...draft.texts,
						billManagerApprovalAbove: approval,
						autoApproveMaxAmount: auto,
					},
				},
				VND,
			);
			expect(reading.issues.billManagerApprovalAbove?.key ?? null).toBe(
				approvalIssue,
			);
			expect(reading.issues.autoApproveMaxAmount?.key ?? null).toBe(autoIssue);
		},
	);

	it("never sends a value with an issue", () => {
		const draft = draftOf(SAVED, vnd);
		const reading = readDraft(
			{ ...draft, texts: { ...draft.texts, reverseWindowMinutes: "14" } },
			VND,
		);
		expect(hasDraftIssues(reading)).toBe(true);
		expect(reading.values.reverseWindowMinutes).toBeUndefined();
	});

	it("starts the demo's staff-mode store from its sample values", () => {
		const demo = demoStoreSettings("MOCK-S1");
		expect(demo.confirmation).toBe("staff");
		expect(draftOf(demo, vnd).texts.maxBillAmount).toBe("1.500.000");
		expect(demoStoreSettings("MOCK-S2").confirmation).toBe("pos_sync");
	});
});
