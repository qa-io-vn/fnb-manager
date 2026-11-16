import {
	hasAtMostFractionDigits,
	MONEY_COLUMN_MAX,
	REPORT_SETTING_LIMITS,
	type ReportSettingLimit,
	type ReportSettings,
} from "@fnb/reports";
import { z } from "zod";
import type { MessageKey } from "../i18n";
import { type IsoDate, isIsoDate } from "../lib/business-dates";

export const VALIDATION_KEYS = [
	"required",
	"number",
	"integer",
	"decimals",
	"range",
	"atLeast",
	"atMost",
	"wholeMoney",
	"date",
	"dateRange",
	"time",
	"openingHours",
	"choice",
	"textLength",
] as const;

export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export const VALIDATION_MESSAGE_KEYS: Readonly<
	Record<ValidationKey, MessageKey>
> = {
	required: "settings.validation.required",
	number: "settings.validation.number",
	integer: "settings.validation.integer",
	decimals: "settings.validation.decimals",
	range: "settings.validation.range",
	atLeast: "settings.validation.atLeast",
	atMost: "settings.validation.atMost",
	wholeMoney: "settings.validation.wholeMoney",
	date: "settings.validation.date",
	dateRange: "settings.validation.dateRange",
	time: "settings.validation.time",
	openingHours: "settings.validation.openingHours",
	choice: "settings.validation.choice",
	textLength: "settings.validation.textLength",
};

export interface ValidationIssue {
	readonly key: ValidationKey;
	readonly min?: number | string;
	readonly max?: number | string;
	readonly digits?: number;
}

export const WHOLE_MONEY_MAX = Math.floor(MONEY_COLUMN_MAX);

export const MONEY_COLUMN_SCALE = 2;

export const PERCENT_LIMIT: ReportSettingLimit = {
	min: 0,
	max: 20,
	fractionDigits: 3,
};

export const FIRST_BUSINESS_DATE: IsoDate = "2023-01-01";

export const WEEKDAYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type OpeningSpan = readonly [string, string];

export type OpeningHours = Partial<Record<Weekday, readonly OpeningSpan[]>>;

function isValidationKey(value: unknown): value is ValidationKey {
	return (
		typeof value === "string" &&
		(VALIDATION_KEYS as readonly string[]).includes(value)
	);
}

function raise(ctx: z.RefinementCtx, issue: ValidationIssue): void {
	ctx.addIssue({ code: "custom", message: issue.key, params: { ...issue } });
}

function finiteNumber() {
	return z.number({ error: "number" satisfies ValidationKey });
}

export function decimalInRange(limit: ReportSettingLimit) {
	return finiteNumber().superRefine((value, ctx) => {
		if (value < limit.min || value > limit.max) {
			raise(ctx, { key: "range", min: limit.min, max: limit.max });
			return;
		}
		if (limit.fractionDigits === 0 && !Number.isInteger(value)) {
			raise(ctx, { key: "integer" });
			return;
		}
		if (!hasAtMostFractionDigits(value, limit.fractionDigits)) {
			raise(ctx, { key: "decimals", digits: limit.fractionDigits });
		}
	});
}

export function integerInRange(min: number, max: number) {
	return decimalInRange({ min, max, fractionDigits: 0 });
}

export function percentage(limit: ReportSettingLimit = PERCENT_LIMIT) {
	return decimalInRange(limit);
}

export function wholeMoney({
	min = 0,
	max = WHOLE_MONEY_MAX,
}: {
	min?: number;
	max?: number;
} = {}) {
	return finiteNumber().superRefine((value, ctx) => {
		if (!Number.isInteger(value)) {
			raise(ctx, { key: "wholeMoney" });
			return;
		}
		if (value < min) {
			raise(ctx, { key: "atLeast", min });
			return;
		}
		if (value > max) raise(ctx, { key: "atMost", max });
	});
}

export function money(
	fractionDigits: number,
	{ min = 0, max }: { min?: number; max?: number } = {},
) {
	if (fractionDigits === 0) {
		return wholeMoney({ min, max: max ?? WHOLE_MONEY_MAX });
	}
	return decimalInRange({
		min,
		max: max ?? MONEY_COLUMN_MAX,
		fractionDigits: Math.min(fractionDigits, MONEY_COLUMN_SCALE),
	});
}

export const ITEM_COST_MAX = 100_000_000;

export function itemCost(fractionDigits: number) {
	return money(fractionDigits, { min: 0, max: ITEM_COST_MAX });
}

export const FEE_FIXED_MAX = 100_000;

export function feeFixedAmount(fractionDigits: number) {
	return money(fractionDigits, { min: 0, max: FEE_FIXED_MAX });
}

export const TARGET_MIN = 1;

export const TARGET_MAX = WHOLE_MONEY_MAX;

export function targetAmount(fractionDigits: number) {
	return money(fractionDigits, { min: TARGET_MIN, max: TARGET_MAX });
}

export function dateBounds(today: IsoDate): { min: IsoDate; max: IsoDate } {
	const nextYear = Number(today.slice(0, 4)) + 1;
	return { min: FIRST_BUSINESS_DATE, max: `${nextYear}-12-31` };
}

export const FIRST_OPENING_DATE: IsoDate = "2000-01-01";

export function openingDateBounds(today: IsoDate): {
	min: IsoDate;
	max: IsoDate;
} {
	return { min: FIRST_OPENING_DATE, max: dateBounds(today).max };
}

export function businessDate(today: IsoDate) {
	return dateWithin(dateBounds(today));
}

export function openingDate(today: IsoDate) {
	return dateWithin(openingDateBounds(today));
}

export const STORE_CODE_MAX_LENGTH = 12;

export const SEAT_COUNT_MAX = 5_000;

export const seatCount = integerInRange(0, SEAT_COUNT_MAX);

export const storeCode = z
	.string({ error: "textLength" satisfies ValidationKey })
	.superRefine((value, ctx) => {
		if ([...value.trim()].length > STORE_CODE_MAX_LENGTH) {
			raise(ctx, { key: "textLength", max: STORE_CODE_MAX_LENGTH });
		}
	});

export function storeCodeValueOf(text: string): string | null {
	const trimmed = text.trim();
	return trimmed === "" ? null : trimmed;
}

export const HOLIDAY_NAME_MAX_LENGTH = 80;

export function holidayNameValueOf(text: string): string {
	return text.normalize("NFC").trim();
}

export const holidayName = z
	.string({ error: "required" satisfies ValidationKey })
	.superRefine((value, ctx) => {
		const length = [...holidayNameValueOf(value)].length;
		if (length === 0) {
			raise(ctx, { key: "required" });
			return;
		}
		if (length > HOLIDAY_NAME_MAX_LENGTH) {
			raise(ctx, { key: "textLength", max: HOLIDAY_NAME_MAX_LENGTH });
		}
	});

export function dateWithin(bounds: { min: IsoDate; max: IsoDate }) {
	return z
		.string({ error: "date" satisfies ValidationKey })
		.superRefine((value, ctx) => {
			if (!isIsoDate(value)) {
				raise(ctx, { key: "date" });
				return;
			}
			if (value < bounds.min || value > bounds.max) {
				raise(ctx, { key: "dateRange", min: bounds.min, max: bounds.max });
			}
		});
}

const OPENING_TIME = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const MIDNIGHT_CLOSE = "24:00";

export function isOpeningTime(value: string): boolean {
	return OPENING_TIME.test(value) || value === MIDNIGHT_CLOSE;
}

export const openingTime = z
	.string({ error: "time" satisfies ValidationKey })
	.refine(isOpeningTime, { error: "time" satisfies ValidationKey });

const openingSpan = z.tuple([openingTime, openingTime], {
	error: "openingHours" satisfies ValidationKey,
});

const openingDay = z
	.array(openingSpan, { error: "openingHours" satisfies ValidationKey })
	.optional();

export const openingHoursSchema = z
	.strictObject(
		{
			mon: openingDay,
			tue: openingDay,
			wed: openingDay,
			thu: openingDay,
			fri: openingDay,
			sat: openingDay,
			sun: openingDay,
		},
		{ error: "openingHours" satisfies ValidationKey },
	)
	.nullable();

export function choice<const Values extends readonly [string, ...string[]]>(
	values: Values,
) {
	return z.enum(values, { error: "choice" satisfies ValidationKey });
}

function settingNumber(field: keyof ReportSettings) {
	return decimalInRange(REPORT_SETTING_LIMITS[field]);
}

export const reportSettingsSchema = z.strictObject({
	menuWindowDays: settingNumber("menuWindowDays"),
	menuPopularityFactor: settingNumber("menuPopularityFactor"),
	menuLowSampleItems: settingNumber("menuLowSampleItems"),
	cashAbsThreshold: settingNumber("cashAbsThreshold"),
	cashRelThreshold: settingNumber("cashRelThreshold"),
	peakHours: settingNumber("peakHours"),
	deadHourRatio: settingNumber("deadHourRatio"),
	busyHourRatio: settingNumber("busyHourRatio"),
	promoPreWeeks: settingNumber("promoPreWeeks"),
});

function issueOfZod(
	issue: z.core.$ZodIssue | undefined,
	fallback: ValidationKey,
): ValidationIssue {
	if (issue?.code === "custom" && isValidationKey(issue.params?.key)) {
		return issue.params as ValidationIssue;
	}
	if (issue !== undefined && isValidationKey(issue.message)) {
		return { key: issue.message };
	}
	return { key: fallback };
}

export function issueOf(
	schema: z.ZodType,
	value: unknown,
	fallback: ValidationKey = "number",
): ValidationIssue | null {
	const result = schema.safeParse(value);
	return result.success ? null : issueOfZod(result.error.issues[0], fallback);
}

export interface FormIssues<Field extends string> {
	readonly byField: Partial<Record<Field, ValidationIssue>>;
	readonly form: ValidationIssue | null;
}

export function issuesByField<Field extends string>(
	schema: z.ZodType,
	value: unknown,
	fallback: ValidationKey = "number",
): FormIssues<Field> {
	const result = schema.safeParse(value);
	if (result.success) return { byField: {}, form: null };
	const byField: Partial<Record<Field, ValidationIssue>> = {};
	let form: ValidationIssue | null = null;
	for (const issue of result.error.issues) {
		const field = issue.path[0];
		if (typeof field !== "string") {
			form ??= issueOfZod(issue, fallback);
			continue;
		}
		if (!(field in byField))
			byField[field as Field] = issueOfZod(issue, fallback);
	}
	return { byField, form };
}

export function hasIssues<Field extends string>(
	issues: FormIssues<Field>,
): boolean {
	return issues.form !== null || Object.keys(issues.byField).length > 0;
}
