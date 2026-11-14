import type { CardModel, ChartModel, TableModel } from "../../../model/card.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { weekdayLongKey } from "../../keys.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { hoursKeys } from "../keys.js";
import {
	type HourProfileRow,
	hoursCalls,
	hoursCsvName,
	hoursNeeds,
	profileRows,
	weekdayRows,
} from "../support.js";

interface WeekdayEntry {
	readonly weekday: number;
	readonly row: HourProfileRow;
	readonly previousMean: number | null;
	readonly change: number | null;
}

function entriesOf(input: ThemeCardInput): WeekdayEntry[] {
	const previous = weekdayRows(
		profileRows(input.results, hoursCalls.hoursPrevious),
	);
	return weekdayRows(profileRows(input.results, hoursCalls.hours)).map(
		(row) => {
			const before = previous.find((entry) => entry.weekday === row.weekday);
			const previousMean = before?.avg_net_amount ?? null;
			return {
				weekday: row.weekday ?? 0,
				row,
				previousMean,
				change: relativeChange(row.avg_net_amount, previousMean),
			};
		},
	);
}

function best(
	entries: readonly WeekdayEntry[],
	direction: 1 | -1,
): WeekdayEntry | null {
	let chosen: WeekdayEntry | null = null;
	for (const entry of entries) {
		const value = entry.row.avg_net_amount;
		if (value === null) continue;
		const current = chosen?.row.avg_net_amount ?? null;
		if (current === null || direction * (value - current) > 0) chosen = entry;
	}
	return chosen;
}

function largestChange(entries: readonly WeekdayEntry[]): WeekdayEntry | null {
	let chosen: WeekdayEntry | null = null;
	for (const entry of entries) {
		if (entry.change === null) continue;
		if (
			chosen === null ||
			Math.abs(entry.change) > Math.abs(chosen.change ?? 0)
		) {
			chosen = entry;
		}
	}
	return chosen;
}

function weekdayTable(entries: readonly WeekdayEntry[]): TableModel {
	return tableModel({
		captionKey: hoursKeys.weekday.table,
		columns: [
			column("weekday", hoursKeys.table.weekday, "message"),
			column("meanNet", hoursKeys.table.meanNet, "money"),
			column("meanInvoices", hoursKeys.table.meanInvoices, "decimal"),
			column("share", hoursKeys.table.share, "percent"),
			column("previousMean", hoursKeys.table.previousMean, "money"),
			column("change", hoursKeys.table.change, "signedPercent"),
		],
		rows: entries.map((entry) => ({
			id: String(entry.weekday),
			cells: {
				weekday: weekdayLongKey(entry.weekday),
				meanNet: entry.row.avg_net_amount,
				meanInvoices: entry.row.avg_invoices,
				share: entry.row.net_share,
				previousMean: entry.previousMean,
				change: entry.change,
			},
		})),
	});
}

function weekdayChart(entries: readonly WeekdayEntry[]): ChartModel {
	return {
		labelKey: hoursKeys.weekday.chart,
		categories: entries.map((entry) =>
			messageValue(weekdayLongKey(entry.weekday)),
		),
		series: [
			{
				label: part(hoursKeys.table.meanNet),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: entries.map((entry) => entry.row.avg_net_amount),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function narrativeOf(
	input: ThemeCardInput,
	entries: readonly WeekdayEntry[],
): SentencePart[] {
	const range = rangeValue(input.context);
	const top = best(entries, 1);
	const bottom = best(entries, -1);
	if (top === null || bottom === null)
		return [part(hoursKeys.weekday.noData, { range })];
	const gap = relativeChange(top.row.avg_net_amount, bottom.row.avg_net_amount);
	const parts: SentencePart[] = [
		part(hoursKeys.weekday.main, {
			range,
			best: messageValue(weekdayLongKey(top.weekday)),
			bestValue: numberValue("money", top.row.avg_net_amount ?? 0),
			worst: messageValue(weekdayLongKey(bottom.weekday)),
			gap: numberValue("percent", gap ?? 0),
		}),
	];
	const driver = largestChange(entries);
	if (driver !== null && driver.change !== null) {
		parts.push(
			part(hoursKeys.weekday.driver, {
				weekday: messageValue(weekdayLongKey(driver.weekday)),
				delta: numberValue("signedPercent", driver.change),
			}),
		);
	}
	return parts;
}

export function buildWeekdayCard(input: ThemeCardInput): CardModel {
	const entries = entriesOf(input);
	const top = best(entries, 1);
	return {
		id: "weekday",
		titleKey: hoursKeys.weekday.title,
		subtitle: null,
		metricId: "weekday_share",
		relatedMetricIds: ["net_revenue"],
		headline: {
			value: top?.row.avg_net_amount ?? null,
			unit: "money",
			caption:
				top === null
					? null
					: part(hoursKeys.weekday.caption, {
							weekday: messageValue(weekdayLongKey(top.weekday)),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrativeOf(input, entries),
		tables: entries.length === 0 ? [] : [weekdayTable(entries)],
		chart: entries.length === 0 ? null : weekdayChart(entries),
		notice: null,
		markers: themeMarkers(input, false),
		csvName: hoursCsvName(input.context, "weekday"),
	};
}

export const hoursWeekdayCard: ThemeCardDefinition = {
	id: "weekday",
	needs: hoursNeeds.profile,
	visible: () => true,
	build: buildWeekdayCard,
};
