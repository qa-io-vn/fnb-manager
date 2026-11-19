import {
	createStandInSessionClient,
	fromZmpNativeStorage,
	type MemberRole,
	type StoredSession,
} from "@fnb/zalo-mini";
import { MiniApp, type MiniAppRoute } from "@fnb/zalo-mini/react";
import { render, screen } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAccessToken, nativeStorage } from "zmp-sdk";
import { catalogs } from "../i18n/catalog";
import { sampleLoyaltyContext } from "../loyalty/source";
import { SAMPLE_MEMBER_ID } from "../shift/sample";
import type { TeamClient } from "../team/client";
import type { DemoTeamClient } from "../team/demo";
import { type TeamOpen, type TeamPath, teamOpenState } from "../team/env";
import { teamRoutes } from "../team/screens";
import { createDemoTeamSource, type TeamSource } from "../team/source";

export const BOTH_STORES = ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"];
export const NOON = new Date("2026-11-19T05:00:00Z");

export interface TeamOptions {
	readonly path: TeamPath | "/";
	readonly role?: MemberRole;
	readonly stores?: readonly string[];
	readonly client?: TeamClient;
	readonly memberId?: string | null;
	readonly language?: "vi" | "en";
	readonly open?: Partial<TeamOpen>;
	readonly home?: (sourceFor: TeamSourceFor) => ReactNode;
	readonly extraRoutes?: readonly MiniAppRoute[];
}

export type TeamSourceFor = (_: unknown, session: StoredSession) => TeamSource;

export interface TeamHarness {
	source(): TeamSource;
	demo(): DemoTeamClient;
}

interface Launch {
	done: boolean;
	readonly path: TeamPath | "/";
	readonly state: unknown;
}

function Launcher({
	launch,
	children,
}: {
	readonly launch: Launch;
	readonly children: ReactNode;
}) {
	const navigate = useNavigate();
	useEffect(() => {
		if (launch.done) return;
		launch.done = true;
		navigate(launch.path, { state: launch.state });
	}, [navigate, launch]);
	return <div data-testid="home-placeholder">{children}</div>;
}

export function renderTeam(options: TeamOptions): TeamHarness {
	nativeStorage.clear();
	const role = options.role ?? "staff";
	const stores =
		options.stores ??
		(role === "staff" ? BOTH_STORES.slice(0, 1) : BOTH_STORES);
	const standIn = createStandInSessionClient({
		settings: { scenario: "bound", delayMs: 0 },
		member: { displayName: "Thành viên thử", role, stores },
		storage: fromZmpNativeStorage(nativeStorage),
		getAccessToken: () => getAccessToken(),
	});
	let created: TeamSource | null = null;
	const sourceFor: TeamSourceFor = (_, session) => {
		if (created !== null) return created;
		created =
			options.client === undefined
				? createDemoTeamSource({ delayMs: 0 }, session)
				: {
						client: options.client,
						memberId:
							options.memberId === undefined
								? SAMPLE_MEMBER_ID
								: options.memberId,
						context: async (query, now) => sampleLoyaltyContext(query, now),
					};
		return created;
	};
	const launch: Launch = {
		done: options.path === "/",
		path: options.path,
		state: teamOpenState(options.open ?? {}),
	};
	const routes: MiniAppRoute[] = [
		{
			path: "/",
			element: (
				<Launcher launch={launch}>
					{options.home === undefined ? "home" : options.home(sourceFor)}
				</Launcher>
			),
		},
		...teamRoutes(sourceFor),
		...(options.extraRoutes ?? []),
	];
	render(
		<MiniApp
			language={options.language ?? "vi"}
			catalogs={catalogs}
			sessionClient={standIn}
			routes={routes}
			tabs={[]}
			standInHeader={null}
		/>,
	);
	return {
		source() {
			if (created === null) throw new Error("the team source is not made yet");
			return created;
		},
		demo() {
			if (created === null) throw new Error("the team source is not made yet");
			return created.client as DemoTeamClient;
		},
	};
}

export function primaryActions(): HTMLElement[] {
	const dialog = document.querySelector("[role=dialog]");
	const root = (dialog ?? document.body) as HTMLElement;
	return [...root.querySelectorAll<HTMLElement>("[data-action=primary]")];
}

export async function screenReady(testId: string): Promise<HTMLElement> {
	return screen.findByTestId(testId, {}, { timeout: 4000 });
}
