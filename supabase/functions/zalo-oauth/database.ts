import { createPostgresClient, enforcedSsl } from "@fnb/sync/postgres";
import { PostgresTokenStore, type TokenKind } from "@fnb/zalo/tokens";
import {
	type FunctionEnvironment,
	HttpError,
	MissingSecretError,
	type RequestContext,
} from "../_shared/http.ts";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";
import type { TicketClaim, ZaloOauthDatabase } from "./handler.ts";

export type Sql = ReturnType<typeof createPostgresClient>;

const DATABASE_URL_VARIABLES = ["FNB_DB_URL", "SUPABASE_DB_URL"] as const;
const CONNECT_TIMEOUT_SECONDS = 10;
const IDLE_TIMEOUT_SECONDS = 30;
const MAX_CONNECTIONS = 2;

const clients = new Map<string, Sql>();

interface ClaimRow {
	kind: string;
	source: string;
	tenant_id: string | null;
	tenant_slug: string | null;
	brand_id: string | null;
	brand_key: string | null;
	app_external_id: string | null;
	app_secret_name: string | null;
	has_token: boolean | null;
}

function kindOf(value: string): TokenKind | null {
	return value === "oa" || value === "developer" ? value : null;
}

export function oauthDatabase(
	environment: FunctionEnvironment,
	context: RequestContext,
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
		applicationName: "fnb-zalo-oauth",
		connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
		idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
		socket: denoPostgresSocket(caCert ? [caCert] : []),
		fetchTypes: false,
		...(ssl === false ? {} : { ssl }),
	});
	clients.set(url, created);
	return created;
}

export async function closeOauthDatabases(): Promise<void> {
	const open = [...clients.values()];
	clients.clear();
	await Promise.all(open.map((sql) => sql.end({ timeout: 5 })));
}

export class PostgresZaloOauthDatabase implements ZaloOauthDatabase {
	readonly tokens: PostgresTokenStore;
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		this.tokens = new PostgresTokenStore(sql);
	}

	async claimTicket(ticket: string): Promise<TicketClaim> {
		const [row] = await this.sql<ClaimRow[]>`
			select c.kind, c.source, t.tenant_id::text as tenant_id, t.tenant_slug, t.brand_id::text as brand_id,
				t.brand_key, t.app_external_id, t.app_secret_name, t.has_token
			from app.claim_zalo_token_ticket(${ticket}::uuid) c
			left join lateral app.zalo_token_targets(c.kind, c.tenant_id, null) t on t.brand_id = c.brand_id
		`;
		if (row === undefined) {
			return { outcome: "unknown" };
		}
		const kind = kindOf(row.kind);
		if (
			kind === null ||
			row.tenant_id === null ||
			row.tenant_slug === null ||
			row.brand_id === null ||
			row.brand_key === null ||
			row.app_external_id === null ||
			row.app_secret_name === null
		) {
			return { outcome: "gone", kind: row.kind };
		}
		return {
			outcome: "claimed",
			source: row.source,
			target: {
				tenantId: row.tenant_id,
				tenantSlug: row.tenant_slug,
				brandId: row.brand_id,
				brandKey: row.brand_key,
				kind,
				appId: row.app_external_id,
				appSecretName: row.app_secret_name,
				hasToken: row.has_token === true,
			},
		};
	}
}
