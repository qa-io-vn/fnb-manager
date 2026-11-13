import type { AnalyticsRow } from "../../../contract/functions.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	NoticeModel,
	TableRowModel,
} from "../../../model/card.js";
import type { Coverage } from "../../../model/coverage.js";
import { byAscending, byDescending, topN } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { weekKeys } from "../keys.js";
import {
	velocityReferenceDate,
	weekCalls,
	weekCsvName,
	weekMarkers,
	weekNeeds,
} from "../support.js";

export type VelocityRow = AnalyticsRow<"item_velocity">;

export const MIN_VELOCITY_QUANTITY = 10;
export const RISER_COUNT = 5;
export const FALLER_COUNT = 5;
export const NEW_ITEM_COUNT = 3;

export type MoverGroup = "up" | "down" | "new";

export interface Movers {
	readonly risers: readonly VelocityRow[];
	readonly fallers: readonly VelocityRow[];
	readonly newItems: readonly VelocityRow[];
}

export function moversOf(rows: readonly VelocityRow[]): Movers {
	const change = (row: VelocityRow) => row.quantity_change_pct;
	return {
		risers: topN(
			rows.filter(
				(row) =>
					row.prior_quantity >= MIN_VELOCITY_QUANTITY &&
					row.recent_quantity >= MIN_VELOCITY_QUANTITY &&
					(row.quantity_change_pct ?? 0) > 0,
			),
			RISER_COUNT,
			byDescending(change),
		),
		fallers: topN(
			rows.filter(
				(row) =>
					row.prior_quantity >= MIN_VELOCITY_QUANTITY &&
					(row.quantity_change_pct ?? 0) < 0,
			),
			FALLER_COUNT,
			byAscending(change),
		),
		newItems: topN(
			rows.filter(
				(row) =>
					row.prior_quantity === 0 &&
					row.recent_quantity >= MIN_VELOCITY_QUANTITY,
			),
			NEW_ITEM_COUNT,
			byDescending((row) => row.recent_net_amount),
		),
	};
}

export function velocityCoverage(input: CardInput): Coverage {
	return input.coverage.forReference(velocityReferenceDate(input.context));
}

export function velocityRows(
	input: CardInput,
	coverage: Coverage,
): readonly VelocityRow[] {
	if (coverage.state === "none") return [];
	const key =
		coverage.state === "partial"
			? weekCalls.velocityCovered
			: weekCalls.velocity;
	return input.results.rows(key, "item_velocity") ?? [];
}

function mainPart(movers: Movers): SentencePart {
	const riser = movers.risers[0];
	const faller = movers.fallers[0];
	const riserValues =
		riser === undefined
			? {}
			: {
					riser: textValue("text", riser.item_name),
					riserChange: numberValue(
						"percentChange",
						riser.quantity_change_pct ?? 0,
					),
				};
	const fallerValues =
		faller === undefined
			? {}
			: {
					faller: textValue("text", faller.item_name),
					fallerChange: numberValue(
						"percentChange",
						faller.quantity_change_pct ?? 0,
					),
				};
	if (riser !== undefined && faller !== undefined) {
		return part(weekKeys.movers.main, { ...riserValues, ...fallerValues });
	}
	if (riser !== undefined) return part(weekKeys.movers.risersOnly, riserValues);
	if (faller !== undefined) {
		return part(weekKeys.movers.fallersOnly, fallerValues);
	}
	return part(weekKeys.movers.none, {
		minimum: numberValue("count", MIN_VELOCITY_QUANTITY),
	});
}

function newItemPart(movers: Movers): SentencePart | null {
	const first = movers.newItems[0];
	if (first === undefined) return null;
	return part(weekKeys.movers.newItem, {
		item: textValue("text", first.item_name),
		quantity: numberValue("decimal", first.recent_quantity),
	});
}

function rowsOf(
	group: MoverGroup,
	rows: readonly VelocityRow[],
): TableRowModel[] {
	return rows.map((row) => ({
		id: `${group}|${row.item_external_id}`,
		cells: {
			group: weekKeys.movers.group[group],
			item: row.item_name,
			recentQuantity: row.recent_quantity,
			priorQuantity: row.prior_quantity,
			quantityChange: row.quantity_change_pct,
			recentNet: row.recent_net_amount,
		},
	}));
}

function windowPart(input: CardInput): SentencePart {
	return part(weekKeys.movers.window, {
		end: textValue("date", input.context.period.end),
	});
}

export function buildMoversCard(input: CardInput): CardModel {
	const { context } = input;
	const coverage = velocityCoverage(input);
	const building = coverage.state === "none";
	const movers = moversOf(velocityRows(input, coverage));
	const riser = movers.risers[0] ?? null;
	const headlineValue = riser === null ? null : riser.quantity_change_pct;
	const caption: SentencePart | null =
		riser === null
			? null
			: coverage.state === "partial"
				? part(weekKeys.movers.captionLikeForLike, {
						item: textValue("text", riser.item_name),
						covered: numberValue("count", coverage.coveredStoreIds.length),
						total: numberValue("count", coverage.storeCount),
					})
				: part(weekKeys.movers.caption, {
						item: textValue("text", riser.item_name),
					});
	const notice: NoticeModel | null = building
		? {
				tone: "info",
				part: part(weekKeys.movers.buildingBaseline),
				action: null,
			}
		: riser === null
			? {
					tone: "info",
					part: part(weekKeys.movers.noRiser, {
						minimum: numberValue("count", MIN_VELOCITY_QUANTITY),
					}),
					action: null,
				}
			: null;
	const newItem = newItemPart(movers);
	const narrative: SentencePart[] = building
		? [part(weekKeys.movers.buildingBaselineSentence)]
		: [mainPart(movers), ...(newItem === null ? [] : [newItem])];
	return {
		id: "movers",
		titleKey: weekKeys.movers.title,
		subtitle: windowPart(input),
		metricId: "item_velocity",
		relatedMetricIds: [],
		headline: { value: headlineValue, unit: "percentChange", caption },
		comparisons: [],
		decomposition: null,
		narrative,
		tables: [
			tableModel({
				captionKey: weekKeys.movers.table,
				columns: [
					column("group", weekKeys.table.group, "message"),
					column("item", reportKeys.table.item, "text"),
					column("recentQuantity", weekKeys.table.recentQuantity, "decimal"),
					column("priorQuantity", weekKeys.table.priorQuantity, "decimal"),
					column(
						"quantityChange",
						weekKeys.table.quantityChange,
						"percentChange",
					),
					column("recentNet", weekKeys.table.recentNet, "money"),
				],
				rows: [
					...rowsOf("up", movers.risers),
					...rowsOf("down", movers.fallers),
					...rowsOf("new", movers.newItems),
				],
			}),
		],
		chart: null,
		notice,
		markers: weekMarkers(input, true),
		csvName: weekCsvName(context, "movers"),
	};
}

export const moversCard: CardDefinition = {
	id: "movers",
	needs: weekNeeds.movers,
	visible: () => true,
	build: buildMoversCard,
};
