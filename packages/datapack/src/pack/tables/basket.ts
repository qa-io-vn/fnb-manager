import { classifyModifier } from "@fnb/core";
import { difference, type ThemeRow } from "@fnb/reports";
import { scopedKey } from "../calls.js";
import type { PackTable } from "../schema.js";
import {
	byNumberDescending,
	byText,
	columns,
	type PackRows,
	packRow,
	packTable,
	rankKey,
	type TableContext,
	type TableSpec,
} from "./support.js";

type PairRow = ThemeRow<"basket_pairs">;
type ModifierRow = ThemeRow<"modifier_summary">;

export const PAIR_LIMIT = 8;
export const MODIFIER_LIMIT = 10;

export const PAIRS_SPEC: TableSpec = {
	grain: "pair-period",
	window: "w28",
	columns: columns([
		["item_a", "text"],
		["item_b", "text"],
		["invoices", "count"],
		["confidence_ab", "fraction"],
		["confidence_ba", "fraction"],
		["lift", "ratio"],
	]),
};

export const MODIFIERS_SPEC: TableSpec = {
	grain: "modifier-period",
	window: "w28",
	columns: columns([
		["name", "text"],
		["family", "class"],
		["lines", "count"],
		["share", "fraction"],
		["share_change", "pp_change"],
	]),
};

export function byPairOrder(left: PairRow, right: PairRow): number {
	return (
		byNumberDescending(left.pair_invoices, right.pair_invoices) ||
		byNumberDescending(left.lift, right.lift) ||
		byText(left.item_a_name, right.item_a_name) ||
		byText(left.item_b_name, right.item_b_name) ||
		byText(left.item_a_external_id, right.item_a_external_id) ||
		byText(left.item_b_external_id, right.item_b_external_id)
	);
}

export function byModifierOrder(left: ModifierRow, right: ModifierRow): number {
	return (
		byNumberDescending(left.lines, right.lines) ||
		byText(left.modifier_name, right.modifier_name)
	);
}

export function pairsTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const kept = [
			...context.results.rows(scopedKey("pairs", scope), "basket_pairs"),
		]
			.sort(byPairOrder)
			.slice(0, PAIR_LIMIT);
		kept.forEach((pair, index) => {
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				PAIRS_SPEC,
				[
					pair.item_a_name,
					pair.item_b_name,
					pair.pair_invoices,
					pair.confidence_a_to_b,
					pair.confidence_b_to_a,
					pair.lift,
				],
				context.request.currency,
			);
		});
	}
	return packTable("pairs", context, PAIRS_SPEC, rows);
}

export function modifiersTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const kept = [
			...context.results.rows(
				scopedKey("modifiers", scope),
				"modifier_summary",
			),
		]
			.filter((row) => row.lines > 0)
			.sort(byModifierOrder)
			.slice(0, MODIFIER_LIMIT);
		kept.forEach((modifier, index) => {
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				MODIFIERS_SPEC,
				[
					modifier.modifier_name,
					classifyModifier(modifier.modifier_name),
					modifier.lines,
					modifier.share,
					difference(modifier.share, modifier.compare_share),
				],
				context.request.currency,
			);
		});
	}
	return packTable("modifiers", context, MODIFIERS_SPEC, rows);
}
