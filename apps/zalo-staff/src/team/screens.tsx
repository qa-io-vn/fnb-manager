import type { MiniAppRoute } from "@fnb/zalo-mini/react";
import type { ComponentType } from "react";
import { AnnouncementsScreen } from "../announcements/announcements-screen";
import { NotificationSettingsScreen } from "../notifications/settings-screen";
import { ApprovalQueueScreen } from "../requests/approval-queue";
import { MyTeamRequestsScreen } from "../requests/my-requests";
import { SendRequestScreen } from "../requests/send-request";
import { TEAM_PATHS, type TeamPath } from "./env";
import { TeamRoute, type TeamScreenProps } from "./route";
import type { TeamSourceFactory } from "./source";

export interface TeamScreenEntry {
	readonly path: TeamPath;
	readonly titleKey: string;
	readonly testId: string;
	readonly screen: ComponentType<TeamScreenProps>;
}

export const TEAM_SCREENS: readonly TeamScreenEntry[] = [
	{
		path: TEAM_PATHS.notices,
		titleKey: "notices.title",
		testId: "announcements",
		screen: AnnouncementsScreen,
	},
	{
		path: TEAM_PATHS.sendRequest,
		titleKey: "ask.title",
		testId: "send-request",
		screen: SendRequestScreen,
	},
	{
		path: TEAM_PATHS.myRequests,
		titleKey: "ask.mine",
		testId: "team-requests",
		screen: MyTeamRequestsScreen,
	},
	{
		path: TEAM_PATHS.approvals,
		titleKey: "approvals.title",
		testId: "approvals",
		screen: ApprovalQueueScreen,
	},
	{
		path: TEAM_PATHS.notifications,
		titleKey: "notify.title",
		testId: "notification-settings",
		screen: NotificationSettingsScreen,
	},
];

export function teamRoutes(sourceFor?: TeamSourceFactory): MiniAppRoute[] {
	return TEAM_SCREENS.map((entry) => ({
		path: entry.path,
		element: (
			<TeamRoute
				titleKey={entry.titleKey}
				testId={entry.testId}
				screen={entry.screen}
				{...(sourceFor === undefined ? {} : { sourceFor })}
			/>
		),
	}));
}
