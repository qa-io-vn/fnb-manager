import type { Language } from "@fnb/zalo-mini";
import type { IsoDate } from "./model";

export interface HomeFormatters {
	moneyCompact(value: number): string;
	moneyExact(value: number): string;
	count(value: number): string;
	date(isoDate: IsoDate): string;
	time(instant: Date): string;
}

export interface HomeFormatterOptions {
	readonly currencyCode: string;
	readonly language: Language;
	readonly timeZone: string;
	readonly million: string;
	readonly billion: string;
}

export const UI_LOCALES: Readonly<Record<Language, string>> = {
	vi: "vi-VN",
	en: "en-GB",
};

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

const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localeForCurrency(
	currencyCode: string,
	fallback: string,
): string {
	return LOCALE_BY_CURRENCY[currencyCode.toUpperCase()] ?? fallback;
}

function currencySymbol(locale: string, currencyCode: string): string {
	return (
		new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode })
			.formatToParts(0)
			.find((part) => part.type === "currency")?.value ?? currencyCode
	);
}

export function createHomeFormatters(
	options: HomeFormatterOptions,
): HomeFormatters {
	const uiLocale = UI_LOCALES[options.language];
	const locale = localeForCurrency(options.currencyCode, uiLocale);
	const exactMoney = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: options.currencyCode,
	});
	const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
	const headline = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const clock = new Intl.DateTimeFormat(uiLocale, {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: options.timeZone,
	});
	const symbol = currencySymbol(locale, options.currencyCode);
	const inUnit = (value: number, unit: number) =>
		Math.round((value / unit) * 10) / 10;
	const reachesBillions = (value: number) =>
		Math.abs(value) >= BILLION ||
		Math.abs(inUnit(value, MILLION)) >= BILLION / MILLION;
	return {
		moneyCompact(value) {
			if (reachesBillions(value)) {
				return `${headline.format(inUnit(value, BILLION))} ${options.billion} ${symbol}`;
			}
			if (Math.abs(value) >= MILLION) {
				return `${headline.format(inUnit(value, MILLION))} ${options.million} ${symbol}`;
			}
			return exactMoney.format(value);
		},
		moneyExact: (value) => exactMoney.format(value),
		count: (value) => integer.format(value),
		date(isoDate) {
			const match = ISO_DATE.exec(isoDate);
			return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
		},
		time: (instant) => clock.format(instant),
	};
}
