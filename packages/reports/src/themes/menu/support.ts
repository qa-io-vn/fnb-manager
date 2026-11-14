import type { AnalyticsRow } from "../../contract/functions.js";
import type { DateRange } from "../../contract/values.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { type Comparison, csvName } from "../../model/card.js";
import {
	comparison,
	likeForLikeLabel,
	noCoverageReason,
} from "../../model/comparison.js";
import type { CoverageModel } from "../../model/coverage.js";
import type { SentencePart, ValueUnit } from "../../model/values.js";
import { addDays } from "../../period/dates.js";
import type { ThemeContext } from "../context.js";
import { MENU_CLASSES, type ThemeRow } from "../contract.js";
import {
	lastDaysWindow,
	type ReportCallSpec,
	reportCall,
	themeCoverageCall,
	themeStoreIds,
} from "../definition.js";

export const MENU_SLUG = "thuc-don";
export const MENU_CALL_PREFIX = "menu.";

export const MENU_WINDOW_DAYS = 92;
export const PAIR_MIN_INVOICES = 3;
export const PAIR_LIMIT = 50;
export const MENU_PREVIEW_ROWS = 10;

export const menuCalls = {
	coverage: COVERAGE_CALL_KEY,
	items: "items",
	itemsCovered: "itemsCovered",
	margins: "margins",
	attach: "attach",
	attachPrevious: "attachPrevious",
	attachCovered: "attachCovered",
	attachPreviousCovered: "attachPreviousCovered",
	pairs: "pairs",
	modifiers: "modifiers",
	settings: "settings",
} as const;

export const menuNeeds = {
	matrix: [menuCalls.coverage, menuCalls.settings, `${MENU_CALL_PREFIX}*`],
	margins: [menuCalls.coverage, menuCalls.margins],
	movers: [menuCalls.coverage, menuCalls.items, menuCalls.itemsCovered],
	categoryMix: [menuCalls.coverage, menuCalls.items],
	sizeMix: [menuCalls.coverage, menuCalls.items, menuCalls.itemsCovered],
	attach: [
		menuCalls.coverage,
		menuCalls.items,
		menuCalls.attach,
		menuCalls.attachPrevious,
		menuCalls.attachCovered,
		menuCalls.attachPreviousCovered,
	],
	pairs: [menuCalls.coverage, menuCalls.pairs],
	preferences: [menuCalls.coverage, menuCalls.modifiers],
} as const;

export type MenuRow = ThemeRow<"menu_engineering">;
export type MarginRow = ThemeRow<"item_margins">;
export type ItemRow = AnalyticsRow<"item_summary">;
export type AttachRow = ThemeRow<"item_attach">;
export type PairRow = ThemeRow<"basket_pairs">;
export type ModifierRow = ThemeRow<"modifier_summary">;
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

export type MenuWindow = DateRange & { readonly days: number };

export function menuWindow(context: Pick<ThemeContext, "range">): MenuWindow {
	return lastDaysWindow(context.range, MENU_WINDOW_DAYS);
}

export function menuPreviousWindow(
	context: Pick<ThemeContext, "range">,
): MenuWindow {
	const window = menuWindow(context);
	return {
		from: addDays(window.from, -window.days),
		to: addDays(window.from, -1),
		days: window.days,
	};
}

function attachCall(
	key: string,
	storeIds: readonly string[],
	window: DateRange,
): ReportCallSpec<"item_attach"> {
	return reportCall(key, "item_attach", {
		store_ids: [...storeIds],
		from_date: window.from,
		to_date: window.to,
	});
}

function itemsCall(
	key: string,
	storeIds: readonly string[],
	context: ThemeContext,
): ReportCallSpec<"item_summary"> {
	const { range } = context;
	return reportCall(key, "item_summary", {
		store_ids: [...storeIds],
		from_date: range.from,
		to_date: range.to,
		compare_from: range.previous.from,
		compare_to: range.previous.to,
	});
}

export function menuPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const { range } = context;
	const window = menuWindow(context);
	return [
		themeCoverageCall(context),
		...storeIds.map((storeId) =>
			reportCall(menuCallKey(storeId), "menu_engineering", {
				store_ids: [storeId],
				as_of_date: range.to,
			}),
		),
		itemsCall(menuCalls.items, storeIds, context),
		reportCall(menuCalls.margins, "item_margins", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
		}),
		attachCall(menuCalls.attach, storeIds, window),
		attachCall(menuCalls.attachPrevious, storeIds, menuPreviousWindow(context)),
		reportCall(menuCalls.pairs, "basket_pairs", {
			store_ids: storeIds,
			from_date: window.from,
			to_date: window.to,
			min_pair_invoices: PAIR_MIN_INVOICES,
			max_pairs: PAIR_LIMIT,
		}),
		reportCall(menuCalls.modifiers, "modifier_summary", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
			compare_from: range.previous.from,
			compare_to: range.previous.to,
		}),
		reportCall(menuCalls.settings, "report_settings_of", {
			store_ids: storeIds,
		}),
	];
}

export function menuFollowUpCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	const calls: ReportCallSpec[] = [];
	const previous = coverage.forReference(context.range.previous.from);
	if (previous.state === "partial") {
		calls.push(
			itemsCall(menuCalls.itemsCovered, previous.coveredStoreIds, context),
		);
	}
	const previousWindow = menuPreviousWindow(context);
	const windowCoverage = coverage.forReference(previousWindow.from);
	if (windowCoverage.state === "partial") {
		calls.push(
			attachCall(
				menuCalls.attachCovered,
				windowCoverage.coveredStoreIds,
				menuWindow(context),
			),
			attachCall(
				menuCalls.attachPreviousCovered,
				windowCoverage.coveredStoreIds,
				previousWindow,
			),
		);
	}
	return calls;
}

export interface ComparedValues {
	readonly current: number | null;
	readonly reference: number | null;
}

export function menuComparison(input: {
	readonly coverage: CoverageModel;
	readonly range: DateRange;
	readonly label: SentencePart;
	readonly all: ComparedValues;
	readonly covered: () => ComparedValues;
	readonly unit: ValueUnit;
}): Comparison {
	const { range, label, unit } = input;
	const covered = input.coverage.forReference(range.from);
	if (covered.state === "full") {
		return comparison({
			kind: "previous",
			label,
			range,
			...input.all,
			coveredStores: covered.storeCount,
			totalStores: covered.storeCount,
			unit,
		});
	}
	if (covered.state === "partial") {
		return comparison({
			kind: "previous",
			label: likeForLikeLabel(label, covered),
			range,
			...input.covered(),
			basis: "like_for_like",
			coveredStores: covered.coveredStoreIds.length,
			totalStores: covered.storeCount,
			unit,
		});
	}
	return comparison({
		kind: "previous",
		label,
		range,
		current: input.all.current,
		reference: null,
		coveredStores: 0,
		totalStores: covered.storeCount,
		unavailable: noCoverageReason(
			input.coverage,
			covered.youngStoreIds,
			range.from,
		),
		unit,
	});
}

export function menuCsvName(context: ThemeContext, card: string): string {
	return csvName(MENU_SLUG, card, context.range.key);
}
