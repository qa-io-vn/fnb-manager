import {
	createZaloPaymentApi,
	type PaymentFetch,
	ProviderUnavailableError,
	type RefundAnswer,
	readProviderConfig,
} from "@fnb/payments";
import {
	graphFetchFor,
	relayKeyText,
	type SupabaseBackend,
	type ZaloFetch,
} from "@fnb/zalo";
import {
	type FunctionEnvironment,
	HttpError,
	json,
	type RequestContext,
	readJsonObject,
	requireMethod,
	serveFunction,
} from "../_shared/http.ts";
import {
	backendOf,
	providerOf,
	rpc,
	zaloPaymentBase,
} from "../_shared/payments.ts";

/**
 * payments-job (ADR-068): the minute job checkout-tick posts a single-use ticket here (verify_jwt false) when work
 * waits; the function claims it and then, within a time budget:
 *
 * 1. asks the provider again about attempts whose notification has not come (Zalo's getOrderStatus for a linked
 *    Checkout order): a final answer goes to checkout_settle as if the callback had come, bound to the attempt it
 *    asked about and refused when Zalo's answer names another reference (a client that linked another order);
 * 2. sends the wallet refunds of paid cancelled orders and follows them (createRefund, then getRefundStatus), settling
 *    each with checkout_refund_confirm; a refund the provider cannot make stays for a manager;
 * 3. reports paid bank-transfer popups to Zalo (purchase-payment).
 *
 * Zalo's calls go through the relay of ADR-057 when the function has a relay key and a relay is announced.
 */

export const FUNCTION_NAME = "payments-job";
export const WORK_LIMIT = 20;
export const BUDGET_MS = 25_000;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PaymentsJobDependencies {
	readonly backend?: SupabaseBackend;
	readonly fetch?: ZaloFetch;
	readonly clock?: () => number;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

interface Report {
	requeried: number;
	settled: number;
	refundsSent: number;
	refundsSettled: number;
	reported: number;
	errors: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isSafeInteger(number)
		? number
		: null;
}

async function requery(
	item: Record<string, unknown>,
	backend: SupabaseBackend,
	context: RequestContext,
	fetch: PaymentFetch | undefined,
	report: Report,
): Promise<void> {
	const paymentId = str(item.payment_id);
	const reference = str(item.reference);
	const amount = num(item.amount);
	if (paymentId === null || reference === null || amount === null) {
		report.errors += 1;
		return;
	}
	const note = () =>
		rpc(backend, "checkout_job_note", {
			p_request: { kind: "requery", payment_id: paymentId },
		});
	try {
		const { config, provider } = providerOf(
			item.provider,
			context,
			fetch === undefined ? {} : { fetch },
		);
		const answer = await provider.queryStatus({
			paymentId,
			reference,
			amount,
			platformOrderId: str(item.platform_order_id),
		});
		report.requeried += 1;
		if (answer.state !== "paid" && answer.state !== "failed") {
			await note();
			return;
		}
		if (
			answer.event.reference !== null &&
			answer.event.reference !== reference
		) {
			context.log("requery: Zalo's order names another reference; not applied");
			await note();
			return;
		}
		context.protect(answer.event.providerRef);
		const settled = await rpc(backend, "checkout_settle", {
			p_request: {
				provider_id: config.id,
				provider_ref: answer.event.providerRef,
				payment_id: paymentId,
				platform_order_id: answer.event.platformOrderId,
				amount: answer.event.amount,
				success: answer.event.success,
				reason: answer.event.reason,
				source: "requery",
			},
		});
		report.settled += 1;
		context.log(
			`requery: ${isRecord(settled) ? String(settled.outcome) : "unknown"}`,
		);
		await note();
	} catch (error) {
		if (error instanceof ProviderUnavailableError) {
			report.errors += 1;
			context.log("requery: the provider could not be asked");
			await note();
			return;
		}
		throw error;
	}
}

async function settleRefund(
	refundId: string,
	answer: RefundAnswer,
	backend: SupabaseBackend,
	report: Report,
): Promise<void> {
	if (answer.state === "succeeded" || answer.state === "failed") {
		await rpc(backend, "checkout_refund_confirm", {
			p_refund: refundId,
			p_success: answer.state === "succeeded",
			p_provider_ref: answer.providerRefundId ?? `refund-${refundId}`,
			p_reason: answer.state === "failed" ? answer.reason : null,
		});
		report.refundsSettled += 1;
		return;
	}
	await rpc(backend, "checkout_job_note", {
		p_request: {
			kind: "refund",
			refund_id: refundId,
			provider_refund_id:
				answer.state === "pending" ? answer.providerRefundId : null,
			error:
				answer.state === "unsupported" ? "the provider makes no refunds" : null,
		},
	});
}

async function refund(
	item: Record<string, unknown>,
	backend: SupabaseBackend,
	context: RequestContext,
	fetch: PaymentFetch | undefined,
	report: Report,
): Promise<void> {
	const refundId = str(item.refund_id);
	const amount = num(item.amount);
	const providerRef = str(item.provider_ref);
	if (refundId === null || amount === null || providerRef === null) {
		report.errors += 1;
		return;
	}
	try {
		const { provider } = providerOf(
			item.provider,
			context,
			fetch === undefined ? {} : { fetch },
		);
		const known = str(item.provider_refund_id);
		const answer =
			known === null
				? await provider.refund({
						refundId,
						providerRef,
						amount,
						description: str(item.description) ?? "Hoàn tiền",
					})
				: await provider.queryRefund(known);
		if (known === null) {
			report.refundsSent += 1;
		}
		context.log(`refund: ${answer.state}`);
		await settleRefund(refundId, answer, backend, report);
	} catch (error) {
		if (error instanceof ProviderUnavailableError) {
			report.errors += 1;
			context.log("refund: the provider could not be reached");
			await rpc(backend, "checkout_job_note", {
				p_request: {
					kind: "refund",
					refund_id: refundId,
					error: "the provider could not be reached",
				},
			});
			return;
		}
		throw error;
	}
}

async function reportPurchase(
	item: Record<string, unknown>,
	backend: SupabaseBackend,
	context: RequestContext,
	fetch: PaymentFetch | undefined,
	report: Report,
): Promise<void> {
	const paymentId = str(item.payment_id);
	const orderId = str(item.platform_order_id);
	if (paymentId === null || orderId === null) {
		report.errors += 1;
		return;
	}
	const config = readProviderConfig(item.provider);
	let ok = false;
	let error: string | null = null;
	if (config === null || config.appId === null || fetch === undefined) {
		error = "no Checkout provider to report with";
	} else {
		try {
			const base = zaloPaymentBase(context.environment);
			ok = await createZaloPaymentApi({
				appId: config.appId,
				privateKey: context.secret(config.secretName),
				fetch,
				...(base === undefined ? {} : { baseUrl: base }),
			}).reportPurchase(orderId, 1);
			if (!ok) {
				error = "Zalo refused the report";
			}
		} catch (caught) {
			if (!(caught instanceof ProviderUnavailableError)) {
				throw caught;
			}
			error = "Zalo could not be reached";
		}
	}
	if (ok) {
		report.reported += 1;
	} else {
		report.errors += 1;
	}
	context.log(`report: ${ok ? "done" : "not done"}`);
	await rpc(backend, "checkout_job_note", {
		p_request: { kind: "report", payment_id: paymentId, ok, error },
	});
}

async function paymentsJob(
	request: Request,
	context: RequestContext,
	dependencies: PaymentsJobDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	const { body } = await readJsonObject(request, 1024);
	const ticket = body.ticket;
	if (typeof ticket !== "string" || !UUID_PATTERN.test(ticket)) {
		throw new HttpError(400, "invalid_request");
	}
	const backend = backendOf(context.environment, dependencies.backend);
	if (
		(await rpc(backend, "checkout_job_claim", { p_ticket: ticket })) !== true
	) {
		context.log("refused a ticket that is unknown, used or expired");
		return json(
			{ error: "ticket_refused", request_id: context.requestId },
			401,
		);
	}
	const clock = dependencies.clock ?? Date.now;
	const started = clock();
	const work = await rpc(backend, "checkout_job_work", { p_limit: WORK_LIMIT });
	if (!isRecord(work)) {
		throw new HttpError(503, "backend_unavailable");
	}
	const keyText = relayKeyText(context.environment, (name) =>
		context.secret(name),
	);
	const fetch =
		(await graphFetchFor(keyText, backend, dependencies.fetch)) ??
		dependencies.fetch ??
		((url, init) => globalThis.fetch(url, init));
	const report: Report = {
		requeried: 0,
		settled: 0,
		refundsSent: 0,
		refundsSettled: 0,
		reported: 0,
		errors: 0,
	};
	const inBudget = () => clock() - started < BUDGET_MS;
	for (const item of list(work.requery)) {
		if (!inBudget()) break;
		await requery(item, backend, context, fetch, report);
	}
	for (const item of list(work.refunds)) {
		if (!inBudget()) break;
		await refund(item, backend, context, fetch, report);
	}
	for (const item of list(work.reports)) {
		if (!inBudget()) break;
		await reportPurchase(item, backend, context, fetch, report);
	}
	context.log(
		`done: ${report.requeried} asked, ${report.settled} settled, ${report.refundsSent} refunds sent, ${report.refundsSettled} settled, ${report.reported} reported, ${report.errors} errors`,
	);
	return json(
		{
			requeried: report.requeried,
			settled: report.settled,
			refunds_sent: report.refundsSent,
			refunds_settled: report.refundsSettled,
			reported: report.reported,
			errors: report.errors,
		},
		200,
	);
}

export function handlePaymentsJob(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: PaymentsJobDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => paymentsJob(incoming, context, dependencies),
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
