import { Button } from "../../components/ui/button";
import type { MonthKey, StoreTableId } from "../../exports/plan";
import type { ExportProgress } from "../../exports/run";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { monthLabel, tableLabel } from "./labels";

export type ProgressLine =
	| {
			readonly kind: "table";
			readonly key: string;
			readonly month: MonthKey;
			readonly store: string;
			readonly table: StoreTableId;
			readonly read: number;
			readonly expected: number;
			readonly attempt: number;
	  }
	| { readonly kind: "daily"; readonly key: string; readonly month: MonthKey };

export interface ProgressState {
	readonly lines: readonly ProgressLine[];
	readonly done: readonly {
		readonly month: MonthKey;
		readonly store: string;
	}[];
}

export const EMPTY_PROGRESS: ProgressState = { lines: [], done: [] };

function upsert(
	lines: readonly ProgressLine[],
	line: ProgressLine,
): ProgressLine[] {
	const index = lines.findIndex((candidate) => candidate.key === line.key);
	if (index < 0) return [...lines, line];
	const next = [...lines];
	next[index] = line;
	return next;
}

export function progressAfter(
	state: ProgressState,
	event: ExportProgress,
): ProgressState {
	switch (event.kind) {
		case "table":
			return {
				...state,
				lines: upsert(state.lines, {
					kind: "table",
					key: `${event.month}|${event.store}|${event.table}`,
					month: event.month,
					store: event.store,
					table: event.table,
					read: event.rowsRead,
					expected: event.expectedRows,
					attempt: event.attempt,
				}),
			};
		case "daily_summary":
			return {
				...state,
				lines: upsert(state.lines, {
					kind: "daily",
					key: `${event.month}|daily`,
					month: event.month,
				}),
			};
		default:
			return {
				...state,
				done: [...state.done, { month: event.month, store: event.store }],
			};
	}
}

export function ExportProgressView({
	progress,
	formatters,
	onStop,
}: {
	progress: ProgressState;
	formatters: Formatters;
	onStop: () => void;
}) {
	const t = useT();
	const last = progress.done.at(-1);
	return (
		<div
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="export-progress"
		>
			<h3 className="text-lg font-semibold">{t("exports.progress.title")}</h3>
			<p className="sr-only" role="status" aria-live="polite">
				{last === undefined
					? t("exports.progress.preparing")
					: t("exports.progress.storeDone", {
							month: monthLabel(t, last.month),
							store: last.store,
						})}
			</p>
			{progress.lines.length === 0 ? (
				<p className="text-ink-muted">{t("exports.progress.preparing")}</p>
			) : (
				<ul className="space-y-1 text-sm">
					{progress.lines.map((line) => (
						<li
							key={line.key}
							className="break-words"
							data-testid="export-progress-line"
						>
							{line.kind === "daily"
								? t("exports.progress.daily", {
										month: monthLabel(t, line.month),
									})
								: t("exports.progress.line", {
										month: monthLabel(t, line.month),
										store: line.store,
										table: tableLabel(t, line.table),
										read: formatters.count(line.read),
										expected: formatters.count(line.expected),
									})}
							{line.kind === "table" && line.attempt > 0 ? (
								<span className="block text-ink-muted">
									{t("exports.progress.reread", { attempt: line.attempt })}
								</span>
							) : null}
						</li>
					))}
				</ul>
			)}
			<Button tone="secondary" onClick={onStop} data-testid="export-stop">
				{t("exports.progress.stop")}
			</Button>
		</div>
	);
}
