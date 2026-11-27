import {
	createSupabaseBackend,
	serviceKeyFrom,
	UpstreamError,
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

/**
 * web-requests (native-till.md section 12): the café website's forms post here, without a login: a booking now, a
 * workshop sign-up, a hold of an item and a job application through the same contract, each taken only where the
 * store switched the kind on (store_ordering_settings.request_kinds). The function
 *
 * - answers CORS, and takes a request, only from the website origins of WEB_REQUEST_ORIGINS, each naming its brand
 *   (`https://www.example.com=<brand uuid>`, comma separated); every other origin gets a 403 without CORS headers;
 * - reads at most 4 KiB of JSON with exactly the known fields and checks each strictly (lengths, a Vietnamese phone,
 *   a real date and time, 1 to 20 guests), naming only the field that failed and never echoing what was sent;
 * - drops, with the same answer as a success, a form whose hidden honeypot field is filled or that was sent less than
 *   three seconds after it was shown, so a bot learns nothing;
 * - derives an opaque client key, HMAC-SHA-256 under WEB_REQUEST_KEY of the caller's IP and user agent, so neither is
 *   sent to or kept by the database, which keeps only its SHA-256 for the limits (3 an hour per client, 100 an hour
 *   per store) and the replay of the same request id;
 * - calls web_submit_request with the service role; the database checks the store, the kind, the time (30 minutes to
 *   60 days ahead, and within the store's opening hours for a booking and a hold) and stores the request.
 *
 * No third-party service is called (no captcha), and the logs carry only outcome codes.
 */

export const FUNCTION_NAME = "web-requests";
export const ORIGINS_VARIABLE = "WEB_REQUEST_ORIGINS";
export const KEY_VARIABLE = "WEB_REQUEST_KEY";
export const MAX_BODY_BYTES = 4096;
export const MIN_FILL_MS = 3000;
export const MAX_FILL_MS = 24 * 60 * 60 * 1000;
export const MIN_GUESTS = 1;
export const MAX_GUESTS = 20;
export const KINDS = ["booking", "workshop", "hold", "application"] as const;
export type RequestKind = (typeof KINDS)[number];

const FIELDS = [
	"kind",
	"store",
	"request_id",
	"name",
	"phone",
	"date",
	"time",
	"guests",
	"subject",
	"note",
	"website",
	"elapsed_ms",
] as const;
const ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/;
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
// A Vietnamese number once spaces, dots, dashes and brackets are gone: +84, 84 or 0, then 9 or 10 digits that do
// not start with 0 or 1 (mobile 3, 5, 7, 8, 9 and landline 2).
const PHONE_PATTERN = /^(?:\+84|84|0)[235789]\d{8,9}$/;
const PHONE_SEPARATORS = /[\s.()-]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this pattern refuses
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const REFUSALS = new Set([
	"store_unknown",
	"kind_not_offered",
	"too_many_open_requests",
	"name_invalid",
	"phone_invalid",
	"party_size_invalid",
	"time_invalid",
	"time_outside_hours",
	"subject_invalid",
	"note_invalid",
	"request_conflict",
]);

export interface RequestBackend {
	rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface WebRequestsDependencies {
	readonly backend?: RequestBackend;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

/** The site of each allowed origin: the brand its requests belong to. */
export function originBrands(
	environment: FunctionEnvironment,
): Map<string, string> {
	const brands = new Map<string, string>();
	for (const entry of (environment[ORIGINS_VARIABLE] ?? "").split(",")) {
		const [origin, brand, extra] = entry.trim().split("=");
		if (
			origin === undefined ||
			brand === undefined ||
			extra !== undefined ||
			!UUID_PATTERN.test(brand.trim())
		) {
			continue;
		}
		const site = origin.trim();
		const local =
			environment.ZALO_LOCAL_DEV === "1" && LOOPBACK_ORIGIN.test(site);
		if (ORIGIN_PATTERN.test(site) || local) {
			brands.set(site, brand.trim().toLowerCase());
		}
	}
	return brands;
}

export class FieldError extends HttpError {
	readonly field: string;
	constructor(name: string) {
		super(400, "invalid_field");
		this.field = name;
	}
}

function fail(name: string): never {
	throw new FieldError(name);
}

function text(
	body: Readonly<Record<string, unknown>>,
	name: string,
	min: number,
	max: number,
): string | null {
	const value = body[name];
	if (value === undefined || value === null) {
		if (min > 0) fail(name);
		return null;
	}
	if (typeof value !== "string") fail(name);
	const trimmed = value.trim();
	if (trimmed === "" && min === 0) return null;
	const length = [...trimmed].length;
	if (length < Math.max(min, 1) || length > max || CONTROL.test(trimmed)) {
		fail(name);
	}
	return trimmed;
}

function realDate(value: string): boolean {
	const match = DATE_PATTERN.exec(value);
	if (match === null) return false;
	const [, year, month, day] = match.map(Number) as [
		number,
		number,
		number,
		number,
	];
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export interface WebRequest {
	readonly request_id: string;
	readonly store: string;
	readonly kind: RequestKind;
	readonly name: string;
	readonly phone: string;
	readonly party_size?: number;
	readonly at?: string;
	readonly subject?: string;
	readonly note?: string;
}

export interface ParsedForm {
	readonly request: WebRequest;
	readonly bot: boolean;
}

/** The strict reading of a form: only the known fields, each in its shape; 400 naming the first field that fails. */
export function parseForm(body: Readonly<Record<string, unknown>>): ParsedForm {
	if (
		!Object.keys(body).every((name) =>
			(FIELDS as readonly string[]).includes(name),
		)
	) {
		throw new HttpError(400, "invalid_request");
	}
	const kind = body.kind;
	if (
		typeof kind !== "string" ||
		!(KINDS as readonly string[]).includes(kind)
	) {
		fail("kind");
	}
	const requestKind = kind as RequestKind;
	if (typeof body.store !== "string" || !STORE_PATTERN.test(body.store)) {
		fail("store");
	}
	if (
		typeof body.request_id !== "string" ||
		!UUID_PATTERN.test(body.request_id)
	) {
		fail("request_id");
	}
	const elapsed = body.elapsed_ms;
	if (
		typeof elapsed !== "number" ||
		!Number.isInteger(elapsed) ||
		elapsed < 0 ||
		elapsed > MAX_FILL_MS
	) {
		fail("elapsed_ms");
	}
	const honeypot = body.website;
	if (
		honeypot !== undefined &&
		honeypot !== null &&
		typeof honeypot !== "string"
	) {
		fail("website");
	}
	const name = text(body, "name", 1, 60) as string;
	const rawPhone = body.phone;
	if (typeof rawPhone !== "string" || rawPhone.length > 30) fail("phone");
	const phone = (rawPhone as string).replace(PHONE_SEPARATORS, "");
	if (!PHONE_PATTERN.test(phone)) fail("phone");
	const timed = requestKind !== "application";
	const date = body.date;
	const time = body.time;
	let at: string | undefined;
	if (timed || date !== undefined || time !== undefined) {
		if (typeof date !== "string" || !realDate(date)) fail("date");
		if (typeof time !== "string" || !TIME_PATTERN.test(time)) fail("time");
		at = `${date}T${time}:00+07:00`;
	}
	let guests: number | undefined;
	if (requestKind === "booking") {
		const value = body.guests;
		if (
			typeof value !== "number" ||
			!Number.isInteger(value) ||
			value < MIN_GUESTS ||
			value > MAX_GUESTS
		) {
			fail("guests");
		}
		guests = value as number;
	} else if (body.guests !== undefined && body.guests !== null) {
		fail("guests");
	}
	const subject = text(body, "subject", requestKind === "booking" ? 0 : 1, 100);
	const note = text(body, "note", 0, 500);
	const request: WebRequest = {
		request_id: (body.request_id as string).toLowerCase(),
		store: body.store as string,
		kind: requestKind,
		name,
		phone,
		...(guests === undefined ? {} : { party_size: guests }),
		...(at === undefined ? {} : { at }),
		...(subject === null ? {} : { subject }),
		...(note === null ? {} : { note }),
	};
	const bot =
		(typeof honeypot === "string" && honeypot.trim() !== "") ||
		(elapsed as number) < MIN_FILL_MS;
	return { request, bot };
}

function base64url(bytes: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** The caller's address as the platform's proxy reports it, or "unknown". */
export function clientAddress(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	const first = forwarded?.split(",")[0]?.trim();
	if (first !== undefined && first !== "" && first.length <= 64) return first;
	const real = request.headers.get("x-real-ip")?.trim();
	return real !== undefined && real !== "" && real.length <= 64
		? real
		: "unknown";
}

/** The opaque client key: HMAC-SHA-256 under the function's key of the address and the user agent, base64url. */
export async function clientKey(
	request: Request,
	secret: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(`web-requests:${secret}`),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const agent = (request.headers.get("user-agent") ?? "").slice(0, 300);
	const signed = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${clientAddress(request)}\n${agent}`),
	);
	return base64url(signed);
}

function backendOf(
	environment: FunctionEnvironment,
	dependencies: WebRequestsDependencies,
): RequestBackend {
	if (dependencies.backend !== undefined) return dependencies.backend;
	const url = environment.SUPABASE_URL;
	const key = serviceKeyFrom(environment);
	if (url === undefined || url.trim() === "" || key === null) {
		throw new HttpError(500, "not_configured");
	}
	return createSupabaseBackend({ url, key });
}

function submitted(replayed: boolean): Response {
	return json({ state: "submitted", replayed }, 200);
}

async function webRequests(
	request: Request,
	context: RequestContext,
	dependencies: WebRequestsDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	const brand = originBrands(context.environment).get(
		request.headers.get("origin") ?? "",
	);
	if (brand === undefined) {
		context.log("refused: origin_not_allowed");
		throw new HttpError(403, "origin_not_allowed");
	}
	const type = (request.headers.get("content-type") ?? "")
		.split(";")[0]
		?.trim()
		.toLowerCase();
	if (type !== "application/json") {
		throw new HttpError(415, "unsupported_media_type");
	}
	const secret = context.secret(KEY_VARIABLE);
	const { body } = await readJsonObject(request, MAX_BODY_BYTES);
	let form: ParsedForm;
	try {
		form = parseForm(body);
	} catch (error) {
		if (error instanceof FieldError) {
			context.log(`refused: invalid_field ${error.field}`);
			return json(
				{
					error: "invalid_field",
					field: error.field,
					request_id: context.requestId,
				},
				400,
			);
		}
		throw error;
	}
	if (form.bot) {
		context.log("dropped: honeypot or too fast");
		return submitted(false);
	}
	const backend = backendOf(context.environment, dependencies);
	let answer: unknown;
	try {
		answer = await backend.rpc("web_submit_request", {
			p_brand: brand,
			p_client_key: await clientKey(request, secret),
			p_request: form.request,
		});
	} catch (error) {
		if (error instanceof UpstreamError || error instanceof TypeError) {
			context.log("backend unavailable");
			throw new HttpError(503, "backend_unavailable");
		}
		throw error;
	}
	const result = (answer ?? {}) as Record<string, unknown>;
	if (result.state === "submitted") {
		context.log(
			`submitted ${form.request.kind}${result.replayed === true ? " (replayed)" : ""}`,
		);
		return submitted(result.replayed === true);
	}
	const refusal = typeof result.refusal === "string" ? result.refusal : "";
	if (refusal === "rate_limited") {
		const retryAt =
			typeof result.retry_at === "string"
				? Date.parse(result.retry_at)
				: Number.NaN;
		const seconds = Number.isNaN(retryAt)
			? 3600
			: Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
		context.log("refused: rate_limited");
		return json({ state: "refused", refusal: "rate_limited" }, 429, {
			"retry-after": String(seconds),
		});
	}
	if (REFUSALS.has(refusal)) {
		context.log(`refused: ${refusal}`);
		return json({ state: "refused", refusal }, 422);
	}
	context.log("unexpected answer from the database");
	throw new HttpError(502, "unexpected_answer");
}

export function handleWebRequests(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: WebRequestsDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => webRequests(incoming, context, dependencies),
		{
			name: FUNCTION_NAME,
			origins: [...originBrands(environment).keys()],
			...(dependencies.log === undefined ? {} : { log: dependencies.log }),
			...(dependencies.requestId === undefined
				? {}
				: { requestId: dependencies.requestId }),
		},
	);
}
