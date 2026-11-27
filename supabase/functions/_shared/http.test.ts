import {
	createRequestContext,
	DEFAULT_MAX_BODY_BYTES,
	type FunctionEnvironment,
	functionRedactor,
	HttpError,
	json,
	MissingSecretError,
	REQUEST_ID_HEADER,
	readBody,
	readJsonObject,
	requireMethod,
	secretValues,
	serveFunction,
	zaloSecretVariables,
} from "./http.ts";

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

async function assertRefused(
	run: () => Promise<unknown>,
	status: number,
	code: string,
	label: string,
): Promise<void> {
	try {
		await run();
	} catch (error) {
		assert(error instanceof HttpError, `${label}: not an HttpError`);
		assertEquals([error.status, error.code], [status, code], label);
		return;
	}
	throw new Error(`${label}: nothing was refused`);
}

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";
const APP_SECRET = "synthetic-app-secret-value";
const OA_SECRET = "synthetic-oa-secret-value";
const SERVICE_KEY = "synthetic-service-role-key";
const DB_PASSWORD = "synthetic-db-password";

const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
	ZALO_OA_SECRET_BRAND_1: OA_SECRET,
	ZALO_INTEGRATION: "1",
	ZALO_TENANT_ID: "11111111-1111-4111-8111-111111111111",
	ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
	SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
	SUPABASE_DB_URL: `postgresql://postgres.synthetic:${DB_PASSWORD}@example.com:5432/postgres`,
	SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_synthet" }),
	SUPABASE_URL: "http://127.0.0.1:54321",
};

const SECRET_VALUES = [
	APP_SECRET,
	OA_SECRET,
	SERVICE_KEY,
	DB_PASSWORD,
	"sb_secret_synthet",
];

function post(
	body: BodyInit | null,
	headers: Record<string, string> = {},
): Request {
	return new Request(FUNCTION_URL, { method: "POST", body, headers });
}

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			const chunk = chunks[index];
			index += 1;
			if (chunk === undefined) {
				controller.close();
			} else {
				controller.enqueue(chunk);
			}
		},
	});
}

function capture(): { lines: string[]; log: (line: string) => void } {
	const lines: string[] = [];
	return { lines, log: (line) => lines.push(line) };
}

function assertNoSecret(text: string, label: string): void {
	for (const value of SECRET_VALUES) {
		assert(!text.includes(value), `${label} carries a secret value`);
	}
}

Deno.test("json answers with the status, a JSON content type and no caching", async () => {
	const response = json({ ok: true, count: 2 }, 201, { "x-extra": "kept" });
	assertEquals(response.status, 201, "status");
	assertEquals(
		response.headers.get("content-type"),
		"application/json; charset=utf-8",
		"content type",
	);
	assertEquals(response.headers.get("cache-control"), "no-store", "cache");
	assertEquals(response.headers.get("x-extra"), "kept", "extra header");
	assertEquals(await response.json(), { ok: true, count: 2 }, "body");
});

Deno.test("the ZALO_ secrets are every ZALO_ variable except the gate, the tenant filter and base URLs", () => {
	assertEquals(
		zaloSecretVariables(ENVIRONMENT).join(" "),
		"ZALO_APP_SECRET_BRAND_1 ZALO_OA_SECRET_BRAND_1",
		"variables",
	);
	const values = secretValues(ENVIRONMENT);
	for (const value of SECRET_VALUES) {
		assert(values.includes(value), `secretValues misses ${value.slice(0, 12)}`);
	}
	assert(!values.includes("http://127.0.0.1:8788"), "a base URL is not secret");
	assert(
		!values.includes("http://127.0.0.1:54321"),
		"SUPABASE_URL is not secret",
	);
});

Deno.test("the redactor masks every secret value and the generic shapes", () => {
	const redact = functionRedactor(ENVIRONMENT);
	const line = redact(
		`app ${APP_SECRET} oa ${OA_SECRET} key ${SERVICE_KEY} db ${ENVIRONMENT.SUPABASE_DB_URL} sb sb_secret_synthet access_token=zzzzzzzzzzzz`,
	);
	assertNoSecret(line, "redacted line");
	assert(!line.includes("zzzzzzzzzzzz"), "an access_token= value is masked");
});

Deno.test("readBody reads a body within the limit", async () => {
	assertEquals(await readBody(post('{"a":1}')), '{"a":1}', "body");
	assertEquals(
		await readBody(new Request(FUNCTION_URL, { method: "GET" })),
		"",
		"no body",
	);
	assertEquals(
		await readBody(post("x".repeat(DEFAULT_MAX_BODY_BYTES))),
		"x".repeat(DEFAULT_MAX_BODY_BYTES),
		"exactly the limit",
	);
});

Deno.test("readBody refuses a declared length over the limit before reading", async () => {
	await assertRefused(
		() => readBody(post("{}", { "content-length": "20000" })),
		413,
		"body_too_large",
		"declared length",
	);
});

Deno.test("readBody refuses a streamed body that grows past the limit", async () => {
	const chunk = new Uint8Array(4096).fill(120);
	await assertRefused(
		() =>
			readBody(
				new Request(FUNCTION_URL, {
					method: "POST",
					body: streamOf([chunk, chunk, chunk]),
				}),
				10_000,
			),
		413,
		"body_too_large",
		"streamed body",
	);
});

Deno.test("readBody refuses bytes that are not UTF-8", async () => {
	await assertRefused(
		() => readBody(post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))),
		400,
		"invalid_body",
		"invalid UTF-8",
	);
});

Deno.test("readJsonObject keeps the raw text and refuses anything but an object", async () => {
	const raw = '{"event_name":"user_send_text","n":1}';
	const read = await readJsonObject(post(raw));
	assertEquals(read.raw, raw, "raw text kept byte for byte");
	assertEquals(read.body, { event_name: "user_send_text", n: 1 }, "parsed");
	for (const body of ["[1,2]", "null", "42", '"text"', "{", ""]) {
		await assertRefused(
			() => readJsonObject(post(body)),
			400,
			"invalid_json",
			`body ${body}`,
		);
	}
});

Deno.test("requireMethod refuses another method with 405", () => {
	requireMethod(post("{}"), "POST");
	try {
		requireMethod(new Request(FUNCTION_URL), "POST");
		throw new Error("GET was accepted");
	} catch (error) {
		assert(error instanceof HttpError, "an HttpError");
		assertEquals(
			[error.status, error.code],
			[405, "method_not_allowed"],
			"405",
		);
	}
});

Deno.test("HttpError keeps only a safe code", () => {
	assertEquals(new HttpError(401, "wrong_proof").code, "wrong_proof", "safe");
	assertEquals(
		new HttpError(400, `token ${APP_SECRET}`).code,
		"request_refused",
		"unsafe code replaced",
	);
	assertEquals(
		new MissingSecretError(APP_SECRET).secretName,
		"an invalid secret name",
		"a value passed as a name is never kept",
	);
});

Deno.test("context.secret reads a secret by name and protects it in the logs", () => {
	const { lines, log } = capture();
	const context = createRequestContext(
		{ ...ENVIRONMENT, OTHER_SECRET: "synthetic-other-secret" },
		{ name: "zalo-test", log, requestId: () => "request-1" },
	);
	assertEquals(context.secret("ZALO_APP_SECRET_BRAND_1"), APP_SECRET, "value");
	assertEquals(
		context.secret("OTHER_SECRET"),
		"synthetic-other-secret",
		"other value",
	);
	context.log(`computed with ${APP_SECRET} and synthetic-other-secret`);
	assertEquals(
		lines,
		["zalo-test request-1: computed with *** and ***"],
		"redacted line",
	);
});

Deno.test("context.secret drops a line ending or spaces around a pasted secret and still protects it", () => {
	const { lines, log } = capture();
	const context = createRequestContext(
		{
			ZALO_APP_SECRET_BRAND_1: `${APP_SECRET}\r\n`,
			ZALO_APP_SECRET_BRAND_2: ` ${OA_SECRET}\t`,
		},
		{ name: "zalo-test", log, requestId: () => "request-1" },
	);
	assertEquals(
		context.secret("ZALO_APP_SECRET_BRAND_1"),
		APP_SECRET,
		"a Windows line ending is dropped",
	);
	assertEquals(
		context.secret("ZALO_APP_SECRET_BRAND_2"),
		OA_SECRET,
		"spaces and a tab are dropped",
	);
	context.log(`computed with ${APP_SECRET} and ${OA_SECRET}`);
	assertEquals(
		lines,
		["zalo-test request-1: computed with *** and ***"],
		"both trimmed values stay redacted",
	);
});

Deno.test("context.secret throws MissingSecretError for a missing, blank or malformed name", () => {
	const context = createRequestContext(
		{ ZALO_APP_SECRET_BRAND_2: "   " },
		{ name: "zalo-test", log: () => {} },
	);
	for (const name of [
		"ZALO_APP_SECRET_BRAND_9",
		"ZALO_APP_SECRET_BRAND_2",
		"zalo_app_secret",
	]) {
		try {
			context.secret(name);
			throw new Error(`${name} was read`);
		} catch (error) {
			assert(
				error instanceof MissingSecretError,
				`${name}: MissingSecretError`,
			);
		}
	}
});

Deno.test("context.protect masks a value learnt during the request", () => {
	const { lines, log } = capture();
	const context = createRequestContext(
		{},
		{ name: "zalo-test", log, requestId: () => "request-2" },
	);
	const token = "synthetic-access-token-from-the-mini-app";
	context.protect(token);
	context.protect("");
	context.log(`graph call with ${token}`);
	context.log(context.errorMessage(new Error(`refused ${token}`)));
	assertEquals(
		lines,
		[
			"zalo-test request-2: graph call with ***",
			"zalo-test request-2: refused ***",
		],
		"lines",
	);
});

Deno.test("a log line is always one line", () => {
	const { lines, log } = capture();
	const context = createRequestContext(
		{},
		{ name: "zalo-test", log, requestId: () => "request-3" },
	);
	context.log("first\r\nforged: line\nthird");
	assertEquals(
		lines,
		["zalo-test request-3: first forged: line third"],
		"lines",
	);
});

Deno.test("serveFunction answers the preflight itself, with CORS, without running the handler", async () => {
	let ran = false;
	const response = await serveFunction(
		new Request(FUNCTION_URL, {
			method: "OPTIONS",
			headers: {
				origin: "https://h5.zdn.vn",
				"access-control-request-method": "POST",
			},
		}),
		ENVIRONMENT,
		() => {
			ran = true;
			return json({}, 200);
		},
		{ name: "zalo-test", log: () => {} },
	);
	assertEquals(ran, false, "handler not run");
	assertEquals(response.status, 204, "status");
	assertEquals(
		response.headers.get("access-control-allow-origin"),
		"https://h5.zdn.vn",
		"origin",
	);
});

Deno.test("serveFunction adds the request id and CORS to the handler's answer", async () => {
	const response = await serveFunction(
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { origin: "zbrowser://h5.zdn.vn" },
			body: "{}",
		}),
		ENVIRONMENT,
		(_request, context) => json({ request_id: context.requestId }, 200),
		{ name: "zalo-test", log: () => {}, requestId: () => "request-4" },
	);
	assertEquals(response.status, 200, "status");
	assertEquals(response.headers.get(REQUEST_ID_HEADER), "request-4", "header");
	assertEquals(
		response.headers.get("access-control-allow-origin"),
		"zbrowser://h5.zdn.vn",
		"origin",
	);
	assertEquals(await response.json(), { request_id: "request-4" }, "body");

	const foreign = await serveFunction(
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { origin: "https://example.com" },
		}),
		ENVIRONMENT,
		() => json({}, 200),
		{ name: "zalo-test", log: () => {} },
	);
	assertEquals(
		foreign.headers.get("access-control-allow-origin"),
		null,
		"foreign origin",
	);
	assert(
		/^[0-9a-f-]{36}$/.test(foreign.headers.get(REQUEST_ID_HEADER) ?? ""),
		"a random request id by default",
	);
});

Deno.test("a missing secret answers 500 without naming the secret or echoing a value", async () => {
	const { lines, log } = capture();
	const response = await serveFunction(
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { origin: "https://h5.zdn.vn" },
		}),
		ENVIRONMENT,
		(_request, context) => {
			context.secret("ZALO_APP_SECRET_BRAND_7");
			return json({}, 200);
		},
		{ name: "zalo-test", log, requestId: () => "request-5" },
	);
	assertEquals(response.status, 500, "status");
	const text = await response.text();
	assertEquals(
		JSON.parse(text),
		{ error: "not_configured", request_id: "request-5" },
		"body",
	);
	assert(!text.includes("ZALO_"), "the answer names no secret");
	assertNoSecret(text, "answer");
	assertEquals(
		response.headers.get("access-control-allow-origin"),
		"https://h5.zdn.vn",
		"the error carries CORS too",
	);
	assertEquals(
		lines,
		[
			"zalo-test request-5: the function secret ZALO_APP_SECRET_BRAND_7 is not set",
		],
		"the log names the secret for the operator, never a value",
	);
});

Deno.test("an unexpected error answers 500 and logs only redacted text", async () => {
	const { lines, log } = capture();
	const response = await serveFunction(
		post("{}"),
		ENVIRONMENT,
		(_request, context) => {
			const token = "synthetic-zalo-access-token";
			context.protect(token);
			throw new Error(
				`graph refused ${token} with ${APP_SECRET} at ${ENVIRONMENT.SUPABASE_DB_URL}`,
			);
		},
		{ name: "zalo-test", log, requestId: () => "request-6" },
	);
	assertEquals(response.status, 500, "status");
	const text = await response.text();
	assertEquals(
		JSON.parse(text),
		{ error: "internal_error", request_id: "request-6" },
		"body",
	);
	assertEquals(lines.length, 1, "one line");
	const line = lines[0] ?? "";
	assert(line.startsWith("zalo-test request-6: unexpected error: "), "prefix");
	assertNoSecret(line, "log line");
	assert(
		!line.includes("synthetic-zalo-access-token"),
		"protected token masked",
	);
});

Deno.test("an HttpError answers its status and code", async () => {
	const { lines, log } = capture();
	const response = await serveFunction(
		post("x".repeat(DEFAULT_MAX_BODY_BYTES + 1)),
		ENVIRONMENT,
		async (request) => {
			await readJsonObject(request);
			return json({}, 200);
		},
		{ name: "zalo-test", log, requestId: () => "request-7" },
	);
	assertEquals(response.status, 413, "status");
	assertEquals(
		await response.json(),
		{ error: "body_too_large", request_id: "request-7" },
		"body",
	);
	assertEquals(lines, [], "a refusal is not logged as an error");
});

Deno.test("every log line of a request passes the redactor", async () => {
	const { lines, log } = capture();
	await serveFunction(
		post("{}"),
		ENVIRONMENT,
		(_request, context) => {
			for (const value of SECRET_VALUES) {
				context.log(`value ${value}`);
			}
			context.log(`url ${ENVIRONMENT.SUPABASE_DB_URL}`);
			return json({}, 200);
		},
		{ name: "zalo-test", log },
	);
	assertEquals(lines.length, SECRET_VALUES.length + 1, "line count");
	for (const line of lines) {
		assertNoSecret(line, "log line");
	}
});

Deno.test("the e-invoice providers' EINVOICE_KEY_ credentials are redacted; the mock and mailer switches are not secrets", () => {
	const environment: FunctionEnvironment = {
		EINVOICE_KEY_BRAND_1: "synthetic-einvoice-key-redacted",
		EINVOICE_MOCK: "on",
		EINVOICE_MAILER: "mock",
	};
	const values = secretValues(environment);
	assert(
		values.includes("synthetic-einvoice-key-redacted"),
		"the provider's key is a secret",
	);
	assert(
		!values.includes("on") && !values.includes("mock"),
		"the switches are not",
	);
	assert(
		!functionRedactor(environment)(
			"key synthetic-einvoice-key-redacted here",
		).includes("synthetic-einvoice-key-redacted"),
		"the log never holds it",
	);
});

Deno.test("the bank services' PAYMENT_ keys are redacted like the Zalo secrets; the mock switch is not a secret", () => {
	const environment: FunctionEnvironment = {
		PAYMENT_BANK_BRAND_1: "synthetic-bank-key-redacted",
		PAYMENTS_MOCK: "on",
		ZALO_CHECKOUT_KEY_BRAND_1: "synthetic-checkout-key-redacted",
	};
	const values = secretValues(environment);
	assert(
		values.includes("synthetic-bank-key-redacted"),
		"the bank key is a secret",
	);
	assert(
		values.includes("synthetic-checkout-key-redacted"),
		"the Checkout key is a secret",
	);
	assert(!values.includes("on"), "the mock switch is not");
	const redact = functionRedactor(environment);
	assert(
		!redact("key synthetic-bank-key-redacted here").includes(
			"synthetic-bank-key-redacted",
		),
		"the log never holds it",
	);
});
