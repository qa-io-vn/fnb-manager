import type { MiniAppRoute, MiniAppTab } from "@fnb/zalo-mini/react";
import { lazy, type ReactNode, Suspense } from "react";
import { ClaimScreen } from "./claim/claim-form";
import { CustomerDataProvider } from "./data/customer-data";
import { StoreLinkProvider } from "./data/store-link";
import { HomeScreen } from "./home/home-screen";
import { StoreScreen } from "./home/store-screen";
import { AccountIcon, CardIcon, HomeIcon } from "./icons";
import { JoinFlow } from "./join/join-flow";
import { SettingsScreen } from "./settings/settings-screen";
import { MemberCodeScreen } from "./wallet/member-code-screen";
import {
	RewardsScreen,
	VoucherScreen,
	VouchersScreen,
} from "./wallet/vouchers";
import { WalletScreen } from "./wallet/wallet-screen";

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
			<StoreLinkProvider>{children}</StoreLinkProvider>
		</CustomerDataProvider>
	);
}
