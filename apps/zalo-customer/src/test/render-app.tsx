import config from "virtual:mini-app-config";
import {
	type CustomerSessionClient,
	fromZmpNativeStorage,
	type Language,
} from "@fnb/zalo-mini";
import { MiniApp, type MiniAppRoute } from "@fnb/zalo-mini/react";
import { resetMockSdk } from "@fnb/zalo-mini/testing/mock-sdk";
import { render } from "@testing-library/react";
import { nativeStorage } from "zmp-sdk";
import { CustomerGate, routes, tabs } from "../app";
import { demoSessionClient, resetDemoWorld } from "../data/source";
import {
	DEMO_DEFAULTS,
	type DemoSettings,
	type DemoWorld,
} from "../demo/world";
import { catalogs } from "../i18n/catalog";

export interface RenderOptions {
	readonly settings?: Partial<DemoSettings>;
	readonly search?: string;
	readonly language?: Language;
	readonly now?: () => number;
	readonly routes?: readonly MiniAppRoute[];
}

export interface RenderedApp {
	readonly world: DemoWorld;
	readonly sessionClient: CustomerSessionClient;
	readonly storedKeys: () => string[];
	readonly fetches: () => readonly string[];
}

export function setSearch(search: string): void {
	window.history.replaceState({}, "", `/${search}`);
}

export function renderCustomerApp(options: RenderOptions = {}): RenderedApp {
	setSearch(options.search ?? "");
	resetMockSdk();
	nativeStorage.clear();
	const world = resetDemoWorld(
		{ ...DEMO_DEFAULTS, ...options.settings },
		options.now,
	);
	const bodies: string[] = [];
	const original = world.sessionFetch;
	Object.assign(world, {
		sessionFetch: (input: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(typeof init?.body === "string" ? init.body : "");
			return original(input, init);
		},
	});
	const storage = fromZmpNativeStorage(nativeStorage);
	const sessionClient = demoSessionClient(storage);
	render(
		<MiniApp
			language={options.language ?? "vi"}
			catalogs={catalogs}
			customerSessionClient={sessionClient}
			routes={options.routes ?? routes}
			tabs={options.routes === undefined ? tabs : []}
			standInHeader={config.app}
			gate={CustomerGate}
		/>,
	);
	return {
		world,
		sessionClient,
		storedKeys: () =>
			["fnb.customer-session", "fnb.session"].filter(
				(key) => storage.getItem(key) !== null,
			),
		fetches: () => bodies,
	};
}
