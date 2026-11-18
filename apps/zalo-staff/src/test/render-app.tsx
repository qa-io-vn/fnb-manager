import config from "virtual:mini-app-config";
import {
	createStandInSessionClient,
	type DataEndpoint,
	fromZmpNativeStorage,
	type MemberProfile,
	type SessionClient,
	type StandInScenario,
} from "@fnb/zalo-mini";
import { MiniApp, type MiniAppRoute } from "@fnb/zalo-mini/react";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { getAccessToken, nativeStorage } from "zmp-sdk";
import { routes as appRoutes, standInMember, tabs } from "../app";
import { catalogs } from "../i18n/catalog";
import type { StaffAccountFactory } from "../onboarding/account";
import { EntryGate } from "../onboarding/entry-gate";

export interface StaffAppOptions {
	readonly scenario?: StandInScenario;
	readonly language?: "vi" | "en";
	readonly member?: MemberProfile;
	readonly noticeChange?: boolean;
	readonly delayMs?: number;
	readonly accountFor?: StaffAccountFactory;
	readonly client?: (client: SessionClient) => SessionClient;
	readonly dataEndpoint?: DataEndpoint;
	readonly routes?: readonly MiniAppRoute[];
}

let testAccountFor: StaffAccountFactory | null = null;

function TestGate({ children }: { readonly children: ReactNode }) {
	return testAccountFor === null ? (
		<EntryGate>{children}</EntryGate>
	) : (
		<EntryGate accountFor={testAccountFor}>{children}</EntryGate>
	);
}

export function renderStaffApp(options: StaffAppOptions = {}) {
	nativeStorage.clear();
	const standIn = createStandInSessionClient({
		settings: {
			scenario: options.scenario ?? "bound",
			delayMs: options.delayMs ?? 0,
			...(options.noticeChange === true ? { noticeChange: true } : {}),
		},
		member: options.member ?? standInMember,
		storage: fromZmpNativeStorage(nativeStorage),
		getAccessToken: () => getAccessToken(),
		onboarding: true,
	});
	const sessionClient = options.client ? options.client(standIn) : standIn;
	testAccountFor = options.accountFor ?? null;
	return render(
		<MiniApp
			language={options.language ?? "vi"}
			catalogs={catalogs}
			sessionClient={sessionClient}
			routes={options.routes ?? appRoutes}
			tabs={tabs}
			standInHeader={config.app}
			gate={TestGate}
			{...(options.dataEndpoint === undefined
				? {}
				: { dataEndpoint: options.dataEndpoint })}
		/>,
	);
}
