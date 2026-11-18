import {
	isFixtureTenantSlug,
	ZaloConfigError,
	type ZaloFetch,
} from "@fnb/zalo";
import {
	type AuthorizationResult,
	completeOaAuthorization,
	type RefreshResult,
	refreshToken,
	type SecretReader,
	type TokenJobSettings,
	type TokenStore,
	type TokenTarget,
	tokenJobSettings,
} from "@fnb/zalo/tokens";
import {
	type FunctionEnvironment,
	type FunctionHandler,
	HttpError,
	json,
	MissingSecretError,
	type RequestContext,
	readJsonObject,
	requireMethod,
} from "../_shared/http.ts";

export const FUNCTION_NAME = "zalo-oauth";
export const MAX_TICKET_BYTES = 1_024;

const TICKET_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TicketClaim =
	| { readonly outcome: "unknown" }
	| { readonly outcome: "gone"; readonly kind: string }
	| {
			readonly outcome: "claimed";
			readonly source: string;
			readonly target: TokenTarget;
	  };

export interface ZaloOauthDatabase {
	readonly tokens: TokenStore;
	claimTicket(ticket: string): Promise<TicketClaim>;
}

export interface ZaloOauthDependencies {
	database(
		environment: FunctionEnvironment,
		context: RequestContext,
	): ZaloOauthDatabase;
	readonly fetch?: ZaloFetch;
	readonly clock: () => Date;
}

const CALLBACK_STATUS: Readonly<
	Record<Exclude<AuthorizationResult["outcome"], "authorized">, number>
> = {
	invalid_state: 400,
	expired_state: 400,
	invalid_code: 400,
	wrong_oa: 400,
	not_configured: 500,
	unanswered: 502,
	refused: 502,
};

function settingsOf(environment: FunctionEnvironment): TokenJobSettings {
	try {
		return tokenJobSettings(environment);
	} catch (error) {
		if (error instanceof ZaloConfigError) {
			throw new HttpError(500, "not_configured");
		}
		throw error;
	}
}

function secretReader(context: RequestContext): SecretReader {
	return (name) => {
		try {
			return context.secret(name);
		} catch (error) {
			if (error instanceof MissingSecretError) {
				context.log(`the function secret ${error.secretName} is not set`);
				return null;
			}
			throw error;
		}
	};
}

function guardedStore(
	store: TokenStore,
	settings: TokenJobSettings,
): TokenStore {
	if (!settings.integration) {
		return store;
	}
	return {
		targets: store.targets.bind(store),
		beginAuthorization: store.beginAuthorization.bind(store),
		claimAuthorization: async (stateKey, at) => {
			const claim = await store.claimAuthorization(stateKey, at);
			return claim.outcome === "claimed" && claim.tenantId !== settings.tenantId
				? { outcome: "unknown" }
				: claim;
		},
		saveTokens: store.saveTokens.bind(store),
		locked: store.locked.bind(store),
		snapshot: store.snapshot.bind(store),
		raiseFailure: store.raiseFailure.bind(store),
		resolveFailure: store.resolveFailure.bind(store),
		checkPackageExpiry: store.checkPackageExpiry.bind(store),
	};
}

function optionalParameter(url: URL, name: string): string | null {
	const values = url.searchParams.getAll(name);
	if (values.length > 1) {
		throw new HttpError(400, "invalid_callback");
	}
	return values[0] ?? null;
}

async function callback(
	request: Request,
	context: RequestContext,
	dependencies: ZaloOauthDependencies,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.search.length > 4_096) {
		throw new HttpError(400, "invalid_callback");
	}
	const state = optionalParameter(url, "state");
	const code = optionalParameter(url, "code");
	for (const value of [state, code]) {
		if (value !== null) {
			context.protect(value);
		}
	}
	const settings = settingsOf(context.environment);
	if (code === null && optionalParameter(url, "error") !== null) {
		context.log("callback outcome declined");
		return json({ error: "declined", request_id: context.requestId }, 400, {
			"referrer-policy": "no-referrer",
		});
	}
	const database = dependencies.database(context.environment, context);
	const result = await completeOaAuthorization(
		{
			store: guardedStore(database.tokens, settings),
			oauth: { baseUrl: settings.oauthBaseUrl, fetch: dependencies.fetch },
			secret: secretReader(context),
			clock: dependencies.clock,
			source: "scheduler",
		},
		{ state, code, oaId: optionalParameter(url, "oa_id") },
	);
	context.log(
		result.outcome === "refused"
			? `callback outcome refused (Zalo error ${result.errorCode})`
			: `callback outcome ${result.outcome}`,
	);
	if (result.outcome === "authorized") {
		return json({ ok: true, brand: result.brandKey }, 200, {
			"referrer-policy": "no-referrer",
		});
	}
	return json(
		{
			error: result.outcome,
			...(result.outcome === "refused" ? { zalo_error: result.errorCode } : {}),
			request_id: context.requestId,
		},
		CALLBACK_STATUS[result.outcome],
		{ "referrer-policy": "no-referrer" },
	);
}

function refreshStatus(result: RefreshResult): number {
	switch (result.outcome) {
		case "refreshed":
		case "fresh":
		case "missing":
			return 200;
		case "not_configured":
			return 500;
		case "refused":
		case "uncertain":
			return 502;
	}
}

function refreshBody(result: RefreshResult): Record<string, string | number> {
	switch (result.outcome) {
		case "refreshed":
			return { outcome: result.outcome, version: result.version };
		case "fresh":
			return {
				outcome: result.outcome,
				version: result.version,
				age_seconds: result.ageSeconds,
			};
		case "refused":
			return {
				outcome: result.outcome,
				zalo_error: result.errorCode,
				alert: result.alert,
			};
		case "not_configured":
			return { outcome: result.outcome, alert: result.alert };
		case "uncertain":
			return {
				outcome: result.outcome,
				failure: result.failure,
				alert: result.alert ?? "none",
			};
		case "missing":
			return { outcome: result.outcome };
	}
}

async function ticketRun(
	request: Request,
	context: RequestContext,
	dependencies: ZaloOauthDependencies,
): Promise<Response> {
	const { body } = await readJsonObject(request, MAX_TICKET_BYTES);
	const ticket = body.ticket;
	if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) {
		throw new HttpError(400, "invalid_ticket");
	}
	const settings = settingsOf(context.environment);
	const database = dependencies.database(context.environment, context);
	const claim = await database.claimTicket(ticket.toLowerCase());
	if (claim.outcome === "unknown") {
		context.log("ticket unknown, used or expired");
		throw new HttpError(401, "invalid_ticket");
	}
	if (claim.outcome === "gone") {
		context.log(`ticket for a ${claim.kind} pair whose brand left the jobs`);
		return json({ outcome: "missing" }, 200);
	}
	if (
		settings.integration &&
		(claim.target.tenantId !== settings.tenantId ||
			!isFixtureTenantSlug(claim.target.tenantSlug))
	) {
		context.log("ticket refused: outside the integration fixture tenant");
		throw new HttpError(401, "invalid_ticket");
	}
	const result = await refreshToken(
		{
			store: database.tokens,
			oauth: { baseUrl: settings.oauthBaseUrl, fetch: dependencies.fetch },
			secret: secretReader(context),
			clock: dependencies.clock,
			source: "scheduler",
		},
		claim.target,
	);
	context.log(
		`${claim.source} ticket: ${claim.target.kind} pair ${result.outcome}${result.outcome === "refused" ? ` (Zalo error ${result.errorCode})` : ""}`,
	);
	return json(refreshBody(result), refreshStatus(result));
}

export function createZaloOauthHandler(
	dependencies: ZaloOauthDependencies,
): FunctionHandler {
	return (request, context) => {
		requireMethod(request, "GET", "POST");
		return request.method === "GET"
			? callback(request, context, dependencies)
			: ticketRun(request, context, dependencies);
	};
}
