import { ReportCard } from "../../components/report-card/report-card";
import type { VerificationMarker } from "../../components/report-card/types";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import { metricRegistry } from "../../metrics/registry";
import { type DayMetric, daySentence } from "../../metrics/sentences";
import type { DayReport } from "../../metrics/today";
import {
	baselineChip,
	dayMetricAccess,
	renderSentence,
	storeNetChart,
	storeTable,
} from "./card-builders";

export interface DayContext {
	day: DayReport;
	dayLabel: string;
	comparisonLabel: string;
	verification: VerificationMarker;
	formatters: Formatters;
	fileSuffix: string;
}

export function DayMetricCard({
	metric,
	context,
}: {
	metric: DayMetric;
	context: DayContext;
}) {
	const t = useT();
	const definition = metricRegistry[metric];
	const access = dayMetricAccess[metric];
	const current =
		context.day.totals.invoices === 0
			? null
			: access.current(context.day.totals);
	const baseline = access.baseline(context.day.baseline);
	const title = t(definition.labelKey);
	return (
		<ReportCard
			title={title}
			metric={definition}
			relatedMetrics={[metricRegistry.same_weekday_baseline]}
			headline={{ value: current, kind: access.kind }}
			chips={[
				baselineChip(
					metric,
					current,
					baseline,
					context.comparisonLabel,
					t("compare.noBaseline"),
				),
			]}
			sentence={renderSentence(
				t,
				daySentence(metric, context.day, context.dayLabel, context.formatters),
			)}
			{...(metric === "net_revenue" && context.day.stores.length > 1
				? { chart: storeNetChart(context.day, t) }
				: {})}
			table={storeTable(metric, context.day, t, title)}
			csvFileName={`${metric}-${context.fileSuffix}.csv`}
			verification={context.verification}
			formatters={context.formatters}
			testId={`card-${context.day.focus}-${metric}`}
		/>
	);
}
