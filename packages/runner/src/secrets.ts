import { ACCOUNTS_VARIABLE, CREDENTIAL_FIELDS } from "./accounts.js";
import type { RunnerEnvironment } from "./connectors.js";

export function accountSecretValues(
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

export function databaseUrlSecrets(value: string | undefined): string[] {
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

export function jsonDictionarySecrets(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed === null || typeof parsed !== "object") {
			return [value];
		}
		return Object.values(parsed).filter(
			(entry): entry is string => typeof entry === "string",
		);
	} catch {
		return [value];
	}
}

export interface SecretSources {
	variables: readonly string[];
	databaseVariables?: readonly string[];
	dictionaryVariables?: readonly string[];
	includeAccountKeys: boolean;
}

export function collectSecretValues(
	environment: RunnerEnvironment,
	sources: SecretSources,
): string[] {
	const values = [
		...accountSecretValues(
			environment[ACCOUNTS_VARIABLE],
			sources.includeAccountKeys,
		),
		...sources.variables.flatMap((name) => {
			const value = environment[name];
			return value ? [value] : [];
		}),
		...(sources.databaseVariables ?? []).flatMap((name) =>
			databaseUrlSecrets(environment[name]),
		),
		...(sources.dictionaryVariables ?? []).flatMap((name) =>
			jsonDictionarySecrets(environment[name]),
		),
	];
	return [...new Set(values.filter((value) => value.trim() !== ""))].sort();
}
