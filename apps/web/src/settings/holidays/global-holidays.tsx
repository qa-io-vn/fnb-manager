import { useId } from "react";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type { HolidayRow } from "../source";
import { HolidayDay } from "./holiday-day";
import {
	globalHolidayNameKey,
	holidayKindKey,
	NATIONAL_CALENDAR_YEARS,
} from "./holidays";

function GlobalHolidayRow({
	row,
	formatters,
}: {
	readonly row: HolidayRow;
	readonly formatters: Formatters;
}) {
	const t = useT();
	const nameKey = globalHolidayNameKey(row.name);
	const kindKey = holidayKindKey(row.kind);
	return (
		<li
			className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
			data-testid="holiday-row"
			data-custom="false"
			data-kind={row.kind}
			data-date={row.holidayDate}
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="font-medium" data-testid="holiday-name">
					{nameKey === null ? row.name : t(nameKey)}
				</span>
				<HolidayDay date={row.holidayDate} formatters={formatters} />
			</div>
			{kindKey === null ? null : (
				<span
					className="rounded-full border border-line px-2 py-0.5 text-xs font-medium"
					data-testid="holiday-kind"
				>
					{t(kindKey)}
				</span>
			)}
		</li>
	);
}

export function GlobalHolidays({
	year,
	rows,
	formatters,
}: {
	readonly year: number;
	readonly rows: readonly HolidayRow[];
	readonly formatters: Formatters;
}) {
	const t = useT();
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="space-y-2 rounded-xl border border-line bg-surface-raised px-4 py-3"
			data-testid="holidays-global"
		>
			<h3 id={headingId} className="text-base font-semibold">
				{t("settings.holidays.global.title")}
			</h3>
			<p className="text-sm text-ink-muted" data-testid="holidays-global-note">
				{t("settings.holidays.global.note", {
					from: NATIONAL_CALENDAR_YEARS.from,
					to: NATIONAL_CALENDAR_YEARS.to,
				})}
			</p>
			{rows.length === 0 ? (
				<p className="py-2" data-testid="holidays-global-empty">
					{t("settings.holidays.global.empty", { year })}
				</p>
			) : (
				<ul className="divide-y divide-line" data-testid="holidays-global-list">
					{rows.map((row) => (
						<GlobalHolidayRow key={row.id} row={row} formatters={formatters} />
					))}
				</ul>
			)}
		</section>
	);
}
