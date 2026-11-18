import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { useMembership } from "../../settings/queries";
import type { Membership } from "../../settings/source";
import { PageHeading } from "../../shell/page-heading";
import { ExportTab } from "./export-tab";
import { PackTab } from "./pack-tab";
import { EXPORT_TAB_PATH, PACK_TAB_PATH } from "./paths";

export type ExportsTab = "goi" | "xuat";

export function tabOf(value: string | null): ExportsTab {
	return value === "xuat" ? "xuat" : "goi";
}

export function canExport(membership: Membership | null): boolean {
	return membership?.role === "owner" || membership?.role === "manager";
}

export function canIncludePersonal(membership: Membership | null): boolean {
	return canExport(membership) && membership?.storeIds === null;
}

function ExportsTabs({ current }: { current: ExportsTab }) {
	const t = useT();
	const tabs: readonly { id: ExportsTab; to: string; label: string }[] = [
		{ id: "goi", to: PACK_TAB_PATH, label: t("exports.tabs.pack") },
		{ id: "xuat", to: EXPORT_TAB_PATH, label: t("exports.tabs.export") },
	];
	return (
		<nav aria-label={t("exports.tabs.label")} data-testid="exports-tabs">
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{tabs.map((tab) => (
					<li key={tab.id} className="shrink-0">
						<Link
							to={tab.to}
							aria-current={tab.id === current ? "page" : undefined}
							className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
						>
							{tab.label}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

function AccessGate({
	children,
}: {
	children: (membership: Membership) => ReactNode;
}) {
	const t = useT();
	const membership = useMembership();
	if (membership.status === "pending") {
		return <p role="status">{t("exports.gate.loading")}</p>;
	}
	if (membership.status === "error") {
		return (
			<div className="space-y-3" data-testid="exports-gate-failed">
				<p role="alert">{t("exports.gate.failed")}</p>
				<Button tone="secondary" onClick={() => void membership.refetch()}>
					{t("exports.gate.retry")}
				</Button>
			</div>
		);
	}
	const data = membership.data ?? null;
	if (data?.role === "publisher") return null;
	if (data === null || !canExport(data)) {
		return (
			<p
				className="rounded-xl border border-line bg-surface-raised p-5"
				data-testid="exports-denied"
			>
				{t("exports.gate.denied")}
			</p>
		);
	}
	return <>{children(data)}</>;
}

export function ExportsPage() {
	const t = useT();
	const [params] = useSearchParams();
	const tab = tabOf(params.get("tab"));
	const tabTitle =
		tab === "goi" ? t("exports.tabs.pack") : t("exports.tabs.export");
	return (
		<div className="space-y-4" data-testid="exports-page">
			<PageHeading
				title={t("exports.title")}
				className="text-2xl font-semibold"
			/>
			<AccessGate>
				{(membership) => (
					<>
						<ExportsTabs current={tab} />
						<section aria-labelledby="exports-tab-title" className="space-y-4">
							<h2 id="exports-tab-title" className="text-xl font-semibold">
								{tabTitle}
							</h2>
							{tab === "goi" ? (
								<PackTab />
							) : (
								<ExportTab personalAllowed={canIncludePersonal(membership)} />
							)}
						</section>
					</>
				)}
			</AccessGate>
		</div>
	);
}
