import { useI18n } from "@fnb/zalo-mini/i18n";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export interface NavItem {
	readonly to: string;
	readonly label: string;
	readonly icon: ReactNode;
	/** a count drawn on the icon (new orders, open calls); 0 draws nothing */
	readonly badge?: number;
	readonly testId: string;
}

function Badge({ count }: { readonly count: number }) {
	const { t } = useI18n();
	if (count <= 0) return null;
	return (
		<>
			<span
				aria-hidden="true"
				className="absolute -top-1.5 -right-2.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] leading-5 font-bold text-accent-ink"
			>
				{count > 99 ? "99+" : count}
			</span>
			<span className="sr-only">{t("nav.badge", { count })}</span>
		</>
	);
}

/** The left rail of the tablet: labelled icons, the active one marked by its colour, a bar and aria-current. */
function Rail({ items }: { readonly items: readonly NavItem[] }) {
	const { t } = useI18n();
	return (
		<nav
			aria-label={t("nav.label")}
			className="hidden w-[72px] shrink-0 flex-col print:hidden items-stretch gap-1 border-r border-line bg-surface-raised py-3 md:flex xl:w-[88px]"
		>
			{items.map((item) => (
				<NavLink
					key={item.to}
					to={item.to}
					data-testid={`rail-${item.testId}`}
					className={({ isActive }) =>
						`relative mx-1.5 flex min-h-16 flex-col items-center justify-center gap-1 rounded-card-xl px-1 text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-focus ${
							isActive
								? "bg-surface-sunken text-highlight"
								: "text-ink-muted hover:text-ink"
						}`
					}
				>
					<span className="relative">
						{item.icon}
						<Badge count={item.badge ?? 0} />
					</span>
					<span className="text-center leading-tight">{item.label}</span>
				</NavLink>
			))}
		</nav>
	);
}

/** The bottom tabs of a phone: the same items, 48 px targets, above the home indicator. */
function BottomTabs({ items }: { readonly items: readonly NavItem[] }) {
	const { t } = useI18n();
	return (
		<nav
			aria-label={t("nav.label")}
			className="fixed inset-x-0 bottom-0 z-40 flex print:hidden border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden"
		>
			{items.map((item) => (
				<NavLink
					key={item.to}
					to={item.to}
					data-testid={`tab-${item.testId}`}
					className={({ isActive }) =>
						`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-bold focus-visible:outline-2 focus-visible:outline-focus ${
							isActive ? "text-highlight" : "text-ink-muted"
						}`
					}
				>
					<span className="relative">
						{item.icon}
						<Badge count={item.badge ?? 0} />
					</span>
					{item.label}
				</NavLink>
			))}
		</nav>
	);
}

/** The counter's frame: the top bar, then the rail (tablet) or the bottom tabs (phone) around the page. */
export function AppShell({
	topBar,
	items,
	banner,
	children,
}: {
	readonly topBar: ReactNode;
	readonly items: readonly NavItem[];
	readonly banner?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<div className="app-shell flex h-dvh flex-col bg-surface text-ink print:h-auto">
			{topBar}
			{banner}
			<div className="flex min-h-0 flex-1">
				<Rail items={items} />
				<main
					className="min-w-0 flex-1 overflow-y-auto px-4 pt-4 pb-24 md:px-6 md:pb-6"
					id="main"
				>
					{children}
				</main>
			</div>
			<BottomTabs items={items} />
		</div>
	);
}
