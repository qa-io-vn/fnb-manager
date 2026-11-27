import config from "virtual:mini-app-config";
import { fromZmpNativeStorage, type Language } from "@fnb/zalo-mini";
import { MiniApp } from "@fnb/zalo-mini/react";
import { resetMockSdk } from "@fnb/zalo-mini/testing/mock-sdk";
import { render } from "@testing-library/react";
import { nativeStorage } from "zmp-sdk";
import { demoSessionClient, resetDemoWorld } from "../data/source";
import type { DemoTill } from "../demo/ordering-world";
import {
	DEMO_DEFAULTS,
	type DemoSettings,
	type DemoWorld,
} from "../demo/world";
import {
	OrderingGate,
	orderingAboveTabs,
	orderingCatalogs,
	orderingRoutes,
	orderingTabs,
} from "../ordering/ordering-app";
import { demoOrderingWorld } from "../ordering/source";
import { setSearch } from "./render-app";

export interface OrderingRenderOptions {
	readonly settings?: Partial<DemoSettings>;
	/** the address the app opens with, such as ?store=mau-1&src=table&t=demo-table-12 */
	readonly search?: string;
	readonly language?: Language;
	readonly now?: () => number;
}

export interface RenderedOrderingApp {
	readonly world: DemoWorld;
	readonly till: DemoTill;
}

/** The ordering build's shell (VITE_ORDERING=on) on the demo world, as renderCustomerApp renders the loyalty build. */
export function renderOrderingApp(
	options: OrderingRenderOptions = {},
): RenderedOrderingApp {
	setSearch(options.search ?? "");
	resetMockSdk();
	nativeStorage.clear();
	const world = resetDemoWorld(
		{ ...DEMO_DEFAULTS, ...options.settings },
		options.now,
	);
	const ordering = demoOrderingWorld(world);
	render(
		<MiniApp
			language={options.language ?? "vi"}
			catalogs={orderingCatalogs}
			customerSessionClient={demoSessionClient(
				fromZmpNativeStorage(nativeStorage),
			)}
			routes={orderingRoutes}
			tabs={orderingTabs}
			standInHeader={config.app}
			gate={OrderingGate}
			aboveTabs={orderingAboveTabs}
		/>,
	);
	return { world, till: ordering.till };
}
