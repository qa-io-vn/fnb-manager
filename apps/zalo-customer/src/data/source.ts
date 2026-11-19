import {
	type CustomerSessionClient,
	createRestClient,
	createZaloCustomerSessionClient,
	type DataEndpoint,
	type NativeStorage,
	RestError,
	refusalCode,
} from "@fnb/zalo-mini";
import {
	type CustomerSession,
	createRestLoyaltyClient,
	type LoyaltyClient,
	REFUSAL_NOT_MEMBER,
} from "@fnb/zalo-mini/loyalty";
import { getAccessToken } from "zmp-sdk";
import {
	createDemoWorld,
	type DemoSettings,
	type DemoWorld,
	demoSettingsFrom,
} from "../demo/world";

let world: DemoWorld | null = null;

export function demoWorld(): DemoWorld {
	if (world === null) {
		world = createDemoWorld(
			demoSettingsFrom(
				typeof window === "undefined" ? "" : window.location.search,
			),
		);
	}
	return world;
}

export function resetDemoWorld(
	settings?: DemoSettings,
	now?: () => number,
): DemoWorld {
	world = createDemoWorld(settings, now);
	return world;
}

export function demoSessionClient(
	storage: NativeStorage,
): CustomerSessionClient {
	return createZaloCustomerSessionClient({
		endpoint: "stand-in:zalo-session",
		brandKey: "stand-in",
		publishableKey: "stand-in",
		storage,
		getAccessToken: () => getAccessToken(),
		fetch: (input, init) => demoWorld().sessionFetch(input, init),
	});
}

export type LoyaltySourceFactory = (
	endpoint: DataEndpoint,
	session: CustomerSession,
) => LoyaltyClient;

export const loyaltyClientFor: LoyaltySourceFactory = (endpoint, session) =>
	createRestLoyaltyClient(
		endpoint.kind === "stand-in"
			? demoWorld().rest(session.accessToken)
			: createRestClient({
					url: endpoint.url,
					publishableKey: endpoint.publishableKey,
					accessToken: session.accessToken,
				}),
	);

export type Failure = "network" | "session" | "not-member" | "unknown";

export function failureOf(error: unknown): Failure {
	if (!(error instanceof RestError)) return "unknown";
	if (error.status === 0) return "network";
	if (error.status === 401) return "session";
	if (refusalCode(error) === REFUSAL_NOT_MEMBER) return "not-member";
	if (error.status === 403) return "session";
	return "unknown";
}
