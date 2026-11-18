import {
	createRedactor,
	type JsonObject,
	type Redactor,
	safeErrorMessage,
} from "@fnb/sync";
import { preflightResponse, withCors, ZALO_ORIGINS } from "./cors.ts";

export type FunctionEnvironment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_MAX_BODY_BYTES = 16_384;
export const REQUEST_ID_HEADER = "x-request-id";

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/;
const ZALO_VARIABLE_PATTERN = /^ZALO_[A-Z0-9_]{1,60}$/;
const BASE_URL_PATTERN = /_BASE_URL$/;
const ZALO_NOT_SECRET: ReadonlySet<string> = new Set([
	"ZALO_INTEGRATION",
	"ZALO_TENANT_ID",
]);
const PLAIN_SECRET_VARIABLES = [
	"SUPABASE_SERVICE_ROLE_KEY",
	"SUPABASE_ANON_KEY",
	"SUPABASE_JWT_SECRET",
];
const DATABASE_VARIABLES = ["SUPABASE_DB_URL", "FNB_DB_URL"];
const DICTIONARY_VARIABLES = [
	"SUPABASE_SECRET_KEYS",
	"SUPABASE_PUBLISHABLE_KEYS",
];

export class HttpError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string) {
		super(code);
		this.name = "HttpError";
		this.status = status;
		this.code = ERROR_CODE_PATTERN.test(code) ? code : "request_refused";
	}
}

export class MissingSecretError extends Error {
	readonly secretName: string;

	constructor(secretName: string) {
		super("a function secret is not set");
		this.name = "MissingSecretError";
		this.secretName = SECRET_NAME_PATTERN.test(secretName)
			? secretName
			: "an invalid secret name";
	}
}

export function json(
	body: JsonObject,
	status: number,
	headers?: HeadersInit,
): Response {
	const merged = new Headers(headers);
	merged.set("content-type", "application/json; charset=utf-8");
	merged.set("cache-control", "no-store");
	return new Response(JSON.stringify(body), { status, headers: merged });
}

export function zaloSecretVariables(
	environment: FunctionEnvironment,
): string[] {
	return Object.keys(environment)
		.filter(
			(name) =>
				ZALO_VARIABLE_PATTERN.test(name) &&
				!ZALO_NOT_SECRET.has(name) &&
				!BASE_URL_PATTERN.test(name),
		)
		.sort();
}

function databaseUrlSecrets(value: string): string[] {
	try {
		const url = new URL(value);
		return [
			value,
			url.password,
			decodeURIComponent(url.password),
			url.username,
			decodeURIComponent(url.username),
		].filter((part) => part !== "" && part !== "postgres");
	} catch {
		return [value];
	}
}

function dictionarySecrets(value: string): string[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed === null || typeof parsed !== "object") {
			return [value];
		}
		return Object.values(parsed).filter(
			(entry): entry is string => typeof entry === "string",
		);
	} catch {
		return [value];
	}
}

export function secretValues(environment: FunctionEnvironment): string[] {
	const values = [
		...[...zaloSecretVariables(environment), ...PLAIN_SECRET_VARIABLES].map(
			(name) => environment[name] ?? "",
		),
		...DATABASE_VARIABLES.flatMap((name) => {
			const value = environment[name];
			return value ? databaseUrlSecrets(value) : [];
		}),
		...DICTIONARY_VARIABLES.flatMap((name) => {
			const value = environment[name];
			return value ? dictionarySecrets(value) : [];
		}),
	];
	return [...new Set(values.filter((value) => value.trim() !== ""))].sort();
}

export function functionRedactor(
	environment: FunctionEnvironment,
	extra: readonly string[] = [],
): Redactor {
	return createRedactor([...secretValues(environment), ...extra]);
}

export function requireMethod(
	request: Request,
	...methods: readonly string[]
): void {
	if (!methods.includes(request.method)) {
		throw new HttpError(405, "method_not_allowed");
	}
}

export async function readBody(
	request: Request,
	maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
	const declared = request.headers.get("content-length");
	if (declared !== null && Number(declared) > maxBytes) {
		throw new HttpError(413, "body_too_large");
	}
	if (request.body === null) {
		return "";
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new HttpError(413, "body_too_large");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new HttpError(400, "invalid_body");
	}
}

export interface JsonRequestBody {
	readonly raw: string;
	readonly body: Readonly<Record<string, unknown>>;
}

export async function readJsonObject(
	request: Request,
	maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<JsonRequestBody> {
	const raw = await readBody(request, maxBytes);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new HttpError(400, "invalid_json");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new HttpError(400, "invalid_json");
	}
	return { raw, body: parsed as Record<string, unknown> };
}

export interface RequestContext {
	readonly name: string;
	readonly requestId: string;
	readonly environment: FunctionEnvironment;
	log(line: string): void;
	protect(value: string): void;
	secret(name: string): string;
	errorMessage(error: unknown): string;
}

export type FunctionHandler = (
	request: Request,
	context: RequestContext,
) => Promise<Response> | Response;

export interface ServeOptions {
	readonly name: string;
	readonly origins?: readonly string[];
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

export function createRequestContext(
	environment: FunctionEnvironment,
	options: ServeOptions,
): RequestContext {
	const requestId = (options.requestId ?? (() => crypto.randomUUID()))();
	const write = options.log ?? ((line: string) => console.log(line));
	const protectedValues: string[] = [];
	let redact = functionRedactor(environment);
	const context: RequestContext = {
		name: options.name,
		requestId,
		environment,
		log(line) {
			write(
				redact(`${options.name} ${requestId}: ${line}`).replace(
					/[\r\n]+/g,
					" ",
				),
			);
		},
		protect(value) {
			if (value.trim() !== "" && !protectedValues.includes(value)) {
				protectedValues.push(value);
				redact = functionRedactor(environment, protectedValues);
			}
		},
		secret(name) {
			if (!SECRET_NAME_PATTERN.test(name)) {
				throw new MissingSecretError(name);
			}
			const value = environment[name];
			if (value === undefined || value.trim() === "") {
				throw new MissingSecretError(name);
			}
			context.protect(value);
			return value;
		},
		errorMessage(error) {
			return safeErrorMessage(error, redact);
		},
	};
	return context;
}

export function errorResponse(
	error: unknown,
	context: RequestContext,
): Response {
	if (error instanceof HttpError) {
		return json(
			{ error: error.code, request_id: context.requestId },
			error.status,
		);
	}
	if (error instanceof MissingSecretError) {
		context.log(`the function secret ${error.secretName} is not set`);
		return json(
			{ error: "not_configured", request_id: context.requestId },
			500,
		);
	}
	context.log(`unexpected error: ${context.errorMessage(error)}`);
	return json({ error: "internal_error", request_id: context.requestId }, 500);
}

function withRequestId(response: Response, requestId: string): Response {
	const headers = new Headers(response.headers);
	headers.set(REQUEST_ID_HEADER, requestId);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export async function serveFunction(
	request: Request,
	environment: FunctionEnvironment,
	handler: FunctionHandler,
	options: ServeOptions,
): Promise<Response> {
	const origins = options.origins ?? ZALO_ORIGINS;
	if (request.method === "OPTIONS") {
		return preflightResponse(request, origins);
	}
	const context = createRequestContext(environment, options);
	let response: Response;
	try {
		response = await handler(request, context);
	} catch (error) {
		response = errorResponse(error, context);
	}
	return withCors(request, withRequestId(response, context.requestId), origins);
}
