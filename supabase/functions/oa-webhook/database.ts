import { createPostgresClient, enforcedSsl } from "@fnb/sync/postgres";
import {
	type FunctionEnvironment,
	HttpError,
	MissingSecretError,
	type RequestContext,
} from "../_shared/http.ts";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";
import type {
	OaTarget,
	OaWebhookStore,
	ReceivedEvent,
	Reception,
	WebhookMode,
} from "./handler.ts";

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

function webhookMode(value: string): WebhookMode {
	return value === "enforce" ? "enforce" : "observe";
}

function receptionOutcome(value: string): Reception["outcome"] {
	if (value === "recorded" || value === "duplicate" || value === "refused") {
		return value;
	}
	throw new Error("app.receive_oa_event answered an unknown outcome");
}

export class PostgresOaWebhookStore implements OaWebhookStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
	}

	async targets(appId: string, oaId: string): Promise<readonly OaTarget[]> {
		const rows = await this.sql<
			{
				oa_id: string;
				tenant_id: string;
				secret_name: string;
				webhook_mode: string;
			}[]
		>`
			select t.oa_id::text as oa_id, t.tenant_id::text as tenant_id, t.secret_name, t.webhook_mode
			from app.oa_webhook_target(${appId}::text, ${oaId}::text) t
		`;
		return rows.map((row) => ({
			oaId: row.oa_id,
			tenantId: row.tenant_id,
			secretName: row.secret_name,
			webhookMode: webhookMode(row.webhook_mode),
		}));
	}

	async receive(event: ReceivedEvent): Promise<Reception> {
		const [row] = await this.sql<
			{ outcome: string; event_row: string | null; unverified: number | null }[]
		>`
			select r.outcome, r.event_row::text as event_row, r.unverified
			from app.receive_oa_event(
				${event.oaId}::uuid,
				${event.eventId}::text,
				${event.eventName}::text,
				${event.oaUserId}::text,
				${event.occurredAt?.toISOString() ?? null}::timestamptz,
				${event.signature}::text,
				${event.receivedAt.toISOString()}::timestamptz
			) r
		`;
		if (row === undefined) {
			throw new Error("app.receive_oa_event answered no row");
		}
		return {
			outcome: receptionOutcome(row.outcome),
			eventRow: row.event_row,
			unverified: row.unverified,
		};
	}

	async apply(eventRow: string, at: Date): Promise<string> {
		const [row] = await this.sql<{ outcome: string }[]>`
			select app.apply_oa_event(${eventRow}::uuid, ${at.toISOString()}::timestamptz) as outcome
		`;
		return row?.outcome ?? "none";
	}

	async raiseAlert(
		oaId: string,
		unverified: number,
		at: Date,
	): Promise<string> {
		const [row] = await this.sql<{ outcome: string | null }[]>`
			select app.raise_oa_webhook_alert(${oaId}::uuid, ${unverified}::integer, ${at.toISOString()}::timestamptz) as outcome
		`;
		return row?.outcome ?? "none";
	}
}
