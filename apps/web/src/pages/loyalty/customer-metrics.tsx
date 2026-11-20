import { useMemo } from "react";
import { type MessageKey, useT } from "../../i18n";
import { addDays, todayIn } from "../../lib/business-dates";
import {
	useCohortRetention,
	useCustomerMetrics,
	useRfmSegments,
} from "../../loyalty/queries";
import type {
	CohortRetentionRow,
	CustomerMetrics,
	RfmSegment,
	RfmSegmentRow,
} from "../../loyalty/source";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

const WINDOW_DAYS = 30;
const COHORT_MONTHS = 6;

const SEGMENT_KEYS: Readonly<Record<RfmSegment, MessageKey>> = {
	champions: "loyalty.metrics.segment.champions",
	loyal: "loyalty.metrics.segment.loyal",
	new: "loyalty.metrics.segment.new",
	promising: "loyalty.metrics.segment.promising",
	at_risk: "loyalty.metrics.segment.at_risk",
	hibernating: "loyalty.metrics.segment.hibernating",
	lost: "loyalty.metrics.segment.lost",
};

function Card({
	id,
	label,
	value,
	note,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly note?: string | null;
}) {
	return (
		<div
			className="space-y-1 rounded-lg border border-line bg-surface p-3"
			data-testid="customer-metric"
			data-metric={id}
		>
			<p className="text-sm text-ink-muted">{label}</p>
			<p
				className="text-xl font-semibold tabular-nums"
				data-testid="customer-metric-value"
			>
				{value}
			</p>
			{note ? <p className="text-xs text-ink-muted">{note}</p> : null}
		</div>
	);
}

function Cards({ metrics }: { readonly metrics: CustomerMetrics }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const f = useFormatters(tenant);
	const missing = t("loyalty.metrics.notMeasured");
	const percent = (value: number | null) =>
		value === null ? missing : f.percent(value);
	const decimal = (value: number | null) =>
		value === null ? missing : f.decimalExact(value);
	const money = (value: number | null) =>
		value === null ? missing : f.moneyExact(value);
	return (
		<div
			className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
			data-testid="customer-metric-cards"
		>
			<Card
				id="customer_capture_rate"
				label={t("loyalty.metrics.capture")}
				value={percent(metrics.captureRate)}
				note={t("loyalty.metrics.captureNote", {
					identified: f.count(metrics.identifiedInvoices),
					total: f.count(metrics.invoices),
				})}
			/>
			<Card
				id="repeat_rate"
				label={t("loyalty.metrics.repeat")}
				value={percent(metrics.repeatRate)}
				note={t("loyalty.metrics.repeatNote", {
					repeat: f.count(metrics.repeatCustomers),
					customers: f.count(metrics.customers),
				})}
			/>
			<Card
				id="visit_frequency_30d"
				label={t("loyalty.metrics.frequency30")}
				value={decimal(metrics.visitFrequency30d)}
				note={t("loyalty.metrics.frequencyNote", {
					customers: f.count(metrics.activeCustomers30d),
				})}
			/>
			<Card
				id="visit_frequency_90d"
				label={t("loyalty.metrics.frequency90")}
				value={decimal(metrics.visitFrequency90d)}
				note={t("loyalty.metrics.frequencyNote", {
					customers: f.count(metrics.activeCustomers90d),
				})}
			/>
			<Card
				id="loyalty_liability"
				label={t("loyalty.metrics.liability")}
				value={money(metrics.liability)}
				note={
					metrics.outstandingPoints === null
						? null
						: t("loyalty.metrics.liabilityNote", {
								points: f.count(metrics.outstandingPoints),
							})
				}
			/>
			<Card
				id="breakage_rate"
				label={t("loyalty.metrics.breakage")}
				value={percent(metrics.breakageRate)}
			/>
			<Card
				id="reward_cost_rate"
				label={t("loyalty.metrics.rewardCost")}
				value={percent(metrics.rewardCostRate)}
				note={
					metrics.rewardsRedeemedValue === null
						? null
						: t("loyalty.metrics.rewardCostNote", {
								value: f.moneyExact(metrics.rewardsRedeemedValue),
							})
				}
			/>
			<Card
				id="member_frequency_uplift"
				label={t("loyalty.metrics.uplift")}
				value={
					metrics.uplift === null ? missing : f.signedPercent(metrics.uplift)
				}
				note={t("loyalty.metrics.upliftNote", {
					members: f.count(metrics.memberCustomers),
					others: f.count(metrics.comparisonCustomers),
				})}
			/>
		</div>
	);
}

function Segments({ rows }: { readonly rows: readonly RfmSegmentRow[] }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const f = useFormatters(tenant);
	if (rows.length === 0) {
		return (
			<p className="text-sm text-ink-muted" data-testid="customer-rfm-none">
				{t("loyalty.metrics.rfmNone")}
			</p>
		);
	}
	return (
		<ul
			className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
			data-testid="customer-rfm"
		>
			{rows.map((row) => (
				<li
					key={row.segment}
					className="flex items-baseline justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm"
					data-segment={row.segment}
				>
					<span>{t(SEGMENT_KEYS[row.segment])}</span>
					<span className="tabular-nums">
						{f.count(row.customers)} · {f.percent(row.share)}
					</span>
				</li>
			))}
		</ul>
	);
}

function Cohorts({ rows }: { readonly rows: readonly CohortRetentionRow[] }) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const f = useFormatters(tenant);
	if (rows.length === 0) return null;
	const months = [...new Set(rows.map((row) => row.cohortMonth))];
	return (
		<ul className="space-y-2" data-testid="customer-cohorts">
			{months.map((month) => {
				const cells = rows
					.filter((row) => row.cohortMonth === month)
					.sort((left, right) => left.monthOffset - right.monthOffset);
				return (
					<li
						key={month}
						className="space-y-1 rounded-lg border border-line px-3 py-2 text-sm"
						data-cohort={month}
					>
						<p className="font-medium">
							{t("loyalty.metrics.cohortHeading", {
								month: month.slice(0, 7),
								size: f.count(cells[0]?.cohortSize ?? 0),
							})}
						</p>
						<ul className="flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
							{cells.map((cell) => (
								<li key={cell.monthOffset} className="tabular-nums">
									{t("loyalty.metrics.cohortOffset", {
										offset: cell.monthOffset,
									})}
									{": "}
									{cell.retention === null ? "—" : f.percent(cell.retention)}
								</li>
							))}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}

export function CustomerMetricsSection() {
	const t = useT();
	const { tenant, stores } = useReadyTenantScope();
	const storeIds = useMemo(() => stores.map((store) => store.id), [stores]);
	const today = todayIn(tenant.timeZone, new Date());
	const to = addDays(today, -1);
	const from = addDays(to, -(WINDOW_DAYS - 1));
	const firstMonth = useMemo(() => {
		const [year = "1970", month = "01"] = to.split("-");
		const index = Number(year) * 12 + Number(month) - 1 - (COHORT_MONTHS - 1);
		const y = Math.floor(index / 12);
		const m = (index % 12) + 1;
		return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01` as typeof to;
	}, [to]);
	const metrics = useCustomerMetrics(storeIds, from, to);
	const rfm = useRfmSegments(storeIds, to);
	const cohorts = useCohortRetention(storeIds, firstMonth, COHORT_MONTHS, to);
	return (
		<section
			className="space-y-4 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="loyalty-metrics-slot"
			aria-labelledby="customer-metrics-heading"
		>
			<div className="space-y-1">
				<h2 id="customer-metrics-heading" className="text-base font-semibold">
					{t("loyalty.metrics.title")}
				</h2>
				<p className="text-sm text-ink-muted">
					{t("loyalty.metrics.intro", { days: WINDOW_DAYS })}
				</p>
			</div>
			{metrics.isPending ? (
				<p role="status">{t("app.loading")}</p>
			) : metrics.isError ? (
				<p
					role="alert"
					className="text-negative"
					data-testid="customer-metrics-failed"
				>
					{t("loyalty.metrics.failed")}
				</p>
			) : (
				<Cards metrics={metrics.data} />
			)}
			<div className="space-y-2">
				<h3 className="text-sm font-semibold">
					{t("loyalty.metrics.rfmTitle")}
				</h3>
				{rfm.isPending ? (
					<p role="status">{t("app.loading")}</p>
				) : rfm.isError ? (
					<p role="alert" className="text-negative">
						{t("loyalty.metrics.failed")}
					</p>
				) : (
					<Segments rows={rfm.data} />
				)}
			</div>
			<div className="space-y-2">
				<h3 className="text-sm font-semibold">
					{t("loyalty.metrics.cohortsTitle")}
				</h3>
				{cohorts.isPending ? (
					<p role="status">{t("app.loading")}</p>
				) : cohorts.isError ? (
					<p role="alert" className="text-negative">
						{t("loyalty.metrics.failed")}
					</p>
				) : (
					<Cohorts rows={cohorts.data} />
				)}
			</div>
			<p className="text-xs text-ink-muted">{t("loyalty.metrics.footnote")}</p>
		</section>
	);
}
