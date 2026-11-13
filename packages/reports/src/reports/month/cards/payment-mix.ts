import type { AnalyticsRow } from "../../../contract/functions.js";
import type { PaymentKindValue } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartSeriesModel,
	SeriesTone,
	TableColumnModel,
} from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	withUnit,
} from "../../../model/comparison.js";
import { SHARE_DIGITS } from "../../../model/grouping.js";
import { paymentKindKey, reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import {
	type DriverCandidate,
	narrate,
	strongestDriver,
} from "../../../model/narrative.js";
import { difference, ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { monthKeys } from "../keys.js";
import {
	comparisonOf,
	likeForLikeMetrics,
	metricRows,
	metricValueOf,
	monthCalls,
	monthCsvName,
	monthMarkers,
	monthNeeds,
	monthRanges,
	monthValue,
	pointsValue,
} from "../support.js";

type PaymentRow = AnalyticsRow<"payment_summary">;

export const CASH_SHARE_METRIC = "cash_share";
const NEUTRAL_CHANGE = 0;
const HEADLINE_KIND: PaymentKindValue = "cash";

export const PAYMENT_KINDS: readonly PaymentKindValue[] = [
	"cash",
	"bank_transfer",
	"ewallet",
	"card",
	"voucher",
	"other",
];

const kindTones: Readonly<Record<PaymentKindValue, SeriesTone>> = {
	cash: "primary",
	bank_transfer: "secondary",
	ewallet: "tertiary",
	card: "muted",
	voucher: "muted",
	other: "muted",
};

export interface KindShare {
	readonly kind: PaymentKindValue;
	readonly amount: number;
	readonly share: number | null;
	readonly previousShare: number | null;
	readonly change: number | null;
}

export function kindShares(rows: readonly PaymentRow[]): KindShare[] {
	const total = sumMoney(rows.map((row) => row.amount));
	const previousTotal = sumMoney(rows.map((row) => row.compare_amount));
	return PAYMENT_KINDS.flatMap((kind) => {
		const ofKind = rows.filter((row) => row.kind === kind);
		if (ofKind.length === 0) return [];
		const amount = sumMoney(ofKind.map((row) => row.amount));
		const share = ratio(amount, total, SHARE_DIGITS);
		const previousShare = ratio(
			sumMoney(ofKind.map((row) => row.compare_amount)),
			previousTotal,
			SHARE_DIGITS,
		);
		return [
			{
				kind,
				amount,
				share,
				previousShare,
				change: difference(share, previousShare),
			},
		];
	});
}

function kindDrivers(kinds: readonly KindShare[]): DriverCandidate[] {
	return kinds.flatMap((entry) =>
		entry.change === null || entry.kind === HEADLINE_KIND
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
	const strongest = strongestDriver(kindDrivers(kinds), NEUTRAL_CHANGE);
	if (strongest === null) return null;
	return part(monthKeys.payments.otherMover, {
		payment: strongest.candidate.label,
		delta: numberValue("percentPoints", strongest.candidate.contribution),
	});
}

export function buildPaymentMixCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const ranges = monthRanges(context);
	const metrics = metricRows(input);
	const current = metricValueOf(metrics, CASH_SHARE_METRIC, "current");
	const comparisons = withUnit(
		comparisonsFromMetricRows({
			all: metrics,
			likeForLike: likeForLikeMetrics(input),
			coverage,
			metricId: CASH_SHARE_METRIC,
			kinds: ["previous", "last_year"],
			labels: {
				previous: part(monthKeys.payments.sharePrevious),
				last_year: part(monthKeys.payments.shareLastYear),
			},
		}),
		"fraction",
	);
	const rows = input.results.rows(monthCalls.payments, "payment_summary") ?? [];
	const kinds = kindShares(rows);
	const fees = sumMoney(rows.map((row) => row.fee_estimate_amount));
	const values: Record<string, TypedValue> = { month: monthValue(context) };
	if (current !== null) values.value = numberValue("percent", current);
	const points = pointsValue(comparisonOf(comparisons, "previous"));
	if (points !== null) values.points = points;
	const columns: TableColumnModel[] = [
		column("method", reportKeys.table.method, "text"),
		column("kind", reportKeys.table.paymentKind, "message"),
		column("amount", reportKeys.table.amount, "money"),
		column("share", reportKeys.table.share, "percent"),
		column("previousShare", monthKeys.table.previousMonthShare, "percent"),
		column("change", monthKeys.table.changePoints, "percentPoints"),
		...(fees > 0
			? [column("feeEstimate", monthKeys.table.feeEstimate, "money")]
			: []),
	];
	const series: ChartSeriesModel[] = kinds.map((entry) => ({
		label: part(paymentKindKey(entry.kind)),
		kind: "bar",
		tone: kindTones[entry.kind],
		axis: "left",
		stack: "share",
		values: [entry.previousShare, entry.share],
	}));
	const parts = narrate({
		main: {
			up: monthKeys.payments.up,
			down: monthKeys.payments.down,
			flat: monthKeys.payments.flat,
			noReference: monthKeys.payments.noReference,
			noData: monthKeys.payments.noData,
		},
		values,
		current,
		comparison: comparisonOf(comparisons, "previous"),
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const mover = current === null ? null : otherKindMover(kinds);
	return {
		id: "payment_mix",
		titleKey: monthKeys.payments.title,
		subtitle: null,
		metricId: CASH_SHARE_METRIC,
		relatedMetricIds: [],
		headline: { value: current, unit: "fraction", caption: null },
		comparisons,
		decomposition: null,
		narrative: mover === null ? parts : [...parts, mover].slice(0, 3),
		tables: [
			tableModel({
				captionKey: monthKeys.payments.table,
				columns,
				rows: rows.map((row) => ({
					id: row.method_key,
					cells: {
						method: row.payment_method_name ?? row.method_key,
						kind: paymentKindKey(row.kind),
						amount: row.amount,
						share: row.share,
						previousShare: row.compare_share,
						change: difference(row.share, row.compare_share),
						feeEstimate: row.fee_estimate_amount,
					},
				})),
				initialSort: { key: "amount", direction: "descending" },
			}),
		],
		chart:
			kinds.length === 0
				? null
				: {
						labelKey: monthKeys.payments.chart,
						categories: [
							textValue("month", ranges.previousStart),
							textValue("month", ranges.monthStart),
						],
						series,
						leftUnit: "fraction",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice: null,
		markers: monthMarkers(input, true),
		csvName: monthCsvName(context, "payment_mix"),
	};
}

export const paymentMixCard: CardDefinition = {
	id: "payment_mix",
	needs: monthNeeds.payments,
	visible: () => true,
	build: buildPaymentMixCard,
};
