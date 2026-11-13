import postgres, { type Options, type Sql } from "postgres";

export type PostgresSocketFactory = NonNullable<Options["socket"]>;

export type PostgresSsl = NonNullable<Options["ssl"]>;

export interface PostgresClientOptions {
	maxConnections?: number;
	applicationName?: string;
	connectTimeoutSeconds?: number;
	idleTimeoutSeconds?: number;
	socket?: PostgresSocketFactory;
	fetchTypes?: boolean;
	ssl?: PostgresSsl;
}

const LOCAL_DATABASE_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]",
	"host.docker.internal",
]);

const LOCAL_STACK_DATABASE_PREFIX = "supabase_db_";

const LOCAL_STACK_DATABASE_ALIASES = new Set(["db", "db.supabase.internal"]);

const PLAINTEXT_SSL_MODES = new Set(["disable", "false", "allow", "prefer"]);

export function isLocalDatabaseHost(host: string): boolean {
	const name = host.toLowerCase();
	return (
		LOCAL_DATABASE_HOSTS.has(name) ||
		LOCAL_STACK_DATABASE_ALIASES.has(name) ||
		name.startsWith(LOCAL_STACK_DATABASE_PREFIX)
	);
}

function parsedUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

export function databaseUrlSslMode(url: string): string | null {
	return parsedUrl(url)?.searchParams.get("sslmode") ?? null;
}

export function isLocalDatabaseUrl(url: string): boolean {
	const host = parsedUrl(url)?.hostname;
	return host !== undefined && isLocalDatabaseHost(host);
}

export function defaultSsl(url: string): PostgresSsl | undefined {
	if (databaseUrlSslMode(url) !== null || isLocalDatabaseUrl(url)) {
		return undefined;
	}
	return "require";
}

export function effectiveSsl(
	url: string,
	explicit?: PostgresSsl,
): PostgresSsl | false {
	if (explicit !== undefined) {
		return explicit;
	}
	const mode = databaseUrlSslMode(url);
	if (mode !== null) {
		return mode === "disable" || mode === "false"
			? false
			: (mode as PostgresSsl);
	}
	return defaultSsl(url) ?? false;
}

export function mayFallBackToPlaintext(ssl: PostgresSsl | false): boolean {
	return (
		ssl === false || (typeof ssl === "string" && PLAINTEXT_SSL_MODES.has(ssl))
	);
}

export function enforcedSsl(url: string): PostgresSsl | false | null {
	const ssl = effectiveSsl(url);
	if (isLocalDatabaseUrl(url)) {
		return ssl;
	}
	return mayFallBackToPlaintext(ssl) ? null : ssl;
}

export function createPostgresClient(
	url: string,
	options: PostgresClientOptions = {},
): Sql {
	const ssl = options.ssl ?? defaultSsl(url);
	return postgres(url, {
		max: options.maxConnections ?? 4,
		connect_timeout: options.connectTimeoutSeconds ?? 15,
		onnotice: () => undefined,
		connection: { application_name: options.applicationName ?? "fnb-sync" },
		...(options.idleTimeoutSeconds === undefined
			? {}
			: { idle_timeout: options.idleTimeoutSeconds }),
		...(ssl === undefined ? {} : { ssl }),
		...(options.socket === undefined ? {} : { socket: options.socket }),
		...(options.fetchTypes === undefined
			? {}
			: { fetch_types: options.fetchTypes }),
	});
}
