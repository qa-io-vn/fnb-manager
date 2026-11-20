import { type ReactNode, useId } from "react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import {
	BILL_FLAG_KEYS,
	billAnomalySummary,
	flagChips,
	flagsInRows,
	isKnownFlag,
	levelTwoShare,
	OTHER_FLAG_KEYS,
	sortedBillAnomalies,
	staffModeStoreIds,
} from "../../loyalty/bill-anomalies";
import { storeName } from "../../loyalty/models";
import type { BillAnomalyRow } from "../../loyalty/source";
import type { AnomalyLocation } from "../../loyalty/use-anomaly-location";
import {
	useBillAnomalies,
	useLoyaltyStoreSettings,
} from "../../settings/queries";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

export const CONFIRMATION_SETTINGS_HREF =
	"/cai-dat/khach-hang-than-thiet?tab=xac-nhan";

function Failed({ onRetry }: { readonly onRetry: () => void }) {
	const t = useT();
	return (
		<div role="alert" className="space-y-2" data-testid="bill-anomalies-failed">
			<p className="text-sm">{t("report.card.error")}</p>
			<Button tone="secondary" size="compact" onClick={onRetry}>
				{t("app.retry")}
			</Button>
		</div>
	);
}

function Loading() {
	const t = useT();
	return (
		<p role="status" className="text-sm text-ink-muted">
			{t("app.loading")}
		</p>
	);
}

function FlagList({ flags }: { readonly flags: readonly string[] }) {
	const t = useT();
	const chips = flagChips(flags);
	if (chips.length === 0) {
		return (
			<span className="text-ink-muted">
				{t("loyalty.billAnomalies.flags.none")}
			</span>
		);
	}
	return (
		<ul className="flex flex-wrap gap-1">
			{chips.map((chip) => (
				<li
					key={chip.flag}
					className="whitespace-nowrap rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-xs font-medium"
					data-testid="bill-anomaly-flag"
					data-flag={chip.flag}
				>
					{t(chip.labelKey, { flag: chip.flag })}
				</li>
			))}
		</ul>
	);
}

function AnomalyTable({
	rows,
	location,
}: {
	readonly rows: readonly BillAnomalyRow[];
	readonly location: AnomalyLocation;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const header = (key: Parameters<typeof t>[0], numeric = false) => (
		<th
			scope="col"
			className={`px-2 py-2 font-medium ${numeric ? "text-end" : "text-start"}`}
		>
			{t(key)}
		</th>
	);
	const count = (value: number) => (
		<td className="px-2 py-2 text-end tabular-nums">
			{formatters.count(value)}
		</td>
	);
	return (
		<section
			aria-label={t("loyalty.billAnomalies.caption")}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus
			tabIndex={0}
			className="overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
			data-testid="bill-anomalies-scroll"
		>
			<table className="w-full min-w-[48rem] text-sm">
				<caption className="sr-only">
					{t("loyalty.billAnomalies.caption")}
				</caption>
				<thead className="border-b border-line text-ink-muted">
					<tr>
						{header("loyalty.billAnomalies.column.store")}
						{header("loyalty.billAnomalies.column.date")}
						{header("loyalty.billAnomalies.column.staff")}
						{header("loyalty.billAnomalies.column.bills", true)}
						{header("loyalty.billAnomalies.column.level2", true)}
						{header("loyalty.billAnomalies.column.disagreements", true)}
						{header("loyalty.billAnomalies.column.disputes", true)}
						{header("loyalty.billAnomalies.column.reversals", true)}
						{header("loyalty.billAnomalies.column.audits", true)}
						{header("loyalty.billAnomalies.column.flags")}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const share = levelTwoShare(row);
						return (
							<tr
								key={`${row.storeId}|${row.businessDate}|${row.staffUserId ?? ""}`}
								className="border-b border-line align-top"
								data-testid="bill-anomaly-row"
								data-flagged={row.flags.length > 0 ? "true" : undefined}
							>
								<td className="px-2 py-2">
									{storeName(t, location.stores, row.storeId)}
								</td>
								<td className="whitespace-nowrap px-2 py-2">
									{formatters.date(row.businessDate)}
								</td>
								<td className="px-2 py-2" data-testid="bill-anomaly-staff">
									{row.staffName ?? t("loyalty.billAnomalies.staff.none")}
								</td>
								{count(row.bills)}
								<td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
									{share === null
										? "—"
										: t("loyalty.billAnomalies.level2Share", {
												share: formatters.percent(share),
												count: formatters.count(row.level2),
												bills: formatters.count(row.bills),
											})}
								</td>
								{count(row.disagreements)}
								{count(row.disputes)}
								{count(row.reversals)}
								{count(row.auditsFailed)}
								<td className="px-2 py-2">
									<FlagList flags={row.flags} />
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</section>
	);
}

function FlagLegend({ flags }: { readonly flags: readonly string[] }) {
	const t = useT();
	const ids = useId();
	if (flags.length === 0) return null;
	return (
		<section aria-labelledby={`${ids}-legend`} className="space-y-1">
			<h3 id={`${ids}-legend`} className="text-sm font-semibold">
				{t("loyalty.billAnomalies.legend")}
			</h3>
			<dl className="space-y-1 text-sm" data-testid="bill-anomaly-legend">
				{flags.map((flag) => {
					const words = isKnownFlag(flag)
						? BILL_FLAG_KEYS[flag]
						: OTHER_FLAG_KEYS;
					return (
						<div key={flag} className="flex flex-wrap gap-x-2">
							<dt className="font-medium">{t(words.labelKey, { flag })}</dt>
							<dd className="text-ink-muted">{t(words.explainKey)}</dd>
						</div>
					);
				})}
			</dl>
		</section>
	);
}

function Report({
	staffStoreIds,
	location,
}: {
	readonly staffStoreIds: readonly string[];
	readonly location: AnomalyLocation;
}) {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const { from, to } = location.range;
	const report = useBillAnomalies(staffStoreIds, from, to, !location.invalid);
	if (report.status === "error") {
		return <Failed onRetry={() => void report.refetch()} />;
	}
	if (report.data === undefined) return <Loading />;
	const rows = sortedBillAnomalies(report.data);
	if (rows.length === 0) {
		return (
			<p className="text-sm" data-testid="bill-anomalies-empty">
				{t("loyalty.billAnomalies.empty")}
			</p>
		);
	}
	const summary = billAnomalySummary(rows);
	return (
		<>
			<p className="text-sm" data-testid="bill-anomalies-summary">
				{t("loyalty.billAnomalies.summary", {
					rows: formatters.count(summary.rows),
					flagged: formatters.count(summary.flagged),
					bills: formatters.count(summary.bills),
				})}
			</p>
			<AnomalyTable rows={rows} location={location} />
			<FlagLegend flags={flagsInRows(rows)} />
		</>
	);
}

/**
 * bill_anomaly_report for the chosen stores that confirm at the counter:
 * owners and managers only, like the function itself.
 */
export function StaffAnomalies({
	location,
	canRead,
}: {
	readonly location: AnomalyLocation;
	readonly canRead: boolean;
}) {
	const t = useT();
	const ids = useId();
	const storeIds = location.stores.map((store) => store.id);
	const settings = useLoyaltyStoreSettings(storeIds, canRead);
	let body: ReactNode;
	if (!canRead) {
		body = (
			<p className="text-sm" data-testid="bill-anomalies-read-only">
				{t("loyalty.billAnomalies.readOnly")}
			</p>
		);
	} else if (settings.status === "error") {
		body = <Failed onRetry={() => void settings.refetch()} />;
	} else if (settings.data === undefined) {
		body = <Loading />;
	} else {
		const staffStoreIds = staffModeStoreIds(storeIds, settings.data);
		body =
			staffStoreIds.length === 0 ? (
				<div className="space-y-1" data-testid="bill-anomalies-no-staff-stores">
					<p className="text-sm">{t("loyalty.billAnomalies.noStaffStores")}</p>
					<p className="text-sm">
						<TextLink to={CONFIRMATION_SETTINGS_HREF}>
							{t("loyalty.billAnomalies.settingsLink")}
						</TextLink>
					</p>
				</div>
			) : (
				<Report staffStoreIds={staffStoreIds} location={location} />
			);
	}
	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="bill-anomalies"
		>
			<h2 id={`${ids}-heading`} className="text-base font-semibold">
				{t("loyalty.billAnomalies.title")}
			</h2>
			<p className="text-sm text-ink-muted">
				{t("loyalty.billAnomalies.intro")}
			</p>
			{body}
		</section>
	);
}
