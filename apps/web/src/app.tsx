import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
	createHashRouter,
	Navigate,
	Outlet,
	type RouteObject,
	RouterProvider,
	useLocation,
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
import { CsvDialectProvider } from "./state/csv-dialect";
import { PreferencesProvider, usePreferences } from "./state/preferences";

function RedirectKeepingSearch({ to }: { to: string }) {
	const { search } = useLocation();
	return <Navigate to={`${to}${search}`} replace />;
}

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
							{
								index: true,
								element: <RedirectKeepingSearch to="/bao-cao/ngay" />,
							},
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
							{
								path: "*",
								element: <RedirectKeepingSearch to="/bao-cao/ngay" />,
							},
						],
					},
					{
						path: "chu-de",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{
								index: true,
								element: <RedirectKeepingSearch to="/chu-de/doanh-thu" />,
							},
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
							{
								path: "thanh-toan",
								lazy: () =>
									import("./pages/themes/thanh-toan/thanh-toan-page").then(
										(module) => ({ Component: module.ThanhToanPage }),
									),
							},
							{
								path: "khuyen-mai",
								lazy: () =>
									import("./pages/themes/khuyen-mai/khuyen-mai-page").then(
										(module) => ({ Component: module.KhuyenMaiPage }),
									),
							},
							{
								path: "ca-ket-tien",
								lazy: () =>
									import("./pages/themes/ca-ket-tien/ca-ket-tien-page").then(
										(module) => ({ Component: module.CaKetTienPage }),
									),
							},
							{
								path: "so-sanh",
								lazy: () =>
									import("./pages/themes/so-sanh/so-sanh-page").then(
										(module) => ({ Component: module.SoSanhPage }),
									),
							},
							{
								path: ":slug",
								lazy: () =>
									import("./pages/themes/later/later-page").then((module) => ({
										Component: module.LaterThemePage,
									})),
							},
							{
								path: "*",
								element: <RedirectKeepingSearch to="/chu-de/doanh-thu" />,
							},
						],
					},
					{ path: "ke-hoach/*", element: <PlaceholderPage section="plans" /> },
					{
						path: "cai-dat",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{ index: true, element: <Navigate to="cua-hang" replace /> },
							{
								path: ":slug",
								lazy: () =>
									import("./pages/settings/settings-route").then((module) => ({
										Component: module.SettingsRoute,
									})),
							},
						],
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
								<CsvDialectProvider dialect={preferences.csvDialect}>
									<RouterProvider router={router} />
								</CsvDialectProvider>
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
