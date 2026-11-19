import {
	isRecord,
	readJson,
	timedFetch,
	UpstreamError,
	type ZaloFetch,
} from "../http.js";
import type { ZaloButton } from "./menu.js";
import type { ConsultationMessage } from "./messages.js";

export const ZALO_OA_API_BASE_URL = "https://openapi.zalo.me";
export const OA_MESSAGE_CS_PATH = "/v3.0/oa/message/cs";
export const OA_MENU_PATH = "/v3.0/oa/menu";

export const OA_API_ERRORS = {
	accessTokenInvalid: -216,
	accessTokenExpired: -220,
	packageExpired: -224,
	outsideWindow: -230,
} as const;

export interface OaApiOptions {
	readonly baseUrl?: string | undefined;
	readonly fetch?: ZaloFetch | undefined;
	readonly timeoutMs?: number | undefined;
}

export type OaApiOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: number };

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function errorCode(body: Record<string, unknown>): number | null {
	const error = body.error;
	if (error === undefined || error === null || error === 0 || error === "0") {
		return null;
	}
	if (typeof error === "number" && Number.isInteger(error)) {
		return error;
	}
	if (typeof error === "string" && /^-?[0-9]{1,9}$/.test(error)) {
		return Number(error);
	}
	throw new UpstreamError("zalo", "invalid_answer");
}

async function oaPost(
	options: OaApiOptions,
	path: string,
	accessToken: string,
	body: unknown,
): Promise<Record<string, unknown>> {
	const base = (options.baseUrl ?? ZALO_OA_API_BASE_URL).replace(/\/+$/, "");
	const response = await timedFetch(
		`${base}${path}`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				access_token: accessToken,
			},
			body: JSON.stringify(body),
		},
		{ service: "zalo", fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	const answer = await readJson(response, "zalo");
	if (isRecord(answer) && errorCode(answer) !== null) {
		return answer;
	}
	if (!response.ok) {
		throw new UpstreamError("zalo", "status", response.status);
	}
	if (!isRecord(answer)) {
		throw new UpstreamError("zalo", "invalid_answer", response.status);
	}
	return answer;
}

export interface SentMessage {
	readonly messageId: string | null;
}

export async function sendConsultation(
	options: OaApiOptions,
	accessToken: string,
	message: ConsultationMessage,
): Promise<OaApiOutcome<SentMessage>> {
	const answer = await oaPost(
		options,
		OA_MESSAGE_CS_PATH,
		accessToken,
		message,
	);
	const error = errorCode(answer);
	if (error !== null) {
		return { ok: false, error };
	}
	const data = answer.data;
	const id = isRecord(data) ? data.message_id : undefined;
	return {
		ok: true,
		value: {
			messageId:
				typeof id === "string" && MESSAGE_ID_PATTERN.test(id) ? id : null,
		},
	};
}

export interface OaMenuRequest {
	readonly menus: readonly ZaloButton[];
}

export function menuRequest(buttons: readonly ZaloButton[]): OaMenuRequest {
	return { menus: [...buttons] };
}

export async function updateOaMenu(
	options: OaApiOptions,
	accessToken: string,
	buttons: readonly ZaloButton[],
): Promise<OaApiOutcome<null>> {
	const answer = await oaPost(
		options,
		OA_MENU_PATH,
		accessToken,
		menuRequest(buttons),
	);
	const error = errorCode(answer);
	return error === null ? { ok: true, value: null } : { ok: false, error };
}
