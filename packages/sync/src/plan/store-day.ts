import { invoiceDigest, lineSetKey } from "../digest.js";
import { formatMoney, parseNumeric } from "../numeric.js";
import type {
	ExistingInvoice,
	InvoiceEventRow,
	SaleWrite,
	StatusChange,
	StoreDayWrite,
	TableCounts,
} from "../rows.js";
import {
	addEvent,
	deriveStatus,
	type EventIndex,
	eventKinds,
	reportsEdit,
} from "./event-index.js";

export interface StoreDayPlanInput {
	tenantId: string;
	storeId: string;
	businessDate: string;
	incoming: readonly SaleWrite[];
	existingById: ReadonlyMap<string, ExistingInvoice>;
	existingOnDate: readonly ExistingInvoice[];
	incomingIds: ReadonlySet<string>;
	events: EventIndex;
	supersededIds: ReadonlySet<string>;
	allowVoids: boolean;
	movedOutOfWindow: (existing: ExistingInvoice) => boolean;
	detectedAt: string;
}

export interface StoreDayStats {
	inserted: number;
	updated: number;
	statusChanged: number;
	unchanged: number;
	voided: number;
	edited: number;
	voidsSkipped: number;
	movedOutOfWindow: number;
}

export interface StoreDayPlan {
	write: StoreDayWrite;
	stats: StoreDayStats;
}

function byExternalId<T extends { external_id: string }>(
	left: T,
	right: T,
): number {
	return left.external_id < right.external_id
		? -1
		: left.external_id > right.external_id
			? 1
			: 0;
}

function resyncEvent(
	input: StoreDayPlanInput,
	externalId: string,
	kind: "voided" | "edited",
	amount: string,
	raw: InvoiceEventRow["raw"],
): InvoiceEventRow {
	return {
		tenant_id: input.tenantId,
		store_id: input.storeId,
		invoice_external_id: externalId,
		kind,
		occurred_at: input.detectedAt,
		amount,
		reason: null,
		source: "resync_diff",
		raw,
	};
}

function editAmount(previous: string, current: string): string {
	return formatMoney(Math.abs(parseNumeric(current) - parseNumeric(previous)));
}

export function planStoreDay(input: StoreDayPlanInput): StoreDayPlan {
	const stats: StoreDayStats = {
		inserted: 0,
		updated: 0,
		statusChanged: 0,
		unchanged: 0,
		voided: 0,
		edited: 0,
		voidsSkipped: 0,
		movedOutOfWindow: 0,
	};
	const sales: SaleWrite[] = [];
	const statusChanges: StatusChange[] = [];
	const events: InvoiceEventRow[] = [];

	const incoming = [...input.incoming].sort((left, right) =>
		byExternalId(left.invoice, right.invoice),
	);
	for (const sale of incoming) {
		const externalId = sale.invoice.external_id;
		const existing = input.existingById.get(externalId);
		const connectorStatus = sale.invoice.status;
		if (!existing) {
			const status = deriveStatus(
				connectorStatus,
				eventKinds(input.events, externalId),
			);
			sales.push({ ...sale, invoice: { ...sale.invoice, status } });
			stats.inserted += 1;
			continue;
		}
		const digest = invoiceDigest(sale.invoice, sale.lines, sale.payments);
		if (digest !== existing.digest) {
			const amountChanged = existing.net_amount !== sale.invoice.net_amount;
			const linesChanged = existing.line_set !== lineSetKey(sale.lines);
			const kinds = eventKinds(input.events, externalId);
			if ((amountChanged || linesChanged) && !reportsEdit(kinds)) {
				const event = resyncEvent(
					input,
					externalId,
					"edited",
					editAmount(existing.net_amount, sale.invoice.net_amount),
					{
						detected_by: "resync_diff",
						previous_net_amount: existing.net_amount,
						net_amount: sale.invoice.net_amount,
						lines_changed: linesChanged,
					},
				);
				events.push(event);
				addEvent(input.events, event);
				stats.edited += 1;
			}
			const status = deriveStatus(
				connectorStatus,
				eventKinds(input.events, externalId),
			);
			sales.push({ ...sale, invoice: { ...sale.invoice, status } });
			stats.updated += 1;
			continue;
		}
		const status = deriveStatus(
			connectorStatus,
			eventKinds(input.events, externalId),
		);
		if (status !== existing.status) {
			statusChanges.push({
				external_id: externalId,
				status,
				from: [existing.status],
			});
			stats.statusChanged += 1;
		} else {
			stats.unchanged += 1;
		}
	}

	const absent = input.existingOnDate
		.filter((existing) => !input.incomingIds.has(existing.external_id))
		.sort(byExternalId);
	for (const existing of absent) {
		if (existing.status === "voided") {
			continue;
		}
		if (input.movedOutOfWindow(existing)) {
			stats.movedOutOfWindow += 1;
			continue;
		}
		if (!input.allowVoids) {
			stats.voidsSkipped += 1;
			continue;
		}
		statusChanges.push({
			external_id: existing.external_id,
			status: "voided",
			from: [existing.status],
		});
		stats.voided += 1;
		const kinds = eventKinds(input.events, existing.external_id);
		const alreadyRecorded =
			kinds.report.has("voided") ||
			kinds.resync.has("voided") ||
			input.supersededIds.has(existing.external_id);
		if (!alreadyRecorded) {
			const event = resyncEvent(
				input,
				existing.external_id,
				"voided",
				existing.net_amount,
				{ detected_by: "resync_diff", reason: "absent_from_resync" },
			);
			events.push(event);
			addEvent(input.events, event);
		}
	}

	return {
		write: {
			tenant_id: input.tenantId,
			store_id: input.storeId,
			business_date: input.businessDate,
			sales,
			status_changes: statusChanges,
			events,
		},
		stats,
	};
}

export function plannedCounts(plan: StoreDayPlan): TableCounts {
	const { sales, status_changes, events } = plan.write;
	return {
		invoices: sales.length + status_changes.length,
		invoice_lines: sales.reduce((sum, sale) => sum + sale.lines.length, 0),
		invoice_payments: sales.reduce(
			(sum, sale) => sum + sale.payments.length,
			0,
		),
		invoice_events: events.length,
	};
}

export function hasWrites(plan: StoreDayPlan): boolean {
	return (
		plan.write.sales.length > 0 ||
		plan.write.status_changes.length > 0 ||
		plan.write.events.length > 0
	);
}
