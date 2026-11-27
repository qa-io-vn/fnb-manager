import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getAccessToken, getSystemInfo, nativeStorage } from "zmp-sdk";
import type { MiniAppBuildConfig } from "../app-config/index";
import { type DataEndpoint, dataEndpointFrom } from "../data/endpoint";
import { type Catalog, type Language, languageFrom } from "../i18n/translate";
import { ZALO_SESSION_PATH } from "../session/endpoint";
import {
	createStandInSessionClient,
	standInSettingsFrom,
} from "../session/stand-in";
import type { MemberProfile, SessionClient } from "../session/types";
import { createZaloSessionClient } from "../session/zalo-session-client";
import { fromZmpNativeStorage } from "../storage/native-storage";
import { applyBrandTheme } from "./brand-theme";
import {
	MiniApp,
	type MiniAppGate,
	type MiniAppRoute,
	type MiniAppTab,
} from "./mini-app-shell";

export const MINI_APP_ROOT_ID = "app";

export interface MiniAppEnvironment {
	readonly runtime: "browser" | "zalo";
	readonly language: Language;
	readonly sessionClient: SessionClient;
	readonly dataEndpoint: DataEndpoint;
}

export function miniAppEnvironment(
	config: MiniAppBuildConfig,
	standInMember: MemberProfile,
	onboarding = false,
): MiniAppEnvironment {
	const storage = fromZmpNativeStorage(nativeStorage);
	const language = languageFrom(getSystemInfo().zaloLanguage);
	const publishableKey = String(
		import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
	);
	const dataEndpoint = dataEndpointFrom({
		runtime: String(import.meta.env.VITE_ZALO_RUNTIME ?? ""),
		session: String(import.meta.env.VITE_ZALO_SESSION ?? ""),
		supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL ?? ""),
		publishableKey,
	});
	if (import.meta.env.VITE_ZALO_RUNTIME === "zalo") {
		const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "");
		return {
			runtime: "zalo",
			language,
			dataEndpoint,
			sessionClient: createZaloSessionClient({
				endpoint: `${supabaseUrl.replace(/\/$/, "")}${ZALO_SESSION_PATH}`,
				brandKey: config.brand,
				publishableKey,
				storage,
				getAccessToken: () => getAccessToken(),
				onboarding,
			}),
		};
	}
	if (import.meta.env.VITE_ZALO_SESSION === "local") {
		return {
			runtime: "browser",
			language,
			dataEndpoint,
			sessionClient: createZaloSessionClient({
				endpoint: ZALO_SESSION_PATH,
				brandKey: config.brand,
				publishableKey,
				storage,
				getAccessToken: () => getAccessToken(),
				onboarding,
			}),
		};
	}
	return {
		runtime: "browser",
		language,
		dataEndpoint,
		sessionClient: createStandInSessionClient({
			settings: standInSettingsFrom(window.location.search),
			member: standInMember,
			storage,
			getAccessToken: () => getAccessToken(),
			onboarding,
		}),
	};
}

export interface BootOptions {
	readonly config: MiniAppBuildConfig;
	readonly catalogs: Readonly<Record<Language, Catalog>>;
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
	readonly standInMember: MemberProfile;
	readonly onboarding?: boolean;
	readonly gate?: MiniAppGate;
	/** A strip above the tab bar on tab routes (see MiniApp). */
	readonly aboveTabs?: ReactNode;
}

export function bootMiniApp(options: BootOptions): void {
	const container = document.getElementById(MINI_APP_ROOT_ID);
	if (!container)
		throw new Error(`the page needs <div id="${MINI_APP_ROOT_ID}">`);
	const environment = miniAppEnvironment(
		options.config,
		options.standInMember,
		options.onboarding === true,
	);
	document.title = options.config.app.title;
	applyBrandTheme(options.config.theme);
	createRoot(container).render(
		<StrictMode>
			<MiniApp
				language={environment.language}
				catalogs={options.catalogs}
				sessionClient={environment.sessionClient}
				routes={options.routes}
				tabs={options.tabs}
				standInHeader={
					environment.runtime === "browser" ? options.config.app : null
				}
				dataEndpoint={environment.dataEndpoint}
				{...(options.gate === undefined ? {} : { gate: options.gate })}
				{...(options.aboveTabs === undefined
					? {}
					: { aboveTabs: options.aboveTabs })}
			/>
		</StrictMode>,
	);
}
