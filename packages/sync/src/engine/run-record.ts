import type { JsonObject, TableCounts } from "../rows.js";
import { sortedCounts } from "./counts.js";
import type { FlagCollector } from "./flags.js";

export interface RunRecordSummary {
	connectorCalls: number;
	retries: number;
	flags: FlagCollector;
	checks?: { available: boolean; unmatched: number };
	refreshMs?: number | null;
	refreshStatus?: string;
}

export function runRows(
	tables: TableCounts,
	summary: RunRecordSummary,
): JsonObject {
	const details: JsonObject = {
		connector_calls: summary.connectorCalls,
		retries: summary.retries,
		flags_warn: summary.flags.total("warn"),
		flags_info: summary.flags.total("info"),
	};
	if (summary.checks) {
		details.checks = summary.checks.available ? "available" : "unavailable";
		details.checks_unmatched = summary.checks.unmatched;
	}
	if (summary.refreshStatus !== undefined) {
		details.refresh = summary.refreshStatus;
		details.refresh_ms = summary.refreshMs ?? null;
	}
	return { ...sortedCounts(tables), summary: details };
}
