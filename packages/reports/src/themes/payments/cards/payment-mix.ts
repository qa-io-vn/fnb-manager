import type {
	CardModel,
	ChartModel,
	ChartSeriesModel,
	Comparison,
	SeriesTone,
	TableModel,
} from "../../../model/card.js";
import { withUnit } from "../../../model/comparison.js";
import { paymentKindKey, reportKeys } from "../../../model/keys.js";
import {
	type DriverCandidate,
	narrate,
	strongestDriver,
} from "../../../model/narrative.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
} from "../../../model/values.js";
import {
	CASH_SHARE_METRIC,
	type KindShare,
	kindShares,
} from "../../../reports/month/cards/payment-mix.js";
import { pointsValue } from "../../../reports/month/support.js";
import {
	comparisonsFromRangeRows,
	RANGE_INDEX,
	rangeRow,
	type ThemeCardDefinition,
	type ThemeCardInput,
	TOTALS_LIKE_FOR_LIKE_KEYS,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { paymentsKeys } from "../keys.js";
import {
	type PaymentRow,
	paymentsCalls,
	paymentsCsvName,
	paymentsNeeds,
	totalsRows,
} from "../support.js";

const kindTones: Readonly<Record<KindShare["kind"], SeriesTone>> = {
	cash: "primary",
	bank_transfer: "secondary",
	ewallet: "tertiary",
	card: "positive",
	voucher: "muted",
	other: "muted",
};

function cashComparisons(input: ThemeCardInput): readonly Comparison[] {
	return withUnit(
		comparisonsFromRangeRows({
			context: input.context,
			all: totalsRows(input.results),
			likeForLike: {
				previous: totalsRows(input.results, TOTALS_LIKE_FOR_LIKE_KEYS.previous),
				last_year: totalsRows(
					input.results,
					TOTALS_LIKE_FOR_LIKE_KEYS.last_year,
				),
			},
			coverage: input.coverage,
			pick: (row) => row.cash_share,
		}),
		"fraction",
	);
}

function kindDrivers(kinds: readonly KindShare[]): DriverCandidate[] {
	return kinds.flatMap((entry) =>
		entry.change === null
			? []
			: [
					{
						dimension: "payment" as const,
						label: messageValue(paymentKindKey(entry.kind)),
						contribution: entry.change,
						unit: "fraction" as const,
					},
				],
	);
}

function otherKindMover(kinds: readonly KindShare[]): SentencePart | null {
	const strongest = strongestDriver(
		kindDrivers(kinds.filter((entry) => entry.kind !== "cash")),
		0,
	);
	if (strongest === null) return null;
	return part(paymentsKeys.mix.otherMover, {
		payment: strongest.candidate.label,
		delta: numberValue("percentPoints", strongest.candidate.contribution),
	});
}

function kindsTable(kinds: readonly KindShare[]): TableModel {
	return tableModel({
		captionKey: paymentsKeys.mix.kindsTable,
		columns: [
			column("kind", reportKeys.table.paymentKind, "message"),
			column("amount", reportKeys.table.amount, "money"),
			column("share", reportKeys.table.share, "percent"),
			column("previousShare", paymentsKeys.table.previousShare, "percent"),
			column("change", reportKeys.table.changePoints, "percentPoints"),
		],
		rows: kinds.map((entry) => ({
			id: entry.kind,
			cells: {
				kind: paymentKindKey(entry.kind),
				amount: entry.amount,
				share: entry.share,
				previousShare: entry.previousShare,
				change: entry.change,
			},
		})),
		initialSort: { key: "amount", direction: "descending" },
	});
}

function methodsTable(rows: readonly PaymentRow[]): TableModel {
	return tableModel({
		captionKey: paymentsKeys.mix.methodsTable,
		columns: [
			column("method", reportKeys.table.method, "text"),
			column("kind", reportKeys.table.paymentKind, "message"),
			column("invoices", reportKeys.table.invoices, "count"),
			column("amount", reportKeys.table.amount, "money"),
			column("share", reportKeys.table.share, "percent"),
		],
		rows: rows.map((row) => ({
			id: row.method_key,
			cells: {
				method: row.payment_method_name ?? row.method_key,
				kind: paymentKindKey(row.kind),
				invoices: row.invoices,
				amount: row.amount,
				share: row.share,
			},
		})),
		initialSort: { key: "amount", direction: "descending" },
	});
}

function chartOf(kinds: readonly KindShare[]): ChartModel | null {
	if (kinds.length === 0) return null;
	const series: ChartSeriesModel[] = kinds.map((entry) => ({
		label: part(paymentKindKey(entry.kind)),
		kind: "bar",
		tone: kindTones[entry.kind],
		axis: "left",
		stack: "share",
		values: [entry.previousShare, entry.share],
	}));
	return {
		labelKey: paymentsKeys.mix.chart,
		categories: [
			messageValue(reportKeys.periodRow.previous),
			messageValue(reportKeys.periodRow.current),
		],
		series,
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildPaymentMixCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const current =
		rangeRow(totalsRows(input.results), RANGE_INDEX.current)?.cash_share ??
		null;
	const comparisons = cashComparisons(input);
	const previous =
		comparisons.find((entry) => entry.kind === "previous") ?? null;
	const rows =
		input.results.rows(paymentsCalls.payments, "payment_summary") ?? [];
	const kinds = kindShares(rows);
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (current !== null) values.value = numberValue("percent", current);
	const points = pointsValue(previous);
	if (points !== null) values.points = points;
	if (previous !== null) values.reference = partValue(previous.label);
	const parts = narrate({
		main: {
			up: paymentsKeys.mix.up,
			down: paymentsKeys.mix.down,
			flat: paymentsKeys.mix.flat,
			noReference: paymentsKeys.mix.noReference,
			noData: paymentsKeys.mix.noData,
		},
		values,
		current,
		comparison: previous,
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const mover = current === null ? null : otherKindMover(kinds);
	return {
		id: "payment_mix",
		titleKey: paymentsKeys.mix.title,
		subtitle: null,
		metricId: CASH_SHARE_METRIC,
		relatedMetricIds: [],
		headline: { value: current, unit: "fraction", caption: null },
		comparisons,
		decomposition: null,
		narrative: mover === null ? parts : [...parts, mover].slice(0, 3),
		tables: rows.length === 0 ? [] : [kindsTable(kinds), methodsTable(rows)],
		chart: chartOf(kinds),
		notice: null,
		markers: themeMarkers(input, true),
		csvName: paymentsCsvName(context, "payment_mix"),
	};
}

export const paymentMixCard: ThemeCardDefinition = {
	id: "payment_mix",
	needs: paymentsNeeds.mix,
	visible: () => true,
	build: buildPaymentMixCard,
};
