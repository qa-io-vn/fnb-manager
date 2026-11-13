import type { AnalyticsRow } from "../../../contract/functions.js";
import type { PaymentKindValue } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartSeriesModel,
	SeriesTone,
} from "../../../model/card.js";
import {
	comparisonsFromPeriodRows,
	withUnit,
} from "../../../model/comparison.js";
import { paymentKindKey, reportKeys } from "../../../model/keys.js";
import { sumMoney, sumMoneyOrNull } from "../../../model/money.js";
import { narrate } from "../../../model/narrative.js";
import { ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { addDays } from "../../../period/dates.js";
import { dayKeys } from "../keys.js";
import {
	compareRows,
	dayCalls,
	dayCsvName,
	dayLabels,
	dayMarkers,
	dayNeeds,
	dayValue,
	likeForLikeTotals,
} from "../support.js";

type PaymentRow = AnalyticsRow<"payment_summary">;

export const PAYMENT_KIND_ORDER: readonly PaymentKindValue[] = [
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

const SHARE_DIGITS = 6;

interface KindTotals {
	readonly kind: PaymentKindValue;
	readonly amount: number;
	readonly compareAmount: number;
}

export function kindTotals(rows: readonly PaymentRow[]): KindTotals[] {
	return PAYMENT_KIND_ORDER.flatMap((kind) => {
		const ofKind = rows.filter((row) => row.kind === kind);
		if (ofKind.length === 0) return [];
		return [
			{
				kind,
				amount: sumMoney(ofKind.map((row) => row.amount)),
				compareAmount: sumMoney(ofKind.map((row) => row.compare_amount)),
			},
		];
	});
}

function leaderOf(kinds: readonly KindTotals[]): KindTotals | null {
	let leader: KindTotals | null = null;
	for (const entry of kinds) {
		if (leader === null || entry.amount > leader.amount) leader = entry;
	}
	return leader;
}

export function buildPaymentsCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = input.results.rows(dayCalls.payments, "payment_summary") ?? [];
	const kinds = kindTotals(rows);
	const total = sumMoney(kinds.map((entry) => entry.amount));
	const compareTotal = sumMoney(kinds.map((entry) => entry.compareAmount));
	const paid = rows.some((row) => row.amount !== 0);
	const cash = paid
		? (sumMoneyOrNull(
				rows.filter((row) => row.kind === "cash").map((row) => row.amount),
			) ?? 0)
		: null;
	const comparisons = withUnit(
		comparisonsFromPeriodRows({
			all: compareRows(input),
			likeForLike: likeForLikeTotals(input),
			coverage,
			kinds: ["previous"],
			pick: (row) => row.cash_share,
			labels: { ...dayLabels(), previous: part(dayKeys.payments.shareCompare) },
		}),
		"fraction",
	);
	const leader = paid ? leaderOf(kinds) : null;
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (leader !== null) {
		values.kind = messageValue(paymentKindKey(leader.kind));
		const share = ratio(leader.amount, total, SHARE_DIGITS);
		if (share !== null) values.share = numberValue("percent", share);
	}
	const parts = narrate({
		main: {
			up: dayKeys.payments.leader,
			down: dayKeys.payments.leader,
			flat: dayKeys.payments.leader,
			noReference: dayKeys.payments.leader,
			noData: dayKeys.payments.noData,
		},
		values,
		current: leader === null ? null : leader.amount,
		comparison: null,
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const cashPart: SentencePart | null =
		cash === null
			? null
			: part(dayKeys.payments.cash, {
					amount: numberValue("moneyExact", cash),
				});
	const day = context.period.end;
	const previousDay = addDays(day, -1);
	const series: ChartSeriesModel[] = kinds.map((entry) => ({
		label: part(paymentKindKey(entry.kind)),
		kind: "bar",
		tone: kindTones[entry.kind],
		axis: "left",
		stack: "share",
		values: [
			ratio(entry.compareAmount, compareTotal, SHARE_DIGITS),
			ratio(entry.amount, total, SHARE_DIGITS),
		],
	}));
	return {
		id: "payments",
		titleKey: dayKeys.payments.title,
		subtitle: null,
		metricId: "cash_to_count",
		relatedMetricIds: ["cash_share"],
		headline: {
			value: cash,
			unit: "money",
			caption: cash === null ? null : part(dayKeys.payments.caption),
		},
		comparisons,
		decomposition: null,
		narrative: cashPart === null ? parts : [...parts, cashPart].slice(0, 3),
		tables: [
			tableModel({
				captionKey: dayKeys.payments.table,
				columns: [
					column("method", reportKeys.table.method, "text"),
					column("kind", reportKeys.table.paymentKind, "message"),
					column("amount", reportKeys.table.amount, "money"),
					column("share", reportKeys.table.share, "percent"),
					column("previous", dayKeys.table.previousDay, "money"),
					column("change", dayKeys.table.changePrevious, "signedPercent"),
				],
				rows: rows.map((row) => ({
					id: row.method_key,
					cells: {
						method: row.payment_method_name ?? row.method_key,
						kind: paymentKindKey(row.kind),
						amount: row.amount,
						share: row.share,
						previous: row.compare_amount,
						change: relativeChange(row.amount, row.compare_amount),
					},
				})),
				initialSort: { key: "amount", direction: "descending" },
			}),
		],
		chart:
			kinds.length === 0
				? null
				: {
						labelKey: dayKeys.payments.chart,
						categories: [
							textValue("date", previousDay),
							textValue("date", day),
						],
						series,
						leftUnit: "fraction",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice: null,
		markers: dayMarkers(input, true),
		csvName: dayCsvName(context, "payments"),
	};
}

export const paymentsCard: CardDefinition = {
	id: "payments",
	needs: dayNeeds.payments,
	visible: () => true,
	build: buildPaymentsCard,
};
