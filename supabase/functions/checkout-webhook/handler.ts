import {
	checkoutAppIdOf,
	checkoutReply,
	type NotificationOutcome,
	verifyCheckoutNotify,
} from "@fnb/payments";
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
	sourceAddress,
} from "../_shared/payments.ts";

/**
 * checkout-webhook (ADR-068): Zalo's Checkout SDK posts here, without a Supabase session (verify_jwt false).
 *
 * - /checkout-webhook/callback (ZaloPay, MoMo, VNPay, PayME): the brand is found by data.appId (its customer Mini
 *   App), then mac and overallMac are checked under the brand's private key in constant time; a verified event goes
 *   to checkout_settle, which is unique on the transaction id, checks the attempt (by the reference our createOrder put
 *   in extradata), the amount and the order, and pays, fails, queues for a manager or ignores. The answer is
 *   returnCode 1 when handled, 2 for a transaction already handled, -1 refused (unverified or unknown), 0 with HTTP 500
 *   when the database could not be reached (the payments job asks Zalo again later).
 * - /checkout-webhook/notify (COD or bank transfer chosen in the sheet): verified, then refused, because the wallet
 *   orders force their method and these are not offered through the sheet.
 *
 * Source addresses are checked against CHECKOUT_WEBHOOK_IPS (Zalo's two documented addresses by default) in observe
 * mode (counted) or enforce mode (refused) per CHECKOUT_WEBHOOK_IP_MODE, behind CHECKOUT_WEBHOOK_PROXY_HOPS proxies.
 * Logs hold outcomes only.
 */

export const FUNCTION_NAME = "checkout-webhook";
export const MAX_BODY_BYTES = 16_384;
export const DEFAULT_CHECKOUT_IPS = ["118.102.2.29", "49.213.78.2"] as const;
export const IPS_VARIABLE = "CHECKOUT_WEBHOOK_IPS";
export const IP_MODE_VARIABLE = "CHECKOUT_WEBHOOK_IP_MODE";
export const PROXY_HOPS_VARIABLE = "CHECKOUT_WEBHOOK_PROXY_HOPS";

export interface CheckoutWebhookDependencies {
	readonly backend?: SupabaseBackend;
	readonly clock?: () => number;
	readonly connectionAddress?: (request: Request) => string | null;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

function reply(outcome: NotificationOutcome): Response {
	const answer = checkoutReply(outcome);
	return json(
		answer.body as Record<string, number | string>,
		outcome === "error" ? 500 : answer.status,
	);
}

function allowedAddresses(environment: FunctionEnvironment): string[] {
	const configured = (environment[IPS_VARIABLE] ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	return configured.length > 0 ? configured : [...DEFAULT_CHECKOUT_IPS];
}

function proxyHops(environment: FunctionEnvironment): number {
	const raw = environment[PROXY_HOPS_VARIABLE]?.trim() ?? "";
	return /^[0-5]$/.test(raw) ? Number(raw) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function checkoutWebhook(
	request: Request,
	context: RequestContext,
	dependencies: CheckoutWebhookDependencies,
): Promise<Response> {
	const kind = segmentAfter(request.url, FUNCTION_NAME);
	if (kind !== "callback" && kind !== "notify") {
		return json({ error: "not_found", request_id: context.requestId }, 404);
	}
	if (request.method !== "POST") {
		throw new HttpError(405, "method_not_allowed");
	}
	const address = sourceAddress(
		request,
		proxyHops(context.environment),
		dependencies.connectionAddress?.(request) ?? null,
	);
	const known =
		address !== null && allowedAddresses(context.environment).includes(address);
	if (!known) {
		if (context.environment[IP_MODE_VARIABLE]?.trim() === "enforce") {
			context.log(`${kind}: refused an address outside the allow-list`);
			return reply("refused");
		}
		context.log(`${kind}: an address outside the allow-list (observe mode)`);
	}
	const rawBody = await readBody(request, MAX_BODY_BYTES);
	const appId = checkoutAppIdOf(rawBody);
	if (appId === null) {
		context.log(`${kind}: refused a body without an app id`);
		return reply("refused");
	}
	try {
		const backend = backendOf(context.environment, dependencies.backend);
		const row = await rpc(backend, "checkout_app_provider", {
			p_app_id: appId,
		});
		if (row === null) {
			context.log(`${kind}: refused an app no Checkout provider serves`);
			return reply("refused");
		}
		const { config, provider } = providerOf(row, context);
		if (kind === "notify") {
			const notify = await verifyCheckoutNotify(
				rawBody,
				context.secret(config.secretName),
				appId,
			);
			context.log(
				notify.ok
					? `notify: refused the ${notify.notify.method} method, which is not offered in the sheet`
					: `notify: refused (${notify.refusal})`,
			);
			return reply("refused");
		}
		const verified = await provider.verifyNotification({
			path: kind,
			headers: headersOf(request),
			rawBody,
			receivedAt: (dependencies.clock ?? Date.now)(),
		});
		if (!verified.ok) {
			context.log(`callback: refused (${verified.refusal})`);
			return reply("refused");
		}
		let replayed = 0;
		for (const event of verified.events) {
			context.protect(event.providerRef);
			const answer = await rpc(backend, "checkout_settle", {
				p_request: {
					provider_id: config.id,
					provider_ref: event.providerRef,
					reference: event.reference,
					platform_order_id: event.platformOrderId,
					amount: event.amount,
					success: event.success,
					reason: event.reason,
					source: "webhook",
				},
			});
			const outcome = isRecord(answer) ? String(answer.outcome) : "unknown";
			if (outcome === "replayed") {
				replayed += 1;
			}
			context.log(
				`callback: ${outcome}${isRecord(answer) && typeof answer.reason === "string" ? ` (${answer.reason})` : ""}${known ? "" : ", unlisted address"}`,
			);
		}
		return reply(
			replayed > 0 && replayed === verified.events.length
				? "replayed"
				: "accepted",
		);
	} catch (error) {
		if (error instanceof HttpError && error.status === 503) {
			context.log(`${kind}: the database could not be reached`);
			return reply("error");
		}
		throw error;
	}
}

export function handleCheckoutWebhook(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: CheckoutWebhookDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => checkoutWebhook(incoming, context, dependencies),
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
