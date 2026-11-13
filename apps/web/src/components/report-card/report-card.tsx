import { useId } from "react";
import { Link } from "react-router-dom";
import type { Formatters } from "../../lib/format";
import type { MetricDefinition } from "../../metrics/registry";
import { CardMarkers } from "./card-markers";
import { ComparisonChips } from "./comparison-chips";
import { DataTable } from "./data-table";
import { Headline } from "./headline";
import { LazyChart } from "./lazy-chart";
import { MetricExplainer } from "./metric-explainer";
import type {
	ChartSpec,
	ChipSpec,
	TableSpec,
	ValueKind,
	VerificationMarker,
} from "./types";

export interface CardNotice {
	tone: "info" | "warning";
	text: string;
	action?: { label: string; to: string };
}

export interface CardDecomposition {
	label: string;
	parts: readonly { label: string; value: string }[];
}

export interface ReportCardProps {
	title: string;
	subtitle?: string;
	metric: MetricDefinition;
	relatedMetrics?: readonly MetricDefinition[];
	headline: {
		value: number | null;
		kind: Exclude<ValueKind, "text">;
		caption?: string;
	};
	chips: readonly ChipSpec[];
	sentence: string;
	notice?: CardNotice;
	decomposition?: CardDecomposition;
	chart?: ChartSpec;
	table?: TableSpec;
	csvFileName: string;
	secondaryTable?: TableSpec;
	secondaryCsvFileName?: string;
	verification: VerificationMarker;
	provisional?: boolean;
	stale?: boolean;
	busy?: boolean;
	wide?: boolean;
	formatters: Formatters;
	testId?: string;
}

export function isProvisional(metrics: readonly MetricDefinition[]): boolean {
	return metrics.some((metric) => metric.missingKey !== undefined);
}

const noticeTones: Record<CardNotice["tone"], string> = {
	info: "border-line bg-surface-sunken text-ink",
	warning: "border-warning bg-warning-soft text-ink",
};

function Notice({ notice }: { notice: CardNotice }) {
	return (
		<p
			role="note"
			className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm ${noticeTones[notice.tone]}`}
			data-testid="card-notice"
		>
			<span>{notice.text}</span>
			{notice.action ? (
				<Link
					to={notice.action.to}
					className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2 print:hidden"
				>
					{notice.action.label}
				</Link>
			) : null}
		</p>
	);
}

export function ReportCard(props: ReportCardProps) {
	const headingId = useId();
	const metrics = [props.metric, ...(props.relatedMetrics ?? [])];
	return (
		<article
			aria-labelledby={headingId}
			aria-busy={props.busy ? true : undefined}
			className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-raised p-4 shadow-sm transition-opacity aria-busy:opacity-60 print:shadow-none ${props.wide ? "md:col-span-2 xl:col-span-3 print:col-span-1" : ""}`}
			data-testid={props.testId}
		>
			<header className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 id={headingId} className="text-base font-semibold">
						{props.title}
					</h3>
					{props.subtitle ? (
						<p className="text-sm text-ink-muted">{props.subtitle}</p>
					) : null}
				</div>
				<CardMarkers
					provisional={props.provisional === true || isProvisional(metrics)}
					verification={props.verification}
					stale={props.stale === true}
					busy={props.busy === true}
				/>
			</header>
			<Headline
				value={props.headline.value}
				kind={props.headline.kind}
				formatters={props.formatters}
				{...(props.headline.caption ? { caption: props.headline.caption } : {})}
			/>
			{props.notice ? <Notice notice={props.notice} /> : null}
			<ComparisonChips chips={props.chips} formatters={props.formatters} />
			{props.decomposition ? (
				<p className="text-sm text-ink-muted" data-testid="decomposition">
					{props.decomposition.label}
					{props.decomposition.parts.map((part) => (
						<span key={part.label}>
							{" · "}
							{part.label} {part.value}
						</span>
					))}
				</p>
			) : null}
			<p className="text-sm leading-relaxed" data-testid="sentence">
				{props.sentence}
			</p>
			{props.chart ? (
				<LazyChart spec={props.chart} formatters={props.formatters} />
			) : null}
			{props.table ? (
				<DataTable
					table={props.table}
					formatters={props.formatters}
					fileName={props.csvFileName}
				/>
			) : null}
			{props.secondaryTable ? (
				<DataTable
					table={props.secondaryTable}
					formatters={props.formatters}
					fileName={
						props.secondaryCsvFileName ??
						props.csvFileName.replace(/\.csv$/, "-2.csv")
					}
				/>
			) : null}
			<MetricExplainer metrics={metrics} />
		</article>
	);
}
