import type {
	CardModel,
	Comparison,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { comparison, noCoverageReason } from "../../../model/comparison.js";
import { paymentKindKey, reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { narrate } from "../../../model/narrative.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import {
	referenceLabel,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { paymentsKeys } from "../keys.js";
import {
	type PaymentRow,
	paymentsCalls,
	paymentsCsvName,
	paymentsNeeds,
} from "../support.js";

export const FEE_METRIC = "payment_fee_estimate";
const RATE_DIGITS = 6;

function feeTotal(rows: readonly PaymentRow[]): number {
	return sumMoney(rows.map((row) => row.fee_estimate_amount));
}

function feesConfigured(input: ThemeCardInput): boolean {
	const rows = input.results.rows(paymentsCalls.settings, "report_settings_of");
	return (rows ?? []).some((row) => row.fee_rates_configured);
}

function previousComparison(
	input: ThemeCardInput,
	current: number,
): Comparison {
	const { context, coverage } = input;
	const range = context.range.previous;
	const label = referenceLabel(context.range, "previous");
	const covered = coverage.forReference(range.from);
	const previousRows = input.results.rows(
		paymentsCalls.paymentsPrevious,
		"payment_summary",
	);
	if (covered.state !== "full") {
		return comparison({
			kind: "previous",
			label,
			range,
			current,
			reference: null,
			coveredStores: covered.coveredStoreIds.length,
			totalStores: covered.storeCount,
			unavailable: noCoverageReason(
				coverage,
				covered.youngStoreIds,
				range.from,
			),
			unit: "money",
		});
	}
	return comparison({
		kind: "previous",
		label,
		range,
		current,
		reference:
			previousRows === undefined || previousRows.length === 0
				? null
				: feeTotal(previousRows),
		coveredStores: covered.storeCount,
		totalStores: covered.storeCount,
		unit: "money",
	});
}

function costliestPart(
	rows: readonly PaymentRow[],
	total: number,
): SentencePart | null {
	let top: PaymentRow | null = null;
	for (const row of rows) {
		if (top === null || row.fee_estimate_amount > top.fee_estimate_amount) {
			top = row;
		}
	}
	if (top === null || top.fee_estimate_amount <= 0) return null;
	return part(paymentsKeys.fees.costliest, {
		method: textValue("text", top.payment_method_name ?? top.method_key),
		fee: numberValue("money", top.fee_estimate_amount),
		share: numberValue(
			"percent",
			ratio(top.fee_estimate_amount, total, RATE_DIGITS) ?? 0,
		),
	});
}

function feesTable(
	rows: readonly PaymentRow[],
	configured: boolean,
): TableModel {
	return tableModel({
		captionKey: paymentsKeys.fees.table,
		columns: [
			column("method", reportKeys.table.method, "text"),
			column("kind", reportKeys.table.paymentKind, "message"),
			column("amount", reportKeys.table.amount, "money"),
			column("effectiveRate", paymentsKeys.table.effectiveRate, "percent"),
			column("feeEstimate", paymentsKeys.table.feeEstimate, "money"),
			column("posFee", paymentsKeys.table.posFee, "money"),
		],
		rows: rows.map((row) => ({
			id: row.method_key,
			cells: {
				method: row.payment_method_name ?? row.method_key,
				kind: paymentKindKey(row.kind),
				amount: row.amount,
				effectiveRate: configured
					? ratio(row.fee_estimate_amount, row.amount, RATE_DIGITS)
					: null,
				feeEstimate: configured ? row.fee_estimate_amount : null,
				posFee: row.fee_amount,
			},
		})),
		initialSort: { key: "feeEstimate", direction: "descending" },
	});
}

export function buildFeesCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows =
		input.results.rows(paymentsCalls.payments, "payment_summary") ?? [];
	const configured = feesConfigured(input);
	const total = feeTotal(rows);
	const nonCash = sumMoney(
		rows.filter((row) => row.kind !== "cash").map((row) => row.amount),
	);
	const current = configured && rows.length > 0 ? total : null;
	const chip = current === null ? null : previousComparison(input, current);
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (current !== null) values.value = numberValue("money", current);
	if (chip !== null) values.reference = partValue(chip.label);
	const rate = current === null ? null : ratio(total, nonCash, RATE_DIGITS);
	const notice: NoticeModel | null =
		!configured && rows.length > 0
			? {
					tone: "info",
					part: part(paymentsKeys.fees.notConfiguredNotice),
					action: "settings_fees",
				}
			: null;
	const costliest = current === null ? null : costliestPart(rows, total);
	const parts =
		!configured && rows.length > 0
			? [part(paymentsKeys.fees.notConfigured)]
			: narrate({
					main: {
						up: paymentsKeys.fees.up,
						down: paymentsKeys.fees.down,
						flat: paymentsKeys.fees.flat,
						noReference: paymentsKeys.fees.noReference,
						noData: paymentsKeys.fees.noData,
					},
					values,
					current,
					comparison: chip,
					notes: [],
					drivers: [],
					decomposition: null,
				});
	return {
		id: "fees",
		titleKey: paymentsKeys.fees.title,
		subtitle: null,
		metricId: FEE_METRIC,
		relatedMetricIds: [],
		headline: {
			value: current,
			unit: "money",
			caption:
				rate === null
					? null
					: part(paymentsKeys.fees.caption, {
							rate: numberValue("percent", rate),
						}),
		},
		comparisons: chip === null ? [] : [chip],
		decomposition: null,
		narrative: (costliest === null ? parts : [...parts, costliest]).slice(0, 3),
		tables: rows.length === 0 ? [] : [feesTable(rows, configured)],
		chart: null,
		notice,
		markers: themeMarkers(input, true),
		csvName: paymentsCsvName(context, "fees"),
	};
}

export const feesCard: ThemeCardDefinition = {
	id: "fees",
	needs: paymentsNeeds.fees,
	visible: () => true,
	build: buildFeesCard,
};
