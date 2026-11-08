import type { Redactor } from "@fnb/sync";
import type { Environment } from "./config/env-file.js";
import type { Output } from "./output.js";
import type { Services } from "./services.js";

export interface CommandContext {
	env: Environment;
	rootDir: string;
	output: Output;
	services: Services;
	redact: Redactor;
	now: () => Date;
}

export type OptionValue = string | boolean | (string | boolean)[] | undefined;
export type OptionValues = Record<string, OptionValue>;

export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

export function stringOption(
	values: OptionValues,
	name: string,
): string | undefined {
	const value = values[name];
	return typeof value === "string" ? value : undefined;
}

export function requiredString(values: OptionValues, name: string): string {
	const value = stringOption(values, name);
	if (value === undefined || value.trim() === "") {
		throw new UsageError(`--${name} is required`);
	}
	return value;
}

export function stringList(values: OptionValues, name: string): string[] {
	const value = values[name];
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === "string");
	}
	return typeof value === "string" ? [value] : [];
}

export function flag(values: OptionValues, name: string): boolean {
	return values[name] === true;
}

export function triggeredBy(environment: Environment): string {
	if (environment.FNB_TRIGGERED_BY) {
		return environment.FNB_TRIGGERED_BY;
	}
	return environment.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "manual";
}
