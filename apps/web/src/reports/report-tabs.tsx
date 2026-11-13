import {
	REPORT_KINDS,
	type ReportKind,
	type ReportPeriod,
	switchKind,
} from "@fnb/reports";
import { Link } from "react-router-dom";
import { type MessageKey, useT } from "../i18n";

const tabLabels: Record<ReportKind, MessageKey> = {
	day: "report.tabs.day",
	week: "report.tabs.week",
	month: "report.tabs.month",
	year: "report.tabs.year",
};

export function ReportTabs({
	kind,
	period,
	hrefFor,
}: {
	kind: ReportKind;
	period: ReportPeriod;
	hrefFor: (kind: ReportKind, period: Pick<ReportPeriod, "key">) => string;
}) {
	const t = useT();
	return (
		<nav
			aria-label={t("report.tabs.label")}
			className="print:hidden"
			data-testid="report-tabs"
		>
			<ul className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-raised p-1">
				{REPORT_KINDS.map((tab) => (
					<li key={tab}>
						<Link
							to={hrefFor(tab, switchKind(period, tab))}
							aria-current={tab === kind ? "page" : undefined}
							className="flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
						>
							{t(tabLabels[tab])}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}
