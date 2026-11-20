import { themeKeys } from "@fnb/reports";
import { type ReactNode, useId } from "react";
import { DataTable } from "../../components/report-card/data-table";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import {
	anomalyRows,
	anomalySummary,
	anomalyTable,
	loyaltyCsvName,
} from "../../loyalty/models";
import { useAnomalies } from "../../loyalty/queries";
import {
	type AnomalyLocation,
	useAnomalyLocation,
} from "../../loyalty/use-anomaly-location";
import { OPERATIONS_MAX_DAYS } from "../../operations/operations-route";
import { StatusMessage } from "../../shell/scope-status";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { RangePicker } from "../../themes/range-picker";
import { CustomersLayout, Notice } from "./customers-layout";
import { StaffAnomalies } from "./staff-anomalies";

function AnomalyTable({ location }: { readonly location: AnomalyLocation }) {
	const t = useT();
	const ids = useId();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const storeIds = location.stores.map((store) => store.id);
	const { from, to } = location.range;
	const inputs = useAnomalies(storeIds, from, to);
	let body: ReactNode;
	if (inputs.status === "error") {
		body = (
			<div
				role="alert"
				className="space-y-2"
				data-testid="loyalty-anomalies-failed"
			>
				<p className="text-sm">{t("report.card.error")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => void inputs.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	} else if (inputs.data === undefined) {
		body = (
			<p role="status" className="text-sm text-ink-muted">
				{t("app.loading")}
			</p>
		);
	} else {
		const rows = anomalyRows(inputs.data);
		const summary = anomalySummary(rows);
		body = (
			<>
				<p className="text-sm" data-testid="loyalty-anomalies-summary">
					{rows.length === 0
						? t("loyalty.anomalies.none")
						: t("loyalty.anomalies.sentence", {
								shifts: formatters.count(summary.shifts),
								flagged: formatters.count(summary.flagged),
								earns: formatters.count(summary.earns),
								refusals: formatters.count(summary.refusals),
								adjustments: formatters.count(summary.adjustments),
								checkins: formatters.count(summary.checkinsWithoutInvoice),
							})}
				</p>
				<DataTable
					table={anomalyTable(rows, {
						t,
						formatters,
						timeZone: tenant.timeZone,
						stores: location.stores,
					})}
					formatters={formatters}
					fileName={loyaltyCsvName("khach-hang", "bat-thuong", `${from}_${to}`)}
					wide
				/>
			</>
		);
	}
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="loyalty-anomalies"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("loyalty.anomalies.title")}
			</h2>
			<p className="text-sm text-ink-muted">{t("loyalty.anomalies.intro")}</p>
			{body}
		</section>
	);
}

function AnomalyBody({
	canReadStaff,
	withShifts,
}: {
	readonly canReadStaff: boolean;
	readonly withShifts: boolean;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const location = useAnomalyLocation();
	return (
		<div className="space-y-4">
			<RangePicker
				range={location.range}
				maxDays={OPERATIONS_MAX_DAYS}
				formatters={formatters}
				summaryKey="operations.range.summary"
				onChange={(range, options) => location.goTo(range, options)}
			/>
			{location.rangeClamped ? (
				<Notice testId="range-clamped">
					{t(themeKeys.page.rangeClamped, {
						days: formatters.count(OPERATIONS_MAX_DAYS),
					})}
				</Notice>
			) : null}
			{location.invalid ? (
				<Notice testId="range-invalid">{t(themeKeys.page.invalidRange)}</Notice>
			) : null}
			{location.stores.length === 0 ? (
				<StatusMessage>
					<p>{t(themeKeys.page.noStores)}</p>
				</StatusMessage>
			) : (
				<>
					{withShifts ? <AnomalyTable location={location} /> : null}
					<StaffAnomalies location={location} canRead={canReadStaff} />
				</>
			)}
		</div>
	);
}

export function AnomaliesPage() {
	return (
		<CustomersLayout
			page="bat-thuong"
			withoutCustomerData={(access) => (
				<AnomalyBody canReadStaff={access.canResolve} withShifts={false} />
			)}
		>
			{({ access }) => (
				<AnomalyBody canReadStaff={access.canResolve} withShifts />
			)}
		</CustomersLayout>
	);
}
