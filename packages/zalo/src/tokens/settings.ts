import {
	isLoopbackBaseUrl,
	ZALO_INTEGRATION_VARIABLE,
	ZaloConfigError,
	type ZaloEnvironment,
	zaloSettings,
} from "../settings.js";
import { ZALO_OAUTH_BASE_URL } from "./oauth.js";

export const ZALO_OAUTH_BASE_URL_VARIABLE = "ZALO_OAUTH_BASE_URL";

export interface TokenJobSettings {
	readonly integration: boolean;
	readonly tenantId: string | null;
	readonly oauthBaseUrl: string;
}

export function tokenJobSettings(
	environment: ZaloEnvironment,
): TokenJobSettings {
	const settings = zaloSettings(environment);
	const raw = environment[ZALO_OAUTH_BASE_URL_VARIABLE];
	const override = raw === undefined || raw.trim() === "" ? null : raw.trim();
	if (override !== null && !settings.integration) {
		throw new ZaloConfigError(
			`${ZALO_OAUTH_BASE_URL_VARIABLE} is accepted only with ${ZALO_INTEGRATION_VARIABLE}=1`,
		);
	}
	if (override !== null && !isLoopbackBaseUrl(override)) {
		throw new ZaloConfigError(
			`${ZALO_OAUTH_BASE_URL_VARIABLE} must be a loopback address such as http://127.0.0.1:8788`,
		);
	}
	return {
		integration: settings.integration,
		tenantId: settings.tenantId,
		oauthBaseUrl: override ?? ZALO_OAUTH_BASE_URL,
	};
}
