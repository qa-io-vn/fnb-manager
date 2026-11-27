import {
	callbackMacInput,
	hmacSha256Hex,
	notifyMacInput,
	overallMacInput,
} from "@fnb/payments";
import { UpstreamError } from "@fnb/zalo";
import type { FunctionEnvironment } from "../_shared/http.ts";
import {
	APP_ID,
	assert,
	assertEquals,
	CHECKOUT_KEY,
	CHECKOUT_PROVIDER_ID,
	checkoutRow,
	ENVIRONMENT,
	fakeBackend,
} from "../_shared/payments-fakes.ts";
import { handleCheckoutWebhook } from "./handler.ts";

// checkout-webhook: security cases of Zalo's callback and notify (a forged MAC, a tampered amount or extradata caught by
// overallMac alone, another app, an address outside the allow-list in observe and enforce mode, a replay answered 2),
// the settlement request the database gets (only after verification), the answers Zalo expects, and logs without the
// key or the transaction id.

const BASE = "http://127.0.0.1:54321/functions/v1/checkout-webhook";
const ZALO_IP = "118.102.2.29";

function data(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		appId: APP_ID,
		orderId: "zorder-1",
		transId: "240101000000001",
		method: "ZALOPAY_SANDBOX",
		transTime: 1767225600000,
		merchantTransId: "m-1",
		amount: 64000,
		description: "Cửa hàng mẫu",
		resultCode: 1,
		message: "Giao dịch thành công",
		extradata: encodeURIComponent('{"ref":"ZC7K2M9Q4T"}'),
		paymentChannel: "ZALOPAY_SANDBOX",
		...overrides,
	};
}

async function callback(
	fields: Record<string, unknown>,
	key = CHECKOUT_KEY,
): Promise<string> {
	return JSON.stringify({
		data: fields,
		mac: await hmacSha256Hex(
			key,
			callbackMacInput({
				appId: String(fields.appId),
				amount: Number(fields.amount),
				description: String(fields.description),
				orderId: String(fields.orderId),
				message: String(fields.message),
				resultCode: Number(fields.resultCode),
				transId: String(fields.transId),
			}),
		),
		overallMac: await hmacSha256Hex(key, overallMacInput(fields)),
	});
}

function backendWith(outcome = "confirmed") {
	return fakeBackend({
		checkout_app_provider: (args) =>
			args.p_app_id === APP_ID ? checkoutRow : null,
		checkout_settle: () => ({ outcome }),
	});
}

async function post(
	path: string,
	body: string,
	backend: ReturnType<typeof fakeBackend>,
	options: {
		readonly ip?: string | null;
		readonly environment?: FunctionEnvironment;
		readonly lines?: string[];
		readonly method?: string;
	} = {},
): Promise<Response> {
	return await handleCheckoutWebhook(
		new Request(`${BASE}/${path}`, {
			method: options.method ?? "POST",
			headers: { "content-type": "application/json" },
			...(options.method === "GET" ? {} : { body }),
		}),
		options.environment ?? ENVIRONMENT,
		{
			backend,
			connectionAddress: () =>
				options.ip === undefined ? ZALO_IP : options.ip,
			log: (line) => options.lines?.push(line),
		},
	);
}

Deno.test("a genuine callback is settled once verified and answered returnCode 1", async () => {
	const backend = backendWith();
	const lines: string[] = [];
	const response = await post("callback", await callback(data()), backend, {
		lines,
	});
	assertEquals(
		[response.status, await response.json()],
		[200, { returnCode: 1, returnMessage: "ok" }],
		"answer",
	);
	assertEquals(
		backend.callsTo("checkout_settle")[0]?.args,
		{
			p_request: {
				provider_id: CHECKOUT_PROVIDER_ID,
				provider_ref: "240101000000001",
				reference: "ZC7K2M9Q4T",
				platform_order_id: "zorder-1",
				amount: 64000,
				success: true,
				reason: null,
				source: "webhook",
			},
		},
		"the settlement request",
	);
	const log = lines.join("\n");
	assert(
		!log.includes(CHECKOUT_KEY) && !log.includes("240101000000001"),
		"the log holds no key and no transaction id",
	);
});

Deno.test("a transaction already handled is answered returnCode 2", async () => {
	const response = await post(
		"callback",
		await callback(data()),
		backendWith("replayed"),
	);
	assertEquals((await response.json()).returnCode, 2, "duplicate");
});

Deno.test("a forged MAC, a changed amount and a changed extradata are refused before the database", async () => {
	const backend = backendWith();
	const forged = await callback(data(), "attacker-key");
	const amount = JSON.parse(await callback(data()));
	amount.data.amount = 1000;
	const extradata = JSON.parse(await callback(data()));
	extradata.data.extradata = encodeURIComponent('{"ref":"ZC22222222"}');
	for (const body of [
		forged,
		JSON.stringify(amount),
		JSON.stringify(extradata),
	]) {
		assertEquals(
			(await (await post("callback", body, backend)).json()).returnCode,
			-1,
			"refused",
		);
	}
	assertEquals(backend.callsTo("checkout_settle").length, 0, "nothing settled");
});

Deno.test("a callback of an app no provider serves, or without an app, is refused", async () => {
	const backend = backendWith();
	const other = await callback(data({ appId: "synthetic-app-9" }));
	assertEquals(
		(await (await post("callback", other, backend)).json()).returnCode,
		-1,
		"unknown app",
	);
	assertEquals(
		(await (await post("callback", "{}", backend)).json()).returnCode,
		-1,
		"no app",
	);
	assertEquals(backend.callsTo("checkout_settle").length, 0, "nothing settled");
});

Deno.test("a genuine notify is refused: cash and bank transfer are not offered in the sheet", async () => {
	const backend = backendWith();
	const fields = { appId: APP_ID, orderId: "zorder-2", method: "COD" };
	const body = JSON.stringify({
		data: fields,
		mac: await hmacSha256Hex(CHECKOUT_KEY, notifyMacInput(fields)),
	});
	assertEquals(
		(await (await post("notify", body, backend)).json()).returnCode,
		-1,
		"refused",
	);
	assertEquals(backend.callsTo("checkout_settle").length, 0, "nothing settled");
});

Deno.test("an address outside the allow-list is counted in observe mode and refused in enforce mode", async () => {
	const lines: string[] = [];
	const observe = await post(
		"callback",
		await callback(data()),
		backendWith(),
		{ ip: "203.0.113.9", lines },
	);
	assertEquals((await observe.json()).returnCode, 1, "observe processes it");
	assert(
		lines.some((line) => line.includes("observe mode")),
		"and logs it",
	);
	const enforced = backendWith();
	const response = await post("callback", await callback(data()), enforced, {
		ip: "203.0.113.9",
		environment: { ...ENVIRONMENT, CHECKOUT_WEBHOOK_IP_MODE: "enforce" },
	});
	assertEquals((await response.json()).returnCode, -1, "enforce refuses");
	assertEquals(
		enforced.callsTo("checkout_app_provider").length,
		0,
		"before reading anything",
	);
	const proxied = await handleCheckoutWebhook(
		new Request(`${BASE}/callback`, {
			method: "POST",
			headers: { "x-forwarded-for": `203.0.113.9, ${ZALO_IP}` },
			body: await callback(data()),
		}),
		{
			...ENVIRONMENT,
			CHECKOUT_WEBHOOK_IP_MODE: "enforce",
			CHECKOUT_WEBHOOK_PROXY_HOPS: "1",
		},
		{ backend: backendWith(), connectionAddress: () => "10.0.0.1" },
	);
	assertEquals(
		(await proxied.json()).returnCode,
		1,
		"the address one proxy back is Zalo's",
	);
});

Deno.test("another path is 404, another method 405, an unreachable database 500 with returnCode 0", async () => {
	assertEquals((await post("other", "{}", backendWith())).status, 404, "path");
	assertEquals(
		(await post("callback", "", backendWith(), { method: "GET" })).status,
		405,
		"method",
	);
	const down = fakeBackend({
		checkout_app_provider: () =>
			Promise.reject(new UpstreamError("supabase", "network")),
	});
	const response = await post("callback", await callback(data()), down);
	assertEquals(
		[response.status, (await response.json()).returnCode],
		[500, 0],
		"try again later",
	);
});
