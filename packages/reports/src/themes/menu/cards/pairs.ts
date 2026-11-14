import type { CardModel, NoticeModel } from "../../../model/card.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeKeys } from "../../keys.js";
import { themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import {
	MENU_PREVIEW_ROWS,
	menuCalls,
	menuCsvName,
	menuNeeds,
	menuWindow,
	PAIR_MIN_INVOICES,
	type PairRow,
} from "../support.js";

export const PAIR_TABLE_ROWS = 20;

function nameA(row: PairRow): string {
	return row.item_a_name ?? row.item_a_external_id;
}

function nameB(row: PairRow): string {
	return row.item_b_name ?? row.item_b_external_id;
}

function mainPart(top: PairRow | null, days: number): SentencePart {
	if (top === null) {
		return part(menuKeys.pairs.none, {
			minimum: numberValue("count", PAIR_MIN_INVOICES),
			days: numberValue("count", days),
		});
	}
	return part(menuKeys.pairs.main, {
		a: textValue("text", nameA(top)),
		b: textValue("text", nameB(top)),
		invoices: numberValue("count", top.pair_invoices),
		lift: numberValue("decimal", top.lift ?? 0),
	});
}

export function buildPairsCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const window = menuWindow(context);
	const rows = (
		input.results.rows(menuCalls.pairs, "basket_pairs") ?? []
	).slice(0, PAIR_TABLE_ROWS);
	const top = rows[0] ?? null;
	const notice: NoticeModel | null =
		top === null
			? {
					tone: "info",
					part: part(menuKeys.pairs.minimum, {
						minimum: numberValue("count", PAIR_MIN_INVOICES),
					}),
					action: null,
				}
			: null;
	return {
		id: "pairs",
		titleKey: menuKeys.pairs.title,
		subtitle: part(themeKeys.subtitle.lastDays, {
			days: numberValue("count", window.days),
		}),
		metricId: "pair_lift",
		relatedMetricIds: [],
		headline: {
			value: top?.pair_invoices ?? null,
			unit: "count",
			caption:
				top === null
					? null
					: part(menuKeys.pairs.caption, {
							a: textValue("text", nameA(top)),
							b: textValue("text", nameB(top)),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainPart(top, window.days)],
		tables:
			rows.length === 0
				? []
				: [
						tableModel({
							captionKey: menuKeys.pairs.table,
							columns: [
								column("itemA", menuKeys.table.itemA, "text"),
								column("itemB", menuKeys.table.itemB, "text"),
								column("pairInvoices", menuKeys.table.pairInvoices, "count"),
								column("confidenceAB", menuKeys.table.confidenceAB, "percent"),
								column("confidenceBA", menuKeys.table.confidenceBA, "percent"),
								column("lift", menuKeys.table.lift, "decimal"),
							],
							rows: rows.map((row) => ({
								id: `${row.item_a_external_id}|${row.item_b_external_id}`,
								cells: {
									itemA: nameA(row),
									itemB: nameB(row),
									pairInvoices: row.pair_invoices,
									confidenceAB: row.confidence_a_to_b,
									confidenceBA: row.confidence_b_to_a,
									lift: row.lift,
								},
							})),
							previewRows: MENU_PREVIEW_ROWS,
						}),
					],
		chart: null,
		notice,
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "pairs"),
	};
}

export const menuPairsCard: ThemeCardDefinition = {
	id: "pairs",
	needs: menuNeeds.pairs,
	visible: () => true,
	build: buildPairsCard,
};
