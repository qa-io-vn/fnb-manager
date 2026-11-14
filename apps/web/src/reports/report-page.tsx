import type { ReportDefinition, ReportPeriod } from "@fnb/reports";
import { Button } from "../components/ui/button";
import { TextLink } from "../components/ui/text-link";
import { useT } from "../i18n";
import { PageHeading } from "../shell/page-heading";
import { StatusMessage } from "../shell/scope-status";
import { storeSelectionLabel } from "../shell/store-select";
import { useFormatters } from "../state/formatters";
import { useReadyTenantScope } from "../state/tenant-scope";
import { periodLabel } from "./period-label";
import type { PeriodChangeOptions } from "./period-navigator";
import { PeriodNavigator } from "./period-navigator";
import { ReportCardView } from "./report-card-view";
import { ReportTabs } from "./report-tabs";
import { translateKey } from "./typed-values";
import { useReportLoad } from "./use-report";
import { useReportContext } from "./use-report-context";

function ReportCards({
	definition,
	location,
}: {
	definition: ReportDefinition;
	location: ReturnType<typeof useReportContext>;
}) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const load = useReportLoad(definition, location.context);
	const { context } = location;
	return (
		<>
			{load.failed ? (
				<StatusMessage>
					<p role="alert" className="mb-3">
						{t("app.error")}
					</p>
					<Button type="button" onClick={load.retry}>
						{t("app.retry")}
					</Button>
				</StatusMessage>
			) : null}
			<p className="hidden text-sm print:block" data-testid="print-summary">
				{t("report.print.summary", {
					report: translateKey(t, definition.titleKey),
					period: periodLabel(context.period, t, formatters),
					stores: storeSelectionLabel(
						scope.stores,
						scope.stores.filter((store) =>
							context.stores.some((selected) => selected.id === store.id),
						),
						t,
					),
					date: formatters.date(context.period.end),
				})}
			</p>
			<div
				className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-1"
				data-testid="report-cards"
			>
				{load.cards.map((state) => (
					<ReportCardView
						key={state.id}
						kind={definition.kind}
						state={state}
						formatters={formatters}
					/>
				))}
			</div>
		</>
	);
}

export function ReportPage({ definition }: { definition: ReportDefinition }) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const location = useReportContext(definition.kind);
	const { context, asOf } = location;
	const onPeriod = (period: ReportPeriod, options?: PeriodChangeOptions) =>
		location.goTo(period, options);
	return (
		<div className="space-y-4">
			<PageHeading
				title={translateKey(t, definition.titleKey)}
				className="text-2xl font-semibold"
			/>
			<ReportTabs
				kind={definition.kind}
				period={context.period}
				hrefFor={location.hrefFor}
			/>
			<PeriodNavigator
				period={context.period}
				asOf={asOf}
				formatters={formatters}
				onChange={onPeriod}
			/>
			{location.clampReason === "today" ? (
				<p
					role="note"
					className="flex flex-wrap items-center gap-x-3 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="report-clamped"
				>
					<span>
						{t("report.page.todayClamped", {
							date: formatters.date(context.period.end),
						})}
					</span>
					<TextLink to="/" className="font-semibold print:hidden">
						{t("report.action.today")}
					</TextLink>
				</p>
			) : null}
			{location.clampReason === "notStarted" ? (
				<p
					role="note"
					className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
					data-testid="report-not-started"
				>
					{t("report.page.notStarted", {
						date: formatters.date(context.period.end),
					})}
				</p>
			) : null}
			{context.stores.length === 0 ? (
				<StatusMessage>
					<p>{t("today.noStores")}</p>
				</StatusMessage>
			) : (
				<ReportCards definition={definition} location={location} />
			)}
		</div>
	);
}
