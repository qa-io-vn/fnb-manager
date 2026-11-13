import {
	type IncrementalSummary,
	incrementalDayCounts,
	type JsonObject,
} from "@fnb/sync";
import type { IncrementalStoreOutcome } from "./incremental-run.js";

function dayCounts(summary: IncrementalSummary): JsonObject {
	const days = incrementalDayCounts(summary.days);
	return {
		checked: days.checked,
		changed: days.changed,
		synced: days.synced,
		handed_off: days.handedOff,
	};
}

function summaryReport(summary: IncrementalSummary): JsonObject {
	return {
		status: summary.status,
		stopped: summary.stopped,
		days: dayCounts(summary),
		connector_calls: summary.connectorCalls,
		retries: summary.retries,
		pulled_sales: summary.store.pulledSales,
		inserted: summary.store.inserted,
		updated: summary.store.updated,
		voided: summary.store.voided,
		checks_unmatched: summary.checks.unmatched,
		refresh: summary.refresh.status,
		stale_days_refreshed: summary.refreshRetried.length,
		duration_ms: summary.durationMs,
		cpu_estimate_ms: summary.estimatedCpuMs,
		flags_warn: summary.flags
			.filter((flag) => flag.severity === "warn")
			.reduce((sum, flag) => sum + flag.count, 0),
	};
}

export function outcomeReport(outcome: IncrementalStoreOutcome): JsonObject {
	if (outcome.kind === "skipped") {
		return { outcome: "skipped", label: outcome.label, reason: outcome.reason };
	}
	const base: JsonObject = {
		outcome: outcome.kind,
		label: outcome.label,
		minutes_without_sync: outcome.minutesWithoutSync,
		http_requests: outcome.httpRequests,
	};
	if (outcome.kind === "failed") {
		return {
			...base,
			stage: outcome.stage,
			error: outcome.error,
			...(outcome.summary ? summaryReport(outcome.summary) : {}),
		};
	}
	return { ...base, ...summaryReport(outcome.summary) };
}

function seconds(milliseconds: number): string {
	return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function outcomeLine(outcome: IncrementalStoreOutcome): string {
	if (outcome.kind === "skipped") {
		return `${outcome.label}: skipped (${outcome.reason})`;
	}
	if (outcome.kind === "failed" && !outcome.summary) {
		return `${outcome.label}: failed at ${outcome.stage}: ${outcome.error}`;
	}
	const summary = outcome.summary;
	if (!summary) {
		return `${outcome.label}: ${outcome.kind}`;
	}
	const days = dayCounts(summary);
	const stopped = summary.stopped ? `, stopped by ${summary.stopped}` : "";
	const failure = outcome.kind === "failed" ? `: ${outcome.error}` : "";
	return `${outcome.label}: ${summary.status}${stopped} in ${seconds(summary.durationMs)}, ${days.checked} days checked, ${days.changed} changed, ${days.synced} synced, ${days.handed_off} handed off, ${summary.store.pulledSales} sales pulled, ${summary.connectorCalls} connector calls, ${outcome.httpRequests} HTTP requests, about ${summary.estimatedCpuMs} ms CPU${failure}`;
}
