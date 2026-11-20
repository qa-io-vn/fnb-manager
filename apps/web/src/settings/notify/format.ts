import { useMemo } from "react";
import { uiLocaleOf, useLanguage } from "../../i18n";

export function instantFormatter(
	locale: string,
	timeZone: string,
): (iso: string) => string {
	const format = new Intl.DateTimeFormat(locale, {
		timeZone,
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	return (iso: string) => {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? "" : format.format(date);
	};
}

export function useInstantFormatter(timeZone: string): (iso: string) => string {
	const { language } = useLanguage();
	return useMemo(
		() => instantFormatter(uiLocaleOf[language], timeZone),
		[language, timeZone],
	);
}
