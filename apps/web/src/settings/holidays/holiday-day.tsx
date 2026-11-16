import { useT } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";

export function useHolidayDayText(formatters: Formatters) {
	const t = useT();
	return (date: IsoDate) =>
		t("settings.holidays.day", {
			weekday: formatters.weekday(date),
			date: formatters.date(date),
		});
}

export function HolidayDay({
	date,
	formatters,
}: {
	readonly date: IsoDate;
	readonly formatters: Formatters;
}) {
	const dayText = useHolidayDayText(formatters);
	return (
		<time
			dateTime={date}
			className="text-sm text-ink-muted"
			data-testid="holiday-date"
		>
			{dayText(date)}
		</time>
	);
}
