import type {
	CardModel,
	ChartModel,
	Comparison,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { narrate } from "../../../model/narrative.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { pointsValue } from "../../../reports/month/support.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeKeys } from "../../keys.js";
import { themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import {
	type AttachRow,
	type ComparedValues,
	type ItemRow,
	MENU_PREVIEW_ROWS,
	menuCalls,
	menuComparison,
	menuCsvName,
	menuNeeds,
	menuPreviousWindow,
	menuWindow,
} from "../support.js";

export const TOPPING_METRIC = "attach_rate_topping";
export const SNACK_METRIC = "attach_rate_snack";
export const MIN_TOP_DRINK_INVOICES = 20;
export const ATTACH_CHART_DRINKS = 10;

type RateKind = "topping" | "snack";

function summaryOf(rows: readonly AttachRow[] | undefined): AttachRow | null {
	return rows?.find((row) => row.item_external_id === null) ?? null;
}

function drinksOf(rows: readonly AttachRow[]): AttachRow[] {
	return rows
		.filter((row) => row.item_external_id !== null)
		.sort(
			(left, right) =>
				right.drink_invoices - left.drink_invoices ||
				((left.item_external_id ?? "") < (right.item_external_id ?? "")
					? -1
					: 1),
		);
}

function rateOf(row: AttachRow | null, kind: RateKind): number | null {
	if (row === null) return null;
	return kind === "topping" ? row.topping_rate : row.snack_rate;
}

function drinkName(row: AttachRow): string {
	return row.item_name ?? row.item_external_id ?? "";
}

function rateComparison(
	input: ThemeCardInput,
	kind: RateKind,
	labelKey: string,
): Comparison {
	const window = menuWindow(input.context);
	const previousWindow = menuPreviousWindow(input.context);
	const valuesOf = (current: string, reference: string): ComparedValues => ({
		current: rateOf(
			summaryOf(input.results.rows(current, "item_attach")),
			kind,
		),
		reference: rateOf(
			summaryOf(input.results.rows(reference, "item_attach")),
			kind,
		),
	});
	return menuComparison({
		coverage: input.coverage,
		range: previousWindow,
		label: part(labelKey, { days: numberValue("count", window.days) }),
		all: valuesOf(menuCalls.attach, menuCalls.attachPrevious),
		covered: () =>
			valuesOf(menuCalls.attachCovered, menuCalls.attachPreviousCovered),
		unit: "fraction",
	});
}

function topDrinkPart(drinks: readonly AttachRow[]): SentencePart | null {
	let top: AttachRow | null = null;
	for (const drink of drinks) {
		if (drink.drink_invoices < MIN_TOP_DRINK_INVOICES) continue;
		if (drink.topping_rate === null || drink.topping_rate <= 0) continue;
		if (top === null || drink.topping_rate > (top.topping_rate ?? 0)) {
			top = drink;
		}
	}
	if (top === null || top.topping_rate === null) return null;
	return part(menuKeys.attach.topDrink, {
		item: textValue("text", drinkName(top)),
		rate: numberValue("percent", top.topping_rate),
	});
}

function rolesNotice(key: string): NoticeModel {
	return { tone: "info", part: part(key), action: "settings_roles" };
}

function sellsWithoutDrinkRole(items: readonly ItemRow[]): boolean {
	const sold = items.filter((row) => row.quantity > 0);
	return sold.length > 0 && sold.every((row) => row.role !== "drink");
}

function noticeOf(
	summary: AttachRow | null,
	items: readonly ItemRow[],
): NoticeModel | null {
	if (summary === null || summary.drink_invoices === 0) {
		return sellsWithoutDrinkRole(items)
			? rolesNotice(menuKeys.attach.noDrinkRole)
			: null;
	}
	if (summary.topping_rate === null && summary.snack_rate === null) {
		return rolesNotice(menuKeys.attach.noRoles);
	}
	if (summary.topping_rate === null) {
		return rolesNotice(menuKeys.attach.noToppingRole);
	}
	if (summary.snack_rate === null) {
		return rolesNotice(menuKeys.attach.noSnackRole);
	}
	return null;
}

function drinksTable(drinks: readonly AttachRow[]): TableModel {
	return tableModel({
		captionKey: menuKeys.attach.table,
		columns: [
			column("drink", menuKeys.table.drink, "text"),
			column("drinkInvoices", menuKeys.table.drinkInvoices, "count"),
			column("toppingRate", menuKeys.table.toppingRate, "percent"),
			column("snackRate", menuKeys.table.snackRate, "percent"),
		],
		rows: drinks.map((drink) => ({
			id: drink.item_external_id ?? "",
			cells: {
				drink: drinkName(drink),
				drinkInvoices: drink.drink_invoices,
				toppingRate: drink.topping_rate,
				snackRate: drink.snack_rate,
			},
		})),
		previewRows: MENU_PREVIEW_ROWS,
	});
}

function chartOf(drinks: readonly AttachRow[]): ChartModel | null {
	const shown = drinks
		.filter((drink) => drink.topping_rate !== null)
		.slice(0, ATTACH_CHART_DRINKS);
	if (shown.length === 0) return null;
	return {
		labelKey: menuKeys.attach.chart,
		categories: shown.map((drink) => textValue("text", drinkName(drink))),
		series: [
			{
				label: part(menuKeys.table.toppingRate),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: shown.map((drink) => drink.topping_rate),
			},
		],
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildAttachCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const window = menuWindow(context);
	const rows = input.results.rows(menuCalls.attach, "item_attach") ?? [];
	const summary = summaryOf(rows);
	const drinks = drinksOf(rows);
	const topping = rateOf(summary, "topping");
	const snack = rateOf(summary, "snack");
	const toppingComparison = rateComparison(
		input,
		"topping",
		menuKeys.attach.toppingPrevious,
	);
	const snackComparison = rateComparison(
		input,
		"snack",
		menuKeys.attach.snackPrevious,
	);
	const values: Record<string, TypedValue> = {
		days: numberValue("count", window.days),
	};
	if (topping !== null) values.value = numberValue("percent", topping);
	const points = pointsValue(toppingComparison);
	if (points !== null) values.points = points;
	const parts = narrate({
		main: {
			up: menuKeys.attach.up,
			down: menuKeys.attach.down,
			flat: menuKeys.attach.flat,
			noReference: menuKeys.attach.noReference,
			noData: menuKeys.attach.noData,
		},
		values,
		current: topping,
		comparison: toppingComparison,
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const topDrink = topping === null ? null : topDrinkPart(drinks);
	return {
		id: "attach",
		titleKey: menuKeys.attach.title,
		subtitle: part(themeKeys.subtitle.lastDays, {
			days: numberValue("count", window.days),
		}),
		metricId: TOPPING_METRIC,
		relatedMetricIds: [SNACK_METRIC],
		headline: {
			value: topping,
			unit: "fraction",
			caption:
				snack === null
					? null
					: part(menuKeys.attach.caption, {
							value: numberValue("percent", snack),
						}),
		},
		comparisons: [
			...(topping === null ? [] : [toppingComparison]),
			...(snack === null ? [] : [snackComparison]),
		],
		decomposition: null,
		narrative: (topDrink === null ? parts : [...parts, topDrink]).slice(0, 3),
		tables: drinks.length === 0 ? [] : [drinksTable(drinks)],
		chart: chartOf(drinks),
		notice: noticeOf(
			summary,
			input.results.rows(menuCalls.items, "item_summary") ?? [],
		),
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "attach"),
	};
}

export const menuAttachCard: ThemeCardDefinition = {
	id: "attach",
	needs: menuNeeds.attach,
	visible: () => true,
	build: buildAttachCard,
};
