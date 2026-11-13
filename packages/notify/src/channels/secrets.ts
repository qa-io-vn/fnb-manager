import type { ChannelKind, ProviderId } from "./types.js";

export type NotifyEnvironment = Readonly<Record<string, string | undefined>>;

const SECRET_NAME_PATTERN = /^NOTIFY_[A-Z0-9_]{1,60}$/;

const KIND_SECRET_PATTERNS: Readonly<Partial<Record<ChannelKind, RegExp>>> = {
	zalo_bot: /^NOTIFY_ZALO_BOT_TOKEN(_[A-Z0-9]{1,20})?$/,
	telegram: /^NOTIFY_TELEGRAM_BOT_TOKEN(_[A-Z0-9]{1,20})?$/,
	email: /^NOTIFY_EMAIL_API_KEY(_[A-Z0-9]{1,20})?$/,
	webhook: /^NOTIFY_WEBHOOK_SECRET(_[A-Z0-9]{1,20})?$/,
};

export const DEFAULT_SECRET_NAMES: Readonly<
	Record<"zalo_bot" | "telegram" | "email" | "webhook", string>
> = {
	zalo_bot: "NOTIFY_ZALO_BOT_TOKEN",
	telegram: "NOTIFY_TELEGRAM_BOT_TOKEN",
	email: "NOTIFY_EMAIL_API_KEY",
	webhook: "NOTIFY_WEBHOOK_SECRET",
};

export const PROVIDER_BASE_URLS: Readonly<Record<ProviderId, string>> = {
	zalo_bot: "https://bot-api.zaloplatforms.com",
	telegram: "https://api.telegram.org",
	brevo: "https://api.brevo.com",
	resend: "https://api.resend.com",
	hmac_webhook: "",
};

export const BASE_URL_OVERRIDE_VARIABLES: Readonly<
	Partial<Record<ProviderId, string>>
> = {
	zalo_bot: "NOTIFY_ZALO_BOT_BASE_URL",
	telegram: "NOTIFY_TELEGRAM_BASE_URL",
	brevo: "NOTIFY_BREVO_BASE_URL",
	resend: "NOTIFY_RESEND_BASE_URL",
};

const LOOPBACK_BASE_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/;

const ANY_BASE_URL_VARIABLE = /^NOTIFY_[A-Z0-9_]+_BASE_URL$/;

export function isSecretNameValid(kind: ChannelKind, name: string): boolean {
	if (!SECRET_NAME_PATTERN.test(name)) {
		return false;
	}
	const pattern = KIND_SECRET_PATTERNS[kind];
	return pattern === undefined || pattern.test(name);
}

export function credentialKindOf(name: string): ChannelKind | null {
	for (const [kind, pattern] of Object.entries(KIND_SECRET_PATTERNS)) {
		if (pattern?.test(name)) {
			return kind as ChannelKind;
		}
	}
	return null;
}

export function resolveSecret(
	kind: ChannelKind,
	secretName: string,
	environment: NotifyEnvironment,
): string | null {
	if (!isSecretNameValid(kind, secretName)) {
		return null;
	}
	const value = environment[secretName];
	return value === undefined || value.trim() === "" ? null : value;
}

export function isLoopbackBaseUrl(value: string): boolean {
	return LOOPBACK_BASE_URL.test(value);
}

export function providerBaseUrl(
	provider: ProviderId,
	environment: NotifyEnvironment,
): string {
	const variable = BASE_URL_OVERRIDE_VARIABLES[provider];
	const override = variable === undefined ? undefined : environment[variable];
	if (override !== undefined && isLoopbackBaseUrl(override)) {
		return override;
	}
	return PROVIDER_BASE_URLS[provider];
}

export function baseUrlOverrideWarnings(
	environment: NotifyEnvironment,
): string[] {
	return Object.entries(BASE_URL_OVERRIDE_VARIABLES).flatMap(([, variable]) => {
		if (variable === undefined) {
			return [];
		}
		const value = environment[variable];
		return value !== undefined && value !== "" && !isLoopbackBaseUrl(value)
			? [
					`${variable} ignored: only a loopback test server (http://127.0.0.1:<port>) may replace a provider host`,
				]
			: [];
	});
}

export function hasBaseUrlOverride(environment: NotifyEnvironment): boolean {
	return Object.entries(environment).some(
		([name, value]) =>
			ANY_BASE_URL_VARIABLE.test(name) && value !== undefined && value !== "",
	);
}

export function providersUseLoopback(
	providers: readonly ProviderId[],
	environment: NotifyEnvironment,
): boolean {
	return providers.every((provider) => {
		const variable = BASE_URL_OVERRIDE_VARIABLES[provider];
		const value = variable === undefined ? undefined : environment[variable];
		return value !== undefined && isLoopbackBaseUrl(value);
	});
}

export const FIXTURE_TENANT_SLUG_PREFIX = "notify-it-";

export function isFixtureTenantSlug(slug: string): boolean {
	return (
		slug.startsWith(FIXTURE_TENANT_SLUG_PREFIX) &&
		slug.length > FIXTURE_TENANT_SLUG_PREFIX.length
	);
}

export function presentSecretNames(environment: NotifyEnvironment): string[] {
	return Object.entries(environment)
		.filter(
			([name, value]) =>
				value !== undefined &&
				value.trim() !== "" &&
				SECRET_NAME_PATTERN.test(name) &&
				credentialKindOf(name) !== null,
		)
		.map(([name]) => name)
		.sort();
}
