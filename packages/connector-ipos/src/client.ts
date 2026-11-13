import {
	type AuthSession,
	createAuthSession,
	createMemoryTokenStore,
	type TokenStore,
} from "./auth.js";
import { createAccountingEndpoints } from "./endpoints/accounting.js";
import { createMasterDataEndpoints } from "./endpoints/master-data.js";
import { createPosCmsEndpoints } from "./endpoints/pos-cms.js";
import { createReportEndpoints } from "./endpoints/reports.js";
import {
	createSaleSummaryEndpoints,
	createSaleTrendEndpoints,
} from "./endpoints/sale-summary.js";
import type { Abortable, ApiCall, ApiCallSpec } from "./endpoints/shared.js";
import { IposAuthError, IposError } from "./errors.js";
import {
	createTransport,
	DEFAULT_RETRY_POLICY,
	type FetchLike,
	type HeaderMap,
	type RetryOptions,
} from "./http.js";
import { type IposLogger, silentLogger } from "./logger.js";

export const DEFAULT_BASE_URL = "https://posapi.ipos.vn";
export const APP_ACCESS_TOKEN_PATTERN = /^[0-9a-f]{32}$/i;
export const DEFAULT_CLIENT_TIMEZONE_OFFSET_MS = 25_200_000;

export interface IposClientOptions {
	email: string;
	password: string;
	baseUrl?: string;
	appAccessToken: string;
	clientTimezoneOffsetMs?: number;
	fetch?: FetchLike;
	tokenStore?: TokenStore;
	logger?: IposLogger;
	retry?: RetryOptions;
	requestTimeoutMs?: number;
}

export function assertAppAccessToken(value: unknown): string {
	if (typeof value !== "string" || !APP_ACCESS_TOKEN_PATTERN.test(value)) {
		throw new IposError(
			"appAccessToken is required and must be the 32-hex iPOS CMS application key (set IPOS_APP_KEY or the account's appAccessToken)",
		);
	}
	return value;
}

export function buildDefaultHeaders(
	appAccessToken: string,
	clientTimezoneOffsetMs: number,
): HeaderMap {
	return {
		access_token: appAccessToken,
		fabi_type: "pos-cms",
		"x-client-timezone": String(clientTimezoneOffsetMs),
		"accept-language": "vi",
		accept: "application/json",
	};
}

function createAuthorizedCall(
	session: AuthSession,
	transport: ReturnType<typeof createTransport>,
	logger: IposLogger,
): ApiCall {
	const withToken = <T>(spec: ApiCallSpec<T>, token: string) => ({
		...spec,
		headers: { authorization: token },
	});

	return async <T>(spec: ApiCallSpec<T>): Promise<T> => {
		const token = await session.getToken(spec.signal);
		try {
			return await transport.request(withToken(spec, token));
		} catch (error) {
			if (!(error instanceof IposAuthError)) {
				throw error;
			}
			logger.info("ipos rejected the session token, logging in again", {
				endpoint: spec.path,
			});
			const refreshed = await session.login(spec.signal);
			return transport.request(withToken(spec, refreshed.token));
		}
	};
}

export function createIposClient(options: IposClientOptions) {
	const appAccessToken = assertAppAccessToken(options.appAccessToken);
	const logger = options.logger ?? silentLogger;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const transport = createTransport({
		baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
		fetchImpl,
		defaultHeaders: buildDefaultHeaders(
			appAccessToken,
			options.clientTimezoneOffsetMs ?? DEFAULT_CLIENT_TIMEZONE_OFFSET_MS,
		),
		retry: { ...DEFAULT_RETRY_POLICY, ...options.retry },
		logger,
		...(options.requestTimeoutMs === undefined
			? {}
			: { requestTimeoutMs: options.requestTimeoutMs }),
	});
	const session = createAuthSession({
		email: options.email,
		password: options.password,
		tokenStore: options.tokenStore ?? createMemoryTokenStore(),
		transport,
		logger,
	});
	const call = createAuthorizedCall(session, transport, logger);

	return {
		login: (params: Abortable = {}) => session.login(params.signal),
		...createMasterDataEndpoints(call),
		saleSummary: createSaleSummaryEndpoints(call),
		saleTrend: createSaleTrendEndpoints(call),
		accounting: createAccountingEndpoints(call, logger),
		reports: createReportEndpoints(call, logger),
		posCms: createPosCmsEndpoints(call, logger),
	};
}

export type IposClient = ReturnType<typeof createIposClient>;
