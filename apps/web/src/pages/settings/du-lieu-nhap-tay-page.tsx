import type { ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type MessageKey, useT } from "../../i18n";
import { FeesTab } from "../../settings/fees/fees-tab";
import { CostsTab } from "../../settings/manual/costs-tab";
import { TargetsTab } from "../../settings/manual/targets-tab";
import { useReadyTenantScope } from "../../state/tenant-scope";

export const MANUAL_TABS = [
	{ slug: "gia-von", titleKey: "settings.manual.tab.costs" },
	{ slug: "muc-tieu", titleKey: "settings.manual.tab.targets" },
	{ slug: "phi", titleKey: "settings.manual.tab.fees" },
] as const satisfies readonly {
	slug: string;
	titleKey: MessageKey;
}[];

type ManualTab = (typeof MANUAL_TABS)[number];

type ManualSlug = ManualTab["slug"];

const DEFAULT_TAB = MANUAL_TABS[0];

export function manualTabOf(slug: string | null): ManualTab {
	return MANUAL_TABS.find((tab) => tab.slug === slug) ?? DEFAULT_TAB;
}

function ManualTabs({ current }: { readonly current: ManualTab }) {
	const t = useT();
	return (
		<nav aria-label={t("settings.manual.tabs.label")} data-testid="manual-tabs">
			<ul className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-raised p-1">
				{MANUAL_TABS.map((tab) => (
					<li key={tab.slug} className="shrink-0">
						<Link
							to={`?tab=${tab.slug}`}
							aria-current={tab.slug === current.slug ? "page" : undefined}
							className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
						>
							{t(tab.titleKey)}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

const TAB_SECTIONS: Readonly<Record<ManualSlug, ComponentType>> = {
	"gia-von": CostsTab,
	"muc-tieu": TargetsTab,
	phi: FeesTab,
};

export default function DuLieuNhapTayPage() {
	const { tenant } = useReadyTenantScope();
	const [search] = useSearchParams();
	const tab = manualTabOf(search.get("tab"));
	const Section = TAB_SECTIONS[tab.slug];
	return (
		<div className="space-y-4" data-testid="manual-page">
			<ManualTabs current={tab} />
			<Section key={`${tenant.id}-${tab.slug}`} />
		</div>
	);
}
