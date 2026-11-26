import { type ComponentType, type ReactNode, useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { App, BottomNavigation, ZMPRouter } from "zmp-ui";
import type { AppConfigApp } from "../app-config/index";
import { type DataEndpoint, STAND_IN_DATA } from "../data/endpoint";
import type { Catalog, Language } from "../i18n/translate";
import type { CustomerSessionClient } from "../session/customer-session-client";
import type { SessionClient } from "../session/types";
import { type ColorScheme, useColorScheme } from "./color-scheme";
import { CustomerSessionProvider } from "./customer-session";
import { DataEndpointProvider } from "./data-endpoint";
import { I18nProvider, useI18n } from "./i18n";
import { SessionProvider } from "./session";

export const MAX_TABS = 4;

export interface MiniAppRoute {
	readonly path: string;
	readonly element: ReactNode;
}

export type MiniAppGate = ComponentType<{ readonly children: ReactNode }>;

export interface MiniAppTab {
	readonly path: string;
	readonly labelKey: string;
	readonly icon: ReactNode;
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

function Frame({
	routes,
	tabs,
	standInHeader,
	scheme,
	gate: Gate,
}: {
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
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
	const activeTab =
		tabs.find((tab) => tab.path === location.pathname)?.path ??
		tabs[0]?.path ??
		"/";
	const body = (
		<>
			<main
				className={
					tabs.length > 0
						? "flex-1 pb-[calc(48px+var(--zaui-safe-area-inset-bottom,0px))]"
						: "flex-1"
				}
			>
				<Routes>
					{routes.map((route) => (
						<Route key={route.path} path={route.path} element={route.element} />
					))}
				</Routes>
			</main>
			{tabs.length > 0 ? (
				<nav aria-label={t("shell.mainNavigation")}>
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
								icon={tab.icon}
							/>
						))}
					</BottomNavigation>
				</nav>
			) : null}
		</>
	);
	return (
		<div className="flex min-h-dvh flex-col bg-surface text-ink">
			{standInHeader ? (
				<StandInHeader app={standInHeader} scheme={scheme} />
			) : null}
			{Gate ? <Gate>{body}</Gate> : body}
		</div>
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
