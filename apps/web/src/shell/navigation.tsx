import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { MessageKey } from "../i18n";
import { useT } from "../i18n";
import { loyaltyReadAccess } from "../loyalty/access";
import { staffPageAccess } from "../settings/access";
import { useMembership } from "../settings/queries";
import type { Membership } from "../settings/source";
import { useTenantScope } from "../state/tenant-scope";

export interface NavigationItem {
	to: string;
	section: string;
	labelKey: MessageKey;
	icon: string;
}

export const navigationItems: readonly NavigationItem[] = [
	{
		to: "/",
		section: "",
		labelKey: "nav.today",
		icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
	},
	{
		to: "/bao-cao/ngay",
		section: "bao-cao",
		labelKey: "nav.reports",
		icon: "M5 20V10m7 10V4m7 16v-7",
	},
	{
		to: "/chu-de/doanh-thu",
		section: "chu-de",
		labelKey: "nav.topics",
		icon: "M4 6h16M4 12h16M4 18h10",
	},
	{
		to: "/ke-hoach",
		section: "ke-hoach",
		labelKey: "nav.plans",
		icon: "M6 4h12v16H6zM9 9h6M9 13h6M9 17h3",
	},
	{
		to: "/cai-dat/cua-hang",
		section: "cai-dat",
		labelKey: "nav.settings",
		icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3m0 14v3M2 12h3m14 0h3",
	},
];

export interface SecondaryNavigationItem extends NavigationItem {
	opensFor: (membership: Membership) => boolean;
}

// The side rail's second group: sections the bottom bar has no slot for. Each
// entry shows only to the roles that can open the page (the same checks the
// pages make), so nobody is offered a link that ends in a reason.
export const secondaryNavigationItems: readonly SecondaryNavigationItem[] = [
	{
		to: "/khach-hang/thanh-vien",
		section: "khach-hang",
		labelKey: "nav.customers",
		icon: "M16 19v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 4a3 3 0 100 6 3 3 0 000-6zM20 19v-1a3 3 0 00-2-2.8M16 4.2a3 3 0 010 5.6",
		opensFor: (membership) => loyaltyReadAccess(membership).canRead,
	},
	{
		to: "/van-hanh/checklist",
		section: "van-hanh",
		labelKey: "nav.operations",
		icon: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
		opensFor: (membership) => staffPageAccess(membership).canWrite,
	},
];

export function visibleSecondaryItems(
	membership: Membership | null | undefined,
): readonly SecondaryNavigationItem[] {
	if (membership === null || membership === undefined) return [];
	return secondaryNavigationItems.filter((item) => item.opensFor(membership));
}

export function activeSection(pathname: string): string {
	return pathname.split("/").filter(Boolean)[0] ?? "";
}

function NavigationIcon({ path }: { path: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={path} />
		</svg>
	);
}

function useNavigationLinks() {
	const t = useT();
	const { pathname } = useLocation();
	const current = activeSection(pathname);
	return navigationItems.map((item) => ({
		...item,
		label: t(item.labelKey),
		active: item.section === current,
	}));
}

export function BottomNavigation() {
	const t = useT();
	const links = useNavigationLinks();
	return (
		<nav
			aria-label={t("nav.main")}
			className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
			data-testid="bottom-navigation"
		>
			<ul className="mx-auto grid max-w-xl grid-cols-5">
				{links.map((link) => (
					<li key={link.to}>
						<Link
							to={link.to}
							aria-current={link.active ? "page" : undefined}
							className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.7rem] font-medium text-ink-muted aria-[current=page]:text-accent"
						>
							<NavigationIcon path={link.icon} />
							<span className="truncate">{link.label}</span>
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

const WIDE_QUERY = "(min-width: 1024px)";

// The rail is hidden below 1024 px; its role-gated entries read the membership,
// so they are only mounted (and the settings source only loaded) when it shows.
function useRailShown(): boolean {
	const [shown, setShown] = useState(
		() =>
			typeof window.matchMedia === "function" &&
			window.matchMedia(WIDE_QUERY).matches,
	);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia(WIDE_QUERY);
		const update = () => setShown(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return shown;
}

function SecondaryLinks() {
	const t = useT();
	const { pathname } = useLocation();
	const current = activeSection(pathname);
	const membership = useMembership();
	const items = visibleSecondaryItems(
		membership.status === "success" ? membership.data : undefined,
	);
	if (items.length === 0) return null;
	return (
		<ul
			aria-label={t("nav.secondary")}
			className="mt-4 space-y-1 border-t border-line pt-4"
			data-testid="side-rail-secondary"
		>
			{items.map((item) => (
				<li key={item.to}>
					<Link
						to={item.to}
						aria-current={item.section === current ? "page" : undefined}
						className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
					>
						<NavigationIcon path={item.icon} />
						<span>{t(item.labelKey)}</span>
					</Link>
				</li>
			))}
		</ul>
	);
}

function SecondaryNavigation() {
	const scope = useTenantScope();
	const shown = useRailShown();
	if (!shown || scope.status !== "ready") return null;
	return <SecondaryLinks />;
}

export function SideRail() {
	const t = useT();
	const links = useNavigationLinks();
	return (
		<nav
			aria-label={t("nav.main")}
			className="fixed inset-y-0 left-0 z-20 hidden w-52 border-r border-line bg-surface-raised px-3 py-4 lg:block print:hidden"
			data-testid="side-rail"
		>
			<p className="mb-6 px-2 text-lg font-semibold">{t("app.title")}</p>
			<ul className="space-y-1">
				{links.map((link) => (
					<li key={link.to}>
						<Link
							to={link.to}
							aria-current={link.active ? "page" : undefined}
							className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink"
						>
							<NavigationIcon path={link.icon} />
							<span>{link.label}</span>
						</Link>
					</li>
				))}
			</ul>
			<SecondaryNavigation />
		</nav>
	);
}
