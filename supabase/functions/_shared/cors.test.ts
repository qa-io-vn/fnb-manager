import {
	ALLOWED_HEADERS,
	ALLOWED_METHODS,
	allowedOrigin,
	corsHeaders,
	PREFLIGHT_MAX_AGE_SECONDS,
	preflightResponse,
	withCors,
	ZALO_ORIGINS,
} from "./cors.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";

function request(
	method: string,
	origin: string | null,
	extra: Record<string, string> = {},
): Request {
	const headers = new Headers(extra);
	if (origin !== null) {
		headers.set("origin", origin);
	}
	return new Request(FUNCTION_URL, { method, headers });
}

function preflight(origin: string | null): Request {
	return request("OPTIONS", origin, {
		"access-control-request-method": "POST",
		"access-control-request-headers": "authorization, content-type",
	});
}

function allowOriginValues(response: Response): string[] {
	return [...response.headers]
		.filter(([name]) => name === "access-control-allow-origin")
		.map(([, value]) => value);
}

const FOREIGN_ORIGINS = [
	"https://example.com",
	"http://localhost:3000",
	"http://h5.zdn.vn",
	"https://h5.zdn.vn.example.com",
	"https://sub.h5.zdn.vn",
	"https://H5.ZDN.VN",
	"https://h5.zdn.vn/",
	"https://h5.zdn.vn:443",
	"null",
	"https://h5.zdn.vn, https://example.com",
];

Deno.test("exactly the two Zalo origins are allowed", () => {
	assertEquals(
		ZALO_ORIGINS,
		["https://h5.zdn.vn", "zbrowser://h5.zdn.vn"],
		"origins",
	);
});

Deno.test("a preflight from https://h5.zdn.vn gets exactly that origin back", () => {
	const response = preflightResponse(preflight("https://h5.zdn.vn"));
	assertEquals(response.status, 204, "status");
	assertEquals(allowOriginValues(response), ["https://h5.zdn.vn"], "origin");
	assertEquals(
		response.headers.get("access-control-allow-methods"),
		ALLOWED_METHODS,
		"methods",
	);
	assertEquals(
		response.headers.get("access-control-allow-headers"),
		ALLOWED_HEADERS,
		"headers",
	);
	assertEquals(
		response.headers.get("access-control-max-age"),
		String(PREFLIGHT_MAX_AGE_SECONDS),
		"max age",
	);
	assertEquals(response.headers.get("vary"), "Origin", "vary");
	assertEquals(
		response.headers.get("access-control-allow-credentials"),
		null,
		"no credentials",
	);
});

Deno.test("a preflight from zbrowser://h5.zdn.vn is reflected the same way", () => {
	const response = preflightResponse(preflight("zbrowser://h5.zdn.vn"));
	assertEquals(response.status, 204, "status");
	assertEquals(allowOriginValues(response), ["zbrowser://h5.zdn.vn"], "origin");
	assertEquals(
		response.headers.get("access-control-allow-methods"),
		ALLOWED_METHODS,
		"methods",
	);
	assertEquals(response.headers.get("vary"), "Origin", "vary");
});

Deno.test("a preflight from any other origin gets no CORS header at all", () => {
	for (const origin of [...FOREIGN_ORIGINS, null]) {
		const response = preflightResponse(preflight(origin));
		const corsNames = [...response.headers]
			.map(([name]) => name)
			.filter((name) => name.startsWith("access-control-"));
		assertEquals(corsNames, [], `CORS headers for ${origin}`);
		assertEquals(response.headers.get("vary"), "Origin", `vary for ${origin}`);
	}
});

Deno.test("a request from an allowed origin gets exactly that origin back", () => {
	for (const origin of ZALO_ORIGINS) {
		const response = withCors(
			request("POST", origin),
			new Response("{}", { status: 200 }),
		);
		assertEquals(allowOriginValues(response), [origin], `origin ${origin}`);
		assertEquals(response.headers.get("vary"), "Origin", `vary ${origin}`);
	}
});

Deno.test("a request from any other origin or without one gets no Access-Control-Allow-Origin", () => {
	for (const origin of [...FOREIGN_ORIGINS, null]) {
		const response = withCors(
			request("POST", origin),
			new Response("{}", { status: 200 }),
		);
		assertEquals(allowOriginValues(response), [], `origin ${origin}`);
		assertEquals(response.headers.get("vary"), "Origin", `vary ${origin}`);
	}
});

Deno.test("withCors replaces any CORS header the handler set", () => {
	const response = withCors(
		request("POST", "https://example.com"),
		new Response("{}", {
			status: 201,
			statusText: "Created",
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-credentials": "true",
				"content-type": "application/json",
			},
		}),
	);
	assertEquals(allowOriginValues(response), [], "wildcard removed");
	assertEquals(
		response.headers.get("access-control-allow-credentials"),
		null,
		"credentials removed",
	);
	assertEquals(response.status, 201, "status kept");
	assertEquals(response.statusText, "Created", "status text kept");
	assertEquals(
		response.headers.get("content-type"),
		"application/json",
		"other headers kept",
	);

	const allowed = withCors(
		request("POST", "https://h5.zdn.vn"),
		new Response("{}", {
			headers: { "access-control-allow-origin": "https://example.com" },
		}),
	);
	assertEquals(
		allowOriginValues(allowed),
		["https://h5.zdn.vn"],
		"one origin only",
	);
});

Deno.test("Vary keeps the handler's fields and names Origin once", () => {
	const merged = withCors(
		request("GET", "https://h5.zdn.vn"),
		new Response(null, { headers: { vary: "Accept-Encoding" } }),
	);
	assertEquals(
		merged.headers.get("vary"),
		"Accept-Encoding, Origin",
		"merged vary",
	);
	const already = withCors(
		request("GET", "https://h5.zdn.vn"),
		new Response(null, { headers: { vary: "origin" } }),
	);
	assertEquals(already.headers.get("vary"), "origin", "origin not repeated");
});

Deno.test("the body survives withCors", async () => {
	const response = withCors(
		request("POST", "https://h5.zdn.vn"),
		new Response('{"ok":true}', { status: 200 }),
	);
	assertEquals(await response.text(), '{"ok":true}', "body");
});

Deno.test("allowedOrigin and corsHeaders take another list for a caller that needs one", () => {
	const local = ["http://127.0.0.1:3000"];
	assertEquals(
		allowedOrigin(request("GET", "http://127.0.0.1:3000"), local),
		"http://127.0.0.1:3000",
		"listed origin",
	);
	assertEquals(
		allowedOrigin(request("GET", "https://h5.zdn.vn"), local),
		null,
		"default list replaced",
	);
	assertEquals(
		corsHeaders(request("GET", "https://h5.zdn.vn")).get(
			"access-control-allow-origin",
		),
		"https://h5.zdn.vn",
		"default list",
	);
});
