import type { MiniAppRoute, MiniAppTab } from "@fnb/zalo-mini/react";
import { lazy, type ReactNode, Suspense } from "react";
import { CustomerDataProvider } from "./data/customer-data";
import { OfflineNotice } from "./data/offline";
import { StoreLinkProvider } from "./data/store-link";
import { HomeScreen } from "./home/home-screen";
import { AccountIcon, CardIcon, HomeIcon } from "./icons";
import { lazyScreen } from "./lazy";

const ClaimScreen = lazyScreen(
	() => import("./claim/claim-form"),
	(m) => m.ClaimScreen,
);
const CounterClaimScreen = lazyScreen(
	() => import("./counter/counter-claim"),
	(m) => m.CounterClaimScreen,
);
const StoreScreen = lazyScreen(
	() => import("./home/store-screen"),
	(m) => m.StoreScreen,
);
const JoinFlow = lazyScreen(
	() => import("./join/join-flow"),
	(m) => m.JoinFlow,
);
const SettingsScreen = lazyScreen(
	() => import("./settings/settings-screen"),
	(m) => m.SettingsScreen,
);
const MemberCodeScreen = lazyScreen(
	() => import("./wallet/member-code-screen"),
	(m) => m.MemberCodeScreen,
);
const RewardsScreen = lazyScreen(
	() => import("./wallet/vouchers"),
	(m) => m.RewardsScreen,
);
const VoucherScreen = lazyScreen(
	() => import("./wallet/vouchers"),
	(m) => m.VoucherScreen,
);
const VouchersScreen = lazyScreen(
	() => import("./wallet/vouchers"),
	(m) => m.VouchersScreen,
);
const WalletScreen = lazyScreen(
	() => import("./wallet/wallet-screen"),
	(m) => m.WalletScreen,
);

export { demoSessionClient } from "./data/source";

function developmentRoutes(): readonly MiniAppRoute[] {
	if (import.meta.env.VITE_MINI_APP_STAGE !== "development") return [];
	const ProbeScreen = lazy(() =>
		import("./probe/probe").then((module) => ({ default: module.ProbeScreen })),
	);
	const KitScreen = lazy(() =>
		import("./probe/kit-probe").then((module) => ({
			default: module.KitScreen,
		})),
	);
	return [
		{
			path: "/probe",
			element: (
				<Suspense fallback={null}>
					<ProbeScreen />
				</Suspense>
			),
		},
		// the design kit on one screen: opened with ?route=/kit in a Development build; /kit-flow is the same screen as a
		// flow route (no tab bar) and /kit-tabs a tab route without the sticky action bar, which the route chrome checks use
		{
			path: "/kit",
			element: (
				<Suspense fallback={null}>
					<KitScreen />
				</Suspense>
			),
		},
		{
			path: "/kit-tabs",
			element: (
				<Suspense fallback={null}>
					<KitScreen actionBar={false} />
				</Suspense>
			),
		},
		{
			path: "/kit-flow",
			chrome: "flow",
			element: (
				<Suspense fallback={null}>
					<KitScreen />
				</Suspense>
			),
		},
	];
}

function developmentEntry(): ReactNode {
	if (import.meta.env.VITE_MINI_APP_STAGE !== "development") return null;
	const ProbeEntry = lazy(() =>
		import("./probe/probe").then((module) => ({ default: module.ProbeEntry })),
	);
	return (
		<Suspense fallback={null}>
			<ProbeEntry />
		</Suspense>
	);
}

const probeEntry = developmentEntry();

export const routes: readonly MiniAppRoute[] = [
	{ path: "/", element: <HomeScreen /> },
	{ path: "/the-thanh-vien", element: <WalletScreen /> },
	{
		path: "/tai-khoan",
		element: (
			<>
				<SettingsScreen />
				{probeEntry}
			</>
		),
	},
	{ path: "/cua-hang/:code", element: <StoreScreen /> },
	{ path: "/tham-gia", element: <JoinFlow /> },
	{ path: "/ma-thanh-vien", element: <MemberCodeScreen /> },
	{ path: "/nhan-diem", element: <ClaimScreen /> },
	{ path: "/quet-ma-quay", element: <CounterClaimScreen /> },
	{ path: "/doi-qua", element: <RewardsScreen /> },
	{ path: "/vi-voucher", element: <VouchersScreen /> },
	{ path: "/voucher/:id", element: <VoucherScreen /> },
	...developmentRoutes(),
];

// Development builds only: ?badge=3 puts a count on the account tab and ?strip=1 shows a strip above the tab bar, so the
// route chrome (the badge, two bars at the bottom) can be looked at before any screen needs them
function developmentBadge(): (() => number | null) | null {
	if (import.meta.env.VITE_MINI_APP_STAGE !== "development") return null;
	return () => {
		const count = Number(
			new URLSearchParams(window.location.search).get("badge"),
		);
		return Number.isFinite(count) && count > 0 ? count : null;
	};
}

const badge = developmentBadge();

export const tabs: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "tab.home", icon: <HomeIcon /> },
	{ path: "/the-thanh-vien", labelKey: "tab.card", icon: <CardIcon /> },
	{
		path: "/tai-khoan",
		labelKey: "tab.account",
		icon: <AccountIcon />,
		...(badge === null ? {} : { badge }),
	},
];

function developmentStrip(): ReactNode {
	if (import.meta.env.VITE_MINI_APP_STAGE !== "development") return null;
	if (new URLSearchParams(window.location.search).get("strip") !== "1")
		return null;
	const KitStrip = lazy(() =>
		import("./probe/kit-probe").then((module) => ({
			default: module.KitStrip,
		})),
	);
	return (
		<Suspense fallback={null}>
			<KitStrip />
		</Suspense>
	);
}

/** The strip above the tab bar: none in a Testing or Zalo build, and in a Development build only with ?strip=1. */
export const aboveTabs: ReactNode = developmentStrip();

export function CustomerGate({ children }: { readonly children: ReactNode }) {
	return (
		<CustomerDataProvider>
			<StoreLinkProvider>
				<OfflineNotice />
				{children}
			</StoreLinkProvider>
		</CustomerDataProvider>
	);
}
