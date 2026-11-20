import type { ReportSettingLimit } from "@fnb/reports";
import type { z } from "zod";
import type { MessageKey } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type {
	ConfirmationMode,
	EvidenceLevel,
	LoyaltyStoreKnob,
	LoyaltyStoreKnobs,
	LoyaltyStoreSettings,
	LoyaltyStoreSettingsChange,
	SilenceOutcome,
} from "../../loyalty/source";
import { formatIntegerText, readIntegerDraft } from "../forms/integer-field";
import { formatMoneyText, readMoneyDraft } from "../forms/money-field";
import { formatPercentText, readPercentDraft } from "../forms/percent-field";
import type { NumberDraft } from "../number-text";
import {
	decimalInRange,
	integerInRange,
	MONEY_COLUMN_SCALE,
	money,
	type ValidationIssue,
} from "../validation";

/** The knobs typed as numbers; the others are choices. */
export type NumericKnob =
	| "maxBillAmount"
	| "billManagerApprovalAbove"
	| "billAmountTolerance"
	| "billUnconfirmedHours"
	| "billStaffShiftCap"
	| "staffAmountPerDay"
	| "storeEarnsPerDay"
	| "staffRedemptionsPerDay"
	| "reverseWindowMinutes"
	| "billAuditSamplePct"
	| "counterCodeTtlSeconds"
	| "autoApproveMaxAmount"
	| "autoApprovePerDay"
	| "billPhotoRetentionDays";

export type KnobKind = "money" | "integer" | "percent";

export type KnobGroup = "main" | "advanced";

/**
 * The range of a knob as the check constraints of loyalty_store_settings
 * hold it (migration 20261120500000). A money knob with minExclusive is
 * "greater than min": its smallest value is one unit of the currency's
 * smallest fraction.
 */
export interface KnobRange {
	readonly min: number;
	readonly max: number;
	readonly minExclusive?: true;
}

export interface KnobSpec {
	readonly knob: NumericKnob;
	readonly kind: KnobKind;
	readonly group: KnobGroup;
	readonly range: KnobRange;
	readonly labelKey: MessageKey;
	readonly hintKey: MessageKey;
	readonly unitKey: MessageKey | null;
}

const MONEY_MAX = 100_000_000;

export const KNOB_RANGES: Readonly<Record<NumericKnob, KnobRange>> = {
	maxBillAmount: { min: 0, max: MONEY_MAX, minExclusive: true },
	billManagerApprovalAbove: { min: 0, max: MONEY_MAX, minExclusive: true },
	billAmountTolerance: { min: 0, max: 100_000 },
	billUnconfirmedHours: { min: 1, max: 168 },
	billStaffShiftCap: { min: 1, max: 1_000 },
	staffAmountPerDay: { min: 0, max: 1_000_000_000, minExclusive: true },
	storeEarnsPerDay: { min: 1, max: 5_000 },
	staffRedemptionsPerDay: { min: 1, max: 1_000 },
	reverseWindowMinutes: { min: 15, max: 1_440 },
	billAuditSamplePct: { min: 0, max: 100 },
	counterCodeTtlSeconds: { min: 30, max: 600 },
	autoApproveMaxAmount: { min: 0, max: MONEY_MAX },
	autoApprovePerDay: { min: 0, max: 500 },
	billPhotoRetentionDays: { min: 1, max: 365 },
};

/** bill_audit_sample_pct is numeric(5, 2). */
export const AUDIT_PERCENT_LIMIT: ReportSettingLimit = {
	min: KNOB_RANGES.billAuditSamplePct.min,
	max: KNOB_RANGES.billAuditSamplePct.max,
	fractionDigits: 2,
};

function spec(
	knob: NumericKnob,
	kind: KnobKind,
	group: KnobGroup,
	unitKey: MessageKey | null = null,
): KnobSpec {
	return {
		knob,
		kind,
		group,
		range: KNOB_RANGES[knob],
		labelKey: `settings.loyalty.confirmation.knob.${knob}` as const,
		hintKey: `settings.loyalty.confirmation.knob.${knob}.hint` as const,
		unitKey,
	};
}

export const KNOB_SPECS: readonly KnobSpec[] = [
	spec("maxBillAmount", "money", "main"),
	spec("billManagerApprovalAbove", "money", "main"),
	spec("billAmountTolerance", "money", "main"),
	spec(
		"billUnconfirmedHours",
		"integer",
		"main",
		"settings.loyalty.unit.hours",
	),
	spec(
		"billStaffShiftCap",
		"integer",
		"main",
		"settings.loyalty.confirmation.unit.bills",
	),
	spec("staffAmountPerDay", "money", "main"),
	spec(
		"storeEarnsPerDay",
		"integer",
		"main",
		"settings.loyalty.confirmation.unit.bills",
	),
	spec(
		"staffRedemptionsPerDay",
		"integer",
		"main",
		"settings.loyalty.confirmation.unit.rewards",
	),
	spec(
		"reverseWindowMinutes",
		"integer",
		"advanced",
		"settings.loyalty.unit.minutes",
	),
	spec("billAuditSamplePct", "percent", "advanced"),
	spec(
		"counterCodeTtlSeconds",
		"integer",
		"advanced",
		"settings.loyalty.unit.seconds",
	),
	spec("autoApproveMaxAmount", "money", "advanced"),
	spec(
		"autoApprovePerDay",
		"integer",
		"advanced",
		"settings.loyalty.confirmation.unit.claims",
	),
	spec(
		"billPhotoRetentionDays",
		"integer",
		"advanced",
		"settings.loyalty.confirmation.unit.days",
	),
];

export const CONFIRMATION_MODE_KEYS: Readonly<
	Record<ConfirmationMode, MessageKey>
> = {
	pos_sync: "settings.loyalty.confirmation.mode.pos_sync",
	staff: "settings.loyalty.confirmation.mode.staff",
};

export const EVIDENCE_LEVEL_KEYS: Readonly<Record<EvidenceLevel, MessageKey>> =
	{
		0: "settings.loyalty.confirmation.level.0",
		1: "settings.loyalty.confirmation.level.1",
		2: "settings.loyalty.confirmation.level.2",
	};

export const SILENCE_OUTCOME_KEYS: Readonly<
	Record<SilenceOutcome, MessageKey>
> = {
	reverse: "settings.loyalty.confirmation.silence.reverse",
	confirm: "settings.loyalty.confirmation.silence.confirm",
};

/** The form's text: numbers as typed, choices as values. */
export interface ConfirmationDraft {
	readonly confirmation: ConfirmationMode;
	readonly billEvidenceRequiredLevel: EvidenceLevel;
	readonly billSilenceOutcome: SilenceOutcome;
	readonly selfClaim: boolean;
	readonly shadowReconcile: boolean;
	readonly texts: Readonly<Record<NumericKnob, string>>;
}

export interface DraftFormat {
	readonly formatters: Formatters;
	readonly currencyCode: string;
}

function moneyDigits(formatters: Formatters): number {
	return Math.min(formatters.moneyFractionDigits, MONEY_COLUMN_SCALE);
}

/** The smallest value a knob takes, in its own units. */
export function knobMinimum(knob: NumericKnob, formatters: Formatters): number {
	const range = KNOB_RANGES[knob];
	if (range.minExclusive !== true) return range.min;
	return range.min + 10 ** -moneyDigits(formatters);
}

export function knobSchema(
	knobSpec: KnobSpec,
	formatters: Formatters,
): z.ZodType {
	const min = knobMinimum(knobSpec.knob, formatters);
	const { max } = knobSpec.range;
	if (knobSpec.kind === "money") {
		return money(moneyDigits(formatters), { min, max });
	}
	if (knobSpec.kind === "percent") {
		return decimalInRange(AUDIT_PERCENT_LIMIT);
	}
	return integerInRange(min, max);
}

export function knobText(
	knobSpec: KnobSpec,
	value: number,
	formatters: Formatters,
): string {
	if (knobSpec.kind === "money") return formatMoneyText(value, formatters);
	if (knobSpec.kind === "percent") {
		return formatPercentText(value, formatters.locale, AUDIT_PERCENT_LIMIT);
	}
	return formatIntegerText(value, formatters.locale);
}

export function readKnob(
	knobSpec: KnobSpec,
	text: string,
	format: DraftFormat,
): NumberDraft {
	const schema = knobSchema(knobSpec, format.formatters);
	if (knobSpec.kind === "money") {
		return readMoneyDraft(text, format.formatters, format.currencyCode, {
			schema,
		});
	}
	if (knobSpec.kind === "percent") {
		return readPercentDraft(text, format.formatters.locale, {
			limit: AUDIT_PERCENT_LIMIT,
			schema,
		});
	}
	return readIntegerDraft(text, format.formatters.locale, schema);
}

export function draftOf(
	settings: LoyaltyStoreKnobs,
	formatters: Formatters,
): ConfirmationDraft {
	const texts = Object.fromEntries(
		KNOB_SPECS.map((knobSpec) => [
			knobSpec.knob,
			knobText(knobSpec, settings[knobSpec.knob], formatters),
		]),
	) as Record<NumericKnob, string>;
	return {
		confirmation: settings.confirmation,
		billEvidenceRequiredLevel: settings.billEvidenceRequiredLevel,
		billSilenceOutcome: settings.billSilenceOutcome,
		selfClaim: settings.selfClaim,
		shadowReconcile: settings.shadowReconcile,
		texts,
	};
}

export interface DraftReading {
	/** Every knob the form edits, when no issue was found. */
	readonly values: Partial<LoyaltyStoreKnobs>;
	readonly issues: Readonly<Partial<Record<NumericKnob, ValidationIssue>>>;
}

/**
 * Reads the draft against the database's ranges, then the two rules across
 * knobs: neither the manager approval threshold nor the auto-approval amount
 * may exceed the largest bill.
 */
export function readDraft(
	draft: ConfirmationDraft,
	format: DraftFormat,
): DraftReading {
	const issues: Partial<Record<NumericKnob, ValidationIssue>> = {};
	const numbers: Partial<Record<NumericKnob, number>> = {};
	for (const knobSpec of KNOB_SPECS) {
		const read = readKnob(knobSpec, draft.texts[knobSpec.knob], format);
		if (read.issue !== null) issues[knobSpec.knob] = read.issue;
		else if (read.value !== null) numbers[knobSpec.knob] = read.value;
	}
	const largest = numbers.maxBillAmount;
	if (largest !== undefined) {
		for (const knob of [
			"billManagerApprovalAbove",
			"autoApproveMaxAmount",
		] as const) {
			const value = numbers[knob];
			if (value !== undefined && value > largest) {
				issues[knob] = { key: "atMost", max: largest };
				delete numbers[knob];
			}
		}
	}
	return {
		values: {
			confirmation: draft.confirmation,
			billEvidenceRequiredLevel: draft.billEvidenceRequiredLevel,
			billSilenceOutcome: draft.billSilenceOutcome,
			selfClaim: draft.selfClaim,
			shadowReconcile: draft.shadowReconcile,
			...numbers,
		},
		issues,
	};
}

/** Only the knobs that differ from the saved row: set_loyalty_store_settings takes a partial object. */
export function changeOf(
	saved: LoyaltyStoreSettings,
	values: Partial<LoyaltyStoreKnobs>,
): LoyaltyStoreSettingsChange {
	const change: Partial<Record<LoyaltyStoreKnob, unknown>> = {};
	for (const [knob, value] of Object.entries(values) as [
		LoyaltyStoreKnob,
		unknown,
	][]) {
		if (value !== undefined && value !== saved[knob]) change[knob] = value;
	}
	return change as LoyaltyStoreSettingsChange;
}

export function hasDraftIssues(reading: DraftReading): boolean {
	return Object.keys(reading.issues).length > 0;
}
