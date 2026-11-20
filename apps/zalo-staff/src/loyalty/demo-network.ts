import { RestError } from "@fnb/zalo-mini";
import type { BillsClient } from "./bills-contract";
import type { LoyaltyClient } from "./contract";

// A stand-in network for the browser demo. Off by default: the demo answers at once and never fails, so every existing
// screen test is unchanged. With `?net=` in the address it behaves like a real connection, for the network failure tests:
//   strict      a call made or answered while the browser is offline fails like a dropped request (status 0)
//   lost-once   as strict, and the first call that changes something is committed, then its answer is lost
//   error-once  as strict, and the first call that changes something is refused with a server error before it commits
// `?answerDelay=` (ms) is the time between the commit and the answer, the window in which the connection can drop.
export type DemoNetworkFault = "none" | "strict" | "lost-once" | "error-once";

export interface DemoNetwork {
	readonly fault: DemoNetworkFault;
	readonly delayMs: number;
	readonly answerDelayMs: number;
}

const MAX_DELAY_MS = 10_000;
const FAULTS: readonly DemoNetworkFault[] = [
	"strict",
	"lost-once",
	"error-once",
];
const CHANGES: ReadonlySet<string> = new Set<string>([
	"recordCheckin",
	"verifyRedemption",
]);
const CALLS: readonly string[] = [
	"recordCheckin",
	"verifyRedemption",
	"lookupMember",
	"request",
	"queue",
	"act",
	"myRequests",
];
const BILL_CHANGES: ReadonlySet<string> = new Set<string>([
	"submit",
	"reverse",
	"answerClaim",
	"decide",
	"closeAudit",
	"confirmRedemption",
	"voidRedemption",
]);
const BILL_CALLS: readonly string[] = [
	...BILL_CHANGES,
	"recent",
	"mode",
	"counterCode",
	"counterClaims",
	"queue",
];

function milliseconds(value: string | null): number {
	const parsed = Number(value ?? "0");
	return Number.isInteger(parsed) && parsed > 0
		? Math.min(parsed, MAX_DELAY_MS)
		: 0;
}

export function demoNetworkFrom(search: string): DemoNetwork {
	const params = new URLSearchParams(search);
	const requested = params.get("net");
	return {
		fault: FAULTS.find((name) => name === requested) ?? "none",
		delayMs: milliseconds(params.get("dataDelay")),
		answerDelayMs: milliseconds(params.get("answerDelay")),
	};
}

function offline(): boolean {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

function wait(ms: number): Promise<void> {
	return ms > 0
		? new Promise((resolve) => setTimeout(resolve, ms))
		: Promise.resolve();
}

export function withDemoNetwork<C extends LoyaltyClient>(
	client: C,
	network: DemoNetwork,
): C {
	return wrapCalls(client, network, CALLS, CHANGES);
}

export function withDemoBillsNetwork<C extends BillsClient>(
	client: C,
	network: DemoNetwork,
): C {
	return wrapCalls(client, network, BILL_CALLS, BILL_CHANGES);
}

function wrapCalls<C extends object>(
	client: C,
	network: DemoNetwork,
	calls: readonly string[],
	changing: ReadonlySet<string>,
): C {
	if (network.fault === "none") return client;
	let spent = false;
	const wrapped: Record<string, unknown> = { ...(client as object) };
	const methods = client as unknown as Record<
		string,
		(...args: unknown[]) => Promise<unknown>
	>;
	for (const name of calls) {
		const call = methods[name];
		if (call === undefined) continue;
		wrapped[name] = async (...args: unknown[]) => {
			await wait(network.delayMs);
			if (offline()) throw new RestError(0);
			const changes = changing.has(name);
			if (network.fault === "error-once" && changes && !spent) {
				spent = true;
				throw new RestError(500, "XX000");
			}
			const answer = await call.apply(client, args);
			await wait(network.answerDelayMs);
			if (offline()) throw new RestError(0);
			if (network.fault === "lost-once" && changes && !spent) {
				spent = true;
				throw new RestError(0);
			}
			return answer;
		};
	}
	return wrapped as unknown as C;
}
