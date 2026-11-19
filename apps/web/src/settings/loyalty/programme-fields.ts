import {
	DEFAULT_LOYALTY_PARAMETERS,
	hasControlCharacter,
	LOYALTY_PARAMETER_RANGES,
	LOYALTY_PROGRAMME_STATUSES,
	type LoyaltyParameters,
	type LoyaltyProgrammeStatus,
	loyaltyProgrammeSchema,
	MAX_EXCLUDED_ORDER_SOURCES,
	NOTIFICATION_DECISIONS,
	type NotificationDecision,
	type ParameterRange,
} from "@fnb/core";
import { MONEY_COLUMN_MAX, type ReportSettingLimit } from "@fnb/reports";
import type { MessageKey } from "../../i18n";
import {
	businessDayStartOf,
	type IsoDate,
	isIsoDate,
	todayIn,
} from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import type {
	LoyaltyProgrammeChange,
	LoyaltyProgrammeRecord,
	ProgrammeField,
} from "../../loyalty/source";
import { formatIntegerText, readIntegerDraft } from "../forms/integer-field";
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
import { decimalInRange, money, type ValidationIssue } from "../validation";

const SAFE_NAME = "-";
const SAFE_START = "2000-01-01";

export const PROGRAMME_NAME_MAX = 120;
export const NOTIFICATION_BASIS_MAX = 500;
export const ORDER_SOURCE_MAX = 100;
const BREAKAGE_FRACTION_DIGITS = 3;

export type NumericParameter = Exclude<
	keyof LoyaltyParameters,
	"excludedOrderSources"
>;

export type ParameterKind = "integer" | "money" | "percent";

export type ParameterGroup =
	| "stamps"
	| "points"
	| "limits"
	| "checkin"
	| "value";

export interface ParameterSpec {
	readonly field: NumericParameter;
	readonly group: ParameterGroup;
	readonly kind: ParameterKind;
	readonly unitKey: MessageKey | null;
}

export const PARAMETER_GROUPS: readonly {
	readonly group: ParameterGroup;
	readonly titleKey: MessageKey;
}[] = [
	{ group: "stamps", titleKey: "settings.loyalty.group.stamps" },
	{ group: "points", titleKey: "settings.loyalty.group.points" },
	{ group: "limits", titleKey: "settings.loyalty.group.limits" },
	{ group: "checkin", titleKey: "settings.loyalty.group.checkin" },
	{ group: "value", titleKey: "settings.loyalty.group.value" },
];

export const PARAMETER_SPECS: readonly ParameterSpec[] = [
	{
		field: "stampsPerCard",
		group: "stamps",
		kind: "integer",
		unitKey: "settings.loyalty.unit.stamps",
	},
	{
		field: "stampMinBillAmount",
		group: "stamps",
		kind: "money",
		unitKey: null,
	},
	{
		field: "welcomeStamps",
		group: "stamps",
		kind: "integer",
		unitKey: "settings.loyalty.unit.stamps",
	},
	{
		field: "stampValidityMonths",
		group: "stamps",
		kind: "integer",
		unitKey: "settings.loyalty.unit.months",
	},
	{
		field: "pointUnitAmount",
		group: "points",
		kind: "money",
		unitKey: null,
	},
	{
		field: "pointsPerUnit",
		group: "points",
		kind: "integer",
		unitKey: "settings.loyalty.unit.points",
	},
	{
		field: "pointsExpiryMonths",
		group: "points",
		kind: "integer",
		unitKey: "settings.loyalty.unit.months",
	},
	{
		field: "earningInvoicesPerPhonePerDay",
		group: "limits",
		kind: "integer",
		unitKey: "settings.loyalty.unit.invoicesPerDay",
	},
	{
		field: "receiptClaimsPerPhonePerDay",
		group: "limits",
		kind: "integer",
		unitKey: "settings.loyalty.unit.claimsPerDay",
	},
	{
		field: "checkinWindowBeforeMinutes",
		group: "checkin",
		kind: "integer",
		unitKey: "settings.loyalty.unit.minutes",
	},
	{
		field: "checkinWindowAfterMinutes",
		group: "checkin",
		kind: "integer",
		unitKey: "settings.loyalty.unit.minutes",
	},
	{
		field: "checkinCodeTtlSeconds",
		group: "checkin",
		kind: "integer",
		unitKey: "settings.loyalty.unit.seconds",
	},
	{
		field: "checkinPendingHours",
		group: "checkin",
		kind: "integer",
		unitKey: "settings.loyalty.unit.hours",
	},
	{
		field: "receiptClaimWindowHours",
		group: "checkin",
		kind: "integer",
		unitKey: "settings.loyalty.unit.hours",
	},
	{
		field: "pointValueAmount",
		group: "value",
		kind: "money",
		unitKey: null,
	},
	{
		field: "expectedBreakageRate",
		group: "value",
		kind: "percent",
		unitKey: null,
	},
];

export const PARAMETER_LABEL_KEYS: Readonly<
	Record<NumericParameter, { label: MessageKey; hint: MessageKey }>
> = {
	stampsPerCard: {
		label: "settings.loyalty.param.stampsPerCard.label",
		hint: "settings.loyalty.param.stampsPerCard.hint",
	},
	stampMinBillAmount: {
		label: "settings.loyalty.param.stampMinBillAmount.label",
		hint: "settings.loyalty.param.stampMinBillAmount.hint",
	},
	welcomeStamps: {
		label: "settings.loyalty.param.welcomeStamps.label",
		hint: "settings.loyalty.param.welcomeStamps.hint",
	},
	stampValidityMonths: {
		label: "settings.loyalty.param.stampValidityMonths.label",
		hint: "settings.loyalty.param.stampValidityMonths.hint",
	},
	pointUnitAmount: {
		label: "settings.loyalty.param.pointUnitAmount.label",
		hint: "settings.loyalty.param.pointUnitAmount.hint",
	},
	pointsPerUnit: {
		label: "settings.loyalty.param.pointsPerUnit.label",
		hint: "settings.loyalty.param.pointsPerUnit.hint",
	},
	pointsExpiryMonths: {
		label: "settings.loyalty.param.pointsExpiryMonths.label",
		hint: "settings.loyalty.param.pointsExpiryMonths.hint",
	},
	earningInvoicesPerPhonePerDay: {
		label: "settings.loyalty.param.earningInvoicesPerPhonePerDay.label",
		hint: "settings.loyalty.param.earningInvoicesPerPhonePerDay.hint",
	},
	receiptClaimsPerPhonePerDay: {
		label: "settings.loyalty.param.receiptClaimsPerPhonePerDay.label",
		hint: "settings.loyalty.param.receiptClaimsPerPhonePerDay.hint",
	},
	checkinWindowBeforeMinutes: {
		label: "settings.loyalty.param.checkinWindowBeforeMinutes.label",
		hint: "settings.loyalty.param.checkinWindowBeforeMinutes.hint",
	},
	checkinWindowAfterMinutes: {
		label: "settings.loyalty.param.checkinWindowAfterMinutes.label",
		hint: "settings.loyalty.param.checkinWindowAfterMinutes.hint",
	},
	checkinCodeTtlSeconds: {
		label: "settings.loyalty.param.checkinCodeTtlSeconds.label",
		hint: "settings.loyalty.param.checkinCodeTtlSeconds.hint",
	},
	checkinPendingHours: {
		label: "settings.loyalty.param.checkinPendingHours.label",
		hint: "settings.loyalty.param.checkinPendingHours.hint",
	},
	receiptClaimWindowHours: {
		label: "settings.loyalty.param.receiptClaimWindowHours.label",
		hint: "settings.loyalty.param.receiptClaimWindowHours.hint",
	},
	pointValueAmount: {
		label: "settings.loyalty.param.pointValueAmount.label",
		hint: "settings.loyalty.param.pointValueAmount.hint",
	},
	expectedBreakageRate: {
		label: "settings.loyalty.param.expectedBreakageRate.label",
		hint: "settings.loyalty.param.expectedBreakageRate.hint",
	},
};

export const STATUS_KEYS: Readonly<Record<LoyaltyProgrammeStatus, MessageKey>> =
	{
		draft: "settings.loyalty.status.draft",
		active: "settings.loyalty.status.active",
		paused: "settings.loyalty.status.paused",
		ended: "settings.loyalty.status.ended",
	};

export const DECISION_KEYS: Readonly<
	Record<NotificationDecision, { label: MessageKey; body: MessageKey }>
> = {
	pending: {
		label: "settings.loyalty.decision.pending",
		body: "settings.loyalty.decision.pending.body",
	},
	notified: {
		label: "settings.loyalty.decision.notified",
		body: "settings.loyalty.decision.notified.body",
	},
	below_threshold: {
		label: "settings.loyalty.decision.below_threshold",
		body: "settings.loyalty.decision.below_threshold.body",
	},
	not_required: {
		label: "settings.loyalty.decision.not_required",
		body: "settings.loyalty.decision.not_required.body",
	},
};

export interface ProgrammeTexts {
	readonly name: string;
	readonly startsOn: string;
	readonly endsOn: string;
	readonly rewardBudgetAmount: string;
	readonly status: LoyaltyProgrammeStatus;
	readonly notificationDecision: NotificationDecision;
	readonly notificationBasis: string;
	readonly notificationDecidedOn: string;
	readonly excludedOrderSources: string;
	readonly parameters: Readonly<Record<NumericParameter, string>>;
}

export interface ProgrammeFormat {
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly timeZone: string;
}

export type ProgrammeIssue =
	| { readonly kind: "value"; readonly issue: ValidationIssue }
	| { readonly kind: "rule"; readonly key: MessageKey };

export type ProgrammeIssues = Readonly<
	Partial<Record<ProgrammeField, ProgrammeIssue>>
>;

export interface ProgrammeDraft {
	readonly issues: ProgrammeIssues;
	readonly changed: readonly ProgrammeField[];
	readonly change: LoyaltyProgrammeChange | null;
}

export function shownLimitOf(spec: ParameterSpec): ReportSettingLimit {
	const range: ParameterRange = LOYALTY_PARAMETER_RANGES[spec.field];
	if (spec.kind === "percent") {
		return percentLimitOf({
			min: range.min,
			max: range.max,
			fractionDigits: BREAKAGE_FRACTION_DIGITS,
		});
	}
	return {
		min: range.min,
		max: range.max,
		fractionDigits: range.integer ? 0 : 2,
	};
}

export function parameterText(
	spec: ParameterSpec,
	value: number,
	format: ProgrammeFormat,
): string {
	const { locale } = format.formatters;
	if (spec.kind === "money") return formatMoneyText(value, format.formatters);
	if (spec.kind === "integer") return formatIntegerText(value, locale);
	return formatPercentText(
		fractionToPercent(value, BREAKAGE_FRACTION_DIGITS),
		locale,
		shownLimitOf(spec),
	);
}

export function parameterDefaultText(
	spec: ParameterSpec,
	format: ProgrammeFormat,
	unit: string | null = null,
): string {
	const value = DEFAULT_LOYALTY_PARAMETERS[spec.field];
	if (spec.kind === "money") return format.formatters.moneyExact(value);
	if (spec.kind === "percent") {
		return formatPercentBound(
			fractionToPercent(value, BREAKAGE_FRACTION_DIGITS),
			format.formatters.locale,
			shownLimitOf(spec),
		);
	}
	const text = parameterText(spec, value, format);
	return unit === null ? text : `${text} ${unit}`;
}

export function readParameter(
	spec: ParameterSpec,
	text: string,
	format: ProgrammeFormat,
): NumberDraft {
	const range: ParameterRange = LOYALTY_PARAMETER_RANGES[spec.field];
	const { formatters } = format;
	if (spec.kind === "money") {
		return readMoneyDraft(text, formatters, format.currencyCode, {
			schema: money(formatters.moneyFractionDigits, {
				min: range.min,
				max: range.max,
			}),
		});
	}
	if (spec.kind === "integer") {
		return readIntegerDraft(
			text,
			formatters.locale,
			decimalInRange({ min: range.min, max: range.max, fractionDigits: 0 }),
		);
	}
	const shown = readPercentDraft(text, formatters.locale, {
		limit: shownLimitOf(spec),
	});
	return {
		value:
			shown.value === null
				? null
				: percentToFraction(shown.value, BREAKAGE_FRACTION_DIGITS),
		issue: shown.issue,
	};
}

export function decidedOnOf(
	decidedAt: string | null,
	timeZone: string,
): IsoDate | "" {
	return decidedAt === null ? "" : todayIn(timeZone, new Date(decidedAt));
}

export function decidedAtOf(date: IsoDate, timeZone: string): string {
	return businessDayStartOf(date, {
		timeZone,
		businessDayStartMinutes: 0,
	}).toISOString();
}

export function programmeTextsOf(
	record: LoyaltyProgrammeRecord | null,
	format: ProgrammeFormat,
	today: IsoDate,
): ProgrammeTexts {
	const parameters = record?.parameters ?? DEFAULT_LOYALTY_PARAMETERS;
	return {
		name: record?.name ?? "",
		startsOn: record?.startsOn ?? today,
		endsOn: record?.endsOn ?? "",
		rewardBudgetAmount: formatMoneyText(
			record?.rewardBudgetAmount ?? 0,
			format.formatters,
		),
		status: record?.status ?? "draft",
		notificationDecision: record?.notificationDecision ?? "pending",
		notificationBasis: record?.notificationBasis ?? "",
		notificationDecidedOn: decidedOnOf(
			record?.notificationDecidedAt ?? null,
			format.timeZone,
		),
		excludedOrderSources: parameters.excludedOrderSources.join("\n"),
		parameters: Object.fromEntries(
			PARAMETER_SPECS.map((spec) => [
				spec.field,
				parameterText(spec, parameters[spec.field], format),
			]),
		) as Record<NumericParameter, string>,
	};
}

function value(issue: ValidationIssue): ProgrammeIssue {
	return { kind: "value", issue };
}

function rule(key: MessageKey): ProgrammeIssue {
	return { kind: "rule", key };
}

function plainTextIssue(
	text: string,
	max: number,
	required: boolean,
): ProgrammeIssue | null {
	const trimmed = text.trim();
	if (trimmed === "") return required ? value({ key: "required" }) : null;
	if ([...trimmed].length > max) return value({ key: "textLength", max });
	if (hasControlCharacter(trimmed)) {
		return rule("settings.loyalty.error.plainText");
	}
	return null;
}

export function orderSourcesOf(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

function orderSourcesIssue(sources: readonly string[]): ProgrammeIssue | null {
	if (sources.length > MAX_EXCLUDED_ORDER_SOURCES) {
		return rule("settings.loyalty.error.tooManySources");
	}
	if (sources.some((source) => [...source].length > ORDER_SOURCE_MAX)) {
		return value({ key: "textLength", max: ORDER_SOURCE_MAX });
	}
	if (sources.some(hasControlCharacter)) {
		return rule("settings.loyalty.error.plainText");
	}
	return null;
}

function dateIssue(text: string, required: boolean): ProgrammeIssue | null {
	if (text === "") return required ? value({ key: "required" }) : null;
	return isIsoDate(text) ? null : value({ key: "date" });
}

const RULE_KEYS: Readonly<
	Record<string, readonly [ProgrammeField, MessageKey]>
> = {
	endsOn: ["endsOn", "settings.loyalty.error.endBeforeStart"],
	notificationBasis: [
		"notificationBasis",
		"settings.loyalty.error.basisRequired",
	],
	status: ["status", "settings.loyalty.hold.refused"],
	welcomeStamps: ["welcomeStamps", "settings.loyalty.error.welcomeBelowCard"],
};

function schemaIssues(
	candidate: unknown,
): Partial<Record<ProgrammeField, ProgrammeIssue>> {
	const parsed = loyaltyProgrammeSchema.safeParse(candidate);
	if (parsed.success) return {};
	const issues: Partial<Record<ProgrammeField, ProgrammeIssue>> = {};
	for (const issue of parsed.error.issues) {
		const last = issue.path.at(-1);
		const known = typeof last === "string" ? RULE_KEYS[last] : undefined;
		if (known !== undefined) {
			issues[known[0]] ??= rule(known[1]);
		}
	}
	return issues;
}

function sameTexts(left: ProgrammeTexts, right: ProgrammeTexts) {
	const changed: ProgrammeField[] = [];
	for (const field of [
		"name",
		"startsOn",
		"endsOn",
		"rewardBudgetAmount",
		"status",
		"notificationDecision",
		"notificationBasis",
		"notificationDecidedOn",
		"excludedOrderSources",
	] as const) {
		if (left[field] !== right[field]) changed.push(field);
	}
	for (const spec of PARAMETER_SPECS) {
		if (left.parameters[spec.field] !== right.parameters[spec.field]) {
			changed.push(spec.field);
		}
	}
	return changed;
}

export function isProgrammeStatus(
	text: string,
): text is LoyaltyProgrammeStatus {
	return (LOYALTY_PROGRAMME_STATUSES as readonly string[]).includes(text);
}

export function isNotificationDecision(
	text: string,
): text is NotificationDecision {
	return (NOTIFICATION_DECISIONS as readonly string[]).includes(text);
}

export function readProgrammeDraft(
	saved: LoyaltyProgrammeRecord | null,
	savedTexts: ProgrammeTexts,
	texts: ProgrammeTexts,
	format: ProgrammeFormat,
): ProgrammeDraft {
	const issues: Partial<Record<ProgrammeField, ProgrammeIssue>> = {};
	const note = (field: ProgrammeField, issue: ProgrammeIssue | null) => {
		if (issue !== null) issues[field] = issue;
	};
	note("name", plainTextIssue(texts.name, PROGRAMME_NAME_MAX, true));
	note("startsOn", dateIssue(texts.startsOn, true));
	note("endsOn", dateIssue(texts.endsOn, false));
	const budget = readMoneyDraft(
		texts.rewardBudgetAmount,
		format.formatters,
		format.currencyCode,
		{
			schema: money(format.formatters.moneyFractionDigits, {
				min: 0,
				max: MONEY_COLUMN_MAX,
			}),
		},
	);
	note(
		"rewardBudgetAmount",
		budget.issue === null ? null : value(budget.issue),
	);
	const parameters: Record<string, number> = {};
	for (const spec of PARAMETER_SPECS) {
		const draft = readParameter(spec, texts.parameters[spec.field], format);
		note(spec.field, draft.issue === null ? null : value(draft.issue));
		parameters[spec.field] =
			draft.value ??
			saved?.parameters[spec.field] ??
			DEFAULT_LOYALTY_PARAMETERS[spec.field];
	}
	const sources = orderSourcesOf(texts.excludedOrderSources);
	note("excludedOrderSources", orderSourcesIssue(sources));
	const basis = texts.notificationBasis.trim();
	note(
		"notificationBasis",
		plainTextIssue(texts.notificationBasis, NOTIFICATION_BASIS_MAX, false),
	);
	const pending = texts.notificationDecision === "pending";
	note(
		"notificationDecidedOn",
		pending ? null : dateIssue(texts.notificationDecidedOn, false),
	);
	const candidate = {
		name: issues.name === undefined ? texts.name.trim() : SAFE_NAME,
		startsOn: isIsoDate(texts.startsOn) ? texts.startsOn : SAFE_START,
		endsOn: isIsoDate(texts.endsOn) ? texts.endsOn : null,
		rewardBudgetAmount: budget.value ?? 0,
		status: texts.status,
		notificationDecision: texts.notificationDecision,
		notificationBasis:
			basis === "" || issues.notificationBasis !== undefined ? null : basis,
		parameters: { ...parameters, excludedOrderSources: [] },
	};
	for (const [field, issue] of Object.entries(schemaIssues(candidate))) {
		const key = field as ProgrammeField;
		if (issues[key] === undefined && issue !== undefined) issues[key] = issue;
	}
	if (texts.status === "active" && pending) {
		issues.status ??= rule("settings.loyalty.hold.refused");
	}
	const changed = sameTexts(savedTexts, texts);
	const valid = Object.keys(issues).length === 0;
	const decidedOn = texts.notificationDecidedOn;
	const keepsDecisionDate =
		saved !== null &&
		saved.notificationDecision === texts.notificationDecision &&
		decidedOn === savedTexts.notificationDecidedOn;
	return {
		issues,
		changed,
		change: !valid
			? null
			: {
					id: saved?.id ?? null,
					name: texts.name.trim(),
					startsOn: texts.startsOn,
					endsOn: texts.endsOn === "" ? null : texts.endsOn,
					rewardBudgetAmount: budget.value ?? 0,
					status: texts.status,
					notificationDecision: texts.notificationDecision,
					notificationBasis: basis === "" ? null : basis,
					notificationDecidedAt: pending
						? null
						: keepsDecisionDate
							? saved.notificationDecidedAt
							: decidedOn === ""
								? null
								: decidedAtOf(decidedOn, format.timeZone),
					parameters: {
						...(parameters as Omit<LoyaltyParameters, "excludedOrderSources">),
						excludedOrderSources: sources,
					},
				},
	};
}

export function holdsLaunch(texts: ProgrammeTexts): boolean {
	return texts.notificationDecision === "pending";
}
