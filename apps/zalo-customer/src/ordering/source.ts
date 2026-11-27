import { createRestClient, type DataEndpoint } from "@fnb/zalo-mini";
import type { CustomerSession } from "@fnb/zalo-mini/loyalty";
import {
	createPaymentClient,
	createRestOrderingClient,
	type OrderingClient,
	type PaymentClient,
} from "@fnb/zalo-mini/ordering";
import { demoWorld } from "../data/source";
import {
	createOrderingWorld,
	type DemoTill,
	type OrderingWorld,
} from "../demo/ordering-world";
import { DEMO_TILL_GLOBAL } from "../demo/till-global";
import type { DemoWorld } from "../demo/world";
import {
	type CheckoutPort,
	standInCheckoutPort,
	zaloCheckoutPort,
} from "./payment-port";

export type OrderingSourceFactory = (
	endpoint: DataEndpoint,
	session: CustomerSession,
) => OrderingClient;

export type PaymentSourceFactory = (
	endpoint: DataEndpoint,
	session: CustomerSession,
) => PaymentClient;

const attached = new WeakMap<DemoWorld, OrderingWorld>();

/** Where the stand-in data's functions answer: the demo world's function fetch reads the name after it. */
const STAND_IN_FUNCTIONS = "stand-in:";

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
		world.settings.onlinePayments,
		world.settings.member,
		!world.settings.einvoiceOff,
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

/**
 * The Edge Function checkout-order with the session: the demo world's stand-in at the wire level with the stand-in
 * data (the same client and readers run as in production), else the function under the Supabase API.
 */
export const paymentClientFor: PaymentSourceFactory = (endpoint, session) => {
	if (endpoint.kind === "stand-in") {
		const world = demoWorld();
		demoOrderingWorld(world);
		return createPaymentClient({
			url: STAND_IN_FUNCTIONS,
			publishableKey: "stand-in",
			accessToken: session.accessToken,
			fetch: (input, init) => world.functionFetch(input, init),
		});
	}
	return createPaymentClient({
		url: endpoint.url,
		publishableKey: endpoint.publishableKey,
		accessToken: session.accessToken,
	});
};

/**
 * Zalo's Checkout SDK inside Zalo; in a browser the stand-in, whose wallet asks the demo till to act as the gateway when
 * the data is the demo world's. Address switches of the stand-in: `?wallet=claim` makes "Thanh toán thử" only claim
 * success (the gateway hears nothing), `?qrPopup=pay|close` answers the QR popup as Zalo would.
 */
export function checkoutPortFor(
	endpoint: DataEndpoint,
	search: string = typeof window === "undefined" ? "" : window.location.search,
): CheckoutPort {
	if (import.meta.env.VITE_ZALO_RUNTIME === "zalo") return zaloCheckoutPort();
	const params = new URLSearchParams(search);
	const popup = params.get("qrPopup");
	return standInCheckoutPort({
		gateway:
			endpoint.kind === "stand-in"
				? (orderId, result) => {
						demoTill().walletResult(orderId, result);
					}
				: null,
		claimOnly: params.get("wallet") === "claim",
		transfer:
			popup === "pay" ? "pay" : popup === "close" ? "close" : "unavailable",
	});
}
