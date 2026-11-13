import { wallClockIn } from "@fnb/core";

const NO_BREAK_SPACE = " ";
const DONG_SIGN = "₫";
const GROUP_SEPARATOR = ".";
const DECIMAL_SEPARATOR = ",";
const PERCENT_SHIFT = 2;
const PERCENT_FRACTION_DIGITS = 1;

const WEEKDAYS = [
	"Chủ Nhật",
	"Thứ Hai",
	"Thứ Ba",
	"Thứ Tư",
	"Thứ Năm",
	"Thứ Sáu",
	"Thứ Bảy",
] as const;

const LOCALE_BY_CURRENCY: Readonly<Record<string, string>> = {
	VND: "vi-VN",
	USD: "en-US",
	EUR: "de-DE",
	GBP: "en-GB",
	THB: "th-TH",
	SGD: "en-SG",
	MYR: "ms-MY",
	IDR: "id-ID",
	PHP: "en-PH",
	JPY: "ja-JP",
	KRW: "ko-KR",
	AUD: "en-AU",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DecimalValue {
	readonly negative: boolean;
	readonly digits: bigint;
	readonly scale: number;
}

function decimalOf(value: number): DecimalValue {
	const negative = value < 0 || Object.is(value, -0);
	const text = String(Math.abs(value));
	const [mantissa = "0", exponentText] = text.split("e");
	const [whole = "0", fraction = ""] = mantissa.split(".");
	const exponent = exponentText === undefined ? 0 : Number(exponentText);
	return {
		negative,
		digits: BigInt(`${whole}${fraction}` || "0"),
		scale: exponent - fraction.length,
	};
}

function roundedDigits(
	value: DecimalValue,
	shift: number,
	fractionDigits: number,
): string {
	const exponent = value.scale + shift + fractionDigits;
	if (exponent >= 0) {
		return (value.digits * 10n ** BigInt(exponent)).toString();
	}
	const divisor = 10n ** BigInt(-exponent);
	const quotient = value.digits / divisor;
	const remainder = value.digits % divisor;
	return (remainder * 2n >= divisor ? quotient + 1n : quotient).toString();
}

function groupThousands(integer: string): string {
	let grouped = "";
	for (let index = 0; index < integer.length; index += 1) {
		const fromRight = integer.length - index;
		grouped += integer[index];
		if (fromRight > 1 && fromRight % 3 === 1) {
			grouped += GROUP_SEPARATOR;
		}
	}
	return grouped;
}

function fixedParts(
	value: number,
	shift: number,
	fractionDigits: number,
): { negative: boolean; zero: boolean; text: string } {
	const decimal = decimalOf(value);
	const digits = roundedDigits(decimal, shift, fractionDigits).padStart(
		fractionDigits + 1,
		"0",
	);
	const integer = digits.slice(0, digits.length - fractionDigits);
	const fraction = digits.slice(digits.length - fractionDigits);
	const zero = /^0+$/.test(digits);
	const text =
		fractionDigits === 0
			? groupThousands(integer)
			: `${groupThousands(integer)}${DECIMAL_SEPARATOR}${fraction}`;
	return { negative: decimal.negative, zero, text };
}

export function formatVndMoney(value: number): string {
	const parts = fixedParts(value, 0, 0);
	return `${parts.negative ? "-" : ""}${parts.text}${NO_BREAK_SPACE}${DONG_SIGN}`;
}

export function formatViCount(value: number): string {
	const parts = fixedParts(value, 0, 0);
	return `${parts.negative ? "-" : ""}${parts.text}`;
}

export function formatViPercent(fraction: number): string {
	const parts = fixedParts(fraction, PERCENT_SHIFT, PERCENT_FRACTION_DIGITS);
	return `${parts.negative ? "-" : ""}${parts.text}%`;
}

export function formatViSignedPercent(fraction: number): string {
	const parts = fixedParts(fraction, PERCENT_SHIFT, PERCENT_FRACTION_DIGITS);
	const sign = parts.zero ? "" : parts.negative ? "-" : "+";
	return `${sign}${parts.text}%`;
}

function isoParts(isoDate: string): [string, string, string] {
	const match = ISO_DATE.exec(isoDate);
	if (!match) {
		throw new RangeError("expected an ISO date YYYY-MM-DD");
	}
	return [match[1] ?? "", match[2] ?? "", match[3] ?? ""];
}

export function formatViDate(isoDate: string): string {
	const [year, month, day] = isoParts(isoDate);
	return `${day}/${month}/${year}`;
}

export function formatViWeekday(isoDate: string): string {
	const [year, month, day] = isoParts(isoDate);
	const weekday = new Date(
		Date.UTC(Number(year), Number(month) - 1, Number(day)),
	).getUTCDay();
	return WEEKDAYS[weekday] ?? "";
}

function pad(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

export function formatClockTime(instant: Date, timeZone: string): string {
	const clock = wallClockIn(instant, timeZone);
	return `${pad(clock.hour)}:${pad(clock.minute)}`;
}

export function localIsoDate(instant: Date, timeZone: string): string {
	const clock = wallClockIn(instant, timeZone);
	return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

export function utcOffsetMinutes(instant: Date, timeZone: string): number {
	const clock = wallClockIn(instant, timeZone);
	const wall = Date.UTC(
		clock.year,
		clock.month - 1,
		clock.day,
		clock.hour,
		clock.minute,
		clock.second,
	);
	return Math.round(
		(wall - Math.floor(instant.getTime() / 1000) * 1000) / 60_000,
	);
}

export function formatUtcOffset(minutes: number): string {
	const sign = minutes < 0 ? "-" : "+";
	const magnitude = Math.abs(minutes);
	const hours = pad(Math.floor(magnitude / 60));
	const rest = magnitude % 60;
	return rest === 0 ? `${sign}${hours}` : `${sign}${hours}:${pad(rest)}`;
}

export function formatLocalInstant(instant: Date, timeZone: string): string {
	return `${localIsoDate(instant, timeZone)} ${formatClockTime(instant, timeZone)} ${formatUtcOffset(utcOffsetMinutes(instant, timeZone))}`;
}

export function localeForCurrency(currencyCode: string): string {
	return LOCALE_BY_CURRENCY[currencyCode.toUpperCase()] ?? "vi-VN";
}

export interface NotifyFormatters {
	readonly money: (value: number) => string;
	readonly count: (value: number) => string;
	readonly percent: (fraction: number) => string;
	readonly signedPercent: (fraction: number) => string;
	readonly date: (isoDate: string) => string;
	readonly weekday: (isoDate: string) => string;
	readonly time: (instant: Date) => string;
}

export interface NotifyFormatterOptions {
	readonly currencyCode: string;
	readonly timeZone: string;
}

function intlFormatters(
	currencyCode: string,
): Pick<NotifyFormatters, "money" | "count" | "percent" | "signedPercent"> {
	const locale = localeForCurrency(currencyCode);
	const money = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: currencyCode,
	});
	const count = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
	const percent = new Intl.NumberFormat(locale, {
		style: "percent",
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const signedPercent = new Intl.NumberFormat(locale, {
		style: "percent",
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
		signDisplay: "exceptZero",
	});
	return {
		money: (value) => money.format(value),
		count: (value) => count.format(value),
		percent: (fraction) => percent.format(fraction),
		signedPercent: (fraction) => signedPercent.format(fraction),
	};
}

export function createNotifyFormatters(
	options: NotifyFormatterOptions,
): NotifyFormatters {
	const numbers =
		options.currencyCode.toUpperCase() === "VND"
			? {
					money: formatVndMoney,
					count: formatViCount,
					percent: formatViPercent,
					signedPercent: formatViSignedPercent,
				}
			: intlFormatters(options.currencyCode);
	return {
		...numbers,
		date: formatViDate,
		weekday: formatViWeekday,
		time: (instant) => formatClockTime(instant, options.timeZone),
	};
}

export function formatSelfCheck(): boolean {
	try {
		const formatters = createNotifyFormatters({
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
		});
		return (
			formatters.money(12_345_000) === `12.345.000${NO_BREAK_SPACE}₫` &&
			formatters.signedPercent(-0.082) === "-8,2%" &&
			formatters.signedPercent(0.031) === "+3,1%" &&
			formatters.date("2026-11-07") === "07/11/2026" &&
			formatters.weekday("2026-11-07") === "Thứ Bảy" &&
			formatters.time(new Date("2026-11-07T12:05:00.000Z")) === "19:05"
		);
	} catch {
		return false;
	}
}
