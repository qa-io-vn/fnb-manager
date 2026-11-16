import {
	DEFAULT_REPORT_SETTINGS,
	isDefaultReportSettings,
	REPORT_SETTING_LIMITS,
	REPORT_SETTINGS_COLUMNS,
	type ReportSettingLimit,
	type ReportSettings,
} from "@fnb/reports";
import type { MessageKey } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { formatIntegerText, readIntegerDraft } from "../forms/integer-field";
import { type BoundFormatter, numericBound } from "../forms/issue-text";
import { formatMoneyText, readMoneyDraft } from "../forms/money-field";
import {
	formatPercentBound,
	formatPercentText,
	readPercentDraft,
} from "../forms/percent-field";
import {
	fractionToPercent,
	type NumberDraft,
	percentLimitOf,
	percentToFraction,
} from "../number-text";
import type { ReportSettingsState } from "../source";
import { decimalInRange, money, type ValidationIssue } from "../validation";

export const THRESHOLD_FIELDS = [
	"menuWindowDays",
	"menuPopularityFactor",
	"menuLowSampleItems",
	"cashAbsThreshold",
	"cashRelThreshold",
	"peakHours",
	"deadHourRatio",
	"busyHourRatio",
	"promoPreWeeks",
] as const satisfies readonly (keyof ReportSettings)[];

export type ThresholdField = (typeof THRESHOLD_FIELDS)[number];

export type ThresholdKind = "integer" | "percent" | "money";

export type ThresholdGroup = "menu" | "cash" | "hours" | "promotions";

export interface ThresholdSpec {
	readonly field: ThresholdField;
	readonly group: ThresholdGroup;
	readonly kind: ThresholdKind;
	readonly labelKey: MessageKey;
	readonly hintKey: MessageKey;
	readonly unitKey: MessageKey | null;
}

export const THRESHOLD_GROUPS: readonly {
	readonly group: ThresholdGroup;
	readonly titleKey: MessageKey;
}[] = [
	{ group: "menu", titleKey: "settings.thresholds.group.menu" },
	{ group: "cash", titleKey: "settings.thresholds.group.cash" },
	{ group: "hours", titleKey: "settings.thresholds.group.hours" },
	{ group: "promotions", titleKey: "settings.thresholds.group.promotions" },
];

export const THRESHOLD_SPECS: readonly ThresholdSpec[] = [
	{
		field: "menuWindowDays",
		group: "menu",
		kind: "integer",
		labelKey: "settings.thresholds.menuWindowDays.label",
		hintKey: "settings.thresholds.menuWindowDays.hint",
		unitKey: "settings.thresholds.unit.days",
	},
	{
		field: "menuPopularityFactor",
		group: "menu",
		kind: "percent",
		labelKey: "settings.thresholds.menuPopularityFactor.label",
		hintKey: "settings.thresholds.menuPopularityFactor.hint",
		unitKey: null,
	},
	{
		field: "menuLowSampleItems",
		group: "menu",
		kind: "integer",
		labelKey: "settings.thresholds.menuLowSampleItems.label",
		hintKey: "settings.thresholds.menuLowSampleItems.hint",
		unitKey: "settings.thresholds.unit.items",
	},
	{
		field: "cashAbsThreshold",
		group: "cash",
		kind: "money",
		labelKey: "settings.thresholds.cashAbsThreshold.label",
		hintKey: "settings.thresholds.cashAbsThreshold.hint",
		unitKey: null,
	},
	{
		field: "cashRelThreshold",
		group: "cash",
		kind: "percent",
		labelKey: "settings.thresholds.cashRelThreshold.label",
		hintKey: "settings.thresholds.cashRelThreshold.hint",
		unitKey: null,
	},
	{
		field: "peakHours",
		group: "hours",
		kind: "integer",
		labelKey: "settings.thresholds.peakHours.label",
		hintKey: "settings.thresholds.peakHours.hint",
		unitKey: "settings.thresholds.unit.hours",
	},
	{
		field: "deadHourRatio",
		group: "hours",
		kind: "percent",
		labelKey: "settings.thresholds.deadHourRatio.label",
		hintKey: "settings.thresholds.deadHourRatio.hint",
		unitKey: null,
	},
	{
		field: "busyHourRatio",
		group: "hours",
		kind: "percent",
		labelKey: "settings.thresholds.busyHourRatio.label",
		hintKey: "settings.thresholds.busyHourRatio.hint",
		unitKey: null,
	},
	{
		field: "promoPreWeeks",
		group: "promotions",
		kind: "integer",
		labelKey: "settings.thresholds.promoPreWeeks.label",
		hintKey: "settings.thresholds.promoPreWeeks.hint",
		unitKey: "settings.thresholds.unit.weeks",
	},
];

export interface ThresholdFormat {
	readonly formatters: Formatters;
	readonly currencyCode: string;
}

export type ThresholdTexts = Readonly<Record<ThresholdField, string>>;

function limitOf(spec: ThresholdSpec): ReportSettingLimit {
	return REPORT_SETTING_LIMITS[spec.field];
}

export function shownLimitOf(spec: ThresholdSpec): ReportSettingLimit {
	return spec.kind === "percent"
		? percentLimitOf(limitOf(spec))
		: limitOf(spec);
}

export function thresholdText(
	spec: ThresholdSpec,
	value: number,
	format: ThresholdFormat,
): string {
	const { locale } = format.formatters;
	if (spec.kind === "money") return formatMoneyText(value, format.formatters);
	if (spec.kind === "integer") return formatIntegerText(value, locale);
	return formatPercentText(
		fractionToPercent(value, limitOf(spec).fractionDigits),
		locale,
		shownLimitOf(spec),
	);
}

export function thresholdTextsOf(
	settings: ReportSettings,
	format: ThresholdFormat,
): ThresholdTexts {
	return Object.fromEntries(
		THRESHOLD_SPECS.map((spec) => [
			spec.field,
			thresholdText(spec, settings[spec.field], format),
		]),
	) as ThresholdTexts;
}

export function readThreshold(
	spec: ThresholdSpec,
	text: string,
	format: ThresholdFormat,
): NumberDraft {
	const { locale, moneyFractionDigits } = format.formatters;
	if (spec.kind === "money") {
		return readMoneyDraft(text, format.formatters, format.currencyCode, {
			schema: money(moneyFractionDigits, { min: limitOf(spec).min }),
		});
	}
	if (spec.kind === "integer") {
		return readIntegerDraft(text, locale, decimalInRange(limitOf(spec)));
	}
	const shown = readPercentDraft(text, locale, { limit: shownLimitOf(spec) });
	return {
		value:
			shown.value === null
				? null
				: percentToFraction(shown.value, limitOf(spec).fractionDigits),
		issue: shown.issue,
	};
}

export function thresholdBoundFormatter(
	spec: ThresholdSpec,
	format: ThresholdFormat,
): BoundFormatter {
	const { formatters } = format;
	if (spec.kind === "money") return numericBound(formatters.moneyExact);
	if (spec.kind === "integer") return numericBound(formatters.count);
	return numericBound((value) =>
		formatPercentBound(value, formatters.locale, shownLimitOf(spec)),
	);
}

export function thresholdDefaultText(
	spec: ThresholdSpec,
	format: ThresholdFormat,
	unit: string | null,
): string {
	const value = DEFAULT_REPORT_SETTINGS[spec.field];
	if (spec.kind === "money") return format.formatters.moneyExact(value);
	if (spec.kind === "percent") {
		return formatPercentBound(
			fractionToPercent(value, limitOf(spec).fractionDigits),
			format.formatters.locale,
			shownLimitOf(spec),
		);
	}
	const text = formatIntegerText(value, format.formatters.locale);
	return unit === null ? text : `${text} ${unit}`;
}

export interface ThresholdDraft {
	readonly changes: Partial<ReportSettings> | null;
	readonly issues: Partial<Record<ThresholdField, ValidationIssue>>;
	readonly changed: readonly ThresholdField[];
}

export function readThresholdDraft(
	saved: ReportSettings,
	texts: ThresholdTexts,
	format: ThresholdFormat,
): ThresholdDraft {
	const savedTexts = thresholdTextsOf(saved, format);
	const changes: Partial<Record<ThresholdField, number>> = {};
	const issues: Partial<Record<ThresholdField, ValidationIssue>> = {};
	const changed: ThresholdField[] = [];
	for (const spec of THRESHOLD_SPECS) {
		const { field } = spec;
		const draft = readThreshold(spec, texts[field], format);
		if (draft.issue !== null || draft.value === null) {
			issues[field] = draft.issue ?? { key: "number" };
			if (texts[field] !== savedTexts[field]) changed.push(field);
			continue;
		}
		if (draft.value === saved[field]) continue;
		changes[field] = draft.value;
		changed.push(field);
	}
	return {
		changes: Object.keys(issues).length === 0 ? changes : null,
		issues,
		changed,
	};
}

export function stateAfterSave(
	previous: ReportSettingsState,
	changes: Partial<ReportSettings>,
	savedAt: string,
): ReportSettingsState {
	const settings = { ...previous.settings, ...changes };
	const hasRow = !isDefaultReportSettings(settings);
	return {
		settings,
		hasRow,
		audit: hasRow ? { changedAt: savedAt, author: { kind: "you" } } : null,
	};
}

export function thresholdFieldOfConstraint(
	constraint: string | null,
): ThresholdField | null {
	if (constraint === null) return null;
	return (
		THRESHOLD_FIELDS.find(
			(field) =>
				constraint === field ||
				constraint ===
					`report_settings_${REPORT_SETTINGS_COLUMNS[field]}_check`,
		) ?? null
	);
}

export function rangeIssueOf(spec: ThresholdSpec): ValidationIssue {
	const shown = shownLimitOf(spec);
	return spec.kind === "money"
		? { key: "atLeast", min: shown.min }
		: { key: "range", min: shown.min, max: shown.max };
}
