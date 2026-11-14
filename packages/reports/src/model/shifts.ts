import type { AnalyticsRow } from "../contract/functions.js";
import { reportKeys } from "./keys.js";
import {
	messageValue,
	numberValue,
	part,
	partValue,
	type TypedValue,
	textValue,
} from "./values.js";

type ShiftRow = AnalyticsRow<"shift_review">;

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function isEmailLike(text: string): boolean {
	return EMAIL_LIKE.test(text);
}

export function shownCashier(name: string | null): string | null {
	if (name === null) return null;
	const trimmed = name.trim();
	return trimmed === "" || isEmailLike(trimmed) ? null : trimmed;
}

export function cashierShownValue(name: string | null): TypedValue {
	const shown = shownCashier(name);
	return shown === null
		? messageValue(reportKeys.label.unknownCashier)
		: textValue("text", shown);
}

export function cashierCell(name: string | null): string {
	return shownCashier(name) ?? reportKeys.label.unknownCashier;
}

function openedAtMillis(row: ShiftRow): number {
	const millis =
		row.opened_at === null ? Number.NaN : Date.parse(row.opened_at);
	return Number.isNaN(millis) ? Number.POSITIVE_INFINITY : millis;
}

function byOpening(left: ShiftRow, right: ShiftRow): number {
	return (
		openedAtMillis(left) - openedAtMillis(right) ||
		left.shift_external_id.localeCompare(right.shift_external_id)
	);
}

export function shiftNumbers(
	rows: readonly ShiftRow[],
): ReadonlyMap<string, number> {
	const days = new Map<string, ShiftRow[]>();
	for (const row of rows) {
		const key = `${row.store_id ?? ""}|${row.business_date}`;
		const members = days.get(key);
		if (members === undefined) days.set(key, [row]);
		else members.push(row);
	}
	const numbers = new Map<string, number>();
	for (const members of days.values()) {
		[...members].sort(byOpening).forEach((row, index) => {
			numbers.set(row.shift_id, index + 1);
		});
	}
	return numbers;
}

export function shiftNumberValue(shiftNumber: number): TypedValue {
	return partValue(
		part(reportKeys.label.shiftNumber, {
			number: numberValue("count", shiftNumber),
		}),
	);
}

export function storeAndLabelValue(
	storeName: string,
	label: TypedValue,
): TypedValue {
	return partValue(
		part(reportKeys.label.storeAndLabel, {
			store: textValue("text", storeName),
			label,
		}),
	);
}
