import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import type { ThemeContext } from "../context.js";
import { MENU_CLASSES, type ThemeRow } from "../contract.js";
import {
	type ReportCallSpec,
	reportCall,
	themeCoverageCall,
	themeStoreIds,
} from "../definition.js";

export const MENU_SLUG = "thuc-don";
export const MENU_CALL_PREFIX = "menu.";

export const menuCalls = {
	coverage: COVERAGE_CALL_KEY,
	items: "items",
	margins: "margins",
	settings: "settings",
} as const;

export const menuNeeds = {
	matrix: [menuCalls.coverage, menuCalls.settings, `${MENU_CALL_PREFIX}*`],
	margins: [menuCalls.coverage, menuCalls.margins],
} as const;

export type MenuRow = ThemeRow<"menu_engineering">;
export type MarginRow = ThemeRow<"item_margins">;
export type MenuClass = NonNullable<MenuRow["menu_class"]>;
export type MenuRole = MenuRow["role"];

export { MENU_CLASSES };

export const MENU_ROLES: readonly MenuRole[] = [
	"drink",
	"topping",
	"food",
	"snack",
	"other",
];

export function menuCallKey(storeId: string): string {
	return `${MENU_CALL_PREFIX}${storeId}`;
}

export function menuPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const { range } = context;
	return [
		themeCoverageCall(context),
		...storeIds.map((storeId) =>
			reportCall(menuCallKey(storeId), "menu_engineering", {
				store_ids: [storeId],
				as_of_date: range.to,
			}),
		),
		reportCall(menuCalls.items, "item_summary", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
			compare_from: range.previous.from,
			compare_to: range.previous.to,
		}),
		reportCall(menuCalls.margins, "item_margins", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
		}),
		reportCall(menuCalls.settings, "report_settings_of", {
			store_ids: storeIds,
		}),
	];
}

export function menuCsvName(context: ThemeContext, card: string): string {
	return csvName(MENU_SLUG, card, context.range.key);
}
