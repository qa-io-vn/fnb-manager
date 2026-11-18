import type { NativeStorage } from "../storage/native-storage";
import type { MemberProfile, SessionClient } from "./types";
import { createZaloSessionClient } from "./zalo-session-client";

export const STAND_IN_SCENARIOS = ["bound", "unpaired", "failed"] as const;

export type StandInScenario = (typeof STAND_IN_SCENARIOS)[number];

export const STAND_IN_REJECTED_CODE = "000000";

export interface StandInSettings {
	readonly scenario: StandInScenario;
	readonly delayMs: number;
}

const MAX_STAND_IN_DELAY_MS = 10_000;
const STAND_IN_SESSION_SECONDS = 3600;

export function standInSettingsFrom(search: string): StandInSettings {
	const params = new URLSearchParams(search);
	const requested = params.get("session") ?? "";
	const scenario = STAND_IN_SCENARIOS.find((name) => name === requested);
	const delay = Number(params.get("delay") ?? "0");
	const delayMs =
		Number.isInteger(delay) && delay > 0
			? Math.min(delay, MAX_STAND_IN_DELAY_MS)
			: 0;
	return { scenario: scenario ?? "bound", delayMs };
}

export interface StandInSessionOptions {
	readonly settings: StandInSettings;
	readonly member: MemberProfile;
	readonly storage: NativeStorage;
	readonly getAccessToken: () => Promise<string>;
	readonly now?: () => number;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function bindingCodeOf(init: RequestInit | undefined): string | null {
	if (typeof init?.body !== "string") return null;
	const body: unknown = JSON.parse(init.body);
	if (typeof body !== "object" || body === null || !("binding_code" in body))
		return null;
	return typeof body.binding_code === "string" ? body.binding_code : null;
}

export function createStandInSessionClient(
	options: StandInSessionOptions,
): SessionClient {
	const now = options.now ?? Date.now;
	let bound = options.settings.scenario === "bound";
	const standInFetch: typeof fetch = async (_input, init) => {
		if (options.settings.delayMs > 0) await wait(options.settings.delayMs);
		if (options.settings.scenario === "failed") {
			throw new TypeError("stand-in network failure");
		}
		const code = bindingCodeOf(init);
		if (code !== null && code !== STAND_IN_REJECTED_CODE) bound = true;
		const body = bound
			? {
					status: "bound",
					access_token: "stand-in-session",
					refresh_token: "stand-in-refresh",
					expires_at: Math.floor(now() / 1000) + STAND_IN_SESSION_SECONDS,
					member: {
						display_name: options.member.displayName,
						role: options.member.role,
						stores: options.member.stores,
					},
				}
			: { status: "unpaired" };
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	return createZaloSessionClient({
		endpoint: "stand-in:zalo-session",
		brandKey: "stand-in",
		publishableKey: "stand-in",
		storage: options.storage,
		getAccessToken: options.getAccessToken,
		fetch: standInFetch,
		now,
	});
}
