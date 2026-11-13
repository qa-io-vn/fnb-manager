import {
	type AccountEntry,
	ConsoleNotifier,
	collectSecretValues,
	edgeFunctionBudget,
	type IncrementalTicket,
	isTicket,
	outcomeLine,
	outcomeReport,
	parseAccountEntries,
	runIncrementalStore,
} from "@fnb/runner";
import { PostgresRunnerDatabase } from "@fnb/runner/postgres";
import {
	createRedactor,
	type JsonObject,
	type Redactor,
	type RunBudget,
	safeErrorMessage,
} from "@fnb/sync";
import {
	createPostgresClient,
	enforcedSsl,
	type PostgresSsl,
	PostgresSyncRepository,
} from "@fnb/sync/postgres";
import { denoPostgresSocket } from "./postgres-socket.ts";

export type FunctionEnvironment = Readonly<Record<string, string | undefined>>;

interface EdgeRuntimeLike {
	waitUntil(promise: Promise<unknown>): void;
}

interface TicketRequest {
	ticket: string;
	wait: boolean;
}

type PostgresClient = ReturnType<typeof createPostgresClient>;

export const CLAIM_QUEUE_LIMIT = 32;
const CLAIM_IDLE_SECONDS = 30;

const SECRET_SOURCES = {
	variables: ["IPOS_APP_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"],
	databaseVariables: ["FNB_DB_URL", "SUPABASE_DB_URL"],
	dictionaryVariables: ["SUPABASE_SECRET_KEYS", "SUPABASE_PUBLISHABLE_KEYS"],
	includeAccountKeys: true,
};

const claimClients = new Map<string, PostgresClient>();
let claimsInFlight = 0;

function json(body: JsonObject, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function edgeRuntime(): EdgeRuntimeLike | undefined {
	return (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
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
	if (body === null || typeof body !== "object") {
		return null;
	}
	const { ticket, wait } = body as Record<string, unknown>;
	return isTicket(ticket) ? { ticket, wait: wait === true } : null;
}

interface DatabaseSettings {
	url: string;
	ssl: PostgresSsl | false;
	caCerts: string[];
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
		connectTimeoutSeconds: 10,
		socket: denoPostgresSocket(settings.caCerts),
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
	const created = connect(
		settings,
		"fnb-sync-incremental-claim",
		1,
		CLAIM_IDLE_SECONDS,
	);
	claimClients.set(settings.url, created);
	return created;
}

interface RunContext {
	environment: FunctionEnvironment;
	entries: AccountEntry[];
	redact: Redactor;
	log: (line: string) => void;
	startedAt: number;
	budget: RunBudget;
}

async function runClaimed(
	context: RunContext,
	settings: DatabaseSettings,
	ticket: IncrementalTicket,
): Promise<JsonObject> {
	const sql = connect(settings, "fnb-sync-incremental", 2);
	try {
		const outcome = await runIncrementalStore({
			repository: new PostgresSyncRepository(sql),
			database: new PostgresRunnerDatabase(sql),
			entries: context.entries,
			environment: context.environment,
			storeId: ticket.storeId,
			notifier: new ConsoleNotifier(
				(line) => console.warn(line),
				context.redact,
			),
			redact: context.redact,
			triggeredBy: ticket.source,
			incremental: {
				startedAt: context.startedAt,
				clock: () => performance.now(),
				budget: context.budget,
			},
			log: context.log,
		});
		context.log(outcomeLine(outcome));
		return outcomeReport(outcome);
	} catch (error) {
		const message = safeErrorMessage(error, context.redact);
		context.log(`run aborted: ${message}`);
		return { outcome: "failed", stage: "runner", error: message };
	} finally {
		await sql.end({ timeout: 5 });
	}
}

export async function handleRequest(
	request: Request,
	environment: FunctionEnvironment,
	startedAt: number = performance.now(),
): Promise<Response> {
	if (request.method !== "POST") {
		return json({ error: "send a POST request with a dispatch ticket" }, 405);
	}
	const parsed = await readTicketRequest(request);
	if (!parsed) {
		return json({ error: "the body must be JSON with a ticket id" }, 400);
	}
	const redact = createRedactor(
		collectSecretValues(environment, SECRET_SOURCES),
	);
	const log = (line: string) =>
		console.log(redact(`sync-incremental: ${line}`));
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
	let entries: AccountEntry[];
	let budget: RunBudget;
	try {
		entries = parseAccountEntries(environment.POS_ACCOUNTS_JSON);
	} catch (error) {
		log(`POS_ACCOUNTS_JSON: ${safeErrorMessage(error, redact)}`);
		return json({ error: "the function is not configured" }, 500);
	}
	try {
		budget = edgeFunctionBudget(environment);
	} catch (error) {
		log(safeErrorMessage(error, redact));
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
	let ticket: IncrementalTicket | null;
	claimsInFlight += 1;
	try {
		ticket = await new PostgresRunnerDatabase(
			claimClient(settings),
		).claimIncrementalTicket(parsed.ticket);
	} catch (error) {
		log(`could not claim the ticket: ${safeErrorMessage(error, redact)}`);
		return json({ error: "the database is unavailable" }, 503);
	} finally {
		claimsInFlight -= 1;
	}
	if (!ticket) {
		return json({ error: "unknown, used or expired ticket" }, 401);
	}
	const run = runClaimed(
		{ environment, entries, redact, log, startedAt, budget },
		settings,
		ticket,
	);
	if (parsed.wait) {
		const report = await run;
		return json(report, report.outcome === "failed" ? 500 : 200);
	}
	const runtime = edgeRuntime();
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
