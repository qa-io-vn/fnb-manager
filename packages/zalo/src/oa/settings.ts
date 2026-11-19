import {
	isLoopbackBaseUrl,
	ZALO_INTEGRATION_VARIABLE,
	ZALO_LOCAL_DEV_VARIABLE,
	ZaloConfigError,
	type ZaloEnvironment,
	zaloSettings,
} from "../settings.js";
import { ZALO_OA_API_BASE_URL } from "./api.js";

export const ZALO_OA_API_BASE_URL_VARIABLE = "ZALO_OA_API_BASE_URL";
export const ZALO_OA_MESSAGES_VARIABLE = "ZALO_OA_MESSAGES";

export interface OaApiSettings {
	readonly integration: boolean;
	readonly local: boolean;
	readonly tenantId: string | null;
	readonly baseUrl: string;
	readonly messages: boolean;
	readonly real: boolean;
}

export function oaApiSettings(environment: ZaloEnvironment): OaApiSettings {
	const settings = zaloSettings(environment);
	const raw = environment[ZALO_OA_API_BASE_URL_VARIABLE];
	const override = raw === undefined || raw.trim() === "" ? null : raw.trim();
	if (override !== null && !settings.integration && !settings.local) {
		throw new ZaloConfigError(
			`${ZALO_OA_API_BASE_URL_VARIABLE} is accepted only with ${ZALO_INTEGRATION_VARIABLE}=1, or with ${ZALO_LOCAL_DEV_VARIABLE}=1 on the local stack`,
		);
	}
	if (override !== null && !isLoopbackBaseUrl(override)) {
		throw new ZaloConfigError(
			`${ZALO_OA_API_BASE_URL_VARIABLE} must be a loopback address such as http://127.0.0.1:8788`,
		);
	}
	const messages = (environment[ZALO_OA_MESSAGES_VARIABLE] ?? "").trim();
	if (messages !== "" && messages !== "1" && messages !== "0") {
		throw new ZaloConfigError(
			`${ZALO_OA_MESSAGES_VARIABLE} must be 1, 0 or unset`,
		);
	}
	if ((settings.integration || settings.local) && override === null) {
		throw new ZaloConfigError(
			`${ZALO_INTEGRATION_VARIABLE}=1 and ${ZALO_LOCAL_DEV_VARIABLE}=1 talk to a mock OA API: set ${ZALO_OA_API_BASE_URL_VARIABLE} to its loopback address`,
		);
	}
	return {
		integration: settings.integration,
		local: settings.local,
		tenantId: settings.tenantId,
		baseUrl: override ?? ZALO_OA_API_BASE_URL,
		messages: messages === "1",
		real: override === null,
	};
}
