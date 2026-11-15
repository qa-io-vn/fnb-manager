import {
	ISO_DATE_REGEX,
	isValidIsoDate,
	MONEY_COLUMN_MAX,
	REPORT_SETTING_LIMITS,
	type ReportSettingLimit,
	type ReportSettings,
	withinReportSettingLimit,
} from "@fnb/reports";
import { WEEKDAY_KEYS } from "./calendar.js";

export type DemoSettingsRefusal =
	| "required"
	| "range"
	| "format"
	| "duplicate"
	| "reference";

export class DemoSettingsError extends RangeError {
	readonly field: string;
	readonly refusal: DemoSettingsRefusal;

	constructor(field: string, refusal: DemoSettingsRefusal, rule: string) {
		super(`${field} must ${rule}`);
		this.name = "DemoSettingsError";
		this.field = field;
		this.refusal = refusal;
	}
}

export const MONEY_AMOUNT: ReportSettingLimit = {
	min: 0,
	max: MONEY_COLUMN_MAX,
	fractionDigits: 2,
};

export const FEE_PERCENT: ReportSettingLimit = {
	min: 0,
	max: 999.999,
	fractionDigits: 3,
};

export const SEAT_COUNT: ReportSettingLimit = {
	min: 0,
	max: 2_147_483_647,
	fractionDigits: 0,
};

export function requireText(field: string, value: unknown): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new DemoSettingsError(field, "required", "be a non-empty text");
	}
	return value;
}

export function requireTextOrNull(
	field: string,
	value: unknown,
): string | null {
	if (value === null) return null;
	if (typeof value !== "string") {
		throw new DemoSettingsError(field, "format", "be a text or null");
	}
	return value;
}

export function requireDate(field: string, value: unknown): string {
	if (
		typeof value !== "string" ||
		!ISO_DATE_REGEX.test(value) ||
		!isValidIsoDate(value)
	) {
		throw new DemoSettingsError(field, "format", "be a calendar date");
	}
	return value;
}

const ISO_TIMESTAMP_REGEX =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function requireTimestampOrNull(
	field: string,
	value: unknown,
): string | null {
	if (value === null) return null;
	if (
		typeof value !== "string" ||
		!ISO_TIMESTAMP_REGEX.test(value) ||
		Number.isNaN(Date.parse(value))
	) {
		throw new DemoSettingsError(field, "format", "be a timestamp or null");
	}
	return value;
}

export function requireNumber(
	field: string,
	value: unknown,
	limit: ReportSettingLimit,
): number {
	if (typeof value !== "number" || !withinReportSettingLimit(value, limit)) {
		throw new DemoSettingsError(
			field,
			"range",
			`lie between ${limit.min} and ${limit.max} with at most ${limit.fractionDigits} decimals`,
		);
	}
	return value;
}

export function requireNumberOrNull(
	field: string,
	value: unknown,
	limit: ReportSettingLimit,
): number | null {
	return value === null ? null : requireNumber(field, value, limit);
}

export function requireChoice<Choice extends string>(
	field: string,
	value: unknown,
	choices: readonly Choice[],
): Choice {
	if (typeof value !== "string" || !choices.includes(value as Choice)) {
		throw new DemoSettingsError(
			field,
			"format",
			`be one of ${choices.join(", ")}`,
		);
	}
	return value as Choice;
}

export function requireOneOf(
	field: string,
	value: string,
	known: ReadonlySet<string>,
	what: string,
): string {
	if (!known.has(value)) {
		throw new DemoSettingsError(field, "reference", `name ${what}`);
	}
	return value;
}

export function requireUnique<Row>(
	rows: readonly Row[],
	field: string,
	columns: string,
	key: (row: Row) => string,
): void {
	const seen = new Set<string>();
	for (const row of rows) {
		const value = key(row);
		if (seen.has(value)) {
			throw new DemoSettingsError(
				field,
				"duplicate",
				`be unique per ${columns}`,
			);
		}
		seen.add(value);
	}
}

export function keyOf(...parts: readonly (string | null)[]): string {
	return parts.map((part) => (part === null ? "\u0001" : part)).join("\u0000");
}

export function checkReportSettings(settings: ReportSettings): ReportSettings {
	for (const field of Object.keys(
		REPORT_SETTING_LIMITS,
	) as (keyof ReportSettings)[]) {
		requireNumber(field, settings[field], REPORT_SETTING_LIMITS[field]);
	}
	return { ...settings };
}

const OPENING_TIME = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

function openingTimeValid(value: unknown): boolean {
	return (
		typeof value === "string" && (OPENING_TIME.test(value) || value === "24:00")
	);
}

export function openingHoursValid(value: unknown): boolean {
	if (value === null) return true;
	if (typeof value !== "object" || Array.isArray(value)) return false;
	return Object.entries(value as Readonly<Record<string, unknown>>).every(
		([weekday, spans]) =>
			(WEEKDAY_KEYS as readonly string[]).includes(weekday) &&
			Array.isArray(spans) &&
			spans.every(
				(span) =>
					Array.isArray(span) &&
					span.length === 2 &&
					openingTimeValid(span[0]) &&
					openingTimeValid(span[1]),
			),
	);
}
