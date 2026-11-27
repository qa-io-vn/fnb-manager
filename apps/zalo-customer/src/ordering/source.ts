import { createRestClient, type DataEndpoint } from "@fnb/zalo-mini";
import type { CustomerSession } from "@fnb/zalo-mini/loyalty";
import {
	createRestOrderingClient,
	type OrderingClient,
} from "@fnb/zalo-mini/ordering";
import { demoWorld } from "../data/source";
import {
	createOrderingWorld,
	type DemoTill,
	type OrderingWorld,
} from "../demo/ordering-world";
import { DEMO_TILL_GLOBAL } from "../demo/till-global";
import type { DemoWorld } from "../demo/world";

export type OrderingSourceFactory = (
	endpoint: DataEndpoint,
	session: CustomerSession,
) => OrderingClient;

const attached = new WeakMap<DemoWorld, OrderingWorld>();

/**
 * The demo world with the native till's functions added (the stand-in data of browser mode), and its till exposed on
 * the page for a browser test acting as staff. Only the ordering build gets here, and only with the stand-in data.
 */
export function demoOrderingWorld(
	world: DemoWorld = demoWorld(),
): OrderingWorld {
	const known = attached.get(world);
	if (known !== undefined) return known;
	const ordering = createOrderingWorld(
		world.now,
		world.settings.orderingReason,
	);
	world.extend(ordering);
	attached.set(world, ordering);
	if (typeof window !== "undefined")
		Object.assign(window, { [DEMO_TILL_GLOBAL]: ordering.till });
	return ordering;
}

/** The till of the current demo world, for unit tests. */
export function demoTill(): DemoTill {
	return demoOrderingWorld().till;
}

/** The native till's functions: the demo world with the stand-in data, else the Data API with the session. */
export const orderingClientFor: OrderingSourceFactory = (endpoint, session) => {
	if (endpoint.kind === "stand-in") {
		const world = demoWorld();
		demoOrderingWorld(world);
		return createRestOrderingClient(world.rest(session.accessToken));
	}
	return createRestOrderingClient(
		createRestClient({
			url: endpoint.url,
			publishableKey: endpoint.publishableKey,
			accessToken: session.accessToken,
		}),
	);
};
