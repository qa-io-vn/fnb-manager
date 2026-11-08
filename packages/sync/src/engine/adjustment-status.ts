import type { InvoiceEventRow, StatusChange } from "../rows.js";
import { byExternalIdText } from "./store-window-context.js";

export function adjustmentStatusChanges(
	events: readonly InvoiceEventRow[],
): StatusChange[] {
	const changes = new Map<string, StatusChange>();
	for (const event of events) {
		if (event.kind === "voided") {
			changes.set(event.invoice_external_id, {
				external_id: event.invoice_external_id,
				status: "voided",
				from: ["completed", "edited"],
			});
		} else if (
			(event.kind === "edited" || event.kind === "line_removed") &&
			changes.get(event.invoice_external_id)?.status !== "voided"
		) {
			changes.set(event.invoice_external_id, {
				external_id: event.invoice_external_id,
				status: "edited",
				from: ["completed"],
			});
		}
	}
	return [...changes.values()].sort((left, right) =>
		byExternalIdText(left.external_id, right.external_id),
	);
}
