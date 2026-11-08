import postgres, { type Sql } from "postgres";

export interface PostgresClientOptions {
	maxConnections?: number;
	applicationName?: string;
	connectTimeoutSeconds?: number;
}

export function createPostgresClient(
	url: string,
	options: PostgresClientOptions = {},
): Sql {
	return postgres(url, {
		max: options.maxConnections ?? 4,
		connect_timeout: options.connectTimeoutSeconds ?? 15,
		onnotice: () => undefined,
		connection: { application_name: options.applicationName ?? "fnb-sync" },
	});
}
