import {
	AccountConfigError,
	type AccountEntry,
	IPOS_APP_KEY_VARIABLE,
	parseAccountEntries,
} from "@fnb/runner";
import { z } from "zod";
import type { Environment } from "./env-file.js";
import { ConfigError } from "./errors.js";

export interface DatabaseSetting {
	url: string;
	variable: "DATABASE_URL" | "SUPABASE_DB_URL";
}

export interface SupabaseApiSetting {
	url: string;
	secretKey: string;
}

export interface SupabasePublisherSetting {
	url: string;
	publishableKey: string;
	email: string;
	password: string;
}

export function isCi(environment: Environment): boolean {
	return Boolean(environment.CI || environment.GITHUB_ACTIONS);
}

const urlSchema = z.string().url();

export function databaseSetting(environment: Environment): DatabaseSetting {
	const ordered: DatabaseSetting["variable"][] = isCi(environment)
		? ["SUPABASE_DB_URL", "DATABASE_URL"]
		: ["DATABASE_URL", "SUPABASE_DB_URL"];
	for (const variable of ordered) {
		const value = environment[variable];
		if (value) {
			if (
				!/^postgres(ql)?:\/\//.test(value) ||
				!urlSchema.safeParse(value).success
			) {
				throw new ConfigError(
					`${variable} must be a postgresql:// connection string`,
				);
			}
			return { url: value, variable };
		}
	}
	throw new ConfigError(
		"set DATABASE_URL (local) or SUPABASE_DB_URL (cloud session pooler) in .env or the job environment",
	);
}

export function supabaseApiSetting(
	environment: Environment,
): SupabaseApiSetting {
	const url = environment.SUPABASE_URL;
	const secretKey =
		environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !urlSchema.safeParse(url).success) {
		throw new ConfigError("set SUPABASE_URL to the project API URL");
	}
	if (!secretKey) {
		throw new ConfigError(
			"set SUPABASE_SECRET_KEY (the project secret API key)",
		);
	}
	return { url, secretKey };
}

export function accountEntries(environment: Environment): AccountEntry[] {
	try {
		return parseAccountEntries(environment.POS_ACCOUNTS_JSON);
	} catch (error) {
		if (error instanceof AccountConfigError) {
			throw new ConfigError(error.message);
		}
		throw error;
	}
}

export function accountEntry(
	environment: Environment,
	key: string,
): AccountEntry {
	const entry = accountEntries(environment).find(
		(candidate) => candidate.key === key,
	);
	if (!entry) {
		throw new ConfigError(
			isCi(environment)
				? "no POS_ACCOUNTS_JSON entry has that key"
				: `no entry with key "${key}" in POS_ACCOUNTS_JSON`,
		);
	}
	return entry;
}

export function iposAppKey(environment: Environment): string | undefined {
	return environment[IPOS_APP_KEY_VARIABLE] || undefined;
}

export function supabasePublisherSetting(
	environment: Environment,
): SupabasePublisherSetting {
	const url = environment.SUPABASE_URL?.trim() ?? "";
	const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
	const email = environment.FNB_PUBLISHER_EMAIL?.trim() ?? "";
	const password = environment.FNB_PUBLISHER_PASSWORD ?? "";
	if (!url || !urlSchema.safeParse(url).success) {
		throw new ConfigError("set SUPABASE_URL to the project API URL");
	}
	const missing = [
		...(publishableKey === "" ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
		...(email === "" ? ["FNB_PUBLISHER_EMAIL"] : []),
		...(password === "" ? ["FNB_PUBLISHER_PASSWORD"] : []),
	];
	if (missing.length > 0) {
		throw new ConfigError(
			`publishing signs in as the publisher member: set ${missing.join(", ")} in .env (no database URL or secret key is used)`,
		);
	}
	return { url, publishableKey, email, password };
}
