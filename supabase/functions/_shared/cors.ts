export const ZALO_ORIGINS: readonly string[] = [
	"https://h5.zdn.vn",
	"zbrowser://h5.zdn.vn",
];

export const ALLOWED_METHODS = "GET, POST, OPTIONS";
export const ALLOWED_HEADERS =
	"authorization, apikey, content-type, x-client-info";
export const PREFLIGHT_MAX_AGE_SECONDS = 600;

const CORS_RESPONSE_HEADERS = [
	"access-control-allow-origin",
	"access-control-allow-methods",
	"access-control-allow-headers",
	"access-control-allow-credentials",
	"access-control-expose-headers",
	"access-control-max-age",
];

export function allowedOrigin(
	request: Request,
	origins: readonly string[] = ZALO_ORIGINS,
): string | null {
	const origin = request.headers.get("origin");
	return origin !== null && origins.includes(origin) ? origin : null;
}

function addVaryOrigin(headers: Headers): void {
	const current = headers.get("vary");
	if (current === null || current.trim() === "") {
		headers.set("vary", "Origin");
		return;
	}
	const fields = current.split(",").map((field) => field.trim().toLowerCase());
	if (!fields.includes("origin") && !fields.includes("*")) {
		headers.set("vary", `${current}, Origin`);
	}
}

export function corsHeaders(
	request: Request,
	origins: readonly string[] = ZALO_ORIGINS,
): Headers {
	const headers = new Headers();
	addVaryOrigin(headers);
	const origin = allowedOrigin(request, origins);
	if (origin !== null) {
		headers.set("access-control-allow-origin", origin);
	}
	return headers;
}

export function preflightResponse(
	request: Request,
	origins: readonly string[] = ZALO_ORIGINS,
): Response {
	const headers = corsHeaders(request, origins);
	if (headers.has("access-control-allow-origin")) {
		headers.set("access-control-allow-methods", ALLOWED_METHODS);
		headers.set("access-control-allow-headers", ALLOWED_HEADERS);
		headers.set("access-control-max-age", String(PREFLIGHT_MAX_AGE_SECONDS));
	}
	return new Response(null, { status: 204, headers });
}

export function withCors(
	request: Request,
	response: Response,
	origins: readonly string[] = ZALO_ORIGINS,
): Response {
	const headers = new Headers(response.headers);
	for (const name of CORS_RESPONSE_HEADERS) {
		headers.delete(name);
	}
	addVaryOrigin(headers);
	const origin = allowedOrigin(request, origins);
	if (origin !== null) {
		headers.set("access-control-allow-origin", origin);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
