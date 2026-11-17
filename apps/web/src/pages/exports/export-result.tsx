import { Button, buttonVariants } from "../../components/ui/button";
import {
	BYTES_PER_GIGABYTE,
	gigabytes,
	megabytes,
} from "../../exports/estimate";
import type { ExportResult, StoreMonthCheck } from "../../exports/run";
import { type Translate, useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { countsText, monthLabel } from "./labels";

function checkLine(
	t: Translate,
	formatters: Formatters,
	check: StoreMonthCheck,
	runningTo: string | null,
): string {
	const base = {
		month: monthLabel(t, check.month),
		store: check.store,
		counts: countsText(t, formatters, check.rows),
	};
	const line = check.verified
		? t("exports.result.verified", base)
		: check.reason === "changed"
			? t("exports.result.changed", base)
			: t("exports.result.mismatch", base);
	return runningTo === null
		? line
		: `${line} ${t("exports.result.running", { date: formatters.date(runningTo) })}`;
}

export function tallyText(
	t: Translate,
	formatters: Formatters,
	bytes: number,
): string {
	return bytes >= BYTES_PER_GIGABYTE / 10
		? t("exports.tally", { gigabytes: formatters.decimal(gigabytes(bytes)) })
		: t("exports.tallyMegabytes", {
				megabytes: formatters.decimal(megabytes(bytes)),
			});
}

export function ExportResultView({
	result,
	url,
	tally,
	formatters,
	onAgain,
}: {
	result: ExportResult;
	url: string;
	tally: number;
	formatters: Formatters;
	onAgain: () => void;
}) {
	const t = useT();
	const runningTo = (check: StoreMonthCheck) =>
		check.running
			? (result.manifest.files.find(
					(file) =>
						file.month === check.month &&
						file.store === check.store &&
						file.running,
				)?.to ?? null)
			: null;
	const allVerified = result.checks.every((check) => check.verified);
	return (
		<div
			className="space-y-4 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="export-result"
		>
			<h3 className="text-lg font-semibold">{t("exports.result.title")}</h3>
			<p className="sr-only" role="status">
				{t("exports.result.title")}
			</p>
			<a
				href={url}
				download={result.archiveName}
				className={`${buttonVariants()} inline-flex max-w-full items-center break-all`}
				data-testid="export-download"
			>
				{t("exports.result.download", { name: result.archiveName })}
			</a>
			<ul className="space-y-1 text-sm" data-testid="export-checks">
				{result.checks.map((check) => (
					<li
						key={`${check.month}|${check.store}`}
						className={
							check.verified
								? "break-words"
								: "break-words font-medium text-negative"
						}
						data-verified={check.verified}
					>
						{checkLine(t, formatters, check, runningTo(check))}
					</li>
				))}
				{result.dailyChecks.map((check) => (
					<li
						key={`${check.month}|${check.store}|daily`}
						className={
							check.matched ? "break-words" : "break-words text-warning"
						}
						data-daily-matched={check.matched}
					>
						{t(
							check.matched
								? "exports.result.dailyMatched"
								: "exports.result.dailyLag",
							{
								month: monthLabel(t, check.month),
								store: check.store,
							},
						)}
					</li>
				))}
			</ul>
			<div className="space-y-1">
				<p data-testid="export-received">
					{t("exports.result.received", {
						megabytes: formatters.decimal(megabytes(result.receivedBytes)),
					})}
				</p>
				<p className="text-sm text-ink-muted">
					{t("exports.result.receivedNote")}
				</p>
				<p className="text-sm text-ink-muted" data-testid="exports-tally">
					{tallyText(t, formatters, tally)}
				</p>
			</div>
			<Button
				tone={allVerified ? "secondary" : "primary"}
				onClick={onAgain}
				data-testid="export-again"
			>
				{t("exports.result.again")}
			</Button>
		</div>
	);
}
