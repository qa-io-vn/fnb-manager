import type { CardModel, ChartModel, TableModel } from "../../../model/card.js";
import { comparison } from "../../../model/comparison.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import type { HourLevel } from "../../contract.js";
import {
	referenceLabel,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { hoursKeys } from "../keys.js";
import {
	type HourProfileRow,
	hourRows,
	hoursCalls,
	hoursCsvName,
	hoursNeeds,
	levelWindows,
	profileRows,
	summaryRow,
	windowText,
} from "../support.js";

export function levelKey(level: HourLevel | null): string | null {
	return level === null ? null : hoursKeys.level[level];
}

function hourTable(rows: readonly HourProfileRow[]): TableModel {
	return tableModel({
		captionKey: hoursKeys.peakDead.table,
		columns: [
			column("hour", hoursKeys.table.hour, "hour"),
			column("meanNet", hoursKeys.table.meanNet, "money"),
			column("share", hoursKeys.table.share, "percent"),
			column("level", hoursKeys.table.level, "message"),
		],
		rows: rows.map((row) => ({
			id: String(row.hour_local),
			cells: {
				hour: row.hour_local,
				meanNet: row.avg_net_amount,
				share: row.net_share,
				level: levelKey(row.level),
			},
		})),
	});
}

function hourChart(rows: readonly HourProfileRow[]): ChartModel {
	const series = (
		level: HourLevel,
		tone: "primary" | "secondary" | "muted",
	) => ({
		label: part(hoursKeys.level[level]),
		kind: "bar" as const,
		tone,
		axis: "left" as const,
		stack: "level",
		values: rows.map((row) =>
			row.level === level ? row.avg_net_amount : null,
		),
	});
	return {
		labelKey: hoursKeys.peakDead.chart,
		categories: rows.map((row) => numberValue("hour", row.hour_local ?? 0)),
		series: [
			series("peak", "primary"),
			series("normal", "secondary"),
			series("dead", "muted"),
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function windowsText(
	rows: readonly HourProfileRow[],
	level: HourLevel,
): string {
	return levelWindows(rows)
		.filter((window) => window.level === level)
		.map(windowText)
		.join(", ");
}

function mainClause(
	input: ThemeCardInput,
	rows: readonly HourProfileRow[],
	summary: HourProfileRow | undefined,
): SentencePart {
	const range = rangeValue(input.context);
	if (
		summary === undefined ||
		summary.peak_share === null ||
		rows.length === 0
	) {
		return part(hoursKeys.peakDead.noData, { range });
	}
	const peak = windowsText(rows, "peak");
	const dead = windowsText(rows, "dead");
	const values = {
		range,
		peak: textValue("text", peak),
		peakShare: numberValue("percent", summary.peak_share),
		peakHours: numberValue("count", summary.peak_hours_used),
	};
	if (dead === "") return part(hoursKeys.peakDead.noDead, values);
	return part(hoursKeys.peakDead.main, {
		...values,
		dead: textValue("text", dead),
		deadShare: numberValue("percent", summary.dead_share ?? 0),
	});
}

export function buildPeakDeadCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const profile = profileRows(input.results, hoursCalls.hours);
	const rows = hourRows(profile, "all");
	const summary = summaryRow(profile, "all");
	const previous = summaryRow(
		profileRows(input.results, hoursCalls.hoursPrevious),
		"all",
	);
	const current = summary?.peak_share ?? null;
	return {
		id: "peak_dead",
		titleKey: hoursKeys.peakDead.title,
		subtitle: null,
		metricId: "peak_share_top_hours",
		relatedMetricIds: ["dead_hour_share"],
		headline: {
			value: current,
			unit: "fraction",
			caption:
				summary === undefined
					? null
					: part(hoursKeys.peakDead.window, {
							hours: numberValue("count", summary.peak_hours_used),
						}),
		},
		comparisons:
			current === null
				? []
				: [
						comparison({
							kind: "previous",
							label: referenceLabel(context.range, "previous"),
							range: context.range.previous,
							current,
							reference: previous?.peak_share ?? null,
							coveredStores: context.stores.length,
							totalStores: context.stores.length,
							unit: "fraction",
						}),
					],
		decomposition: null,
		narrative: [mainClause(input, rows, summary)],
		tables: rows.length === 0 ? [] : [hourTable(rows)],
		chart: rows.length === 0 ? null : hourChart(rows),
		notice: null,
		markers: themeMarkers(input, false),
		csvName: hoursCsvName(context, "peak_dead"),
	};
}

export const hoursPeakDeadCard: ThemeCardDefinition = {
	id: "peak_dead",
	needs: hoursNeeds.profile,
	visible: () => true,
	build: buildPeakDeadCard,
};
