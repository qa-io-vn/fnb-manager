import type { CardModel, TableModel } from "../../../model/card.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeKeys, weekdayLongKey, weekdayShortKey } from "../../keys.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { hoursKeys } from "../keys.js";
import {
	type HeatRow,
	hourRows,
	hoursCalls,
	hoursCsvName,
	hoursNeeds,
	profileRows,
	THIN_WEEKDAY_DAYS,
} from "../support.js";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function weekdayColumn(weekday: number): string {
	return `d${weekday}`;
}

function heatRowsOf(input: ThemeCardInput): readonly HeatRow[] {
	return input.results.rows(hoursCalls.heat, "hour_weekday_heatmap") ?? [];
}

function hourOrder(input: ThemeCardInput, rows: readonly HeatRow[]): number[] {
	const startHour = Math.floor(
		(input.context.stores[0]?.businessDayStartMinutes ?? 0) / 60,
	);
	const hours = [
		...new Set(
			rows.filter((row) => row.net_amount > 0).map((row) => row.hour_local),
		),
	];
	return hours.sort(
		(left, right) =>
			((left - startHour + 24) % 24) - ((right - startHour + 24) % 24),
	);
}

function heatTable(
	input: ThemeCardInput,
	rows: readonly HeatRow[],
	captionKey: string,
	pick: (row: HeatRow) => number | null,
	averageOf: (hour: number) => number | null,
	kind: "money" | "decimal",
): TableModel {
	const hours = hourOrder(input, rows);
	return tableModel({
		captionKey,
		variant: "heat",
		heatColumns: WEEKDAYS.map(weekdayColumn),
		columns: [
			column("hour", hoursKeys.table.hour, "hour"),
			...WEEKDAYS.map((weekday) =>
				column(weekdayColumn(weekday), weekdayShortKey(weekday), kind),
			),
			column("average", hoursKeys.table.average, kind),
		],
		rows: hours.map((hour) => {
			const cells: Record<string, number | null> = {
				hour,
				average: averageOf(hour),
			};
			for (const weekday of WEEKDAYS) {
				const row = rows.find(
					(entry) => entry.weekday === weekday && entry.hour_local === hour,
				);
				cells[weekdayColumn(weekday)] = row === undefined ? null : pick(row);
			}
			return { id: String(hour), cells };
		}),
	});
}

function extremes(rows: readonly HeatRow[]): {
	readonly best: HeatRow;
	readonly quietest: HeatRow;
} | null {
	let best: HeatRow | null = null;
	let quietest: HeatRow | null = null;
	for (const row of rows) {
		if (row.avg_net_amount === null || row.net_amount <= 0) continue;
		if (best === null || row.avg_net_amount > (best.avg_net_amount ?? 0))
			best = row;
		if (
			quietest === null ||
			row.avg_net_amount < (quietest.avg_net_amount ?? 0)
		) {
			quietest = row;
		}
	}
	return best === null || quietest === null ? null : { best, quietest };
}

function mainClause(
	input: ThemeCardInput,
	pair: ReturnType<typeof extremes>,
): SentencePart {
	const range = rangeValue(input.context);
	if (pair === null) return part(hoursKeys.heatmap.noData, { range });
	return part(hoursKeys.heatmap.main, {
		range,
		bestDay: messageValue(weekdayLongKey(pair.best.weekday)),
		bestHour: numberValue("hour", pair.best.hour_local),
		best: numberValue("money", pair.best.avg_net_amount ?? 0),
		quietDay: messageValue(weekdayLongKey(pair.quietest.weekday)),
		quietHour: numberValue("hour", pair.quietest.hour_local),
		quiet: numberValue("money", pair.quietest.avg_net_amount ?? 0),
	});
}

export function buildHeatmapCard(input: ThemeCardInput): CardModel {
	const rows = heatRowsOf(input);
	const pair = extremes(rows);
	const profile = hourRows(profileRows(input.results, hoursCalls.hours), "all");
	const averageOf = (hour: number, pick: "net" | "invoices") => {
		const row = profile.find((entry) => entry.hour_local === hour);
		if (row === undefined) return null;
		return pick === "net" ? row.avg_net_amount : row.avg_invoices;
	};
	const daysByWeekday = new Map(
		rows.map((row) => [row.weekday, row.days_with_data]),
	);
	const thin =
		rows.length > 0 &&
		WEEKDAYS.some(
			(weekday) => (daysByWeekday.get(weekday) ?? 0) < THIN_WEEKDAY_DAYS,
		);
	return {
		id: "heatmap",
		titleKey: hoursKeys.heatmap.title,
		subtitle: part(themeKeys.heat.legend),
		metricId: "hour_heat",
		relatedMetricIds: ["weekday_share"],
		headline: {
			value: pair?.best.avg_net_amount ?? null,
			unit: "money",
			caption:
				pair === null
					? null
					: part(hoursKeys.heatmap.caption, {
							weekday: messageValue(weekdayLongKey(pair.best.weekday)),
							hour: numberValue("hour", pair.best.hour_local),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainClause(input, pair)],
		tables:
			rows.length === 0
				? []
				: [
						heatTable(
							input,
							rows,
							hoursKeys.heatmap.netTable,
							(row) => row.avg_net_amount,
							(hour) => averageOf(hour, "net"),
							"money",
						),
						heatTable(
							input,
							rows,
							hoursKeys.heatmap.invoicesTable,
							(row) => row.avg_invoices,
							(hour) => averageOf(hour, "invoices"),
							"decimal",
						),
					],
		chart: null,
		notice: thin
			? {
					tone: "info",
					part: part(hoursKeys.heatmap.thin, {
						days: numberValue("count", THIN_WEEKDAY_DAYS),
					}),
					action: null,
				}
			: null,
		markers: themeMarkers(input, false),
		csvName: hoursCsvName(input.context, "heatmap"),
	};
}

export const hoursHeatmapCard: ThemeCardDefinition = {
	id: "heatmap",
	needs: hoursNeeds.heat,
	visible: () => true,
	build: buildHeatmapCard,
};
