import {
	isRecord,
	readJson,
	timedFetch,
	UpstreamError,
	type ZaloFetch,
} from "./http.js";
import { appSecretProof } from "./proof.js";

export const ZALO_GRAPH_BASE_URL = "https://graph.zalo.me";
export const GRAPH_ME_PATH = "/v2.0/me";
export const GRAPH_ME_INFO_PATH = "/v2.0/me/info";
export const PHONE_TOKEN_USED = 119;
export const ZALO_USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DISPLAY_NAME_MAX_LENGTH = 100;

export interface ZaloGraphOptions {
	readonly baseUrl?: string | undefined;
	readonly fetch?: ZaloFetch | undefined;
	readonly timeoutMs?: number | undefined;
}

export interface ZaloUser {
	readonly id: string;
	readonly name: string | null;
}

export type GraphOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: number };

async function graphGet(
	options: ZaloGraphOptions,
	path: string,
	headers: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
	const base = (options.baseUrl ?? ZALO_GRAPH_BASE_URL).replace(/\/+$/, "");
	const response = await timedFetch(
		`${base}${path}`,
		{ method: "GET", headers },
		{ service: "zalo", fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	const body = await readJson(response, "zalo");
	if (isRecord(body) && graphError(body) !== null) {
		return body;
	}
	if (!response.ok) {
		throw new UpstreamError("zalo", "status", response.status);
	}
	if (!isRecord(body)) {
		throw new UpstreamError("zalo", "invalid_answer", response.status);
	}
	return body;
}

function graphError(body: Record<string, unknown>): number | null {
	const error = body.error;
	if (error === undefined || error === null || error === 0) {
		return null;
	}
	if (typeof error === "number" && Number.isInteger(error)) {
		return error;
	}
	throw new UpstreamError("zalo", "invalid_answer");
}

export function cleanDisplayName(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const cleaned = value.replace(/\p{Cc}/gu, "").trim();
	if (cleaned === "") {
		return null;
	}
	return [...cleaned].slice(0, DISPLAY_NAME_MAX_LENGTH).join("").trim();
}

export async function fetchZaloUser(
	options: ZaloGraphOptions,
	accessToken: string,
	appSecret: string,
): Promise<GraphOutcome<ZaloUser>> {
	const proof = await appSecretProof(accessToken, appSecret);
	const body = await graphGet(options, `${GRAPH_ME_PATH}?fields=id,name`, {
		access_token: accessToken,
		appsecret_proof: proof,
	});
	const error = graphError(body);
	if (error !== null) {
		return { ok: false, error };
	}
	const id = body.id;
	if (typeof id !== "string" || !ZALO_USER_ID_PATTERN.test(id)) {
		throw new UpstreamError("zalo", "invalid_answer");
	}
	return { ok: true, value: { id, name: cleanDisplayName(body.name) } };
}

export function toInternationalPhone(raw: string): string | null {
	const compact = raw.replace(/[\s().-]/g, "");
	const national = /^0([1-9][0-9]{8,9})$/.exec(compact);
	if (national) {
		return `+84${national[1]}`;
	}
	const international = /^\+?([1-9][0-9]{7,14})$/.exec(compact);
	return international ? `+${international[1]}` : null;
}

export async function exchangePhoneToken(
	options: ZaloGraphOptions,
	accessToken: string,
	phoneToken: string,
	appSecret: string,
): Promise<GraphOutcome<string>> {
	const body = await graphGet(options, GRAPH_ME_INFO_PATH, {
		access_token: accessToken,
		code: phoneToken,
		secret_key: appSecret,
	});
	const error = graphError(body);
	if (error !== null) {
		return { ok: false, error };
	}
	const data = body.data;
	const number = isRecord(data) ? data.number : undefined;
	const international =
		typeof number === "string" ? toInternationalPhone(number) : null;
	if (international === null) {
		throw new UpstreamError("zalo", "invalid_answer");
	}
	return { ok: true, value: international };
}
