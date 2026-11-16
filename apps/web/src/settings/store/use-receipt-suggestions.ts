import type { ThemeRow } from "@fnb/reports";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAnalyticsSourceState } from "../../data/analytics-source-context";
import type { Translate } from "../../i18n";
import { useAsOf } from "../../reports/use-as-of";
import { fetchOptions, type PlannedCall } from "../../reports/use-cards-load";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { StoreProfile } from "../source";

export interface ReceiptSuggestion {
	readonly restartsDaily: boolean;
	readonly receiptDays: number;
}

type SummaryRow = ThemeRow<"data_quality_summary">;

export function receiptSuggestionsOf(
	rows: readonly SummaryRow[],
): ReadonlyMap<string, ReceiptSuggestion> {
	const suggestions = new Map<string, ReceiptSuggestion>();
	for (const row of rows) {
		if (
			row.store_id === null ||
			row.receipt_days === null ||
			row.receipt_restarts_daily === null
		) {
			continue;
		}
		suggestions.set(row.store_id, {
			restartsDaily: row.receipt_restarts_daily,
			receiptDays: row.receipt_days,
		});
	}
	return suggestions;
}

export function receiptSuggestionText(
	t: Translate,
	suggestion: ReceiptSuggestion | undefined,
	formatCount: (value: number) => string,
): string | null {
	if (suggestion === undefined) return null;
	return t(
		suggestion.restartsDaily
			? "settings.store.receipts.suggestDaily"
			: "settings.store.receipts.suggestNotDaily",
		{ days: formatCount(suggestion.receiptDays) },
	);
}

type SummaryQuery = ReturnType<typeof fetchOptions> & {
	readonly retry: false;
};

export interface ReceiptSuggestions {
	readonly settled: boolean;
	readonly byStore: ReadonlyMap<string, ReceiptSuggestion>;
}

const NO_SUGGESTIONS: ReadonlyMap<string, ReceiptSuggestion> = new Map();
const NO_PROFILES: readonly StoreProfile[] = [];

export function useReceiptSuggestions(
	profiles: readonly StoreProfile[] | undefined,
): ReceiptSuggestions {
	const state = useAnalyticsSourceState();
	const { tenant } = useReadyTenantScope();
	const visible = profiles ?? NO_PROFILES;
	const asOf = useAsOf(visible);
	const source = state.status === "ready" ? state.source : null;
	const call = useMemo<PlannedCall>(
		() => ({
			key: "store-receipt-numbering",
			name: "data_quality_summary",
			args: {
				store_ids: visible.map((profile) => profile.storeId),
				from_date: asOf,
				to_date: asOf,
			},
		}),
		[visible, asOf],
	);
	const queries: SummaryQuery[] =
		source === null || visible.length === 0
			? []
			: [{ ...fetchOptions(source, tenant.id, asOf, call), retry: false }];
	const [summary] = useQueries({ queries });
	const rows = summary?.data as readonly SummaryRow[] | undefined;
	const byStore = useMemo(
		() => (rows === undefined ? NO_SUGGESTIONS : receiptSuggestionsOf(rows)),
		[rows],
	);
	const settled =
		state.status === "failed" ||
		(summary !== undefined && summary.status !== "pending");
	return { settled, byStore };
}
