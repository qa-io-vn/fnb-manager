import {
	createEInvoiceProvider,
	createMockMailer,
	EInvoiceConfigError,
	type EInvoiceProvider,
	emailResultRequest,
	type InvoiceMailer,
	type MockFailure,
	type MockLedger,
	readEmailItem,
	readWorkItem,
	resultRequest,
	runEmailItem,
	runWorkItem,
	type WorkItem,
} from "@fnb/einvoice";
import type { SupabaseBackend } from "@fnb/zalo";
import {
	type FunctionEnvironment,
	HttpError,
	json,
	MissingSecretError,
	type RequestContext,
	readJsonObject,
	requireMethod,
	serveFunction,
} from "../_shared/http.ts";
import { backendOf, rpc } from "../_shared/payments.ts";

/**
 * einvoice-job (ADR-069): the minute job einvoice-tick posts a single-use ticket here (verify_jwt false) when work
 * waits; the function claims it and then, within a time budget:
 *
 * 1. takes the work list (app.einvoice_job_work), each document under its own 5-minute claim, its amount fixed by the
 *    database, and runs it through the provider of its row (the mock until a provider is chosen; EINVOICE_MOCK=on lets
 *    it run): a later attempt asks the provider for the document by our id first, so a lost answer never makes a
 *    second invoice; a cancellation the provider refuses becomes an adjustment to zero;
 * 2. reports every outcome under its claim (app.einvoice_job_result): issued with the provider's numbers, not found,
 *    or failed with an error class only; the database retries with back-off, gives up for a person and alerts;
 * 3. sends the company invoice emails through the mailer (EINVOICE_MAILER=mock: the mock; no real email provider
 *    yet, and most e-invoice providers email the buyer themselves).
 *
 * The log holds counts and classes only: never a buyer's tax code, name, address or email.
 */

export const FUNCTION_NAME = "einvoice-job";
export const WORK_LIMIT = 10;
export const BUDGET_MS = 25_000;
export const EINVOICE_MOCK_VARIABLE = "EINVOICE_MOCK";
export const EINVOICE_MAILER_VARIABLE = "EINVOICE_MAILER";
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EInvoiceJobDependencies {
	readonly backend?: SupabaseBackend;
	/** the mailer; by default the mock where EINVOICE_MAILER=mock, else none */
	readonly mailer?: InvoiceMailer | null;
	/** the mock provider's memory and failures, so tests see one run's documents in the next */
	readonly mockLedger?: MockLedger;
	readonly mockScript?: MockFailure[];
	readonly clock?: () => number;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

interface Report {
	issued: number;
	notFound: number;
	failed: number;
	emailed: number;
	emailFailed: number;
	errors: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function mocksAllowed(environment: FunctionEnvironment): boolean {
	return environment[EINVOICE_MOCK_VARIABLE]?.trim() === "on";
}

function mailerOf(
	environment: FunctionEnvironment,
	dependencies: EInvoiceJobDependencies,
): InvoiceMailer | null {
	if (dependencies.mailer !== undefined) {
		return dependencies.mailer;
	}
	return environment[EINVOICE_MAILER_VARIABLE]?.trim() === "mock"
		? createMockMailer()
		: null;
}

function protectBuyer(item: WorkItem, context: RequestContext): void {
	if (item.buyer !== null) {
		context.protect(item.buyer.taxCode);
		context.protect(item.buyer.companyName);
		context.protect(item.buyer.address);
		context.protect(item.buyer.email);
	}
}

function providerFor(
	item: WorkItem,
	context: RequestContext,
	dependencies: EInvoiceJobDependencies,
	at: Date,
): EInvoiceProvider | "not_configured" {
	try {
		return createEInvoiceProvider(item.provider, {
			secret: context.secret(item.provider.secretName),
			allowMock: mocksAllowed(context.environment),
			...(dependencies.mockLedger === undefined
				? {}
				: { mockLedger: dependencies.mockLedger }),
			...(dependencies.mockScript === undefined
				? {}
				: { mockScript: dependencies.mockScript }),
			clock: () => at,
		});
	} catch (error) {
		if (error instanceof MissingSecretError) {
			context.log(`the function secret ${error.secretName} is not set`);
			return "not_configured";
		}
		if (error instanceof EInvoiceConfigError) {
			context.log(`the ${item.provider.adapter} provider cannot run here`);
			return "not_configured";
		}
		throw error;
	}
}

async function runDocument(
	raw: Record<string, unknown>,
	backend: SupabaseBackend,
	context: RequestContext,
	dependencies: EInvoiceJobDependencies,
	at: Date,
	report: Report,
): Promise<void> {
	const item = readWorkItem(raw);
	if (item === null) {
		report.errors += 1;
		const invoiceId = typeof raw.invoice_id === "string" ? raw.invoice_id : "";
		const claim = typeof raw.claim === "string" ? raw.claim : "";
		context.log("a document of the work list is out of shape");
		if (UUID_PATTERN.test(invoiceId) && UUID_PATTERN.test(claim)) {
			await rpc(backend, "einvoice_job_result", {
				p_request: {
					kind: "invoice",
					invoice_id: invoiceId,
					claim,
					outcome: "failed",
					error_class: "rejected_data",
				},
			});
		}
		return;
	}
	protectBuyer(item, context);
	const provider = providerFor(item, context, dependencies, at);
	const result =
		provider === "not_configured"
			? ({ outcome: "failed", errorClass: "not_configured" } as const)
			: await runWorkItem(item, provider, at);
	if (result.outcome === "issued") {
		report.issued += 1;
	} else if (result.outcome === "not_found") {
		report.notFound += 1;
	} else {
		report.failed += 1;
	}
	context.log(
		`${item.kind} ${item.action}: ${result.outcome === "failed" ? `failed (${result.errorClass})` : result.outcome}`,
	);
	await rpc(backend, "einvoice_job_result", {
		p_request: resultRequest(item, result),
	});
}

async function runEmail(
	raw: Record<string, unknown>,
	backend: SupabaseBackend,
	context: RequestContext,
	mailer: InvoiceMailer | null,
	report: Report,
): Promise<void> {
	const item = readEmailItem(raw);
	if (item === null) {
		report.errors += 1;
		context.log("an email of the work list is out of shape");
		return;
	}
	context.protect(item.to);
	context.protect(item.companyName);
	context.protect(item.taxCode);
	const result = await runEmailItem(item, mailer);
	if (result.ok) {
		report.emailed += 1;
	} else {
		report.emailFailed += 1;
	}
	context.log(
		`email: ${result.ok ? "sent" : `not sent (${result.errorClass})`}`,
	);
	await rpc(backend, "einvoice_job_result", {
		p_request: emailResultRequest(item, result),
	});
}

async function einvoiceJob(
	request: Request,
	context: RequestContext,
	dependencies: EInvoiceJobDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	const { body } = await readJsonObject(request, 1024);
	const ticket = body.ticket;
	if (typeof ticket !== "string" || !UUID_PATTERN.test(ticket)) {
		throw new HttpError(400, "invalid_request");
	}
	const backend = backendOf(context.environment, dependencies.backend);
	if (
		(await rpc(backend, "einvoice_job_claim", { p_ticket: ticket })) !== true
	) {
		context.log("refused a ticket that is unknown, used or expired");
		return json(
			{ error: "ticket_refused", request_id: context.requestId },
			401,
		);
	}
	const clock = dependencies.clock ?? Date.now;
	const started = clock();
	const work = await rpc(backend, "einvoice_job_work", { p_limit: WORK_LIMIT });
	if (!isRecord(work)) {
		throw new HttpError(503, "backend_unavailable");
	}
	const report: Report = {
		issued: 0,
		notFound: 0,
		failed: 0,
		emailed: 0,
		emailFailed: 0,
		errors: 0,
	};
	const inBudget = () => clock() - started < BUDGET_MS;
	for (const item of list(work.invoices)) {
		if (!inBudget()) break;
		await runDocument(
			item,
			backend,
			context,
			dependencies,
			new Date(clock()),
			report,
		);
	}
	const mailer = mailerOf(context.environment, dependencies);
	for (const item of list(work.emails)) {
		if (!inBudget()) break;
		await runEmail(item, backend, context, mailer, report);
	}
	context.log(
		`done: ${report.issued} issued, ${report.notFound} not found, ${report.failed} failed, ${report.emailed} emailed, ${report.emailFailed} emails failed, ${report.errors} errors`,
	);
	return json(
		{
			issued: report.issued,
			not_found: report.notFound,
			failed: report.failed,
			emailed: report.emailed,
			email_failed: report.emailFailed,
			errors: report.errors,
		},
		200,
	);
}

export function handleEInvoiceJob(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: EInvoiceJobDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => einvoiceJob(incoming, context, dependencies),
		{
			name: FUNCTION_NAME,
			origins: [],
			...(dependencies.log === undefined ? {} : { log: dependencies.log }),
			...(dependencies.requestId === undefined
				? {}
				: { requestId: dependencies.requestId }),
		},
	);
}
