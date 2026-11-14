import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
	createHashRouter,
	Navigate,
	Outlet,
	type RouteObject,
	RouterProvider,
	useNavigate,
} from "react-router-dom";
import { AppModeProvider } from "./app-mode/app-mode";
import { LoginPage } from "./auth/login-page";
import { NewPasswordPage } from "./auth/new-password-page";
import { ProtectedShell } from "./auth/protected-shell";
import {
	NEW_PASSWORD_ROUTE,
	ResetRequestPage,
} from "./auth/reset-request-page";
import { SessionProvider, useSession } from "./auth/session";
import { AnalyticsSourceProvider } from "./data/analytics-source-context";
import { RowSourceProvider } from "./data/row-source-context";
import { I18nProvider, type Language } from "./i18n";
import { configuredClientLoader } from "./lib/supabase";
import { PlaceholderPage } from "./pages/placeholder-page";
import { TodayPage } from "./pages/today/today-page";
import { ReportRouteLoading } from "./reports/route-loading";
import { NewVersionPrompt } from "./shell/new-version-prompt";
import { PreferencesProvider, usePreferences } from "./state/preferences";

function RecoveryRedirect() {
	const navigate = useNavigate();
	const { recovering } = useSession();
	useEffect(() => {
		if (recovering) navigate(NEW_PASSWORD_ROUTE, { replace: true });
	}, [recovering, navigate]);
	return <Outlet />;
}

export const routes: RouteObject[] = [
	{
		element: <RecoveryRedirect />,
		children: [
			{ path: "dang-nhap", element: <LoginPage /> },
			{ path: "quen-mat-khau", element: <ResetRequestPage /> },
			{ path: NEW_PASSWORD_ROUTE.slice(1), element: <NewPasswordPage /> },
			{
				element: <ProtectedShell />,
				children: [
					{ index: true, element: <TodayPage /> },
					{
						path: "bao-cao",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{ index: true, element: <Navigate to="ngay" replace /> },
							{
								path: "ngay",
								lazy: () =>
									import("./pages/reports/day/day-page").then((module) => ({
										Component: module.DayReportPage,
									})),
							},
							{
								path: "tuan",
								lazy: () =>
									import("./pages/reports/week/week-page").then((module) => ({
										Component: module.WeekReportPage,
									})),
							},
							{
								path: "thang",
								lazy: () =>
									import("./pages/reports/month/month-page").then((module) => ({
										Component: module.MonthReportPage,
									})),
							},
							{
								path: "nam",
								lazy: () =>
									import("./pages/reports/year/year-page").then((module) => ({
										Component: module.YearReportPage,
									})),
							},
							{ path: "*", element: <Navigate to="ngay" replace /> },
						],
					},
					{
						path: "chu-de",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{ index: true, element: <Navigate to="doanh-thu" replace /> },
							{
								path: "doanh-thu",
								lazy: () =>
									import("./pages/themes/doanh-thu/doanh-thu-page").then(
										(module) => ({ Component: module.DoanhThuPage }),
									),
							},
							{
								path: "gio-ngay",
								lazy: () =>
									import("./pages/themes/gio-ngay/gio-ngay-page").then(
										(module) => ({ Component: module.GioNgayPage }),
									),
							},
							{
								path: "thuc-don",
								lazy: () =>
									import("./pages/themes/thuc-don/thuc-don-page").then(
										(module) => ({ Component: module.ThucDonPage }),
									),
							},
							{ path: "*", element: <Navigate to="doanh-thu" replace /> },
						],
					},
					{ path: "ke-hoach/*", element: <PlaceholderPage section="plans" /> },
					{
						path: "cai-dat/*",
						element: <PlaceholderPage section="settings" />,
					},
					{
						path: "xuat-du-lieu",
						element: <PlaceholderPage section="exports" />,
					},
					...(import.meta.env.DEV
						? [
								{
									path: "thiet-ke",
									lazy: () =>
										import("./pages/design-catalogue").then((module) => ({
											Component: module.DesignCataloguePage,
										})),
								},
							]
						: []),
					{ path: "*", element: <Navigate to="/" replace /> },
				],
			},
		],
	},
];

function LocalisedApp() {
	const { preferences, update } = usePreferences();
	const [router] = useState(() => createHashRouter(routes));
	const [queryClient] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
	);
	const [loadClient] = useState(configuredClientLoader);
	const setLanguage = useCallback(
		(language: Language) => update({ language }),
		[update],
	);
	return (
		<I18nProvider
			language={preferences.language}
			onLanguageChange={setLanguage}
		>
			<QueryClientProvider client={queryClient}>
				<AppModeProvider>
					<SessionProvider loadClient={loadClient}>
						<RowSourceProvider>
							<AnalyticsSourceProvider>
								<RouterProvider router={router} />
							</AnalyticsSourceProvider>
						</RowSourceProvider>
					</SessionProvider>
					<NewVersionPrompt />
				</AppModeProvider>
			</QueryClientProvider>
		</I18nProvider>
	);
}

export function App() {
	return (
		<PreferencesProvider>
			<LocalisedApp />
		</PreferencesProvider>
	);
}
