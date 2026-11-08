import { adjustmentKey, type CanonicalAdjustment } from "@fnb/core";
import { toJson } from "../json.js";
import { formatOptionalMoney } from "../numeric.js";
import type { InvoiceEventRow } from "../rows.js";
import { text, textOrNull } from "./text.js";

export interface EventMappingContext {
	tenantId: string;
	storeId: string;
}

export function eventKey(
	row: Pick<InvoiceEventRow, "invoice_external_id" | "kind" | "occurred_at">,
): string {
	return [row.invoice_external_id, row.kind, row.occurred_at].join("|");
}

export function mapAdjustment(
	adjustment: CanonicalAdjustment,
	context: EventMappingContext,
): InvoiceEventRow {
	return {
		tenant_id: context.tenantId,
		store_id: context.storeId,
		invoice_external_id: text(adjustment.saleExternalId),
		kind: adjustment.kind,
		occurred_at: adjustment.occurredAt.toISOString(),
		amount: formatOptionalMoney(adjustment.amount),
		reason: textOrNull(adjustment.reason),
		source: "pos_report",
		raw: toJson(adjustment.raw),
	};
}

export interface AdjustmentEvents {
	events: InvoiceEventRow[];
	repeated: number;
	merged: number;
}

function mergeEvents(group: readonly InvoiceEventRow[]): InvoiceEventRow {
	const [first] = group;
	if (!first) {
		throw new RangeError("cannot merge an empty group of events");
	}
	if (group.length === 1) {
		return first;
	}
	const amounts = group.map((row) => row.amount);
	const total = amounts.every((amount) => amount === null)
		? null
		: formatOptionalMoney(
				amounts.reduce((sum, amount) => sum + Number(amount ?? 0), 0),
			);
	return {
		...first,
		amount: total,
		raw: { merged: group.map((row) => row.raw) },
	};
}

export function adjustmentEvents(
	adjustments: readonly CanonicalAdjustment[],
	context: EventMappingContext,
): AdjustmentEvents {
	const byKey = new Map<string, CanonicalAdjustment>();
	let repeated = 0;
	for (const adjustment of adjustments) {
		const key = adjustmentKey(adjustment);
		if (byKey.has(key)) {
			repeated += 1;
		} else {
			byKey.set(key, adjustment);
		}
	}
	const groups = new Map<string, InvoiceEventRow[]>();
	for (const [, adjustment] of [...byKey.entries()].sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	)) {
		const row = mapAdjustment(adjustment, context);
		const key = eventKey(row);
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	const events = [...groups.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([, group]) => mergeEvents(group));
	return { events, repeated, merged: byKey.size - events.length };
}
