import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getAccessToken, getSystemInfo, nativeStorage } from "zmp-sdk";
import type { MiniAppBuildConfig } from "../app-config/index";
import { type DataEndpoint, dataEndpointFrom } from "../data/endpoint";
import { type Catalog, type Language, languageFrom } from "../i18n/translate";
import {
	type CustomerSessionClient,
	createZaloCustomerSessionClient,
} from "../session/customer-session-client";
import { ZALO_SESSION_PATH } from "../session/endpoint";
import {
	fromZmpNativeStorage,
	type NativeStorage,
} from "../storage/native-storage";
import { MINI_APP_ROOT_ID } from "./boot";
import { applyBrandTheme } from "./brand-theme";
import {
	MiniApp,
	type MiniAppGate,
	type MiniAppRoute,
	type MiniAppTab,
} from "./mini-app-shell";

export type CustomerStandIn = (storage: NativeStorage) => CustomerSessionClient;

export interface CustomerEnvironment {
	readonly runtime: "browser" | "zalo";
	readonly language: Language;
	readonly sessionClient: CustomerSessionClient;
	readonly dataEndpoint: DataEndpoint;
}

export function customerMiniAppEnvironment(
	config: MiniAppBuildConfig,
	standIn: CustomerStandIn,
): CustomerEnvironment {
	const storage = fromZmpNativeStorage(nativeStorage);
	const language = languageFrom(getSystemInfo().zaloLanguage);
	const publishableKey = String(
		import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
	);
	const runtime = String(import.meta.env.VITE_ZALO_RUNTIME ?? "");
	const session = String(import.meta.env.VITE_ZALO_SESSION ?? "");
	const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "");
	const dataEndpoint = dataEndpointFrom({
		runtime,
		session,
		supabaseUrl,
		publishableKey,
	});
	if (runtime === "zalo" || session === "local") {
		return {
			runtime: runtime === "zalo" ? "zalo" : "browser",
			language,
			dataEndpoint,
			sessionClient: createZaloCustomerSessionClient({
				endpoint:
					runtime === "zalo"
						? `${supabaseUrl.replace(/\/$/, "")}${ZALO_SESSION_PATH}`
						: ZALO_SESSION_PATH,
				brandKey: config.brand,
				publishableKey,
				storage,
				getAccessToken: () => getAccessToken(),
			}),
		};
	}
	return {
		runtime: "browser",
		language,
		dataEndpoint,
		sessionClient: standIn(storage),
	};
}

export interface CustomerBootOptions {
	readonly config: MiniAppBuildConfig;
	readonly catalogs: Readonly<Record<Language, Catalog>>;
	readonly routes: readonly MiniAppRoute[];
	readonly tabs: readonly MiniAppTab[];
	readonly standIn: CustomerStandIn;
	readonly gate?: MiniAppGate;
}

export function bootCustomerMiniApp(options: CustomerBootOptions): void {
	const container = document.getElementById(MINI_APP_ROOT_ID);
	if (!container)
		throw new Error(`the page needs <div id="${MINI_APP_ROOT_ID}">`);
	const environment = customerMiniAppEnvironment(
		options.config,
		options.standIn,
	);
	document.title = options.config.app.title;
	applyBrandTheme(options.config.theme);
	createRoot(container).render(
		<StrictMode>
			<MiniApp
				language={environment.language}
				catalogs={options.catalogs}
				customerSessionClient={environment.sessionClient}
				routes={options.routes}
				tabs={options.tabs}
				standInHeader={
					environment.runtime === "browser" ? options.config.app : null
				}
				dataEndpoint={environment.dataEndpoint}
				{...(options.gate === undefined ? {} : { gate: options.gate })}
			/>
		</StrictMode>,
	);
}
