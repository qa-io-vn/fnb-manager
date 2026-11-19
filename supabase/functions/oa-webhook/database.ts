import { createPostgresClient, enforcedSsl } from "@fnb/sync/postgres";
import {
	type FunctionEnvironment,
	HttpError,
	MissingSecretError,
	type RequestContext,
} from "../_shared/http.ts";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";

export type Sql = ReturnType<typeof createPostgresClient>;

const DATABASE_URL_VARIABLES = ["FNB_DB_URL", "SUPABASE_DB_URL"] as const;
const CONNECT_TIMEOUT_SECONDS = 10;
const IDLE_TIMEOUT_SECONDS = 30;
const MAX_CONNECTIONS = 2;

const clients = new Map<string, Sql>();

export function webhookDatabase(
	environment: FunctionEnvironment,
	context: RequestContext,
	applicationName: string,
): Sql {
	const url = DATABASE_URL_VARIABLES.map((name) => environment[name]).find(
		(value): value is string => value !== undefined && value.trim() !== "",
	);
	if (url === undefined) {
		throw new MissingSecretError("SUPABASE_DB_URL");
	}
	const known = clients.get(url);
	if (known) {
		return known;
	}
	const ssl = enforcedSsl(url);
	if (ssl === null) {
		context.log(
			"the database URL lets the connection to a remote host fall back to plaintext; drop its sslmode or set sslmode=require or verify-full",
		);
		throw new HttpError(500, "not_configured");
	}
	const caCert = environment.FNB_DB_CA_CERT;
	const created = createPostgresClient(url, {
		maxConnections: MAX_CONNECTIONS,
		applicationName,
		connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
		idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
		socket: denoPostgresSocket(caCert ? [caCert] : []),
		fetchTypes: false,
		...(ssl === false ? {} : { ssl }),
	});
	clients.set(url, created);
	return created;
}

export async function closeWebhookDatabases(): Promise<void> {
	const open = [...clients.values()];
	clients.clear();
	await Promise.all(open.map((sql) => sql.end({ timeout: 5 })));
}
