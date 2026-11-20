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
	return [
		{
			path: "/probe",
			element: (
				<Suspense fallback={null}>
					<ProbeScreen />
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
	{ path: "/doi-qua", element: <RewardsScreen /> },
	{ path: "/vi-voucher", element: <VouchersScreen /> },
	{ path: "/voucher/:id", element: <VoucherScreen /> },
	...developmentRoutes(),
];

export const tabs: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "tab.home", icon: <HomeIcon /> },
	{ path: "/the-thanh-vien", labelKey: "tab.card", icon: <CardIcon /> },
	{ path: "/tai-khoan", labelKey: "tab.account", icon: <AccountIcon /> },
];

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
