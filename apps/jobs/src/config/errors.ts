import type { z } from "zod";

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export function describeIssues(source: string, error: z.ZodError): string {
	const details = error.issues
		.slice(0, 5)
		.map(
			(issue) =>
				`${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`,
		)
		.join("; ");
	return `${source} is invalid (${details})`;
}
