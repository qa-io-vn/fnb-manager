import type { ZodIssue } from "zod";

export class IposError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
	}
}

export interface HttpFailureDetails {
	status: number;
	endpoint: string;
	trackId: string | null;
	serverMessage: string | null;
}

function describeFailure(details: HttpFailureDetails): string {
	const suffix = details.serverMessage ? `: ${details.serverMessage}` : "";
	return `iPOS ${details.endpoint} responded with HTTP ${details.status}${suffix}`;
}

export class IposHttpError extends IposError {
	readonly status: number;
	readonly endpoint: string;
	readonly trackId: string | null;
	readonly serverMessage: string | null;

	constructor(details: HttpFailureDetails) {
		super(describeFailure(details));
		this.status = details.status;
		this.endpoint = details.endpoint;
		this.trackId = details.trackId;
		this.serverMessage = details.serverMessage;
	}
}

export interface AuthFailureDetails {
	endpoint: string;
	status: number | null;
	trackId: string | null;
	serverMessage: string | null;
}

export class IposAuthError extends IposError {
	readonly endpoint: string;
	readonly status: number | null;
	readonly trackId: string | null;
	readonly serverMessage: string | null;

	constructor(details: AuthFailureDetails) {
		const status = details.status === null ? "" : ` (HTTP ${details.status})`;
		const reason = details.serverMessage ?? "authentication rejected";
		super(`iPOS ${details.endpoint}${status}: ${reason}`);
		this.endpoint = details.endpoint;
		this.status = details.status;
		this.trackId = details.trackId;
		this.serverMessage = details.serverMessage;
	}
}

export class IposSchemaError extends IposError {
	readonly endpoint: string;
	readonly issues: readonly ZodIssue[];

	constructor(
		endpoint: string,
		issues: readonly ZodIssue[],
		summary = "response did not match the expected shape",
	) {
		const firstIssue = issues[0];
		const detail = firstIssue
			? ` (${firstIssue.path.map(String).join(".") || "<root>"}: ${firstIssue.message})`
			: "";
		super(`iPOS ${endpoint} ${summary}${detail}`);
		this.endpoint = endpoint;
		this.issues = issues;
	}
}

export class IposNetworkError extends IposError {
	readonly endpoint: string;

	constructor(endpoint: string, cause: unknown, detail?: string) {
		super(
			`iPOS ${endpoint} could not be reached${detail ? `: ${detail}` : ""}`,
			{
				cause,
			},
		);
		this.endpoint = endpoint;
	}
}
