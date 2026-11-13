import { collectSecretValues } from "@fnb/runner";
import { isCi } from "./config.js";
import type { Environment } from "./env-file.js";

const SECRET_VARIABLES = [
	"IPOS_APP_KEY",
	"SUPABASE_SECRET_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
	"SUPABASE_DB_PASSWORD",
	"SUPABASE_ACCESS_TOKEN",
	"FNB_MEMBER_PASSWORD",
] as const;

const DATABASE_VARIABLES = ["DATABASE_URL", "SUPABASE_DB_URL"] as const;

const NOTIFY_SECRET_PATTERN = /^NOTIFY_[A-Z0-9_]{1,60}$/;
const NOTIFY_NOT_SECRET = new Set([
	"NOTIFY_INTEGRATION",
	"NOTIFY_EMAIL_FROM_NAME",
	"NOTIFY_FALLBACK_TARGETS",
]);
const NOTIFY_BASE_URL_PATTERN = /^NOTIFY_[A-Z0-9_]+_BASE_URL$/;
export const FALLBACK_TARGETS_VARIABLE = "NOTIFY_FALLBACK_TARGETS";

const MIN_MASKED_LENGTH = 6;

export function notifySecretVariables(environment: Environment): string[] {
	return Object.keys(environment)
		.filter(
			(name) =>
				NOTIFY_SECRET_PATTERN.test(name) &&
				!NOTIFY_NOT_SECRET.has(name) &&
				!NOTIFY_BASE_URL_PATTERN.test(name) &&
				(environment[name]?.trim().length ?? 0) >= MIN_MASKED_LENGTH,
		)
		.sort();
}

export function fallbackTargetSecrets(raw: string | undefined): string[] {
	if (raw === undefined || raw.trim() === "") {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [raw];
	}
	const entries = Array.isArray(parsed) ? parsed : [parsed];
	return entries.flatMap((entry: unknown) =>
		entry !== null && typeof entry === "object" && !Array.isArray(entry)
			? Object.entries(entry as Record<string, unknown>).flatMap(
					([key, value]) =>
						key !== "kind" &&
						key !== "provider" &&
						typeof value === "string" &&
						value.trim() !== ""
							? [value]
							: [],
				)
			: [],
	);
}

export function collectSecrets(environment: Environment): string[] {
	const values = collectSecretValues(environment, {
		variables: [...SECRET_VARIABLES, ...notifySecretVariables(environment)],
		databaseVariables: DATABASE_VARIABLES,
		includeAccountKeys: isCi(environment),
	});
	return [
		...new Set([
			...values,
			...fallbackTargetSecrets(environment[FALLBACK_TARGETS_VARIABLE]),
		]),
	].sort();
}

export function escapeCommandData(value: string): string {
	return value
		.replaceAll("%", "%25")
		.replaceAll("\r", "%0D")
		.replaceAll("\n", "%0A");
}

export function maskCommands(secrets: readonly string[]): string[] {
	return secrets.flatMap((secret) =>
		secret
			.split(/\r?\n/)
			.filter((line) => line.trim() !== "")
			.map((line) => `::add-mask::${escapeCommandData(line)}`),
	);
}
