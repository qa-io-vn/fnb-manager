import type { MemberProfile } from "@fnb/zalo-mini";
import {
	type MiniAppRoute,
	type MiniAppTab,
	SessionScreen,
} from "@fnb/zalo-mini/react";
import { lazy, type ReactNode, Suspense } from "react";

function developmentScreens(): {
	readonly home: ReactNode;
	readonly routes: readonly MiniAppRoute[];
} {
	if (import.meta.env.VITE_MINI_APP_STAGE !== "development") {
		return { home: <SessionScreen />, routes: [] };
	}
	const ProbeEntry = lazy(() =>
		import("./probe/probe").then((module) => ({ default: module.ProbeEntry })),
	);
	const ProbeScreen = lazy(() =>
		import("./probe/probe").then((module) => ({ default: module.ProbeScreen })),
	);
	return {
		home: (
			<>
				<SessionScreen />
				<Suspense fallback={null}>
					<ProbeEntry />
				</Suspense>
			</>
		),
		routes: [
			{
				path: "/probe",
				element: (
					<Suspense fallback={null}>
						<ProbeScreen />
					</Suspense>
				),
			},
		],
	};
}

const screens = developmentScreens();

export const routes: readonly MiniAppRoute[] = [
	{ path: "/", element: screens.home },
	...screens.routes,
];

export const tabs: readonly MiniAppTab[] = [];

export const standInMember: MemberProfile = {
	displayName: "Chủ cửa hàng thử",
	role: "owner",
	stores: ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"],
};
