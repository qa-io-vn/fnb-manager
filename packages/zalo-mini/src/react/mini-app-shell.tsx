import {
	type ComponentType,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import {
	matchPath,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router-dom";
import { App, BottomNavigation, ZMPRouter } from "zmp-ui";
import type { AppConfigApp } from "../app-config/index";
import { type DataEndpoint, STAND_IN_DATA } from "../data/endpoint";
import type { Catalog, Language } from "../i18n/translate";
import type { CustomerSessionClient } from "../session/customer-session-client";
import type { SessionClient } from "../session/types";
import {
	BAR_SELECTOR,
	BottomBarsContext,
	clearHeightOf,
	focusScrollDelta,
	MAX_BOTTOM_BARS,
	scrollContainerOf,
	useBarRegistry,
	useElementHeight,
} from "./bottom-bars";
import { type ColorScheme, useColorScheme } from "./color-scheme";
import { CustomerSessionProvider } from "./customer-session";
import { DataEndpointProvider } from "./data-endpoint";
import { I18nProvider, useI18n } from "./i18n";
import { SessionProvider } from "./session";

export const MAX_TABS = 4;

/** How a route is framed: with the tab bar (and the strip above it), or as a flow without them (design spec 6.0, 6.1). */
export type RouteChrome = "tabs" | "flow";

export const ROUTE_CHROMES: readonly RouteChrome[] = ["tabs", "flow"];

/** The largest number a tab's badge writes; more is written as 99+. */
export const MAX_BADGE = 99;

export interface MiniAppRoute {
	readonly path: string;
	readonly element: ReactNode;
	/** "tabs" (the default) shows the tab bar and the strip above it; "flow" hides both and leaves the bottom to the screen. */
	readonly chrome?: RouteChrome;
	/**
	 * The tab shown active on this route when it is not a tab itself: a tab's path, or null for none (an order's
	 * screen, design spec 6.1), so that every tab opens its screen from here. Left out, the first tab is shown active.
	 */
	readonly activeTab?: string | null;
}

export type MiniAppGate = ComponentType<{ readonly children: ReactNode }>;

export interface MiniAppTab {
	readonly path: string;
	readonly labelKey: string;
	readonly icon: ReactNode;
	/**
	 * A count shown on the tab's icon, or null for none (a count below 1 shows none, one above 99 shows 99+). It is called
	 * on every render of the tab bar, in a component of its own, so it may read a store through a hook.
	 */
	readonly badge?: () => number | null;
	/** The message that says the count to assistive technology, with {count}; "shell.tabBadge" by default. */
	readonly badgeLabelKey?: string;
}

export function shellProblems(
	routes: readonly MiniAppRoute[],
	tabs: readonly MiniAppTab[],
): string[] {
	const problems: string[] = [];
	if (routes[0]?.path !== "/") problems.push("the first route must be /");
	if (tabs.length > MAX_TABS) {
		problems.push(`a Mini App has at most ${MAX_TABS} tabs`);
	}
	if (tabs.length === 1) problems.push("a bottom navigation needs two tabs");
	if (tabs.length > 0 && tabs[0]?.path !== "/") {
		problems.push("the first tab must open the first route");
	}
	const paths = new Set(routes.map((route) => route.path));
	for (const tab of tabs) {
		if (!paths.has(tab.path)) problems.push(`no route for the tab ${tab.path}`);
	}
	for (const route of routes) {
		if (
			route.chrome !== undefined &&
			!ROUTE_CHROMES.includes(route.chrome as RouteChrome)
		) {
			problems.push(
				`the route ${route.path} has the chrome "${String(route.chrome)}": use tabs or flow`,
			);
		}
	}
	for (const tab of tabs) {
		if (routes.find((route) => route.path === tab.path)?.chrome === "flow") {
			problems.push(
				`the route of the tab ${tab.path} is a flow route: it would hide its own tab bar`,
			);
		}
	}
	for (const route of routes) {
		if (
			typeof route.activeTab === "string" &&
			!tabs.some((tab) => tab.path === route.activeTab)
		) {
			problems.push(
				`the route ${route.path} names the active tab ${route.activeTab}, which is not a tab`,
			);
		}
	}
	return problems;
}

function StandInHeader({
	app,
	scheme,
}: {
	readonly app: AppConfigApp;
	readonly scheme: ColorScheme;
}) {
	const { language } = useI18n();
	return (
		<header
			data-testid="stand-in-header"
			className="sticky top-0 z-10 flex h-11 items-center px-4"
			style={{
				backgroundColor: app.headerColor[scheme],
				color: app.textColor[scheme] === "white" ? "#FFFFFF" : "#000000",
			}}
		>
			<span className="truncate text-body font-semibold">
				{app.headerTitle[language]}
			</span>
		</header>
	);
}

// Development builds only: ?route=/path opens a screen directly (the design kit, a flow screen), which a browser test cannot
// reach by tapping before its data exists. A path is one to six segments of letters, digits, dashes and underscores, so
// nothing else (a host, a query, a dot) can be navigated to; a Testing or Zalo build ignores the parameter.
const DEV_ROUTE = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,5}$/;

export function devRouteOf(
	search: string,
	stage: string | undefined,
): string | null {
	if (stage !== "development") return null;
	const path = new URLSearchParams(search).get("route");
	return path !== null && DEV_ROUTE.test(path) ? path : null;
}

// the height of the tab bar without the safe area (ZaUI's bottom navigation)
const TAB_BAR_PX = 48;
const SAFE_BOTTOM = "var(--zaui-safe-area-inset-bottom, 0px)";
const TAB_BAR_CSS = `calc(${TAB_BAR_PX}px + ${SAFE_BOTTOM})`;

/** The first route whose path matches the address, which says how the screen is framed. */
export function routeAt(
	routes: readonly MiniAppRoute[],
	pathname: string,
): MiniAppRoute | undefined {
	return routes.find(
		(route) => matchPath({ path: route.path, end: true }, pathname) !== null,
	);
}

function TabIcon({ tab }: { readonly tab: MiniAppTab }) {
	const { t } = useI18n();
	// a tab's badge may read a store through a hook: it is called here, in a component of its own, once per render
	const raw = tab.badge?.() ?? null;
	const count = raw === null || !(raw >= 1) ? null : Math.floor(raw);
	return (
		<span className="relative inline-flex">
			{tab.icon}
			{count === null ? null : (
				<>
					<span
						aria-hidden="true"
						data-testid="tab-badge"
						className="absolute -top-1.5 -right-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-badge px-1 text-xs leading-none font-bold text-badge-ink"
					>
						{count > MAX_BADGE ? `${MAX_BADGE}+` : count}
					</span>
					<span className="sr-only">
						{t(tab.badgeLabelKey ?? "shell.tabBadge", { count })}
					</span>
				</>
			)}
		</span>
	);
}

function Frame({
	routes,
	tabs,
	aboveTabs,
	standInHeader,
	scheme,
	gate: Gate,
}: {
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
	readonly aboveTabs: ReactNode;
	readonly standInHeader: AppConfigApp | null;
	readonly scheme: ColorScheme;
	readonly gate: MiniAppGate | undefined;
}) {
	const { t } = useI18n();
	const location = useLocation();
	const navigate = useNavigate();
	useEffect(() => {
		const path = devRouteOf(
			window.location.search,
			import.meta.env.VITE_MINI_APP_STAGE,
		);
		if (path !== null) navigate(path, { replace: true });
	}, [navigate]);
	const route = routeAt(routes, location.pathname);
	// a route that is not a tab shows the tab it names, none (null), or by default the first one
	const activeTab =
		tabs.find((tab) => tab.path === location.pathname)?.path ??
		(route?.activeTab === undefined
			? (tabs[0]?.path ?? "/")
			: (route.activeTab ?? ""));
	// a flow route hides the tab bar (and with it the strip above it); a tab route shows both
	const chrome = route?.chrome ?? "tabs";
	const showTabs = tabs.length > 0 && chrome === "tabs";
	const showStrip = showTabs && aboveTabs !== null && aboveTabs !== undefined;
	const stripRef = useRef<HTMLDivElement>(null);
	const stripHeight = useElementHeight(stripRef, showStrip);
	const registry = useBarRegistry();
	// the bars the shell owns, then every bar a screen registered: the page leaves room for all of them
	const shellBottom = `calc(${showTabs ? TAB_BAR_CSS : "0px"} + ${stripHeight}px)`;
	const barsBottom = `calc(${shellBottom} + ${registry.padding}px)`;
	const clearBottom = `calc(${shellBottom} + ${registry.all}px)`;
	// a strip whose content draws nothing (no order in progress) takes no room and is not counted
	const bars =
		(showTabs ? 1 : 0) +
		(showStrip && stripHeight > 0 ? 1 : 0) +
		registry.count;
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--shell-bottom", shellBottom);
		root.style.setProperty("--bottom-bars", barsBottom);
		root.style.setProperty("--bottom-clear", clearBottom);
		return () => {
			root.style.removeProperty("--shell-bottom");
			root.style.removeProperty("--bottom-bars");
			root.style.removeProperty("--bottom-clear");
		};
	}, [shellBottom, barsBottom, clearBottom]);
	// a focused control that a bar covers is scrolled clear of it (the browser does not, for an element in the viewport)
	useEffect(() => {
		const onFocus = (event: FocusEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest(BAR_SELECTOR) !== null) return;
			requestAnimationFrame(() => {
				const scroller = scrollContainerOf(target);
				const viewportBottom = Math.min(
					window.innerHeight,
					scroller.getBoundingClientRect().bottom || window.innerHeight,
				);
				const delta = focusScrollDelta(
					target.getBoundingClientRect(),
					viewportBottom,
					clearHeightOf(viewportBottom),
				);
				if (delta > 0) scroller.scrollBy(0, delta);
			});
		};
		document.addEventListener("focusin", onFocus);
		return () => document.removeEventListener("focusin", onFocus);
	}, []);
	useEffect(() => {
		if (bars > MAX_BOTTOM_BARS) {
			console.error(
				`a screen shows at most ${MAX_BOTTOM_BARS} bars at the bottom, found ${bars}`,
			);
		}
	}, [bars]);
	const body = (
		<>
			<main className="flex-1 pb-[var(--bottom-bars,0px)]">
				<Routes>
					{routes.map((route) => (
						<Route key={route.path} path={route.path} element={route.element} />
					))}
				</Routes>
			</main>
			{showStrip ? (
				<div
					ref={stripRef}
					data-bottom-bar="strip"
					data-testid="above-tabs"
					className="fixed inset-x-0 z-40"
					style={{ bottom: TAB_BAR_CSS }}
				>
					{aboveTabs}
				</div>
			) : null}
			{showTabs ? (
				<nav aria-label={t("shell.mainNavigation")} data-bottom-bar="tabs">
					<BottomNavigation
						fixed
						activeKey={activeTab}
						onChange={(key) => navigate(key)}
					>
						{tabs.map((tab) => (
							<BottomNavigation.Item
								key={tab.path}
								itemKey={tab.path}
								label={t(tab.labelKey)}
								icon={<TabIcon tab={tab} />}
							/>
						))}
					</BottomNavigation>
				</nav>
			) : null}
		</>
	);
	return (
		<BottomBarsContext.Provider value={registry.value}>
			<div
				className="flex min-h-dvh flex-col bg-surface text-ink"
				data-testid="shell"
				data-chrome={chrome}
				data-bottom-bars={bars}
			>
				{standInHeader ? (
					<StandInHeader app={standInHeader} scheme={scheme} />
				) : null}
				{Gate ? <Gate>{body}</Gate> : body}
			</div>
		</BottomBarsContext.Provider>
	);
}

export interface MiniAppProps {
	readonly language: Language;
	readonly catalogs: Readonly<Record<Language, Catalog>>;
	readonly sessionClient?: SessionClient;
	readonly customerSessionClient?: CustomerSessionClient;
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
	readonly standInHeader: AppConfigApp | null;
	readonly dataEndpoint?: DataEndpoint;
	readonly gate?: MiniAppGate;
	/** A strip that floats above the tab bar on tab routes (an order in progress); a flow route never shows it. */
	readonly aboveTabs?: ReactNode;
}

function Sessions({
	sessionClient,
	customerSessionClient,
	children,
}: {
	readonly sessionClient: SessionClient | undefined;
	readonly customerSessionClient: CustomerSessionClient | undefined;
	readonly children: ReactNode;
}) {
	const customer =
		customerSessionClient === undefined ? (
			children
		) : (
			<CustomerSessionProvider client={customerSessionClient}>
				{children}
			</CustomerSessionProvider>
		);
	return sessionClient === undefined ? (
		customer
	) : (
		<SessionProvider client={sessionClient}>{customer}</SessionProvider>
	);
}

export function MiniApp({
	language,
	catalogs,
	sessionClient,
	customerSessionClient,
	routes,
	tabs,
	standInHeader,
	dataEndpoint = STAND_IN_DATA,
	gate,
	aboveTabs = null,
}: MiniAppProps) {
	const scheme = useColorScheme();
	useEffect(() => {
		document.body.setAttribute("zaui-theme", scheme);
	}, [scheme]);
	const problems = shellProblems(routes, tabs);
	if (problems.length > 0) throw new Error(problems.join("; "));
	return (
		<I18nProvider language={language} catalogs={catalogs}>
			<DataEndpointProvider endpoint={dataEndpoint}>
				<Sessions
					sessionClient={sessionClient}
					customerSessionClient={customerSessionClient}
				>
					<App theme={scheme}>
						<ZMPRouter memoryRouter>
							<Frame
								routes={routes}
								tabs={tabs}
								aboveTabs={aboveTabs}
								standInHeader={standInHeader}
								scheme={scheme}
								gate={gate}
							/>
						</ZMPRouter>
					</App>
				</Sessions>
			</DataEndpointProvider>
		</I18nProvider>
	);
}

export function PlainState() {
	const { t } = useI18n();
	return (
		<section className="px-4 py-6" data-testid="plain-state">
			<p className="text-body text-ink-muted">{t("shell.plainState")}</p>
		</section>
	);
}
