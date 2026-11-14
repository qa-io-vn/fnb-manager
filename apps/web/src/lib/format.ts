import { roundHalfAwayFromZero } from "@fnb/reports";
import { dateFromIso, type IsoDate } from "./business-dates";

export interface CompactUnitLabels {
	million: string;
	billion: string;
}

export interface FormatterOptions {
	currencyCode: string;
	uiLocale: string;
	timeZone: string;
	unitLabels: CompactUnitLabels;
}

export interface Formatters {
	locale: string;
	moneyFractionDigits: number;
	moneyCompact: (value: number) => string;
	moneyExact: (value: number) => string;
	count: (value: number) => string;
	decimal: (value: number) => string;
	ratio: (value: number) => string;
	points: (fraction: number) => string;
	pointMagnitude: (points: number) => string;
	percent: (fraction: number) => string;
	signedPercent: (fraction: number) => string;
	date: (isoDate: IsoDate) => string;
	weekday: (isoDate: IsoDate) => string;
	time: (instant: Date) => string;
}

const localeByCurrency: Readonly<Record<string, string>> = {
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

export function localeForCurrency(
	currencyCode: string,
	fallback: string,
): string {
	return localeByCurrency[currencyCode.toUpperCase()] ?? fallback;
}

const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
const POINTS_PER_FRACTION = 100;
const POINT_DIGITS = 1;

function currencySymbol(locale: string, currencyCode: string): string {
	const parts = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: currencyCode,
	}).formatToParts(0);
	return parts.find((part) => part.type === "currency")?.value ?? currencyCode;
}

function datePartsFormatter(locale: string): (isoDate: IsoDate) => string {
	const format = new Intl.DateTimeFormat(locale, {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		timeZone: "UTC",
	});
	return (isoDate) => {
		const parts = format.formatToParts(dateFromIso(isoDate));
		const pick = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((part) => part.type === type)?.value ?? "";
		return `${pick("day")}/${pick("month")}/${pick("year")}`;
	};
}

export function createFormatters(options: FormatterOptions): Formatters {
	const { currencyCode, uiLocale, timeZone, unitLabels } = options;
	const locale = localeForCurrency(currencyCode, uiLocale);
	const exactMoney = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: currencyCode,
	});
	const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
	const oneDecimal = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 0,
		maximumFractionDigits: 1,
	});
	const headlineDecimal = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const twoDecimals = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const signedPoints = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
		signDisplay: "exceptZero",
	});
	const percentFormat = new Intl.NumberFormat(locale, {
		style: "percent",
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const signedPercentFormat = new Intl.NumberFormat(locale, {
		style: "percent",
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
		signDisplay: "exceptZero",
	});
	const weekdayFormat = new Intl.DateTimeFormat(uiLocale, {
		weekday: "long",
		timeZone: "UTC",
	});
	const timeFormat = new Intl.DateTimeFormat(uiLocale, {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone,
	});
	const symbol = currencySymbol(locale, currencyCode);

	const roundedInUnit = (value: number, unit: number) =>
		Math.round((value / unit) * 10) / 10;
	const reachesBillions = (value: number) =>
		Math.abs(value) >= BILLION ||
		Math.abs(roundedInUnit(value, MILLION)) >= BILLION / MILLION;

	const moneyCompact = (value: number) => {
		if (reachesBillions(value)) {
			return `${headlineDecimal.format(roundedInUnit(value, BILLION))} ${unitLabels.billion} ${symbol}`;
		}
		if (Math.abs(value) >= MILLION) {
			return `${headlineDecimal.format(roundedInUnit(value, MILLION))} ${unitLabels.million} ${symbol}`;
		}
		return exactMoney.format(value);
	};

	return {
		locale,
		moneyFractionDigits:
			exactMoney.resolvedOptions().maximumFractionDigits ?? 0,
		moneyCompact,
		moneyExact: (value) => exactMoney.format(value),
		count: (value) => integer.format(value),
		decimal: (value) => oneDecimal.format(value),
		ratio: (value) => twoDecimals.format(value),
		points: (fraction) =>
			signedPoints.format(
				roundHalfAwayFromZero(fraction * POINTS_PER_FRACTION, POINT_DIGITS),
			),
		pointMagnitude: (points) => headlineDecimal.format(Math.abs(points)),
		percent: (fraction) => percentFormat.format(fraction),
		signedPercent: (fraction) => signedPercentFormat.format(fraction),
		date: datePartsFormatter(locale),
		weekday: (isoDate) => weekdayFormat.format(dateFromIso(isoDate)),
		time: (instant) => timeFormat.format(instant),
	};
}
