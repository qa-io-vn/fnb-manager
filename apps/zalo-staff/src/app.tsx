import type { MemberProfile } from "@fnb/zalo-mini";
import type { MiniAppRoute, MiniAppTab } from "@fnb/zalo-mini/react";
import { HomeScreen } from "./home/home-screen";
import { HomeIcon, NoticeIcon, ProfileIcon, ShiftIcon } from "./icons";
import { lazyCard, lazyScreen } from "./lazy";
import { LOYALTY_PATHS, type LoyaltyPath } from "./loyalty/env";
import { HomeLoyaltyContext } from "./loyalty/home-slot";
import { HomeTasksContext } from "./shift/home-slot";
import { TEAM_PATHS, type TeamPath } from "./team/env";
import { HomeTeamContext, type HomeTeamParts } from "./team/home-slot";

const ShiftScreen = lazyScreen(
	() => import("./shift/shift-screen"),
	(m) => m.ShiftScreen,
);
const ProfileScreen = lazyScreen(
	() => import("./profile/profile-screen"),
	(m) => m.ProfileScreen,
);
const LoyaltyPage = lazyScreen(
	() => import("./loyalty/pages"),
	(m) => m.default,
);
const TeamPage = lazyScreen(
	() => import("./team/pages"),
	(m) => m.default,
);
const ShiftTaskCards = lazyCard(
	() => import("./shift/home-cards"),
	(m) => m.ShiftTaskCards,
);
const LoyaltyHomeCard = lazyCard(
	() => import("./loyalty/home-card"),
	(m) => m.LoyaltyHomeCard,
);
const TEAM_HOME_PARTS: HomeTeamParts = {
	notices: lazyCard(
		() => import("./team/home-cards"),
		(m) => m.TEAM_HOME_PARTS.notices,
	),
	requests: lazyCard(
		() => import("./team/home-cards"),
		(m) => m.TEAM_HOME_PARTS.requests,
	),
};

export { EntryGate } from "./onboarding/entry-gate";

function teamPaths(): TeamPath[] {
	return Object.values(TEAM_PATHS);
}

function loyaltyPaths(): LoyaltyPath[] {
	return Object.values(LOYALTY_PATHS);
}

export const routes: readonly MiniAppRoute[] = [
	{
		path: "/",
		element: (
			<HomeTasksContext.Provider value={ShiftTaskCards}>
				<HomeTeamContext.Provider value={TEAM_HOME_PARTS}>
					<HomeLoyaltyContext.Provider value={LoyaltyHomeCard}>
						<HomeScreen />
					</HomeLoyaltyContext.Provider>
				</HomeTeamContext.Provider>
			</HomeTasksContext.Provider>
		),
	},
	{ path: "/ca-lam", element: <ShiftScreen /> },
	{ path: "/ca-nhan", element: <ProfileScreen /> },
	...teamPaths().map((path) => ({ path, element: <TeamPage path={path} /> })),
	...loyaltyPaths().map((path) => ({
		path,
		element: <LoyaltyPage path={path} />,
	})),
];

export const tabs: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "tab.home", icon: <HomeIcon /> },
	{ path: "/ca-lam", labelKey: "tab.shifts", icon: <ShiftIcon /> },
	{ path: TEAM_PATHS.notices, labelKey: "tab.notices", icon: <NoticeIcon /> },
	{ path: "/ca-nhan", labelKey: "tab.profile", icon: <ProfileIcon /> },
];

export const standInMember: MemberProfile = {
	displayName: "Thành viên thử",
	role: "manager",
	stores: ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"],
	tenantId: "stand-in-tenant",
};

export const STAND_IN_ROLES = ["owner", "manager", "staff"] as const;

export function standInMemberFrom(search: string): MemberProfile {
	const params = new URLSearchParams(search);
	const requested = params.get("role");
	const role = STAND_IN_ROLES.find((name) => name === requested);
	if (role === undefined) return standInMember;
	return role === "staff" || params.get("stores") === "one"
		? { ...standInMember, role, stores: standInMember.stores.slice(0, 1) }
		: { ...standInMember, role };
}
