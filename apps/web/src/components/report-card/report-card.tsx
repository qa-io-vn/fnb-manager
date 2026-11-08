import { useId } from "react";
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
	chart?: ChartSpec;
	table: TableSpec;
	csvFileName: string;
	verification: VerificationMarker;
	formatters: Formatters;
	testId?: string;
}

export function isProvisional(metrics: readonly MetricDefinition[]): boolean {
	return metrics.some((metric) => metric.missingKey !== undefined);
}

export function ReportCard(props: ReportCardProps) {
	const headingId = useId();
	const metrics = [props.metric, ...(props.relatedMetrics ?? [])];
	return (
		<article
			aria-labelledby={headingId}
			className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-raised p-4 shadow-sm print:shadow-none"
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
					provisional={isProvisional(metrics)}
					verification={props.verification}
				/>
			</header>
			<Headline
				value={props.headline.value}
				kind={props.headline.kind}
				formatters={props.formatters}
				{...(props.headline.caption ? { caption: props.headline.caption } : {})}
			/>
			<ComparisonChips chips={props.chips} formatters={props.formatters} />
			<p className="text-sm leading-relaxed" data-testid="sentence">
				{props.sentence}
			</p>
			{props.chart ? (
				<LazyChart spec={props.chart} formatters={props.formatters} />
			) : null}
			<DataTable
				table={props.table}
				formatters={props.formatters}
				fileName={props.csvFileName}
			/>
			<MetricExplainer metrics={metrics} />
		</article>
	);
}
