import type { MemberProfile } from "@fnb/zalo-mini";
import {
	type MiniAppRoute,
	type MiniAppTab,
	PlainState,
	SessionScreen,
} from "@fnb/zalo-mini/react";
import { HomeIcon, NoticeIcon, ProfileIcon, ShiftIcon } from "./icons";

export const routes: readonly MiniAppRoute[] = [
	{ path: "/", element: <SessionScreen /> },
	{ path: "/ca-lam", element: <PlainState /> },
	{ path: "/thong-bao", element: <PlainState /> },
	{ path: "/ca-nhan", element: <PlainState /> },
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
};
