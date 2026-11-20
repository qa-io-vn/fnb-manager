import {
	type CycleReport,
	createAdapterRegistry,
	createCycleBudget,
	type DigestBuilder,
	EDGE_CYCLE_LIMITS,
	type FetchLike,
	formatSelfCheck,
	type NotifyRepository,
	runNotifyCycle,
} from "@fnb/notify";
import {
	createPostgresDigestBuilder,
	createPostgresNotifyRepository,
	kickNotify,
	tenantFilterRequired,
} from "@fnb/notify/postgres";
import { collectSecretValues } from "@fnb/runner";
import { createRedactor, type JsonObject, type Redactor } from "@fnb/sync";
import {
	createPostgresClient,
	enforcedSsl,
	type PostgresSsl,
} from "@fnb/sync/postgres";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";

export type FunctionEnvironment = Readonly<Record<string, string | undefined>>;

interface EdgeRuntimeLike {
	waitUntil(promise: Promise<unknown>): void;
}

type PostgresClient = ReturnType<typeof createPostgresClient>;

export interface DatabaseSettings {
	readonly url: string;
	readonly ssl: PostgresSsl | false;
	readonly caCerts: readonly string[];
}

export interface ClaimedNotifyTicket {
	readonly reason: string;
}

export interface CycleResources {
	readonly repository: NotifyRepository;
	readonly digests: DigestBuilder;
	continueLater(): Promise<boolean>;
	close(): Promise<void>;
}

export interface NotifyFunctionDependencies {
	claimTicket(
		settings: DatabaseSettings,
		ticket: string,
	): Promise<ClaimedNotifyTicket | null>;
	openCycle(
		settings: DatabaseSettings,
		environment: FunctionEnvironment,
	): CycleResources;
	readonly fetch: FetchLike;
	readonly clock: () => Date;
	readonly monotonic: () => number;
	readonly log: (line: string) => void;
	readonly edgeRuntime: () => EdgeRuntimeLike | undefined;
	readonly worker: () => string;
}

export interface NotifyCycleSummary {
	readonly reason: string;
	readonly counts: Readonly<Record<string, number>>;
	readonly stopped_by: string | null;
	readonly continuation: boolean;
	readonly format_check: boolean;
}

export const CLAIM_QUEUE_LIMIT = 32;
export const CYCLE_CONNECTIONS = 2;
const CLAIM_IDLE_SECONDS = 30;
const CONNECT_TIMEOUT_SECONDS = 10;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTIFY_VARIABLE_PATTERN = /^NOTIFY_[A-Z0-9_]{1,60}$/;
const NOTIFY_BASE_URL_PATTERN = /^NOTIFY_[A-Z0-9_]+_BASE_URL$/;
const NOTIFY_NOT_SECRET: ReadonlySet<string> = new Set([
	"NOTIFY_INTEGRATION",
	"NOTIFY_EMAIL_FROM_NAME",
	"NOTIFY_FALLBACK_TARGETS",
]);
const MIN_REDACTED_LENGTH = 6;
export const TENANT_FILTER_VARIABLE = "NOTIFY_TENANT_ID";

const claimClients = new Map<string, PostgresClient>();
let claimsInFlight = 0;

export function notifySecretVariables(
	environment: FunctionEnvironment,
): string[] {
	return Object.keys(environment)
		.filter(
			(name) =>
				NOTIFY_VARIABLE_PATTERN.test(name) &&
				!NOTIFY_NOT_SECRET.has(name) &&
				!NOTIFY_BASE_URL_PATTERN.test(name) &&
				(environment[name]?.trim().length ?? 0) >= MIN_REDACTED_LENGTH,
		)
		.sort();
}

export function functionRedactor(environment: FunctionEnvironment): Redactor {
	return createRedactor(
		collectSecretValues(environment, {
			variables: [
				"IPOS_APP_KEY",
				"SUPABASE_SERVICE_ROLE_KEY",
				"SUPABASE_ANON_KEY",
				...notifySecretVariables(environment),
			],
			databaseVariables: ["FNB_DB_URL", "SUPABASE_DB_URL"],
			dictionaryVariables: [
				"SUPABASE_SECRET_KEYS",
				"SUPABASE_PUBLISHABLE_KEYS",
			],
			includeAccountKeys: true,
		}),
	);
}

export type TenantScope =
	| { readonly ok: true; readonly tenantId: string | null }
	| { readonly ok: false };

export function tenantScope(environment: FunctionEnvironment): TenantScope {
	const raw = environment[TENANT_FILTER_VARIABLE]?.trim() ?? "";
	if (raw !== "") {
		return UUID_PATTERN.test(raw)
			? { ok: true, tenantId: raw.toLowerCase() }
			: { ok: false };
	}
	return tenantFilterRequired({ environment })
		? { ok: false }
		: { ok: true, tenantId: null };
}

function json(body: JsonObject, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

interface TicketRequest {
	readonly ticket: string;
	readonly wait: boolean;
}

async function readTicketRequest(
	request: Request,
): Promise<TicketRequest | null> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return null;
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	const { ticket, wait } = body as Record<string, unknown>;
	return typeof ticket === "string" && UUID_PATTERN.test(ticket)
		? { ticket, wait: wait === true }
		: null;
}

function connect(
	settings: DatabaseSettings,
	applicationName: string,
	maxConnections: number,
	idleTimeoutSeconds?: number,
): PostgresClient {
	return createPostgresClient(settings.url, {
		maxConnections,
		applicationName,
		connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
		socket: denoPostgresSocket([...settings.caCerts]),
		fetchTypes: false,
		...(settings.ssl === false ? {} : { ssl: settings.ssl }),
		...(idleTimeoutSeconds === undefined ? {} : { idleTimeoutSeconds }),
	});
}

function claimClient(settings: DatabaseSettings): PostgresClient {
	const known = claimClients.get(settings.url);
	if (known) {
		return known;
	}
	const created = connect(settings, "fnb-notify-claim", 1, CLAIM_IDLE_SECONDS);
	claimClients.set(settings.url, created);
	return created;
}

async function claimWithSharedConnection(
	settings: DatabaseSettings,
	ticket: string,
): Promise<ClaimedNotifyTicket | null> {
	const sql = claimClient(settings);
	const rows = await sql<{ reason: string }[]>`
		select c.reason from app.claim_notify_ticket(${ticket}::uuid) c
	`;
	const row = rows[0];
	return row ? { reason: row.reason } : null;
}

function openPostgresCycle(
	settings: DatabaseSettings,
	environment: FunctionEnvironment,
): CycleResources {
	const sql = connect(settings, "fnb-notify", CYCLE_CONNECTIONS);
	return {
		repository: createPostgresNotifyRepository(sql, { environment }),
		digests: createPostgresDigestBuilder(sql, { environment }),
		continueLater: () => kickNotify(sql, "continue"),
		close: () => sql.end({ timeout: 5 }),
	};
}

export const defaultDependencies: NotifyFunctionDependencies = {
	claimTicket: claimWithSharedConnection,
	openCycle: openPostgresCycle,
	fetch: (input, init) => globalThis.fetch(input, init),
	clock: () => new Date(),
	monotonic: () => performance.now(),
	log: (line) => console.log(line),
	edgeRuntime: () =>
		(globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime,
	worker: () => `edge:${crypto.randomUUID().slice(0, 8)}`,
};

export function cycleLine(report: CycleReport): string {
	const parts = [
		`digests built ${report.get("digests_built")}`,
		`messages sent ${report.get("sent")}`,
		`retried ${report.get("retried")}`,
		`failed ${report.get("failed")}`,
		`uncertain ${report.get("uncertain")}`,
		`links matched ${report.get("links_matched")}`,
		`accepted ${report.get("links_accepted")}`,
	];
	if (report.stoppedBy !== null) {
		parts.push(`stopped by the budget (${report.stoppedBy})`);
	}
	return parts.join(" · ");
}

function errorCode(error: unknown): string {
	if (error !== null && typeof error === "object") {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
			return code;
		}
		const name = (error as { name?: unknown }).name;
		if (typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)) {
			return name;
		}
	}
	return "error";
}

interface CycleRun {
	readonly settings: DatabaseSettings;
	readonly environment: FunctionEnvironment;
	readonly tenantId: string | null;
	readonly reason: string;
	readonly startedAt: number;
	readonly log: (line: string) => void;
	readonly dependencies: NotifyFunctionDependencies;
}

export function remainingWallSeconds(
	startedAt: number,
	now: number,
	limitSeconds: number = EDGE_CYCLE_LIMITS.wallSeconds,
): number {
	return Math.max(0, limitSeconds - (now - startedAt) / 1000);
}

async function runCycle(run: CycleRun): Promise<NotifyCycleSummary | null> {
	const { dependencies } = run;
	const resources = dependencies.openCycle(run.settings, run.environment);
	try {
		const report = await runNotifyCycle({
			repository: resources.repository,
			digests: resources.digests,
			adapters: createAdapterRegistry(),
			environment: run.environment,
			runtime: "edge",
			worker: dependencies.worker(),
			tenantId: run.tenantId,
			clock: dependencies.clock,
			fetch: dependencies.fetch,
			log: run.log,
			budget: createCycleBudget(
				{
					...EDGE_CYCLE_LIMITS,
					wallSeconds: remainingWallSeconds(
						run.startedAt,
						dependencies.monotonic(),
					),
				},
				dependencies.monotonic,
			),
			runSqlTick: false,
			dryRun: false,
		});
		let continuation = false;
		if (report.stoppedBy !== null) {
			try {
				continuation = await resources.continueLater();
			} catch (error) {
				run.log(`continuation not posted (${errorCode(error)})`);
			}
		}
		run.log(
			`${cycleLine(report)}${continuation ? " · continuation posted" : ""}`,
		);
		return {
			reason: run.reason,
			counts: report.counts(),
			stopped_by: report.stoppedBy,
			continuation,
			format_check: formatSelfCheck(),
		};
	} catch (error) {
		run.log(`cycle stopped (${errorCode(error)})`);
		return null;
	} finally {
		try {
			await resources.close();
		} catch {
			run.log("closing the cycle's connections failed");
		}
	}
}

function summaryBody(summary: NotifyCycleSummary): JsonObject {
	return {
		reason: summary.reason,
		counts: { ...summary.counts },
		stopped_by: summary.stopped_by,
		continuation: summary.continuation,
		format_check: summary.format_check,
	};
}

export async function handleRequest(
	request: Request,
	environment: FunctionEnvironment,
	startedAt: number = performance.now(),
	dependencies: NotifyFunctionDependencies = defaultDependencies,
): Promise<Response> {
	if (request.method !== "POST") {
		return json({ error: "send a POST request with a dispatch ticket" }, 405);
	}
	const parsed = await readTicketRequest(request);
	if (!parsed) {
		return json({ error: "the body must be JSON with a ticket id" }, 400);
	}
	const redact = functionRedactor(environment);
	const log = (line: string) => dependencies.log(redact(`notify: ${line}`));
	const databaseUrl = environment.FNB_DB_URL || environment.SUPABASE_DB_URL;
	if (!databaseUrl) {
		log("no database URL in the function environment");
		return json({ error: "the function is not configured" }, 500);
	}
	const ssl = enforcedSsl(databaseUrl);
	if (ssl === null) {
		log(
			"the database URL lets the connection to a remote host fall back to plaintext; drop its sslmode or set sslmode=require or verify-full",
		);
		return json({ error: "the function is not configured" }, 500);
	}
	const scope = tenantScope(environment);
	if (!scope.ok) {
		log(
			`a provider base-URL override or NOTIFY_INTEGRATION=1 needs ${TENANT_FILTER_VARIABLE} set to the fixture tenant's id`,
		);
		return json({ error: "the function is not configured" }, 500);
	}
	if (claimsInFlight >= CLAIM_QUEUE_LIMIT) {
		return json({ error: "too many tickets are being claimed, retry" }, 429);
	}
	const settings: DatabaseSettings = {
		url: databaseUrl,
		ssl,
		caCerts: environment.FNB_DB_CA_CERT ? [environment.FNB_DB_CA_CERT] : [],
	};
	let claimed: ClaimedNotifyTicket | null;
	claimsInFlight += 1;
	try {
		claimed = await dependencies.claimTicket(settings, parsed.ticket);
	} catch (error) {
		log(`could not claim the ticket (${errorCode(error)})`);
		return json({ error: "the database is unavailable" }, 503);
	} finally {
		claimsInFlight -= 1;
	}
	if (!claimed) {
		return json({ error: "unknown, used or expired ticket" }, 401);
	}
	const run = runCycle({
		settings,
		environment,
		tenantId: scope.tenantId,
		reason: claimed.reason,
		startedAt,
		log,
		dependencies,
	});
	if (parsed.wait) {
		const summary = await run;
		return summary === null
			? json(
					{
						error: "the dispatch cycle stopped",
						format_check: formatSelfCheck(),
					},
					500,
				)
			: json(summaryBody(summary), 200);
	}
	const runtime = dependencies.edgeRuntime();
	if (runtime) {
		runtime.waitUntil(run);
	} else {
		await run;
	}
	return json({ accepted: true }, 202);
}

export async function closeClaimClients(): Promise<void> {
	const clients = [...claimClients.values()];
	claimClients.clear();
	await Promise.all(clients.map((sql) => sql.end({ timeout: 5 })));
}
