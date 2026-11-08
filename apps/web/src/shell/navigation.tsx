import { Link, useLocation } from "react-router-dom";
import type { MessageKey } from "../i18n";
import { useT } from "../i18n";

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
		</nav>
	);
}
