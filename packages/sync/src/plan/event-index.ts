import type { AdjustmentKind } from "@fnb/core";
import type { ExistingEvent, InvoiceEventRow, InvoiceStatus } from "../rows.js";

export interface InvoiceEventKinds {
	report: Set<AdjustmentKind>;
	resync: Set<AdjustmentKind>;
}

export type EventIndex = Map<string, InvoiceEventKinds>;

function kindsFor(index: EventIndex, externalId: string): InvoiceEventKinds {
	const existing = index.get(externalId);
	if (existing) {
		return existing;
	}
	const created: InvoiceEventKinds = { report: new Set(), resync: new Set() };
	index.set(externalId, created);
	return created;
}

export function addEvent(
	index: EventIndex,
	event: Pick<ExistingEvent, "invoice_external_id" | "kind" | "source">,
): void {
	const kinds = kindsFor(index, event.invoice_external_id);
	if (event.source === "resync_diff") {
		kinds.resync.add(event.kind);
	} else {
		kinds.report.add(event.kind);
	}
}

export function buildEventIndex(
	existing: readonly ExistingEvent[],
	reported: readonly InvoiceEventRow[],
): EventIndex {
	const index: EventIndex = new Map();
	for (const event of existing) {
		addEvent(index, event);
	}
	for (const event of reported) {
		addEvent(index, event);
	}
	return index;
}

const EMPTY_KINDS: InvoiceEventKinds = { report: new Set(), resync: new Set() };

export function eventKinds(
	index: EventIndex,
	externalId: string,
): InvoiceEventKinds {
	return index.get(externalId) ?? EMPTY_KINDS;
}

export function reportsEdit(kinds: InvoiceEventKinds): boolean {
	return kinds.report.has("edited") || kinds.report.has("line_removed");
}

export function deriveStatus(
	connectorStatus: InvoiceStatus,
	kinds: InvoiceEventKinds,
): InvoiceStatus {
	if (connectorStatus === "voided" || kinds.report.has("voided")) {
		return "voided";
	}
	if (
		connectorStatus === "edited" ||
		reportsEdit(kinds) ||
		kinds.resync.has("edited")
	) {
		return "edited";
	}
	return "completed";
}
