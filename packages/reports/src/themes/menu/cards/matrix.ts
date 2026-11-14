import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableModel,
	TableRowModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import { isMultiStore } from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import {
	MENU_CLASSES,
	MENU_ROLES,
	type MenuClass,
	type MenuRole,
	type MenuRow,
	menuCallKey,
	menuCalls,
	menuCsvName,
	menuNeeds,
} from "../support.js";

interface StoreMenuRow {
	readonly storeId: string;
	readonly storeName: string;
	readonly row: MenuRow;
}

const SHARE_DIGITS = 6;
const CLASS_TONES = {
	star: "positive",
	plowhorse: "secondary",
	puzzle: "tertiary",
	dog: "negative",
} as const;

function rowsOf(input: ThemeCardInput): StoreMenuRow[] {
	return input.context.stores.flatMap((store) =>
		(input.results.rows(menuCallKey(store.id), "menu_engineering") ?? []).map(
			(row) => ({ storeId: store.id, storeName: store.name, row }),
		),
	);
}

function rolesPresent(rows: readonly StoreMenuRow[]): MenuRole[] {
	return MENU_ROLES.filter((role) =>
		rows.some((entry) => entry.row.role === role),
	);
}

function itemsTable(
	input: ThemeCardInput,
	rows: readonly StoreMenuRow[],
): TableModel {
	const multi = isMultiStore(input.context);
	return tableModel({
		captionKey: menuKeys.matrix.itemsTable,
		columns: [
			...(multi ? [column("store", reportKeys.table.store, "text")] : []),
			column("role", menuKeys.table.role, "message"),
			column("item", reportKeys.table.item, "text"),
			column("quantity", reportKeys.table.quantity, "decimal"),
			column("mix", menuKeys.table.mix, "decimal"),
			column("threshold", menuKeys.table.threshold, "decimal"),
			column("avgPrice", menuKeys.table.avgPrice, "money"),
			column("unitCost", menuKeys.table.unitCost, "money"),
			column("marginAxis", menuKeys.table.marginAxis, "money"),
			column("class", menuKeys.table.class, "message"),
			column("state", reportKeys.table.state, "message"),
		],
		rows: rows.map(
			({ storeId, storeName, row }): TableRowModel => ({
				id: `${storeId}|${row.role}|${row.item_external_id}`,
				cells: {
					store: storeName,
					role: reportKeys.role[row.role],
					item: row.item_name ?? row.item_external_id,
					quantity: row.quantity,
					mix: row.menu_mix_pct,
					threshold: row.popularity_threshold_pct,
					avgPrice: row.avg_unit_price,
					unitCost: row.unit_cost,
					marginAxis: row.margin_axis,
					class:
						row.menu_class === null ? null : menuKeys.class[row.menu_class],
					state: row.provisional ? menuKeys.matrix.provisionalCell : null,
				},
			}),
		),
	});
}

function classTable(rows: readonly StoreMenuRow[]): TableModel {
	const tableRows: TableRowModel[] = [];
	for (const role of rolesPresent(rows)) {
		const inRole = rows.filter((entry) => entry.row.role === role);
		const roleNet = inRole.reduce(
			(sum, entry) => sum + entry.row.net_amount,
			0,
		);
		for (const menuClass of MENU_CLASSES) {
			const inClass = inRole.filter(
				(entry) => entry.row.menu_class === menuClass,
			);
			const classNet = inClass.reduce(
				(sum, entry) => sum + entry.row.net_amount,
				0,
			);
			tableRows.push({
				id: `${role}|${menuClass}`,
				cells: {
					role: reportKeys.role[role],
					class: menuKeys.class[menuClass],
					items: inClass.length,
					netShare:
						roleNet === 0 ? null : ratio(classNet, roleNet, SHARE_DIGITS),
				},
			});
		}
	}
	return tableModel({
		captionKey: menuKeys.matrix.classTable,
		columns: [
			column("role", menuKeys.table.role, "message"),
			column("class", menuKeys.table.class, "message"),
			column("items", menuKeys.table.items, "count"),
			column("netShare", menuKeys.table.netShare, "percent"),
		],
		rows: tableRows,
	});
}

function classChart(rows: readonly StoreMenuRow[]): ChartModel | null {
	const roles = rolesPresent(rows);
	if (roles.length === 0) return null;
	return {
		labelKey: menuKeys.matrix.chart,
		categories: roles.map((role) => messageValue(reportKeys.role[role])),
		series: MENU_CLASSES.map((menuClass) => ({
			label: part(menuKeys.class[menuClass]),
			kind: "bar" as const,
			tone: CLASS_TONES[menuClass],
			axis: "left" as const,
			stack: "classes",
			values: roles.map(
				(role) =>
					rows.filter(
						(entry) =>
							entry.row.role === role && entry.row.menu_class === menuClass,
					).length,
			),
		})),
		leftUnit: "count",
		rightUnit: null,
		markLines: [],
		markAreas: [],
		zeroBased: true,
	};
}

function countClass(
	rows: readonly StoreMenuRow[],
	role: MenuRole,
	menuClass: MenuClass,
): number {
	return rows.filter(
		(entry) => entry.row.role === role && entry.row.menu_class === menuClass,
	).length;
}

export function buildMatrixCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = rowsOf(input);
	const first = rows[0]?.row;
	const settings = input.results.rows(
		menuCalls.settings,
		"report_settings_of",
	)?.[0];
	const windowDays =
		first?.window_days_used ?? settings?.menu_window_days ?? null;
	const factor =
		first?.popularity_factor_used ?? settings?.menu_popularity_factor ?? null;
	const mapped = rows.some((entry) => entry.row.role_mapped);
	const classed = rows.length > 0 && mapped;
	const drinks = rows.filter((entry) => entry.row.role === "drink").length;
	const stars = countClass(rows, "drink", "star");
	const provisional = classed && rows.some((entry) => entry.row.provisional);
	const lowSample = classed && rows.some((entry) => entry.row.low_sample);
	const days = numberValue("count", windowDays ?? 0);
	const narrative: SentencePart[] =
		rows.length === 0
			? [part(menuKeys.matrix.noData, { days })]
			: !mapped
				? [part(menuKeys.matrix.unmapped)]
				: [
						drinks === 0
							? part(menuKeys.matrix.noStars, { days })
							: part(
									isMultiStore(context)
										? menuKeys.matrix.starsStores
										: menuKeys.matrix.stars,
									{
										stars: numberValue("count", stars),
										drinks: numberValue("count", drinks),
									},
								),
						...(provisional ? [part(menuKeys.matrix.provisional)] : []),
						...(lowSample && first !== undefined
							? [
									part(menuKeys.matrix.lowSample, {
										minimum: numberValue("count", first.low_sample_items_used),
									}),
								]
							: []),
					];
	const notice: NoticeModel | null =
		rows.length > 0 && !mapped
			? {
					tone: "info",
					part: part(menuKeys.matrix.noRoles),
					action: "settings_roles",
				}
			: null;
	return {
		id: "menu_matrix",
		titleKey: menuKeys.matrix.title,
		subtitle:
			windowDays === null || factor === null
				? null
				: part(menuKeys.matrix.subtitle, {
						days,
						factor: numberValue("decimal", factor),
					}),
		metricId: "menu_class",
		relatedMetricIds: [],
		headline: {
			value: classed && drinks > 0 ? stars : null,
			unit: "count",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: classed ? [itemsTable(input, rows), classTable(rows)] : [],
		chart: classed ? classChart(rows) : null,
		notice,
		markers: { ...themeMarkers(input, true), provisional },
		csvName: menuCsvName(context, "menu_matrix"),
	};
}

export const menuMatrixCard: ThemeCardDefinition = {
	id: "menu_matrix",
	needs: menuNeeds.matrix,
	visible: () => true,
	build: buildMatrixCard,
};
