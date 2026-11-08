import { CREDENTIAL_FIELDS } from "./accounts.js";
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

function accountSecrets(
	raw: string | undefined,
	includeKeys: boolean,
): string[] {
	if (!raw) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [raw];
	}
	if (!Array.isArray(parsed)) {
		return [raw];
	}
	return parsed.flatMap((entry: unknown) => {
		if (entry === null || typeof entry !== "object") {
			return [];
		}
		const record = entry as Record<string, unknown>;
		const fields = includeKeys
			? [...CREDENTIAL_FIELDS, "key"]
			: [...CREDENTIAL_FIELDS];
		return fields.flatMap((field) => {
			const value = record[field];
			return typeof value === "string" ? [value] : [];
		});
	});
}

function databaseSecrets(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	try {
		const url = new URL(value);
		return [
			decodeURIComponent(url.password),
			decodeURIComponent(url.username),
			url.password,
			url.username,
		].filter((part) => part !== "" && part !== "postgres");
	} catch {
		return [value];
	}
}

export function collectSecrets(environment: Environment): string[] {
	const values = [
		...accountSecrets(environment.POS_ACCOUNTS_JSON, isCi(environment)),
		...SECRET_VARIABLES.flatMap((name) => {
			const value = environment[name];
			return value ? [value] : [];
		}),
		...DATABASE_VARIABLES.flatMap((name) => databaseSecrets(environment[name])),
	];
	return [...new Set(values.filter((value) => value.trim() !== ""))].sort();
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
