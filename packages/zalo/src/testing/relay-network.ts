import type { ZaloFetch } from "../http.js";
import {
	openRelayRequest,
	RELAY_PATH,
	ReplayGuard,
	sealRelayAnswer,
	ZALO_GRAPH_ORIGIN,
} from "../relay.js";

export const SYNTHETIC_RELAY_URL =
	"https://synthetic-relay-0001.trycloudflare.com";

export interface RelayNetwork {
	/** The network the function sees: the relay at SYNTHETIC_RELAY_URL, the Graph and anything else via `graph`. */
	readonly fetch: ZaloFetch;
	/** Graph calls that arrived through the relay. */
	relayed(): number;
	/** Graph calls that went straight to the Graph. */
	direct(): number;
	/** Every relay request body as sent over the wire. */
	wire(): readonly string[];
	/** Makes the relay unreachable (a stopped tunnel) or reachable again. */
	setDown(down: boolean): void;
}

/**
 * A stand-in network for tests of the relay path (ADR-057): requests to the synthetic relay are opened with the key
 * and forwarded to `graph` (a mock Zalo's fetch), answers are sealed back; direct Graph calls are counted.
 */
export function createRelayNetwork(
	key: CryptoKey,
	graph: ZaloFetch,
	now: () => number = () => Date.now(),
): RelayNetwork {
	const guard = new ReplayGuard();
	const bodies: string[] = [];
	let relayed = 0;
	let direct = 0;
	let down = false;
	return {
		async fetch(url, init) {
			if (url === `${SYNTHETIC_RELAY_URL}${RELAY_PATH}`) {
				if (down) {
					throw new TypeError("the tunnel is down");
				}
				bodies.push(init.body ?? "");
				const request = await openRelayRequest(
					key,
					init.body ?? "",
					now(),
					guard,
				);
				relayed += 1;
				const answer = await graph(
					`${ZALO_GRAPH_ORIGIN}${request.path}${request.query === "" ? "" : `?${request.query}`}`,
					{ method: "GET", headers: request.headers },
				);
				return new Response(
					await sealRelayAnswer(key, request.id, {
						status: answer.status,
						body: await answer.text(),
					}),
					{ status: 200 },
				);
			}
			if (url.startsWith(`${ZALO_GRAPH_ORIGIN}/`)) {
				direct += 1;
			}
			return graph(url, init);
		},
		relayed: () => relayed,
		direct: () => direct,
		wire: () => [...bodies],
		setDown(value) {
			down = value;
		},
	};
}
