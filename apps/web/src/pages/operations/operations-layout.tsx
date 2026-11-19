import { themeKeys } from "@fnb/reports";
import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { type MessageKey, useT } from "../../i18n";
import type { OperationsPage } from "../../operations/operations-route";
import { OPERATIONS_MAX_DAYS } from "../../operations/operations-route";
import { useOperationsSource } from "../../operations/queries";
import {
	type OperationsLocation,
	useOperationsLocation,
} from "../../operations/use-operations-location";
import { staffPageAccess } from "../../settings/access";
import { useMembership } from "../../settings/queries";
import { ReadOnlyNotice } from "../../settings/read-only-notice";
import { useRetrySettingsSource } from "../../settings/settings-source-context";
import { PageHeading } from "../../shell/page-heading";
import { StatusMessage } from "../../shell/scope-status";
import { storeSelectionLabel } from "../../shell/store-select";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { RangePicker } from "../../themes/range-picker";

const TABS: readonly {
	readonly page: OperationsPage;
	readonly key: MessageKey;
}[] = [
	{ page: "checklist", key: "operations.tab.checklist" },
	{ page: "ket-tien", key: "operations.tab.cash" },
	{ page: "su-co", key: "operations.tab.log" },
];

export const TAB_KEYS: Readonly<Record<OperationsPage, MessageKey>> = {
	checklist: "operations.tab.checklist",
	"ket-tien": "operations.tab.cash",
	"su-co": "operations.tab.log",
};

function OperationsTabs({
	current,
	hrefFor,
}: {
	readonly current: OperationsPage;
	readonly hrefFor: (page: OperationsPage) => string;
}) {
	const t = useT();
	const active = useRef<HTMLAnchorElement | null>(null);
	useEffect(() => {
		active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, []);
	return (
		<nav
			aria-label={t("operations.tabs")}
			className="print:hidden"
			data-testid="operations-tabs"
		>
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{TABS.map((tab) => {
					const isCurrent = tab.page === current;
					return (
						<li key={tab.page} className="shrink-0">
							<Link
								ref={isCurrent ? active : undefined}
								to={hrefFor(tab.page)}
								aria-current={isCurrent ? "page" : undefined}
								className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
							>
								{t(tab.key)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

function Notice({ testId, children }: { testId: string; children: string }) {
	return (
		<p
			role="note"
			className="rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm"
			data-testid={testId}
		>
			{children}
		</p>
	);
}

function PrintSummary({ location }: { readonly location: OperationsLocation }) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	return (
		<p className="hidden text-sm print:block" data-testid="print-summary">
			{t("operations.print", {
				page: t(TAB_KEYS[location.page]),
				range: t(themeKeys.range.span, {
					from: formatters.date(location.range.from),
					to: formatters.date(location.range.to),
				}),
				stores: storeSelectionLabel(scope.stores, location.stores, t),
				date: formatters.date(location.range.asOf),
			})}
		</p>
	);
}

export function OperationsLayout({
	page,
	children,
}: {
	readonly page: OperationsPage;
	readonly children: (location: OperationsLocation) => ReactNode;
}) {
	const t = useT();
	const scope = useReadyTenantScope();
	const formatters = useFormatters(scope.tenant);
	const location = useOperationsLocation(page);
	const operations = useOperationsSource();
	const membership = useMembership();
	const retrySource = useRetrySettingsSource();
	const member = membership.status === "success" ? membership.data : undefined;
	const access =
		membership.status === "error"
			? { canWrite: false, reason: "unavailable" as const }
			: staffPageAccess(member);
	return (
		<div className="space-y-4" data-testid="operations-page" data-page={page}>
			<PageHeading
				title={`${t("operations.title")} · ${t(TAB_KEYS[page])}`}
				className="text-2xl font-semibold"
			/>
			<OperationsTabs current={page} hrefFor={location.hrefFor} />
			{operations.status === "unavailable" ? (
				<Notice testId="operations-demo">{t("operations.demo")}</Notice>
			) : operations.status === "failed" ? (
				<StatusMessage>
					<p role="alert" className="mb-3">
						{t("app.error")}
					</p>
					<Button type="button" onClick={retrySource}>
						{t("app.retry")}
					</Button>
				</StatusMessage>
			) : (
				<>
					<p className="text-sm text-ink-muted print:hidden">
						{t("operations.intro")}
					</p>
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
						<Notice testId="range-invalid">
							{t(themeKeys.page.invalidRange)}
						</Notice>
					) : null}
					<ReadOnlyNotice
						access={access}
						messages={{ role: "operations.readOnly.role" }}
						testId="operations-read-only"
					/>
					{!access.canWrite ? null : location.stores.length === 0 ? (
						<StatusMessage>
							<p>{t(themeKeys.page.noStores)}</p>
						</StatusMessage>
					) : operations.status === "loading" ? (
						<p role="status">{t("app.loading")}</p>
					) : (
						<>
							<PrintSummary location={location} />
							{children(location)}
						</>
					)}
				</>
			)}
		</div>
	);
}
