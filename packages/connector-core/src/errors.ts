import type { CapabilityName } from "./connector.js";

export class ConnectorError extends Error {
	readonly connectorId: string;

	constructor(connectorId: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
		this.connectorId = connectorId;
	}
}

export class ConnectorAuthError extends ConnectorError {
	constructor(connectorId: string, reason: string, options?: ErrorOptions) {
		super(
			connectorId,
			`${connectorId}: authentication failed (${reason})`,
			options,
		);
	}
}

export interface SchemaIssue {
	path: string;
	message: string;
}

export class ConnectorSchemaError extends ConnectorError {
	readonly source: string;
	readonly issues: readonly SchemaIssue[];

	constructor(
		connectorId: string,
		source: string,
		issues: readonly SchemaIssue[],
		options?: ErrorOptions,
	) {
		const first = issues[0];
		const detail = first
			? ` (${first.path || "<root>"}: ${first.message})`
			: "";
		super(
			connectorId,
			`${connectorId}: ${source} did not match the expected shape${detail}`,
			options,
		);
		this.source = source;
		this.issues = issues;
	}
}

export class ConnectorCapabilityError extends ConnectorError {
	readonly capability: CapabilityName;

	constructor(connectorId: string, capability: CapabilityName) {
		super(
			connectorId,
			`${connectorId} does not provide the "${capability}" capability`,
		);
		this.capability = capability;
	}
}

export class ConnectorRateLimitError extends ConnectorError {
	readonly retryAfterMs: number | null;

	constructor(
		connectorId: string,
		retryAfterMs: number | null,
		options?: ErrorOptions,
	) {
		const hint =
			retryAfterMs === null ? "" : ` (retry after ${retryAfterMs} ms)`;
		super(
			connectorId,
			`${connectorId}: rate limited by the POS${hint}`,
			options,
		);
		this.retryAfterMs = retryAfterMs;
	}
}
