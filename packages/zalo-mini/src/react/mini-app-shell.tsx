import { type ReactNode, useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { App, BottomNavigation, ZMPRouter } from "zmp-ui";
import type { AppConfigApp } from "../app-config/index";
import type { Catalog, Language } from "../i18n/translate";
import type { SessionClient } from "../session/types";
import { type ColorScheme, useColorScheme } from "./color-scheme";
import { I18nProvider, useI18n } from "./i18n";
import { SessionProvider } from "./session";

export const MAX_TABS = 4;

export interface MiniAppRoute {
	readonly path: string;
	readonly element: ReactNode;
}

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
			<span className="truncate text-base font-semibold">
				{app.headerTitle[language]}
			</span>
		</header>
	);
}

function Frame({
	routes,
	tabs,
	standInHeader,
	scheme,
}: {
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
	readonly standInHeader: AppConfigApp | null;
	readonly scheme: ColorScheme;
}) {
	const { t } = useI18n();
	const location = useLocation();
	const navigate = useNavigate();
	const activeTab =
		tabs.find((tab) => tab.path === location.pathname)?.path ??
		tabs[0]?.path ??
		"/";
	return (
		<div className="flex min-h-dvh flex-col bg-surface text-ink">
			{standInHeader ? (
				<StandInHeader app={standInHeader} scheme={scheme} />
			) : null}
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
		</div>
	);
}

export interface MiniAppProps {
	readonly language: Language;
	readonly catalogs: Readonly<Record<Language, Catalog>>;
	readonly sessionClient: SessionClient;
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
	readonly standInHeader: AppConfigApp | null;
}

export function MiniApp({
	language,
	catalogs,
	sessionClient,
	routes,
	tabs,
	standInHeader,
}: MiniAppProps) {
	const scheme = useColorScheme();
	useEffect(() => {
		document.body.setAttribute("zaui-theme", scheme);
	}, [scheme]);
	const problems = shellProblems(routes, tabs);
	if (problems.length > 0) throw new Error(problems.join("; "));
	return (
		<I18nProvider language={language} catalogs={catalogs}>
			<SessionProvider client={sessionClient}>
				<App theme={scheme}>
					<ZMPRouter memoryRouter>
						<Frame
							routes={routes}
							tabs={tabs}
							standInHeader={standInHeader}
							scheme={scheme}
						/>
					</ZMPRouter>
				</App>
			</SessionProvider>
		</I18nProvider>
	);
}

export function PlainState() {
	const { t } = useI18n();
	return (
		<section className="px-4 py-6" data-testid="plain-state">
			<p className="text-base text-ink-muted">{t("shell.plainState")}</p>
		</section>
	);
}
