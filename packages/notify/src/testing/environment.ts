export const SYNTHETIC_BOT_TOKEN = "synthetic-bot-token";
export const SYNTHETIC_EMAIL_KEY = "synthetic-email-key";
export const SYNTHETIC_SENDER = "notify-it-sender@example.com";

export const INTEGRATION_SECRET_NAMES = {
	zalo_bot: "NOTIFY_ZALO_BOT_TOKEN_IT",
	telegram: "NOTIFY_TELEGRAM_BOT_TOKEN_IT",
	email: "NOTIFY_EMAIL_API_KEY_IT",
	webhook: "NOTIFY_WEBHOOK_SECRET_IT",
} as const;

export const SYNTHETIC_ENVIRONMENT_KEYS = [
	"DATABASE_URL",
	"NOTIFY_INTEGRATION",
	"CI",
	"POS_ACCOUNTS_JSON",
	"NOTIFY_ZALO_BOT_BASE_URL",
	"NOTIFY_TELEGRAM_BASE_URL",
	"NOTIFY_BREVO_BASE_URL",
	"NOTIFY_RESEND_BASE_URL",
	"NOTIFY_EMAIL_FROM",
	"NOTIFY_EMAIL_FROM_NAME",
	...Object.values(INTEGRATION_SECRET_NAMES),
] as const;

export interface SyntheticEnvironmentOptions {
	readonly databaseUrl: string;
	readonly mockEnvironment: Readonly<Record<string, string>>;
	readonly extra?: Readonly<Record<string, string>>;
}

export class SyntheticEnvironmentError extends Error {
	constructor(keys: readonly string[]) {
		super(
			`the test environment carries keys outside the synthetic list: ${keys.join(", ")}`,
		);
		this.name = "SyntheticEnvironmentError";
	}
}

export function assertSyntheticEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
): void {
	const allowed = new Set<string>(SYNTHETIC_ENVIRONMENT_KEYS);
	const extra = Object.keys(environment).filter((key) => !allowed.has(key));
	if (extra.length > 0) {
		throw new SyntheticEnvironmentError(extra);
	}
}

export function syntheticEnvironment(
	options: SyntheticEnvironmentOptions,
): Record<string, string> {
	const environment: Record<string, string> = {
		DATABASE_URL: options.databaseUrl,
		NOTIFY_INTEGRATION: "1",
		...options.mockEnvironment,
		[INTEGRATION_SECRET_NAMES.zalo_bot]: SYNTHETIC_BOT_TOKEN,
		[INTEGRATION_SECRET_NAMES.email]: SYNTHETIC_EMAIL_KEY,
		NOTIFY_EMAIL_FROM: SYNTHETIC_SENDER,
		...(options.extra ?? {}),
	};
	assertSyntheticEnvironment(environment);
	return environment;
}
