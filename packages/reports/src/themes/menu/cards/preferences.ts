import { classifyModifier, type ModifierFamily } from "@fnb/core";
import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { SHARE_DIGITS } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import {
	type DriverCandidate,
	driverClause,
} from "../../../model/narrative.js";
import { difference, ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import {
	type ModifierRow,
	menuCalls,
	menuCsvName,
	menuNeeds,
} from "../support.js";

export interface ModifierLevel {
	readonly name: string;
	readonly family: ModifierFamily;
	readonly lines: number;
	readonly previousLines: number;
	readonly share: number | null;
	readonly previousShare: number | null;
	readonly change: number | null;
}

const FAMILY_ORDER: Readonly<Record<ModifierFamily, number>> = {
	sugar: 0,
	ice: 1,
	other: 2,
};

function byName(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function modifierLevels(rows: readonly ModifierRow[]): ModifierLevel[] {
	const classified = rows.map((row) => ({
		row,
		family: classifyModifier(row.modifier_name),
	}));
	const totals = new Map<ModifierFamily, { lines: number; previous: number }>();
	for (const { row, family } of classified) {
		const total = totals.get(family) ?? { lines: 0, previous: 0 };
		totals.set(family, {
			lines: total.lines + row.lines,
			previous: total.previous + (row.compare_lines ?? 0),
		});
	}
	return classified
		.map(({ row, family }) => {
			const total = totals.get(family) ?? { lines: 0, previous: 0 };
			const previousLines = row.compare_lines ?? 0;
			const share = ratio(row.lines, total.lines, SHARE_DIGITS);
			const previousShare = ratio(previousLines, total.previous, SHARE_DIGITS);
			return {
				name: row.modifier_name,
				family,
				lines: row.lines,
				previousLines,
				share,
				previousShare,
				change: difference(share, previousShare),
			};
		})
		.sort(
			(left, right) =>
				FAMILY_ORDER[left.family] - FAMILY_ORDER[right.family] ||
				right.lines - left.lines ||
				byName(left.name, right.name),
		);
}

function leaderOf(
	levels: readonly ModifierLevel[],
	family: ModifierFamily,
): ModifierLevel | null {
	return (
		levels.find((level) => level.family === family && level.lines > 0) ?? null
	);
}

function mainPart(
	input: ThemeCardInput,
	levels: readonly ModifierLevel[],
): SentencePart {
	const sugar = leaderOf(levels, "sugar");
	const ice = leaderOf(levels, "ice");
	const values: Record<string, TypedValue> = {};
	if (sugar !== null) {
		values.sugar = textValue("text", sugar.name);
		values.sugarShare = numberValue("percent", sugar.share ?? 0);
	}
	if (ice !== null) {
		values.ice = textValue("text", ice.name);
		values.iceShare = numberValue("percent", ice.share ?? 0);
	}
	if (sugar !== null && ice !== null) {
		return part(menuKeys.preferences.main, values);
	}
	if (sugar !== null) return part(menuKeys.preferences.sugarOnly, values);
	if (ice !== null) return part(menuKeys.preferences.iceOnly, values);
	const others = levels.filter((level) => level.lines > 0).length;
	if (others > 0) {
		return part(menuKeys.preferences.otherOnly, {
			count: numberValue("count", others),
		});
	}
	return part(menuKeys.preferences.noData, {
		range: rangeValue(input.context),
	});
}

function drivers(levels: readonly ModifierLevel[]): DriverCandidate[] {
	return levels.flatMap((level) =>
		level.family === "other" || level.change === null
			? []
			: [
					{
						dimension: "item" as const,
						label: textValue("text", level.name),
						contribution: level.change,
						unit: "fraction" as const,
					},
				],
	);
}

function levelTable(
	captionKey: string,
	levels: readonly ModifierLevel[],
	withFamily: boolean,
): TableModel {
	return tableModel({
		captionKey,
		columns: [
			column("level", menuKeys.table.level, "text"),
			...(withFamily
				? [column("family", menuKeys.table.family, "message")]
				: []),
			column("lines", menuKeys.table.lines, "count"),
			column("familyShare", menuKeys.table.familyShare, "percent"),
			column("previousShare", menuKeys.table.previousShare, "percent"),
			column("change", reportKeys.table.changePoints, "percentPoints"),
		],
		rows: levels.map((level) => ({
			id: `${level.family}|${level.name}`,
			cells: {
				level: level.name,
				family: menuKeys.family[level.family],
				lines: level.lines,
				familyShare: level.share,
				previousShare: level.previousShare,
				change: level.change,
			},
		})),
	});
}

function chartOf(levels: readonly ModifierLevel[]): ChartModel | null {
	const shown = levels.filter((level) => level.family !== "other");
	if (shown.length === 0) return null;
	return {
		labelKey: menuKeys.preferences.chart,
		categories: shown.map((level) => textValue("text", level.name)),
		series: [
			{
				label: part(reportKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: shown.map((level) => level.share),
			},
			{
				label: part(reportKeys.periodRow.previous),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: shown.map((level) => level.previousShare),
			},
		],
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildPreferencesCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const levels = modifierLevels(
		input.results.rows(menuCalls.modifiers, "modifier_summary") ?? [],
	);
	const sugar = leaderOf(levels, "sugar");
	const sugarAndOther = levels.filter((level) => level.family !== "ice");
	const ice = levels.filter((level) => level.family === "ice");
	const driver = driverClause(drivers(levels), 0);
	const notice: NoticeModel | null = levels.every(
		(level) => level.family === "other",
	)
		? { tone: "info", part: part(menuKeys.preferences.none), action: null }
		: null;
	return {
		id: "preferences",
		titleKey: menuKeys.preferences.title,
		subtitle: null,
		metricId: "modifier_pref",
		relatedMetricIds: [],
		headline: {
			value: sugar?.share ?? null,
			unit: "fraction",
			caption:
				sugar === null
					? null
					: part(menuKeys.preferences.caption, {
							level: textValue("text", sugar.name),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainPart(input, levels), ...(driver === null ? [] : [driver])],
		tables: [
			...(sugarAndOther.length === 0
				? []
				: [
						levelTable(
							menuKeys.preferences.sugarTable,
							sugarAndOther,
							sugarAndOther.some((level) => level.family === "other"),
						),
					]),
			...(ice.length === 0
				? []
				: [levelTable(menuKeys.preferences.iceTable, ice, false)]),
		],
		chart: chartOf(levels),
		notice,
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "preferences"),
	};
}

export const menuPreferencesCard: ThemeCardDefinition = {
	id: "preferences",
	needs: menuNeeds.preferences,
	visible: () => true,
	build: buildPreferencesCard,
};
