import type { MemberProfile } from "@fnb/zalo-mini";
import {
	type MiniAppRoute,
	type MiniAppTab,
	PlainState,
} from "@fnb/zalo-mini/react";
import { LoyaltyQueueScreen } from "./approvals/loyalty-queue";
import { MyRequestsScreen } from "./approvals/my-requests";
import { CheckInScreen } from "./check-in/check-in-screen";
import { HomeScreen } from "./home/home-screen";
import { HomeIcon, NoticeIcon, ProfileIcon, ShiftIcon } from "./icons";
import { LOYALTY_PATHS } from "./loyalty/env";
import { LoyaltyHomeCard } from "./loyalty/home-card";
import { HomeLoyaltyContext } from "./loyalty/home-slot";
import { LoyaltyRoute } from "./loyalty/route";
import { MemberLookupScreen } from "./member-lookup/member-lookup-screen";
import { ProfileScreen } from "./profile/profile-screen";
import { RedemptionScreen } from "./redemption/redemption-screen";
import { ShiftTaskCards } from "./shift/home-cards";
import { HomeTasksContext } from "./shift/home-slot";
import { ShiftScreen } from "./shift/shift-screen";

export { EntryGate } from "./onboarding/entry-gate";

export const routes: readonly MiniAppRoute[] = [
	{
		path: "/",
		element: (
			<HomeTasksContext.Provider value={ShiftTaskCards}>
				<HomeLoyaltyContext.Provider value={LoyaltyHomeCard}>
					<HomeScreen />
				</HomeLoyaltyContext.Provider>
			</HomeTasksContext.Provider>
		),
	},
	{ path: "/ca-lam", element: <ShiftScreen /> },
	{ path: "/thong-bao", element: <PlainState /> },
	{ path: "/ca-nhan", element: <ProfileScreen /> },
	{
		path: LOYALTY_PATHS.checkIn,
		element: (
			<LoyaltyRoute
				titleKey="checkin.title"
				testId="check-in"
				screen={CheckInScreen}
			/>
		),
	},
	{
		path: LOYALTY_PATHS.redeem,
		element: (
			<LoyaltyRoute
				titleKey="redeem.title"
				testId="redemption"
				screen={RedemptionScreen}
			/>
		),
	},
	{
		path: LOYALTY_PATHS.lookup,
		element: (
			<LoyaltyRoute
				titleKey="lookup.title"
				testId="member-lookup"
				screen={MemberLookupScreen}
			/>
		),
	},
	{
		path: LOYALTY_PATHS.queue,
		element: (
			<LoyaltyRoute
				titleKey="queue.title"
				testId="loyalty-queue"
				screen={LoyaltyQueueScreen}
			/>
		),
	},
	{
		path: LOYALTY_PATHS.requests,
		element: (
			<LoyaltyRoute
				titleKey="requests.title"
				testId="my-requests"
				screen={MyRequestsScreen}
			/>
		),
	},
];

export const tabs: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "tab.home", icon: <HomeIcon /> },
	{ path: "/ca-lam", labelKey: "tab.shifts", icon: <ShiftIcon /> },
	{ path: "/thong-bao", labelKey: "tab.notices", icon: <NoticeIcon /> },
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
	const requested = new URLSearchParams(search).get("role");
	const role = STAND_IN_ROLES.find((name) => name === requested);
	if (role === undefined) return standInMember;
	return role === "staff"
		? { ...standInMember, role, stores: standInMember.stores.slice(0, 1) }
		: { ...standInMember, role };
}
