import type {
	CardModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeMarkers } from "../../support.js";
import { qualityKeys } from "../keys.js";
import {
	type QualitySummaryRow,
	qualityCsvName,
	qualityNeeds,
	railFlaggedStoreIds,
	storeSummaries,
} from "../support.js";

export type ReceiptReading = "daily" | "notDaily" | "unknown";

export type ComplianceFinding =
	| "eInvoice"
	| "receipts"
	| "memberDisabled"
	| "railEInvoice"
	| "hours"
	| "seats"
	| "openedOn";

export interface StoreFinding {
	readonly finding: ComplianceFinding;
	readonly findingKey: string;
	readonly fixKey: string;
}

export function isEInvoiceFinding(row: QualitySummaryRow): boolean {
	return row.e_invoice_status !== "configured";
}

export function receiptReading(row: QualitySummaryRow): ReceiptReading {
	if (row.receipt_restarts_daily === null) return "unknown";
	return row.receipt_restarts_daily ? "daily" : "notDaily";
}

export function receiptsDisagree(row: QualitySummaryRow): boolean {
	const reading = receiptReading(row);
	if (reading === "unknown") return false;
	switch (row.tran_no_reset_period) {
		case "daily":
			return reading === "notDaily";
		case "yearly":
		case "never":
			return reading === "daily";
		default:
			return false;
	}
}

function eInvoiceFinding(row: QualitySummaryRow): StoreFinding | null {
	switch (row.e_invoice_status) {
		case "configured":
			return null;
		case "not_configured":
		case "disabled":
			return {
				finding: "eInvoice",
				findingKey: qualityKeys.finding.eInvoice[row.e_invoice_status],
				fixKey: qualityKeys.fix.pos.eInvoice,
			};
		default:
			return {
				finding: "eInvoice",
				findingKey: qualityKeys.finding.eInvoice.unknown,
				fixKey: qualityKeys.fix.settings.eInvoice,
			};
	}
}

function receiptsFinding(row: QualitySummaryRow): StoreFinding | null {
	if (
		row.tran_no_reset_period === null ||
		row.tran_no_reset_period === "unknown"
	) {
		return {
			finding: "receipts",
			findingKey: qualityKeys.finding.receipts.unknown,
			fixKey: qualityKeys.fix.settings.receipts,
		};
	}
	return receiptsDisagree(row)
		? {
				finding: "receipts",
				findingKey: qualityKeys.finding.receipts.mismatch,
				fixKey: qualityKeys.fix.settings.receipts,
			}
		: null;
}

export function storeFindings(
	row: QualitySummaryRow,
	railFlagged = false,
): StoreFinding[] {
	const findings: (StoreFinding | null)[] = [
		eInvoiceFinding(row),
		railFlagged
			? {
					finding: "railEInvoice",
					findingKey: qualityKeys.finding.railEInvoice,
					fixKey: qualityKeys.fix.pos.eInvoice,
				}
			: null,
		receiptsFinding(row),
		row.member_capture_status === "disabled"
			? {
					finding: "memberDisabled",
					findingKey: qualityKeys.finding.memberDisabled,
					fixKey: qualityKeys.fix.pos.memberFeatureRecord,
				}
			: null,
		row.opening_hours_known === true
			? null
			: {
					finding: "hours",
					findingKey: qualityKeys.finding.hours,
					fixKey: qualityKeys.fix.settings.hours,
				},
		row.seat_count === null
			? {
					finding: "seats",
					findingKey: qualityKeys.finding.seats,
					fixKey: qualityKeys.fix.settings.seats,
				}
			: null,
		row.opened_on === null
			? {
					finding: "openedOn",
					findingKey: qualityKeys.finding.openedOn,
					fixKey: qualityKeys.fix.settings.openedOn,
				}
			: null,
	];
	return findings.filter((entry): entry is StoreFinding => entry !== null);
}

type Store = {
	readonly name: string;
	readonly row: QualitySummaryRow;
	readonly railFlagged: boolean;
};

function findingsTable(stores: readonly Store[]): TableModel {
	return tableModel({
		captionKey: qualityKeys.compliance.findingsTable,
		columns: [
			column("store", reportKeys.table.store, "text"),
			column("finding", qualityKeys.table.finding, "message"),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: stores.flatMap(({ name, row, railFlagged }) =>
			storeFindings(row, railFlagged).map((entry) => ({
				id: `${row.store_id ?? ""}|${entry.finding}`,
				cells: { store: name, finding: entry.findingKey, fix: entry.fixKey },
			})),
		),
	});
}

function storesTable(stores: readonly Store[]): TableModel {
	return tableModel({
		captionKey: qualityKeys.compliance.storesTable,
		columns: [
			column("store", reportKeys.table.store, "text"),
			column("eInvoice", qualityKeys.table.eInvoice, "message"),
			column("receipts", qualityKeys.table.receipts, "message"),
			column("receiptsData", qualityKeys.table.receiptsData, "message"),
			column("member", qualityKeys.table.member, "message"),
			column("openingHours", qualityKeys.table.openingHours, "message"),
			column("seats", qualityKeys.table.seats, "count"),
			column("openedOn", qualityKeys.table.openedOn, "date"),
		],
		rows: stores.map(({ name, row }) => ({
			id: row.store_id ?? "",
			cells: {
				store: name,
				eInvoice: qualityKeys.eInvoice[row.e_invoice_status ?? "unknown"],
				receipts: qualityKeys.receipts[row.tran_no_reset_period ?? "unknown"],
				receiptsData: qualityKeys.receiptsData[receiptReading(row)],
				member: qualityKeys.member[row.member_capture_status ?? "unknown"],
				openingHours:
					row.opening_hours_known === true
						? qualityKeys.value.entered
						: qualityKeys.value.missing,
				seats: row.seat_count,
				openedOn: row.opened_on,
			},
		})),
	});
}

function noticeOf(stores: readonly Store[]): NoticeModel | null {
	if (stores.some(({ row }) => isEInvoiceFinding(row))) {
		return {
			tone: "warning",
			part: part(qualityKeys.compliance.eInvoiceNotice),
			action: "settings_e_invoice",
		};
	}
	const findings = stores.flatMap(({ row, railFlagged }) =>
		storeFindings(row, railFlagged),
	);
	if (findings.some((entry) => entry.finding === "memberDisabled")) {
		return {
			tone: "info",
			part: part(qualityKeys.compliance.memberNotice),
			action: "settings_store_profile",
		};
	}
	if (findings.length > 0) {
		return {
			tone: "info",
			part: part(qualityKeys.compliance.storeNotice),
			action: "settings_store_profile",
		};
	}
	return null;
}

export function buildComplianceCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const railFlags = railFlaggedStoreIds(input.results);
	const stores: Store[] = storeSummaries(context, input.results).map(
		(store) => ({
			...store,
			railFlagged:
				store.row.store_id !== null && railFlags.has(store.row.store_id),
		}),
	);
	const flagged = stores.filter(
		({ row, railFlagged }) => storeFindings(row, railFlagged).length > 0,
	);
	const eInvoice = stores.filter(({ row }) => isEInvoiceFinding(row));
	const railEInvoice = stores.filter(({ railFlagged }) => railFlagged);
	const narrative: SentencePart[] = [
		flagged.length === 0
			? part(qualityKeys.compliance.none)
			: part(qualityKeys.compliance.main, {
					count: numberValue("count", flagged.length),
					total: numberValue("count", stores.length),
				}),
	];
	if (eInvoice.length > 0) {
		narrative.push(
			part(qualityKeys.compliance.eInvoice, {
				count: numberValue("count", eInvoice.length),
			}),
		);
	}
	if (railEInvoice.length > 0) {
		narrative.push(
			part(qualityKeys.compliance.railEInvoice, {
				count: numberValue("count", railEInvoice.length),
			}),
		);
	}
	const tables: TableModel[] = [];
	if (flagged.length > 0) tables.push(findingsTable(flagged));
	if (stores.length > 0) tables.push(storesTable(stores));
	return {
		id: "compliance",
		titleKey: qualityKeys.compliance.title,
		subtitle: null,
		metricId: "store_findings",
		relatedMetricIds: [],
		headline: {
			value: stores.length === 0 ? null : flagged.length,
			unit: "count",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables,
		chart: null,
		notice: noticeOf(stores),
		markers: themeMarkers(input, false),
		csvName: qualityCsvName(context, "compliance"),
	};
}

export const qualityComplianceCard: ThemeCardDefinition = {
	id: "compliance",
	needs: qualityNeeds.compliance,
	wide: true,
	visible: () => true,
	build: buildComplianceCard,
};
