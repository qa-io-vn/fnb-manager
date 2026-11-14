import { type ReactNode, useId } from "react";
import type { VerificationMarker } from "../../components/report-card/types";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import type { Formatters } from "../../lib/format";
import type { DayReport } from "../../metrics/today";
import { PageHeading } from "../../shell/page-heading";
import { StatusMessage } from "../../shell/scope-status";
import { VerifiedBadge } from "../../shell/verified-badge";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { type DayContext, DayMetricCard } from "./day-metric-card";
import { HourlyCard, PaymentsCard, TopItemsCard } from "./today-detail-cards";
import { type TodayData, useTodayReport } from "./use-today-report";

function DaySection({
	title,
	context,
	children,
}: {
	title: string;
	context: DayContext;
	children?: ReactNode;
}) {
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="space-y-3"
			data-testid={`section-${context.day.focus}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id={headingId} className="text-lg font-semibold">
					{title}
				</h2>
				<VerifiedBadge state={context.verification} />
			</div>
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-1">
				<DayMetricCard metric="net_revenue" context={context} />
				<DayMetricCard metric="invoices" context={context} />
				<DayMetricCard metric="avg_ticket" context={context} />
				{children}
			</div>
		</section>
	);
}

function dayHeading(formatters: Formatters, day: DayReport): string {
	return day.date === null
		? ""
		: `${formatters.weekday(day.date)}, ${formatters.date(day.date)}`;
}

function TodayContent({
	data,
	formatters,
}: {
	data: TodayData;
	formatters: Formatters;
}) {
	const t = useT();
	const { report, now } = data;
	const time = formatters.time(now);
	const contextOf = (
		day: DayReport,
		verification: VerificationMarker,
		dayLabel: string,
		comparisonLabel: string,
	): DayContext => ({
		day,
		dayLabel,
		comparisonLabel,
		verification,
		formatters,
		fileSuffix: day.date ?? "",
	});
	const today = contextOf(
		report.today,
		data.verification.today,
		t("today.sentenceDay.today", { time }),
		t("compare.vsBaselineToTime", { time }),
	);
	const yesterday = contextOf(
		report.yesterday,
		data.verification.yesterday,
		t("today.sentenceDay.yesterday"),
		t("compare.vsBaseline"),
	);
	return (
		<div className="space-y-8">
			<DaySection
				title={t("today.section.today", {
					time,
					date: dayHeading(formatters, report.today),
				})}
				context={today}
			>
				<HourlyCard context={today} />
				<TopItemsCard items={report.topItems} context={today} />
				<PaymentsCard split={report.payments} context={today} />
			</DaySection>
			<DaySection
				title={t("today.section.yesterday", {
					date: dayHeading(formatters, report.yesterday),
				})}
				context={yesterday}
			/>
		</div>
	);
}

export function TodayPage() {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const query = useTodayReport(
		scope.source,
		scope.tenant,
		scope.selectedStores,
	);
	return (
		<div className="space-y-4">
			<PageHeading
				title={t("today.title")}
				className="text-2xl font-semibold"
			/>
			{scope.selectedStores.length === 0 ? (
				<StatusMessage>
					<p>{t("today.noStores")}</p>
				</StatusMessage>
			) : query.isError ? (
				<StatusMessage>
					<p role="alert" className="mb-3">
						{t("app.error")}
					</p>
					<Button type="button" onClick={() => void query.refetch()}>
						{t("app.retry")}
					</Button>
				</StatusMessage>
			) : query.data ? (
				<TodayContent data={query.data} formatters={formatters} />
			) : (
				<StatusMessage>
					<p role="status">{t("app.loading")}</p>
				</StatusMessage>
			)}
		</div>
	);
}
