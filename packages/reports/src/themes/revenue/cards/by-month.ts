import type { IsoDate } from "../../../contract/values.js";
import type { CardModel, ChartModel, TableModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoneyOrNull } from "../../../model/money.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { addYears, firstOfMonth, lastOfMonth } from "../../../period/dates.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { revenueKeys } from "../keys.js";
import {
	MONTHS_MIN_DAYS,
	revenueCalls,
	revenueCsvName,
	revenueNeeds,
	type SeriesRow,
	seriesRowsOf,
} from "../support.js";

export interface MonthEntry {
	readonly month: IsoDate;
	readonly complete: boolean;
	readonly net: number | null;
	readonly current: number | null;
	readonly lastYear: number | null;
	readonly change: number | null;
	readonly likeForLike: boolean;
	readonly covered: number;
	readonly total: number;
}

function netOf(
	rows: readonly SeriesRow[],
	month: IsoDate,
	storeIds: readonly string[] | null,
): number | null {
	if (storeIds === null) {
		const row = rows.find(
			(entry) => entry.store_id === null && entry.bucket_start === month,
		);
		return row === undefined || row.days_with_data === 0
			? null
			: row.net_amount;
	}
	const values = rows
		.filter(
			(entry) =>
				entry.store_id !== null &&
				storeIds.includes(entry.store_id) &&
				entry.bucket_start === month &&
				entry.days_with_data > 0,
		)
		.map((entry) => entry.net_amount);
	return values.length === 0 ? null : sumMoneyOrNull(values);
}

export function monthEntries(input: ThemeCardInput): MonthEntry[] {
	const rows = seriesRowsOf(input.results, revenueCalls.months);
	const lastYearRows = seriesRowsOf(input.results, revenueCalls.monthsLastYear);
	return rows
		.filter((row) => row.store_id === null)
		.map((row) => {
			const month = row.bucket_start;
			const lastYearMonth = addYears(month, -1);
			const reference = input.coverage.forReference(
				firstOfMonth(lastYearMonth),
			);
			const likeForLike = reference.state === "partial";
			const covered = likeForLike ? reference.coveredStoreIds : null;
			const current = netOf(rows, month, covered);
			const lastYear =
				reference.state === "none"
					? null
					: netOf(lastYearRows, lastYearMonth, covered);
			return {
				month,
				complete:
					month === firstOfMonth(month) &&
					row.bucket_end === lastOfMonth(month),
				net: row.days_with_data > 0 ? row.net_amount : null,
				current,
				lastYear,
				change: relativeChange(current, lastYear),
				likeForLike,
				covered: reference.coveredStoreIds.length,
				total: reference.storeCount,
			};
		});
}

function bestMonth(entries: readonly MonthEntry[]): MonthEntry | null {
	let best: MonthEntry | null = null;
	for (const entry of entries) {
		if (entry.net === null) continue;
		if (best === null || entry.net > (best.net ?? 0)) best = entry;
	}
	return best;
}

function monthTable(entries: readonly MonthEntry[]): TableModel {
	const anyLikeForLike = entries.some((entry) => entry.likeForLike);
	return tableModel({
		captionKey: revenueKeys.byMonth.table,
		columns: [
			column("month", revenueKeys.table.month, "month"),
			column("net", reportKeys.table.netAmount, "money"),
			column("lastYear", revenueKeys.table.lastYear, "money"),
			column("change", revenueKeys.table.changeLastYear, "signedPercent"),
			...(anyLikeForLike
				? [column("basis", reportKeys.table.state, "message")]
				: []),
		],
		rows: entries.map((entry) => ({
			id: entry.month,
			cells: {
				month: entry.month,
				net: entry.net,
				lastYear: entry.lastYear,
				change: entry.change,
				basis: entry.likeForLike ? revenueKeys.byMonth.likeForLike : null,
			},
		})),
	});
}

function monthChart(entries: readonly MonthEntry[]): ChartModel {
	return {
		labelKey: revenueKeys.byMonth.chart,
		categories: entries.map((entry) => textValue("month", entry.month)),
		series: [
			{
				label: part(revenueKeys.byMonth.thisYear),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: entries.map((entry) => entry.net),
			},
			{
				label: part(revenueKeys.byMonth.lastYear),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: entries.map((entry) => entry.lastYear),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function mainClause(
	input: ThemeCardInput,
	best: MonthEntry | null,
): SentencePart {
	const range = rangeValue(input.context);
	if (best === null || best.net === null) {
		return part(revenueKeys.byMonth.noData, { range });
	}
	const month = textValue("month", best.month);
	if (best.change === null) {
		return part(revenueKeys.byMonth.noLastYear, {
			range,
			month,
			value: numberValue("money", best.net),
		});
	}
	return part(revenueKeys.byMonth.main, {
		range,
		month,
		value: numberValue("money", best.net),
		delta: numberValue("signedPercent", best.change),
	});
}

export function buildByMonthCard(input: ThemeCardInput): CardModel {
	const entries = monthEntries(input);
	const latest = [...entries]
		.reverse()
		.find((entry) => entry.complete && entry.net !== null);
	return {
		id: "by_month",
		titleKey: revenueKeys.byMonth.title,
		subtitle: null,
		metricId: "month_net",
		relatedMetricIds: ["net_revenue"],
		headline: {
			value: latest?.net ?? null,
			unit: "money",
			caption:
				latest === undefined
					? null
					: part(revenueKeys.byMonth.caption, {
							month: textValue("month", latest.month),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainClause(input, bestMonth(entries))],
		tables: [monthTable(entries)],
		chart: entries.some((entry) => entry.net !== null)
			? monthChart(entries)
			: null,
		notice: null,
		markers: themeMarkers(input, false),
		csvName: revenueCsvName(input.context, "by_month"),
	};
}

export const revenueByMonthCard: ThemeCardDefinition = {
	id: "by_month",
	needs: revenueNeeds.months,
	visible: ({ context }) => context.range.days >= MONTHS_MIN_DAYS,
	build: buildByMonthCard,
};
