import { ReportCard } from "../../components/report-card/report-card";
import { useT } from "../../i18n";
import { metricRegistry } from "../../metrics/registry";
import {
	hourlySentence,
	itemsSentence,
	paymentsSentence,
	peakHourOf,
} from "../../metrics/sentences";
import type { ItemSummary, PaymentSplit } from "../../metrics/today";
import {
	hourLabel,
	hourlyChart,
	hourlyTable,
	itemsTable,
	kindLabelOf,
	paymentsTable,
	renderSentence,
} from "./card-builders";
import type { DayContext } from "./day-metric-card";

export function HourlyCard({ context }: { context: DayContext }) {
	const t = useT();
	const peak = peakHourOf(context.day);
	return (
		<ReportCard
			title={t("today.hourly.title")}
			metric={metricRegistry.hourly_net}
			headline={{
				value: peak ? peak.current : null,
				kind: "money",
				...(peak
					? {
							caption: t("today.hourly.peakAt", { hour: hourLabel(peak.hour) }),
						}
					: {}),
			}}
			chips={[]}
			sentence={renderSentence(
				t,
				hourlySentence(context.day, context.formatters),
			)}
			chart={hourlyChart(context.day, t)}
			table={hourlyTable(context.day, t)}
			csvFileName={`hourly_net-${context.fileSuffix}.csv`}
			verification={context.verification}
			formatters={context.formatters}
			testId="card-today-hourly"
		/>
	);
}

export function TopItemsCard({
	items,
	context,
}: {
	items: readonly ItemSummary[];
	context: DayContext;
}) {
	const t = useT();
	const leader = items[0];
	return (
		<ReportCard
			title={t("today.items.title")}
			metric={metricRegistry.item_net}
			headline={{
				value: leader ? leader.net : null,
				kind: "money",
				...(leader ? { caption: leader.name } : {}),
			}}
			chips={[]}
			sentence={renderSentence(t, itemsSentence(items, context.formatters))}
			table={itemsTable(items, t)}
			csvFileName={`top_items-${context.fileSuffix}.csv`}
			verification={context.verification}
			formatters={context.formatters}
			testId="card-today-items"
		/>
	);
}

export function PaymentsCard({
	split,
	context,
}: {
	split: PaymentSplit;
	context: DayContext;
}) {
	const t = useT();
	return (
		<ReportCard
			title={t("today.payments.title")}
			metric={metricRegistry.cash_to_count}
			headline={{
				value: split.total === 0 ? null : split.cashToCount,
				kind: "money",
				caption: t("today.cashToCount"),
			}}
			chips={[]}
			sentence={renderSentence(
				t,
				paymentsSentence(split, kindLabelOf(t), context.formatters),
			)}
			table={paymentsTable(split, t)}
			csvFileName={`payments-${context.fileSuffix}.csv`}
			verification={context.verification}
			formatters={context.formatters}
			testId="card-today-payments"
		/>
	);
}
