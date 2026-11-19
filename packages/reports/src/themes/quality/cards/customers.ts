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
	allStoresSummary,
	type QualitySummaryRow,
	qualityCsvName,
	qualityNeeds,
	storeSummaries,
} from "../support.js";

export function customerFixKey(row: QualitySummaryRow): string | null {
	if (row.member_capture_status === "disabled") {
		return qualityKeys.fix.pos.memberFeature;
	}
	return row.identified_invoices < row.invoices
		? qualityKeys.fix.pos.member
		: null;
}

function customersTable(
	stores: readonly { name: string; row: QualitySummaryRow }[],
): TableModel {
	return tableModel({
		captionKey: qualityKeys.customers.table,
		columns: [
			column("store", reportKeys.table.store, "text"),
			column("invoices", reportKeys.table.invoices, "count"),
			column(
				"identifiedInvoices",
				qualityKeys.table.identifiedInvoices,
				"count",
			),
			column("captureRate", reportKeys.table.captureRate, "percent"),
			column(
				"identifiedCustomers",
				qualityKeys.table.identifiedCustomers,
				"count",
			),
			column("loyaltyConsents", qualityKeys.table.loyaltyConsents, "count"),
			column("marketingConsents", qualityKeys.table.marketingConsents, "count"),
			column("consentCoverage", qualityKeys.table.consentCoverage, "percent"),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: stores.map(({ name, row }) => ({
			id: row.store_id ?? "",
			cells: {
				store: name,
				invoices: row.invoices,
				identifiedInvoices: row.identified_invoices,
				captureRate: row.capture_rate,
				identifiedCustomers: row.identified_customers,
				loyaltyConsents: row.loyalty_consents,
				marketingConsents: row.marketing_consents,
				consentCoverage: row.consent_coverage,
				fix: customerFixKey(row),
			},
		})),
	});
}

function noticeOf(
	stores: readonly { row: QualitySummaryRow }[],
): NoticeModel | null {
	if (stores.some(({ row }) => row.member_capture_status === "disabled")) {
		return {
			tone: "warning",
			part: part(qualityKeys.customers.featureNotice),
			action: "theme_member_share",
		};
	}
	if (stores.some(({ row }) => customerFixKey(row) !== null)) {
		return {
			tone: "info",
			part: part(qualityKeys.customers.notice),
			action: "theme_member_share",
		};
	}
	return null;
}

export function buildCustomersCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const total = allStoresSummary(input.results);
	const stores = storeSummaries(context, input.results);
	const invoices = total?.invoices ?? 0;
	const range = rangeValue(context);
	const narrative: SentencePart[] =
		invoices === 0
			? [part(qualityKeys.customers.noData, { range })]
			: [
					part(qualityKeys.customers.main, {
						range,
						rate: numberValue("percent", total?.capture_rate ?? 0),
					}),
					(total?.identified_customers ?? 0) === 0 ||
					total?.consent_coverage === null ||
					total?.consent_coverage === undefined
						? part(qualityKeys.customers.noIdentified)
						: part(qualityKeys.customers.coverage, {
								coverage: numberValue("percent", total.consent_coverage),
								customers: numberValue("count", total.identified_customers),
							}),
				];
	return {
		id: "customers",
		titleKey: qualityKeys.customers.title,
		subtitle: null,
		metricId: "customer_capture_rate",
		relatedMetricIds: ["consent_coverage"],
		headline: {
			value: invoices === 0 ? null : (total?.capture_rate ?? null),
			unit: "fraction",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: invoices === 0 ? [] : [customersTable(stores)],
		chart: null,
		notice: invoices === 0 ? null : noticeOf(stores),
		markers: themeMarkers(input, false),
		csvName: qualityCsvName(context, "customers"),
	};
}

export const qualityCustomersCard: ThemeCardDefinition = {
	id: "customers",
	needs: qualityNeeds.customers,
	visible: () => true,
	build: buildCustomersCard,
};
