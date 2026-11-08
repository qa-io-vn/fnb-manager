import type { FlagCount, MasterDataSummary, WindowSummary } from "@fnb/sync";
import type { CommandContext } from "../context.js";
import { countsText } from "./formatting.js";

export function printFlags(
	context: CommandContext,
	flags: readonly FlagCount[],
): void {
	if (flags.length === 0) {
		context.output.line("data-quality flags: none");
		return;
	}
	context.output.line(
		`data-quality flags: ${flags.map((entry) => `${entry.code} (${entry.severity}) ${entry.count}`).join(", ")}`,
	);
}

function refreshText(summary: WindowSummary): string {
	const refresh = summary.refresh;
	switch (refresh.status) {
		case "refreshed":
			return `refreshed ${refresh.rows} rows in ${refresh.durationMs} ms`;
		case "failed":
			return `failed after ${refresh.durationMs} ms (${refresh.error})`;
		default:
			return refresh.status;
	}
}

export function printWindowSummary(
	context: CommandContext,
	accountLabel: string,
	summary: WindowSummary,
	httpRequests: number,
): void {
	const { output } = context;
	output.line(
		`${accountLabel}: ${summary.kind}${summary.dryRun ? " (dry run)" : ""} ${summary.window.fromDate}..${summary.window.toDate} ${summary.status} in ${(summary.durationMs / 1000).toFixed(1)} s`,
	);
	output.table(
		[
			"store",
			"sales",
			"new",
			"updated",
			"status",
			"voided",
			"edited",
			"events",
			"shifts",
			"checks",
		],
		summary.stores.map((store, index) => [
			output.label("store", index, store.name),
			store.pulledSales,
			store.inserted,
			store.updated,
			store.statusChanged,
			store.voided,
			store.edited,
			store.newAdjustmentEvents,
			store.shifts,
			store.checks.available
				? `${store.checks.matched}/${store.checks.matched + store.checks.unmatched}`
				: "unavailable",
		]),
	);
	output.line(
		`${summary.dryRun ? "would write" : "rows written"}: ${countsText(summary.tables)}`,
	);
	output.line(
		`connector calls ${summary.connectorCalls} (retries ${summary.retries}), POS HTTP requests ${httpRequests}`,
	);
	printFlags(context, summary.flags);
	output.line(`analytics refresh: ${refreshText(summary)}`);
	if (summary.error) {
		output.error(`error: ${summary.error}`);
	}
}

export function windowSummaryMarkdown(
	accountIndex: number,
	summary: WindowSummary,
): string {
	const header = `### Account ${accountIndex + 1}: ${summary.kind} ${summary.window.fromDate} to ${summary.window.toDate} — ${summary.status}${summary.dryRun ? " (dry run)" : ""}`;
	const rows = summary.stores.map(
		(store, index) =>
			`| store ${index + 1} | ${store.pulledSales} | ${store.inserted} | ${store.updated} | ${store.voided} | ${store.edited} | ${store.checks.available ? `${store.checks.matched}/${store.checks.matched + store.checks.unmatched}` : "unavailable"} |`,
	);
	const flags = summary.flags.reduce((sum, entry) => sum + entry.count, 0);
	return [
		header,
		"",
		"| store | sales | new | updated | voided | edited | days matched |",
		"|---|---|---|---|---|---|---|",
		...rows,
		"",
		`Connector calls ${summary.connectorCalls}, retries ${summary.retries}, data-quality flags ${flags}, analytics refresh ${summary.refresh.status}, ${(summary.durationMs / 1000).toFixed(1)} s.`,
		"",
	].join("\n");
}

export function masterSummaryText(summary: MasterDataSummary): string {
	return `master data ${summary.status}: ${summary.stores.discovered} store(s), ${countsText(summary.tables)}`;
}
