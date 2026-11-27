import type { SupabaseBackend } from "@fnb/zalo";
import {
	type FunctionEnvironment,
	HttpError,
	json,
	type RequestContext,
	readBody,
	serveFunction,
} from "../_shared/http.ts";
import {
	backendOf,
	headersOf,
	providerOf,
	rpc,
	segmentAfter,
} from "../_shared/payments.ts";

/**
 * bank-webhook (ADR-068): the service that watches a store's bank account posts each incoming transfer to
 * /bank-webhook/<provider id> (the id checkout_set_provider answered), without a Supabase session (verify_jwt false).
 * The provider row names the adapter (mock, sepay) and the function secret with the service's key; the adapter proves
 * the post (an HMAC signature or an API key, per service) and reads the transfers. Each incoming transfer goes to
 * checkout_settle with the reference-shaped words of its text: the exact amount for a pending attempt in time pays the
 * order; another amount, a late or second transfer and an unknown reference go to the manager queue, never applied;
 * a transfer without a reference is ignored (the account receives other money too). Parallel posts of one transfer
 * settle once (the database serialises on the service's transaction id). The answer is the service's own format: 2xx
 * when handled, 401 when unverified, 500 when the database could not be reached (so the service retries).
 */

export const FUNCTION_NAME = "bank-webhook";
export const MAX_BODY_BYTES = 16_384;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BankWebhookDependencies {
	readonly backend?: SupabaseBackend;
	readonly clock?: () => number;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function bankWebhook(
	request: Request,
	context: RequestContext,
	dependencies: BankWebhookDependencies,
): Promise<Response> {
	const providerId = segmentAfter(request.url, FUNCTION_NAME);
	if (providerId === null || !UUID_PATTERN.test(providerId)) {
		return json({ error: "not_found", request_id: context.requestId }, 404);
	}
	if (request.method !== "POST") {
		throw new HttpError(405, "method_not_allowed");
	}
	const rawBody = await readBody(request, MAX_BODY_BYTES);
	const backend = backendOf(context.environment, dependencies.backend);
	const row = await rpc(backend, "checkout_provider", {
		p_provider: providerId,
	});
	if (!isRecord(row) || row.method !== "vietqr") {
		context.log("refused a post for no bank provider");
		return json({ error: "not_found", request_id: context.requestId }, 404);
	}
	const { config, provider } = providerOf(row, context);
	const verified = await provider.verifyNotification({
		path: "",
		headers: headersOf(request),
		rawBody,
		receivedAt: (dependencies.clock ?? Date.now)(),
	});
	if (!verified.ok) {
		context.log(`${config.adapter}: refused (${verified.refusal})`);
		const answer = provider.reply("refused");
		return json(answer.body as Record<string, boolean>, answer.status);
	}
	const outcomes: string[] = [];
	try {
		for (const event of verified.events) {
			context.protect(event.providerRef);
			const answer = await rpc(backend, "checkout_settle", {
				p_request: {
					provider_id: config.id,
					provider_ref: event.providerRef,
					candidates: event.candidates,
					amount: event.amount,
					success: event.success,
					source: "webhook",
				},
			});
			outcomes.push(
				isRecord(answer)
					? `${String(answer.outcome)}${typeof answer.reason === "string" ? ` (${answer.reason})` : ""}`
					: "unknown",
			);
		}
	} catch (error) {
		if (error instanceof HttpError && error.status === 503) {
			context.log(
				`${config.adapter}: the database could not be reached after ${outcomes.length} of ${verified.events.length}`,
			);
			const answer = provider.reply("error");
			return json(answer.body as Record<string, boolean>, answer.status);
		}
		throw error;
	}
	context.log(
		`${config.adapter}: ${verified.events.length} transfer(s): ${outcomes.join(", ") || "none incoming"}`,
	);
	const answer = provider.reply(
		outcomes.length > 0 && outcomes.every((outcome) => outcome === "replayed")
			? "replayed"
			: "accepted",
	);
	return json(answer.body as Record<string, boolean>, answer.status);
}

export function handleBankWebhook(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: BankWebhookDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => bankWebhook(incoming, context, dependencies),
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
