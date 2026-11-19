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
import { LoyaltyQueueScreen } from "../approvals/loyalty-queue";
import { MyRequestsScreen } from "../approvals/my-requests";
import { CheckInScreen } from "../check-in/check-in-screen";
import { catalogs } from "../i18n/catalog";
import type { LoyaltyClient } from "../loyalty/contract";
import { DEMO_PHONES, type DemoLoyaltyClient } from "../loyalty/demo";
import { LOYALTY_PATHS, type LoyaltyPath } from "../loyalty/env";
import { LoyaltyHomeCard } from "../loyalty/home-card";
import { LoyaltyRoute } from "../loyalty/route";
import type { ScanResult, ScanTools } from "../loyalty/scan";
import { ScanToolsProvider } from "../loyalty/scan";
import {
	createDemoLoyaltySource,
	type LoyaltySource,
	sampleLoyaltyContext,
} from "../loyalty/source";
import { MemberLookupScreen } from "../member-lookup/member-lookup-screen";
import { RedemptionScreen } from "../redemption/redemption-screen";

export const STORE_1 = "00000000-0000-4000-8000-0000000005a1";
export const STORE_2 = "00000000-0000-4000-8000-0000000005a2";
export const BOTH_STORES = ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"];
export const NOON = new Date("2026-11-19T05:00:00Z");
export { DEMO_PHONES };

export interface FakeScanTools extends ScanTools {
	readonly calls: readonly string[];
}

export function fakeScanTools(results: readonly ScanResult[]): FakeScanTools {
	const queue = [...results];
	const calls: string[] = [];
	return {
		calls,
		async scan(purpose) {
			calls.push(purpose);
			return queue.shift() ?? { kind: "cancelled" };
		},
	};
}

export interface LoyaltyOptions {
	readonly path: LoyaltyPath;
	readonly role?: MemberRole;
	readonly stores?: readonly string[];
	readonly client?: LoyaltyClient;
	readonly scan?: ScanTools;
	readonly language?: "vi" | "en";
	readonly membershipId?: string;
	readonly storeId?: string;
	readonly withHome?: boolean;
}

export interface LoyaltyHarness {
	source(): LoyaltySource & { readonly client: LoyaltyClient };
	demo(): DemoLoyaltyClient;
}

const SCREENS = {
	[LOYALTY_PATHS.checkIn]: {
		titleKey: "checkin.title",
		testId: "check-in",
		screen: CheckInScreen,
	},
	[LOYALTY_PATHS.redeem]: {
		titleKey: "redeem.title",
		testId: "redemption",
		screen: RedemptionScreen,
	},
	[LOYALTY_PATHS.lookup]: {
		titleKey: "lookup.title",
		testId: "member-lookup",
		screen: MemberLookupScreen,
	},
	[LOYALTY_PATHS.queue]: {
		titleKey: "queue.title",
		testId: "loyalty-queue",
		screen: LoyaltyQueueScreen,
	},
	[LOYALTY_PATHS.requests]: {
		titleKey: "requests.title",
		testId: "my-requests",
		screen: MyRequestsScreen,
	},
} as const;

interface Launch {
	done: boolean;
	readonly path: LoyaltyPath;
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

export function renderLoyalty(options: LoyaltyOptions): LoyaltyHarness {
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
	let created: (LoyaltySource & { readonly client: LoyaltyClient }) | null =
		null;
	const sourceFor = (_: unknown, session: StoredSession) => {
		if (created !== null) return created;
		created =
			options.client === undefined
				? createDemoLoyaltySource({ delayMs: 0 }, session)
				: {
						client: options.client,
						sampleBadge: false,
						context: async (query, now) => sampleLoyaltyContext(query, now),
					};
		return created;
	};
	const launch = {
		done: options.withHome === true,
		path: options.path,
		state: {
			loyalty: {
				storeId: options.storeId ?? null,
				membershipId: options.membershipId ?? null,
			},
		},
	};
	const routes: MiniAppRoute[] = [
		{
			path: "/",
			element: (
				<Launcher launch={launch}>
					{options.withHome === true ? (
						<LoyaltyHomeCard
							storeId={options.storeId ?? STORE_1}
							sourceFor={sourceFor}
						/>
					) : (
						"home"
					)}
				</Launcher>
			),
		},
		...Object.entries(SCREENS).map(([path, entry]) => ({
			path,
			element: (
				<LoyaltyRoute
					titleKey={entry.titleKey}
					testId={entry.testId}
					screen={entry.screen}
					sourceFor={sourceFor}
				/>
			),
		})),
	];
	render(
		<ScanToolsProvider tools={options.scan ?? fakeScanTools([])}>
			<MiniApp
				language={options.language ?? "vi"}
				catalogs={catalogs}
				sessionClient={standIn}
				routes={routes}
				tabs={[]}
				standInHeader={null}
			/>
		</ScanToolsProvider>,
	);
	return {
		source() {
			if (created === null)
				throw new Error("the loyalty source is not made yet");
			return created;
		},
		demo() {
			if (created === null)
				throw new Error("the loyalty source is not made yet");
			return created.client as DemoLoyaltyClient;
		},
	};
}

export function primaryActions(): HTMLElement[] {
	const dialog = document.querySelector("[role=dialog]");
	const root = (dialog ?? document.body) as HTMLElement;
	return [...root.querySelectorAll<HTMLElement>("[data-action=primary]")];
}

export async function screenReady(testId: string): Promise<HTMLElement> {
	const found = await screen.findByTestId(testId, {}, { timeout: 4000 });
	return found;
}
