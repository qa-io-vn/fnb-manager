import type {
	CardModel,
	NoticeModel,
	TableRowModel,
} from "../../../model/card.js";
import type { Coverage } from "../../../model/coverage.js";
import { byAscending, byDescending, topN } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import {
	FALLER_COUNT,
	MIN_VELOCITY_QUANTITY,
	NEW_ITEM_COUNT,
	RISER_COUNT,
} from "../../../reports/week/cards/movers.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { spanValue, themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import { type ItemRow, menuCalls, menuCsvName, menuNeeds } from "../support.js";

const CHANGE_DIGITS = 3;
const PERCENT = 100;

export type MoverGroup = "up" | "down" | "new";

export interface ItemMove {
	readonly id: string;
	readonly name: string;
	readonly quantity: number;
	readonly previousQuantity: number;
	readonly change: number | null;
	readonly net: number;
}

export interface MenuMovers {
	readonly risers: readonly ItemMove[];
	readonly fallers: readonly ItemMove[];
	readonly newItems: readonly ItemMove[];
}

function changeOf(quantity: number, previousQuantity: number): number | null {
	return ratio(
		PERCENT * (quantity - previousQuantity),
		previousQuantity,
		CHANGE_DIGITS,
	);
}

export function itemMoves(rows: readonly ItemRow[]): ItemMove[] {
	return rows.map((row) => {
		const previousQuantity = row.compare_quantity ?? 0;
		return {
			id: row.item_external_id,
			name: row.item_name,
			quantity: row.quantity,
			previousQuantity,
			change: changeOf(row.quantity, previousQuantity),
			net: row.net_amount,
		};
	});
}

export function menuMoversOf(moves: readonly ItemMove[]): MenuMovers {
	const change = (move: ItemMove) => move.change;
	return {
		risers: topN(
			moves.filter(
				(move) =>
					move.previousQuantity >= MIN_VELOCITY_QUANTITY &&
					move.quantity >= MIN_VELOCITY_QUANTITY &&
					(move.change ?? 0) > 0,
			),
			RISER_COUNT,
			byDescending(change),
		),
		fallers: topN(
			moves.filter(
				(move) =>
					move.previousQuantity >= MIN_VELOCITY_QUANTITY &&
					(move.change ?? 0) < 0,
			),
			FALLER_COUNT,
			byAscending(change),
		),
		newItems: topN(
			moves.filter(
				(move) =>
					move.previousQuantity === 0 && move.quantity >= MIN_VELOCITY_QUANTITY,
			),
			NEW_ITEM_COUNT,
			byDescending((move) => move.net),
		),
	};
}

function moverRows(input: ThemeCardInput, previous: Coverage): ItemRow[] {
	if (previous.state === "none") return [];
	const key =
		previous.state === "partial" ? menuCalls.itemsCovered : menuCalls.items;
	return [...(input.results.rows(key, "item_summary") ?? [])];
}

function mainPart(movers: MenuMovers): SentencePart {
	const riser = movers.risers[0];
	const faller = movers.fallers[0];
	const riserValues =
		riser === undefined
			? {}
			: {
					riser: textValue("text", riser.name),
					riserChange: numberValue("percentChange", riser.change ?? 0),
				};
	const fallerValues =
		faller === undefined
			? {}
			: {
					faller: textValue("text", faller.name),
					fallerChange: numberValue("percentChange", faller.change ?? 0),
				};
	if (riser !== undefined && faller !== undefined) {
		return part(menuKeys.movers.main, { ...riserValues, ...fallerValues });
	}
	if (riser !== undefined) return part(menuKeys.movers.risersOnly, riserValues);
	if (faller !== undefined) {
		return part(menuKeys.movers.fallersOnly, fallerValues);
	}
	return part(menuKeys.movers.none, {
		minimum: numberValue("count", MIN_VELOCITY_QUANTITY),
	});
}

function newItemPart(movers: MenuMovers): SentencePart | null {
	const first = movers.newItems[0];
	if (first === undefined) return null;
	return part(menuKeys.movers.newItem, {
		item: textValue("text", first.name),
		quantity: numberValue("decimal", first.quantity),
	});
}

function rowsOf(
	group: MoverGroup,
	moves: readonly ItemMove[],
): TableRowModel[] {
	return moves.map((move) => ({
		id: `${group}|${move.id}`,
		cells: {
			group: menuKeys.movers.group[group],
			item: move.name,
			recentQuantity: move.quantity,
			priorQuantity: move.previousQuantity,
			quantityChange: move.change,
			recentNet: move.net,
		},
	}));
}

function captionOf(riser: ItemMove, previous: Coverage): SentencePart {
	if (previous.state === "partial") {
		return part(menuKeys.movers.captionLikeForLike, {
			item: textValue("text", riser.name),
			covered: numberValue("count", previous.coveredStoreIds.length),
			total: numberValue("count", previous.storeCount),
		});
	}
	return part(menuKeys.movers.caption, {
		item: textValue("text", riser.name),
	});
}

function noticeOf(
	input: ThemeCardInput,
	previous: Coverage,
	riser: ItemMove | null,
): NoticeModel | null {
	if (previous.state === "none") {
		return {
			tone: "info",
			part: part(menuKeys.movers.noPrevious, {
				range: spanValue(input.context.range.previous),
			}),
			action: null,
		};
	}
	if (riser !== null) return null;
	return {
		tone: "info",
		part: part(menuKeys.movers.noRiser, {
			minimum: numberValue("count", MIN_VELOCITY_QUANTITY),
		}),
		action: null,
	};
}

export function buildMoversCard(input: ThemeCardInput): CardModel {
	const { context, coverage } = input;
	const previous = coverage.forReference(context.range.previous.from);
	const movers = menuMoversOf(itemMoves(moverRows(input, previous)));
	const riser = movers.risers[0] ?? null;
	const newItem = newItemPart(movers);
	const narrative: SentencePart[] =
		previous.state === "none"
			? [part(menuKeys.movers.noPreviousSentence)]
			: [mainPart(movers), ...(newItem === null ? [] : [newItem])];
	return {
		id: "movers",
		titleKey: menuKeys.movers.title,
		subtitle: null,
		metricId: "item_velocity",
		relatedMetricIds: [],
		headline: {
			value: riser?.change ?? null,
			unit: "percentChange",
			caption: riser === null ? null : captionOf(riser, previous),
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: [
			tableModel({
				captionKey: menuKeys.movers.table,
				columns: [
					column("item", reportKeys.table.item, "text"),
					column("group", menuKeys.table.group, "message"),
					column("recentQuantity", menuKeys.table.recentQuantity, "decimal"),
					column("priorQuantity", menuKeys.table.priorQuantity, "decimal"),
					column(
						"quantityChange",
						menuKeys.table.quantityChange,
						"percentChange",
					),
					column("recentNet", menuKeys.table.recentNet, "money"),
				],
				rows: [
					...rowsOf("up", movers.risers),
					...rowsOf("down", movers.fallers),
					...rowsOf("new", movers.newItems),
				],
			}),
		],
		chart: null,
		notice: noticeOf(input, previous, riser),
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "movers"),
	};
}

export const menuMoversCard: ThemeCardDefinition = {
	id: "movers",
	needs: menuNeeds.movers,
	visible: () => true,
	build: buildMoversCard,
};
