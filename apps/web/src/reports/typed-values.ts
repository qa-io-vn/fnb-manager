import type { SentencePart, TypedValue } from "@fnb/reports";
import { hourText, signed } from "../components/report-card/headline";
import { isMessageKey, type MessageParams, type Translate } from "../i18n";
import { addDays } from "../lib/business-dates";
import type { Formatters } from "../lib/format";

const MONDAY_OF_REFERENCE_WEEK = "2024-01-01";
const ISO_MONTH = /^(\d{4})-(\d{2})(?:-\d{2})?$/;
const ISO_WEEK = /^(\d{4})-W(\d{2})$/;

export function translateKey(
	t: Translate,
	key: string,
	params?: MessageParams,
): string {
	return isMessageKey(key) ? t(key, params) : key;
}

export function weekdayOf(isoWeekday: number, formatters: Formatters): string {
	return formatters.weekday(addDays(MONDAY_OF_REFERENCE_WEEK, isoWeekday - 1));
}

export function monthLabel(value: string): string {
	const match = ISO_MONTH.exec(value);
	return match ? `${match[2]}/${match[1]}` : value;
}

export function formatTypedValue(
	value: TypedValue,
	t: Translate,
	formatters: Formatters,
): string {
	switch (value.kind) {
		case "money":
			return formatters.moneyCompact(value.value);
		case "moneyExact":
			return formatters.moneyExact(value.value);
		case "moneySigned":
			return signed(formatters.moneyCompact(value.value), value.value);
		case "count":
			return formatters.count(value.value);
		case "countSigned":
			return signed(formatters.count(value.value), value.value);
		case "decimal":
			return formatters.decimal(value.value);
		case "ratio":
			return formatters.ratio(value.value);
		case "percent":
			return formatters.percent(value.value);
		case "signedPercent":
			return formatters.signedPercent(value.value);
		case "percentPoints":
			return t("report.value.points", {
				value: formatters.points(value.value),
			});
		case "pointMagnitude":
			return formatters.pointMagnitude(value.value);
		case "percentChange":
			return formatters.signedPercent(value.value / 100);
		case "hour":
			return hourText(value.value);
		case "date":
			return formatters.date(value.value);
		case "weekday":
			return weekdayOf(Number(value.value), formatters);
		case "month":
			return monthLabel(value.value);
		case "year":
			return value.value.slice(0, 4);
		case "isoWeek": {
			const match = ISO_WEEK.exec(value.value);
			return match
				? t("report.value.isoWeek", {
						week: Number(match[2]),
						year: match[1] ?? "",
					})
				: value.value;
		}
		case "text":
			return value.value;
		case "message":
			return translateKey(t, value.value);
		case "part":
			return formatPart(value.value, t, formatters);
	}
}

export function formatPart(
	part: SentencePart,
	t: Translate,
	formatters: Formatters,
): string {
	const params: MessageParams = Object.fromEntries(
		Object.entries(part.values).map(([name, value]) => [
			name,
			formatTypedValue(value, t, formatters),
		]),
	);
	return translateKey(t, part.key, params);
}

export function formatParts(
	parts: readonly SentencePart[],
	t: Translate,
	formatters: Formatters,
): string {
	return parts.map((part) => formatPart(part, t, formatters)).join(" ");
}
