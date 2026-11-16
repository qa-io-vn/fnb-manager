import type { IsoDate } from "../../../contract/values.js";
import type {
	CardModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import type { StoreCoverageRow } from "../../../model/coverage.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import type { RangeSeriesGrain } from "../../range.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { qualityKeys } from "../keys.js";
import {
	type DaySeriesRow,
	daysGrain,
	qualityCalls,
	qualityCsvName,
	qualityNeeds,
	storeNameOf,
	sumOf,
} from "../support.js";

export type DayState = "notMatched" | "notChecked" | "updating";

const STATE_ORDER: readonly DayState[] = [
	"notMatched",
	"notChecked",
	"updating",
];

export interface UnverifiedEntry {
	readonly storeId: string;
	readonly from: IsoDate | null;
	readonly to: IsoDate | null;
	readonly days: number;
	readonly state: DayState;
}

function selectedCoverage(input: ThemeCardInput): StoreCoverageRow[] {
	return input.context.stores.flatMap((store) => {
		const row = input.coverage.rows.find(
			(entry) => entry.store_id === store.id,
		);
		return row === undefined ? [] : [row];
	});
}

export function uncheckedSalesDays(
	row: DaySeriesRow,
	grain: RangeSeriesGrain,
): number {
	if ((row.invoices ?? 0) === 0) return 0;
	if (grain === "day") return row.checked_days === 0 ? 1 : 0;
	return Math.max(0, row.days_with_data - row.checked_days);
}

export function unverifiedEntries(
	rows: readonly DaySeriesRow[],
	storeOrder: readonly string[],
	grain: RangeSeriesGrain,
): UnverifiedEntry[] {
	const entries: UnverifiedEntry[] = [];
	for (const row of rows) {
		if (row.store_id === null || !storeOrder.includes(row.store_id)) continue;
		const notMatched = Math.max(0, row.checked_days - row.matched_days);
		const notChecked = uncheckedSalesDays(row, grain);
		for (const [state, days] of [
			["notMatched", notMatched],
			["notChecked", notChecked],
		] as const) {
			if (days === 0) continue;
			entries.push({
				storeId: row.store_id,
				from: row.bucket_start,
				to: row.bucket_end,
				days,
				state,
			});
		}
	}
	return entries.sort(
		(left, right) =>
			(right.from ?? "").localeCompare(left.from ?? "") ||
			storeOrder.indexOf(left.storeId) - storeOrder.indexOf(right.storeId) ||
			STATE_ORDER.indexOf(left.state) - STATE_ORDER.indexOf(right.state),
	);
}

function stateKey(state: DayState): string {
	return qualityKeys.state[state];
}

function fixKey(state: DayState, grain: RangeSeriesGrain): string {
	if (state === "updating") return qualityKeys.fix.waitRefresh;
	return grain === "day" ? qualityKeys.fix.syncDay : qualityKeys.fix.syncDays;
}

function verificationColumns(
	grain: RangeSeriesGrain,
): readonly TableColumnModel[] {
	const dates =
		grain === "day"
			? [column("date", reportKeys.table.date, "date")]
			: [
					column("from", reportKeys.table.from, "date"),
					column("to", reportKeys.table.to, "date"),
					column("days", reportKeys.table.days, "count"),
				];
	return [
		column("store", reportKeys.table.store, "text"),
		...dates,
		column("state", reportKeys.table.state, "message"),
		column("fix", qualityKeys.table.fix, "message"),
	];
}

function verificationTable(
	input: ThemeCardInput,
	grain: RangeSeriesGrain,
	entries: readonly UnverifiedEntry[],
): TableModel {
	return tableModel({
		captionKey: qualityKeys.verification.table,
		columns: verificationColumns(grain),
		rows: entries.map((entry) => ({
			id: `${entry.storeId}|${entry.from ?? ""}|${entry.state}`,
			cells: {
				store: storeNameOf(input.context, entry.storeId),
				...(grain === "day"
					? { date: entry.from }
					: { from: entry.from, to: entry.to, days: entry.days }),
				state: stateKey(entry.state),
				fix: fixKey(entry.state, grain),
			},
		})),
		previewRows: 10,
	});
}

export function buildVerificationCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const grain = daysGrain(context);
	const coverage = selectedCoverage(input);
	const notMatched = sumOf(coverage, (row) => row.unmatched_days);
	const notChecked = sumOf(coverage, (row) => row.unchecked_sales_days);
	const unverified = notMatched + notChecked;
	const updating = coverage.filter((row) => row.stale_days > 0);
	const updatingDays = sumOf(updating, (row) => row.stale_days);
	const storeOrder = context.stores.map((store) => store.id);
	const entries: UnverifiedEntry[] = [
		...unverifiedEntries(
			input.results.rows(qualityCalls.days, "period_series") ?? [],
			storeOrder,
			grain,
		),
		...updating.map((row) => ({
			storeId: row.store_id ?? "",
			from: null,
			to: null,
			days: row.stale_days,
			state: "updating" as const,
		})),
	];
	const range = rangeValue(context);
	const salesDays = sumOf(coverage, (row) => row.sales_days);
	const noSales = unverified === 0 && salesDays === 0;
	const narrative: SentencePart[] = [
		noSales
			? part(qualityKeys.verification.noData, { range })
			: unverified === 0
				? part(qualityKeys.verification.none, { range })
				: part(qualityKeys.verification.main, {
						range,
						count: numberValue("count", unverified),
						notMatched: numberValue("count", notMatched),
						notChecked: numberValue("count", notChecked),
					}),
	];
	if (updatingDays > 0) {
		narrative.push(
			part(qualityKeys.verification.updating, {
				count: numberValue("count", updatingDays),
			}),
		);
	}
	return {
		id: "verification",
		titleKey: qualityKeys.verification.title,
		subtitle: null,
		metricId: "unverified_days",
		relatedMetricIds: [],
		headline: {
			value: coverage.length === 0 || noSales ? null : unverified,
			unit: "count",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables:
			entries.length === 0 ? [] : [verificationTable(input, grain, entries)],
		chart: null,
		notice:
			unverified === 0
				? null
				: {
						tone: "info",
						part: part(qualityKeys.verification.notice),
						action: null,
					},
		markers: themeMarkers(input, false),
		csvName: qualityCsvName(context, "verification"),
	};
}

export const qualityVerificationCard: ThemeCardDefinition = {
	id: "verification",
	needs: qualityNeeds.verification,
	wide: true,
	visible: () => true,
	build: buildVerificationCard,
};
