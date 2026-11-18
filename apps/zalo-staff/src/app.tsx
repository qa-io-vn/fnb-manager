import type { MemberProfile } from "@fnb/zalo-mini";
import {
	type MiniAppRoute,
	type MiniAppTab,
	PlainState,
} from "@fnb/zalo-mini/react";
import { HomeScreen } from "./home/home-screen";
import { HomeIcon, NoticeIcon, ProfileIcon, ShiftIcon } from "./icons";
import { ProfileScreen } from "./profile/profile-screen";
import { ShiftTaskCards } from "./shift/home-cards";
import { HomeTasksContext } from "./shift/home-slot";
import { ShiftScreen } from "./shift/shift-screen";

export { EntryGate } from "./onboarding/entry-gate";

export const routes: readonly MiniAppRoute[] = [
	{
		path: "/",
		element: (
			<HomeTasksContext.Provider value={ShiftTaskCards}>
				<HomeScreen />
			</HomeTasksContext.Provider>
		),
	},
	{ path: "/ca-lam", element: <ShiftScreen /> },
	{ path: "/thong-bao", element: <PlainState /> },
	{ path: "/ca-nhan", element: <ProfileScreen /> },
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
