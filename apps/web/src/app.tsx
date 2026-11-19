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
import { PlansPage } from "./pages/plans/plans-page";
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
								path: "chat-luong",
								lazy: () =>
									import("./pages/themes/chat-luong/chat-luong-page").then(
										(module) => ({ Component: module.ChatLuongPage }),
									),
							},
							{
								path: "*",
								element: <RedirectKeepingSearch to="/chu-de/doanh-thu" />,
							},
						],
					},
					{
						path: "ke-hoach",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{ index: true, element: <PlansPage /> },
							{
								path: "dan",
								lazy: () =>
									import("./pages/plans/paste-page").then((module) => ({
										Component: module.PastePage,
									})),
							},
							{ path: "*", element: <Navigate to="/ke-hoach" replace /> },
						],
					},
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
						path: "van-hanh",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{ index: true, element: <Navigate to="checklist" replace /> },
							{
								path: "checklist",
								lazy: () =>
									import("./pages/operations/checklist-compliance-page").then(
										(module) => ({
											Component: module.ChecklistCompliancePage,
										}),
									),
							},
							{
								path: "ket-tien",
								lazy: () =>
									import("./pages/operations/cash-counts-page").then(
										(module) => ({ Component: module.CashCountsPage }),
									),
							},
							{
								path: "su-co",
								lazy: () =>
									import("./pages/operations/incident-log-page").then(
										(module) => ({ Component: module.IncidentLogPage }),
									),
							},
							{
								path: "thong-bao",
								lazy: () =>
									import("./pages/operations/announcements-page").then(
										(module) => ({ Component: module.AnnouncementsPage }),
									),
							},
							{
								path: "*",
								element: <Navigate to="/van-hanh/checklist" replace />,
							},
						],
					},
					{
						path: "khach-hang",
						hydrateFallbackElement: <ReportRouteLoading />,
						children: [
							{ index: true, element: <Navigate to="thanh-vien" replace /> },
							{
								path: "thanh-vien",
								lazy: () =>
									import("./pages/loyalty/members-page").then((module) => ({
										Component: module.MembersPage,
									})),
							},
							{
								path: "thanh-vien/:membershipId",
								lazy: () =>
									import("./pages/loyalty/member-page").then((module) => ({
										Component: module.MemberPage,
									})),
							},
							{
								path: "doi-soat",
								lazy: () =>
									import("./pages/loyalty/queue-page").then((module) => ({
										Component: module.QueuePage,
									})),
							},
							{
								path: "bat-thuong",
								lazy: () =>
									import("./pages/loyalty/anomalies-page").then((module) => ({
										Component: module.AnomaliesPage,
									})),
							},
							{
								path: "*",
								element: <Navigate to="/khach-hang/thanh-vien" replace />,
							},
						],
					},
					{
						path: "xuat-du-lieu",
						hydrateFallbackElement: <ReportRouteLoading />,
						lazy: () =>
							import("./pages/exports/exports-page").then((module) => ({
								Component: module.ExportsPage,
							})),
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
