import type {
	CardModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { qualityKeys } from "../keys.js";
import {
	type QualityPaymentRow,
	qualityCalls,
	qualityCsvName,
	qualityNeeds,
	shareOf,
	sumOf,
} from "../support.js";

export function isUsed(row: QualityPaymentRow): boolean {
	return (row.invoices ?? 0) > 0 || (row.amount ?? 0) !== 0;
}

export function isUnclassified(row: QualityPaymentRow): boolean {
	return row.kind === "other" && row.override_kind === null && isUsed(row);
}

export function isOutsideCatalogue(row: QualityPaymentRow): boolean {
	return !row.in_catalogue && isUsed(row);
}

export function paymentFixKey(row: QualityPaymentRow): string {
	return row.in_catalogue
		? qualityKeys.fix.settings.paymentKind
		: qualityKeys.fix.syncMaster;
}

function kindLabel(kind: QualityPaymentRow["kind"] | null): string | null {
	return kind === null ? null : reportKeys.paymentKind[kind];
}

function paymentsTable(rows: readonly QualityPaymentRow[]): TableModel {
	return tableModel({
		captionKey: qualityKeys.payments.table,
		columns: [
			column("method", reportKeys.table.method, "text"),
			column("posKind", qualityKeys.table.posKind, "label"),
			column("overrideKind", qualityKeys.table.overrideKind, "label"),
			column("kind", qualityKeys.table.kind, "label"),
			column("invoices", reportKeys.table.invoices, "count"),
			column("amount", reportKeys.table.amount, "money"),
			column("inCatalogue", qualityKeys.table.inCatalogue, "message"),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: rows.map((row) => ({
			id: `${row.pos_account_id ?? ""}|${row.payment_method_external_id}`,
			cells: {
				method: row.payment_method_name ?? row.payment_method_external_id,
				posKind: kindLabel(row.pos_kind),
				overrideKind: kindLabel(row.override_kind),
				kind: kindLabel(row.kind),
				invoices: row.invoices,
				amount: row.amount,
				inCatalogue: row.in_catalogue
					? qualityKeys.value.yes
					: qualityKeys.value.no,
				fix: paymentFixKey(row),
			},
		})),
		initialSort: { key: "amount", direction: "descending" },
	});
}

function noticeOf(unclassified: number, outside: number): NoticeModel | null {
	if (unclassified > 0) {
		return {
			tone: "info",
			part: part(qualityKeys.payments.notice),
			action: "settings_payment_kinds",
		};
	}
	if (outside > 0) {
		return {
			tone: "info",
			part: part(qualityKeys.fix.syncMaster),
			action: null,
		};
	}
	return null;
}

export function buildPaymentsCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows =
		input.results.rows(qualityCalls.payments, "data_quality_payments") ?? [];
	const used = rows.filter(isUsed);
	const unclassified = used.filter(isUnclassified);
	const outside = used.filter(isOutsideCatalogue);
	const findings = used.filter(
		(row) => isUnclassified(row) || isOutsideCatalogue(row),
	);
	const range = rangeValue(context);
	const narrative: SentencePart[] =
		used.length === 0
			? [part(qualityKeys.payments.noData, { range })]
			: [
					unclassified.length === 0
						? part(qualityKeys.payments.none, { range })
						: part(qualityKeys.payments.main, {
								range,
								count: numberValue("count", unclassified.length),
								share: numberValue(
									"percent",
									shareOf(
										sumOf(unclassified, (row) => row.amount),
										sumOf(used, (row) => row.amount),
									) ?? 0,
								),
							}),
				];
	if (outside.length > 0) {
		narrative.push(
			part(qualityKeys.payments.notInCatalogue, {
				count: numberValue("count", outside.length),
			}),
		);
	}
	return {
		id: "payments",
		titleKey: qualityKeys.payments.title,
		subtitle: null,
		metricId: "unclassified_payment_methods",
		relatedMetricIds: [],
		headline: {
			value: used.length === 0 ? null : unclassified.length,
			unit: "count",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: findings.length === 0 ? [] : [paymentsTable(findings)],
		chart: null,
		notice: noticeOf(unclassified.length, outside.length),
		markers: themeMarkers(input, true),
		csvName: qualityCsvName(context, "payments"),
	};
}

export const qualityPaymentsCard: ThemeCardDefinition = {
	id: "payments",
	needs: qualityNeeds.payments,
	visible: () => true,
	build: buildPaymentsCard,
};
