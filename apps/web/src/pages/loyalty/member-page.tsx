import { useId } from "react";
import { Navigate, useParams } from "react-router-dom";
import { DataTable } from "../../components/report-card/data-table";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/ui/text-link";
import { useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import {
	balanceOf,
	ledgerTable,
	loyaltyCsvName,
	MEMBERSHIP_STATUS_KEYS,
	phoneText,
} from "../../loyalty/models";
import { useMember, useMemberLedger } from "../../loyalty/queries";
import { customerHref, isMembershipId } from "../../loyalty/route";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { CustomersLayout, Notice } from "./customers-layout";

function Figure({
	label,
	value,
	testId,
}: {
	readonly label: string;
	readonly value: string;
	readonly testId: string;
}) {
	return (
		<div className="min-w-0 rounded-lg border border-line bg-surface p-3">
			<dt className="text-xs text-ink-muted">{label}</dt>
			<dd className="text-xl font-semibold tabular-nums" data-testid={testId}>
				{value}
			</dd>
		</div>
	);
}

function MemberLedger({ membershipId }: { readonly membershipId: string }) {
	const t = useT();
	const ids = useId();
	const { tenant, stores } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const member = useMember(membershipId);
	const ledger = useMemberLedger(membershipId);
	if (member.status === "error" || ledger.status === "error") {
		return (
			<div
				role="alert"
				className="space-y-2"
				data-testid="loyalty-member-failed"
			>
				<p className="text-sm">{t("report.card.error")}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={() => {
						if (member.status === "error") void member.refetch();
						if (ledger.status === "error") void ledger.refetch();
					}}
				>
					{t("app.retry")}
				</Button>
			</div>
		);
	}
	if (member.data === undefined || ledger.data === undefined) {
		return (
			<p role="status" className="text-sm text-ink-muted">
				{t("app.loading")}
			</p>
		);
	}
	if (member.data === null) {
		return (
			<Notice testId="loyalty-member-missing">
				{t("loyalty.member.missing")}
			</Notice>
		);
	}
	const balance = balanceOf(ledger.data);
	const table = ledgerTable(ledger.data, {
		t,
		formatters,
		timeZone: tenant.timeZone,
		stores,
	});
	return (
		<div className="space-y-4">
			<section
				aria-labelledby={`${ids}-member`}
				className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-member"
			>
				<h2 id={`${ids}-member`} className="text-base font-semibold">
					{t("loyalty.member.heading", {
						phone: phoneText(t, member.data.phone),
					})}
				</h2>
				<p className="text-sm text-ink-muted">
					{t("loyalty.lookup.joined", {
						date: formatters.date(
							todayIn(tenant.timeZone, new Date(member.data.joinedAt)),
						),
						status: t(MEMBERSHIP_STATUS_KEYS[member.data.status]),
					})}
				</p>
				<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					<Figure
						label={t("loyalty.column.stamps")}
						value={formatters.count(balance.stamps)}
						testId="loyalty-balance-stamps"
					/>
					<Figure
						label={t("loyalty.column.points")}
						value={formatters.count(balance.points)}
						testId="loyalty-balance-points"
					/>
					<Figure
						label={t("loyalty.member.pending")}
						value={t("loyalty.member.pendingValue", {
							stamps: formatters.count(balance.pendingStamps),
							points: formatters.count(balance.pendingPoints),
						})}
						testId="loyalty-balance-pending"
					/>
					<Figure
						label={t("loyalty.column.lastVisit")}
						value={
							balance.lastVisit === null
								? "—"
								: formatters.date(balance.lastVisit)
						}
						testId="loyalty-balance-visit"
					/>
				</dl>
			</section>
			<section
				aria-labelledby={`${ids}-ledger`}
				className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-raised p-4"
				data-testid="loyalty-ledger"
			>
				<h2 id={`${ids}-ledger`} className="text-base font-semibold">
					{t("loyalty.ledger.title")}
				</h2>
				<p className="text-sm text-ink-muted">{t("loyalty.ledger.note")}</p>
				<DataTable
					table={table}
					formatters={formatters}
					fileName={loyaltyCsvName(
						"khach-hang",
						"so-diem",
						membershipId.slice(0, 8),
					)}
				/>
			</section>
		</div>
	);
}

export function MemberPage() {
	const t = useT();
	const { membershipId } = useParams();
	if (!isMembershipId(membershipId)) {
		return <Navigate to={customerHref("thanh-vien")} replace />;
	}
	return (
		<CustomersLayout page="thanh-vien" subtitle={t("loyalty.ledger.title")}>
			{() => (
				<div className="space-y-4">
					<p className="text-sm print:hidden">
						<TextLink to={customerHref("thanh-vien")}>
							{t("loyalty.member.back")}
						</TextLink>
					</p>
					<MemberLedger key={membershipId} membershipId={membershipId} />
				</div>
			)}
		</CustomersLayout>
	);
}
