import type {
	CardModel,
	Comparison,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { comparison } from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
import { ratio } from "../../../model/numeric.js";
import {
	column,
	periodComparisonTable,
	storeComparisonTable,
} from "../../../model/tables.js";
import { isMultiStore } from "../../../model/totals.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
} from "../../../model/values.js";
import {
	referenceLabel,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { settingsOf } from "../../settings.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { hoursKeys } from "../keys.js";
import {
	hoursCalls,
	hoursCsvName,
	hoursNeeds,
	type ProductivityRow,
} from "../support.js";

const HOUR_DIGITS = 2;

function rowsOf(
	input: ThemeCardInput,
	key: string,
): readonly ProductivityRow[] {
	return input.results.rows(key, "opening_productivity") ?? [];
}

function blockOf(
	rows: readonly ProductivityRow[],
	storeId: string | null,
): ProductivityRow | undefined {
	return rows.find((row) => row.store_id === storeId);
}

function openHours(row: ProductivityRow | undefined): number | null {
	return row?.opening_minutes == null
		? null
		: ratio(row.opening_minutes, 60, HOUR_DIGITS);
}

function missingHours(
	input: ThemeCardInput,
	rows: readonly ProductivityRow[],
): boolean {
	return input.context.stores.some((store) => {
		const row = blockOf(rows, store.id);
		return (
			row !== undefined &&
			row.days_with_sales > 0 &&
			row.opening_minutes === null
		);
	});
}

function noSeatsCell(row: ProductivityRow | undefined): string | null {
	return row !== undefined && row.days_with_sales > 0 && row.seat_count === null
		? hoursKeys.productivity.noSeats
		: null;
}

function storeTable(
	input: ThemeCardInput,
	rows: readonly ProductivityRow[],
): TableModel {
	const anyMissingSeats = input.context.stores.some(
		(store) => noSeatsCell(blockOf(rows, store.id)) !== null,
	);
	return storeComparisonTable({
		captionKey: hoursKeys.productivity.storeTable,
		stores: input.context.stores,
		columns: [
			column("openHours", hoursKeys.table.openHours, "decimal"),
			column("netPerHour", hoursKeys.table.netPerHour, "money"),
			column("invoicesPerHour", hoursKeys.table.invoicesPerHour, "decimal"),
			column("seats", hoursKeys.table.seats, "count"),
			column("revpash", hoursKeys.table.revpash, "money"),
			...(anyMissingSeats
				? [column("state", reportKeys.table.state, "message")]
				: []),
		],
		cells: (store) => {
			const row = blockOf(rows, store.id);
			return {
				openHours: openHours(row),
				netPerHour: row?.sales_per_opening_hour ?? null,
				invoicesPerHour: row?.invoices_per_opening_hour ?? null,
				seats: row?.seat_count ?? null,
				revpash: row?.revpash ?? null,
				state: noSeatsCell(row),
			};
		},
	});
}

function periodTable(
	rows: readonly ProductivityRow[],
	previousRows: readonly ProductivityRow[],
): TableModel {
	const cells = (row: ProductivityRow | undefined) => ({
		openHours: openHours(row),
		netPerHour: row?.sales_per_opening_hour ?? null,
		invoicesPerHour: row?.invoices_per_opening_hour ?? null,
		seats: row?.seat_count ?? null,
		revpash: row?.revpash ?? null,
	});
	return periodComparisonTable({
		captionKey: hoursKeys.productivity.periodTable,
		columns: [
			column("openHours", hoursKeys.table.openHours, "decimal"),
			column("netPerHour", hoursKeys.table.netPerHour, "money"),
			column("invoicesPerHour", hoursKeys.table.invoicesPerHour, "decimal"),
			column("seats", hoursKeys.table.seats, "count"),
			column("revpash", hoursKeys.table.revpash, "money"),
		],
		periods: [
			{
				id: "current",
				labelKey: hoursKeys.productivity.current,
				cells: cells(blockOf(rows, null)),
			},
			{
				id: "previous",
				labelKey: hoursKeys.productivity.previous,
				cells: cells(blockOf(previousRows, null)),
			},
		],
	});
}

function notesOf(row: ProductivityRow | undefined): SentencePart[] {
	if (row?.revpash == null) return [];
	return [
		part(hoursKeys.productivity.revpash, {
			value: numberValue("money", row.revpash),
			seats: numberValue("count", row.seat_count ?? 0),
		}),
	];
}

export function buildProductivityCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = rowsOf(input, hoursCalls.productivity);
	const previousRows = rowsOf(input, hoursCalls.productivityPrevious);
	const all = blockOf(rows, null);
	const previous = blockOf(previousRows, null);
	const noHours = missingHours(input, rows);
	const current = noHours ? null : (all?.sales_per_opening_hour ?? null);
	const chips: Comparison[] =
		current === null
			? []
			: [
					comparison({
						kind: "previous",
						label: referenceLabel(context.range, "previous"),
						range: context.range.previous,
						current,
						reference: previous?.sales_per_opening_hour ?? null,
						coveredStores: context.stores.length,
						totalStores: context.stores.length,
					}),
				];
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (current !== null) values.value = numberValue("money", current);
	if (chips[0] !== undefined) values.reference = partValue(chips[0].label);
	const settings = settingsOf(
		input.results.rows(hoursCalls.settings, "report_settings_of") ?? [],
	);
	const seatsMissing = settings.stores.some(
		(store) => store.seatCount === null,
	);
	const notice: NoticeModel | null = noHours
		? {
				tone: "info",
				part: part(hoursKeys.productivity.noHours),
				action: "settings_store",
			}
		: null;
	return {
		id: "productivity",
		titleKey: hoursKeys.productivity.title,
		subtitle: null,
		metricId: "sales_per_opening_hour",
		relatedMetricIds: ["invoices_per_opening_hour", "revpash"],
		headline: { value: current, unit: "money", caption: null },
		comparisons: chips,
		decomposition: null,
		narrative: noHours
			? [
					part(hoursKeys.productivity.missingHours, {
						range: rangeValue(context),
					}),
				]
			: narrate({
					main: {
						up: hoursKeys.productivity.up,
						down: hoursKeys.productivity.down,
						flat: hoursKeys.productivity.flat,
						noReference: hoursKeys.productivity.noReference,
						noData: hoursKeys.productivity.noData,
					},
					values,
					current,
					comparison: chips[0] ?? null,
					notes: notesOf(all),
					drivers: [],
					decomposition: null,
				}),
		tables: [
			isMultiStore(context)
				? storeTable(input, rows)
				: periodTable(rows, previousRows),
		],
		chart: null,
		notice,
		markers: {
			...themeMarkers(input, false),
			provisional: !noHours && seatsMissing,
		},
		csvName: hoursCsvName(context, "productivity"),
	};
}

export const hoursProductivityCard: ThemeCardDefinition = {
	id: "productivity",
	needs: hoursNeeds.productivity,
	visible: () => true,
	build: buildProductivityCard,
};
