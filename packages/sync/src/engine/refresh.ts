import { type BusinessDateWindow, windowDates } from "@fnb/connector-core";
import { shiftIsoDate } from "@fnb/core";
import type { DateRange } from "../repository.js";
import type { AccountRecord } from "../rows.js";
import { createRedactor, safeErrorMessage } from "./redact.js";
import type { RefreshSummary, SyncEngineOptions } from "./types.js";

export function refreshRanges(
	window: BusinessDateWindow,
	extraDates: readonly string[],
): DateRange[] {
	const dates = [...new Set([...windowDates(window), ...extraDates])].sort();
	const ranges: DateRange[] = [];
	for (const date of dates) {
		const last = ranges.at(-1);
		if (last && shiftIsoDate(last.to, 1) === date) {
			last.to = date;
		} else {
			ranges.push({ from: date, to: date });
		}
	}
	return ranges;
}

export async function refreshAnalytics(
	options: SyncEngineOptions,
	account: AccountRecord,
	ranges: readonly DateRange[],
	now: () => Date,
): Promise<RefreshSummary> {
	const started = now().getTime();
	let rows = 0;
	try {
		for (const range of ranges) {
			const result = await options.repository.refreshAnalytics(
				account.tenant_id,
				range,
			);
			if (!result.available) {
				return { status: "unavailable" };
			}
			rows += result.rows;
		}
		return { status: "refreshed", rows, durationMs: now().getTime() - started };
	} catch (error) {
		return {
			status: "failed",
			durationMs: now().getTime() - started,
			error: safeErrorMessage(error, options.redact ?? createRedactor()),
		};
	}
}
