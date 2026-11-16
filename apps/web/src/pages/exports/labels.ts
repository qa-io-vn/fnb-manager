import type { ExportTableId, MonthKey, StoreTableId } from "../../exports/plan";
import type { Translate } from "../../i18n";
import type { Formatters } from "../../lib/format";

export function monthLabel(t: Translate, month: MonthKey): string {
	const [year, number] = month.split("-");
	return t("exports.month", { month: Number(number), year: year ?? "" });
}

export function tableLabel(t: Translate, table: ExportTableId): string {
	return t(`exports.table.${table}`);
}

export function countsText(
	t: Translate,
	formatters: Formatters,
	rows: Readonly<Partial<Record<StoreTableId, number>>>,
): string {
	return (Object.entries(rows) as [StoreTableId, number][])
		.map(([table, count]) =>
			t(`exports.count.${table}`, { count: formatters.count(count) }),
		)
		.join(" · ");
}
