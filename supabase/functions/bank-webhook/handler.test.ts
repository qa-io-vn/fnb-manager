import { mockSignature } from "@fnb/payments";
import { UpstreamError } from "@fnb/zalo";
import type { FunctionEnvironment } from "../_shared/http.ts";
import {
	assert,
	assertEquals,
	BANK_KEY,
	BANK_PROVIDER_ID,
	bankRow,
	ENVIRONMENT,
	fakeBackend,
	SEPAY_PROVIDER_ID,
	sepayRow,
} from "../_shared/payments-fakes.ts";
import { handleBankWebhook } from "./handler.ts";

// bank-webhook: the provider row chosen by the path, the adapter's proof (a forged, stale or missing signature, a wrong
// API key), the settlement requests with the candidates of each incoming transfer, the service's own answers, a mock
// where mocks are off, and a database that cannot be reached (500, so the service retries).

const BASE = "http://127.0.0.1:54321/functions/v1/bank-webhook";
const NOW = Date.UTC(2026, 10, 28, 3, 0, 0);

const transfer = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		transactions: [
			{
				id: "tx-1",
				amount: 64000,
				content: "CT FNB7K2M9Q4T",
				account_number: "0123456789",
				direction: "in",
				...overrides,
			},
		],
	});

function backendWith(outcome = "confirmed") {
	return fakeBackend({
		checkout_provider: (args) =>
			args.p_provider === BANK_PROVIDER_ID
				? bankRow
				: args.p_provider === SEPAY_PROVIDER_ID
					? sepayRow
					: null,
		checkout_settle: () => ({ outcome }),
	});
}

async function post(
	path: string,
	body: string,
	headers: Record<string, string>,
	backend: ReturnType<typeof fakeBackend>,
	environment: FunctionEnvironment = ENVIRONMENT,
	lines?: string[],
): Promise<Response> {
	return await handleBankWebhook(
		new Request(`${BASE}/${path}`, { method: "POST", headers, body }),
		environment,
		{
			backend,
			clock: () => NOW,
			log: (line) => lines?.push(line),
		},
	);
}

Deno.test("a signed transfer is settled with its candidates and answered as the mock expects", async () => {
	const backend = backendWith();
	const body = transfer();
	const lines: string[] = [];
	const response = await post(
		BANK_PROVIDER_ID,
		body,
		{ "x-mock-signature": await mockSignature(BANK_KEY, body, NOW) },
		backend,
		ENVIRONMENT,
		lines,
	);
	assertEquals(
		[response.status, await response.json()],
		[200, { ok: true }],
		"answer",
	);
	assertEquals(
		backend.callsTo("checkout_settle")[0]?.args,
		{
			p_request: {
				provider_id: BANK_PROVIDER_ID,
				provider_ref: "mock:tx-1",
				candidates: ["FNB7K2M9Q4T"],
				amount: 64000,
				success: true,
				source: "webhook",
			},
		},
		"the settlement request",
	);
	assert(
		!lines.join("\n").includes(BANK_KEY) &&
			!lines.join("\n").includes("mock:tx-1"),
		"the log holds no key and no transaction id",
	);
});

Deno.test("a forged, stale or missing signature is refused with 401 before the database settles anything", async () => {
	const backend = backendWith();
	const body = transfer();
	for (const header of [
		await mockSignature("attacker-key", body, NOW),
		await mockSignature(BANK_KEY, body, NOW - 6 * 60_000),
		"",
	]) {
		const response = await post(
			BANK_PROVIDER_ID,
			body,
			header === "" ? {} : { "x-mock-signature": header },
			backend,
		);
		assertEquals(response.status, 401, "refused");
	}
	assertEquals(backend.callsTo("checkout_settle").length, 0, "nothing settled");
});

Deno.test("SePay's API key decides, and SePay gets {success: true}", async () => {
	const body = JSON.stringify({
		id: 92704,
		accountNumber: "0123456789",
		content: "FNB7K2M9Q4T chuyen tien",
		transferType: "in",
		transferAmount: 64000,
		transactionDate: "2026-11-28 10:08:33",
	});
	const good = await post(
		SEPAY_PROVIDER_ID,
		body,
		{ authorization: `Apikey ${BANK_KEY}` },
		backendWith(),
	);
	assertEquals(
		[good.status, await good.json()],
		[200, { success: true }],
		"accepted",
	);
	const bad = await post(
		SEPAY_PROVIDER_ID,
		body,
		{ authorization: "Apikey wrong" },
		backendWith(),
	);
	assertEquals(
		[bad.status, await bad.json()],
		[401, { success: false }],
		"refused",
	);
});

Deno.test("an unknown provider, a path without one and a mock where mocks are off are refused", async () => {
	const backend = backendWith();
	const body = transfer();
	const header = {
		"x-mock-signature": await mockSignature(BANK_KEY, body, NOW),
	};
	assertEquals(
		(await post("44444444-4444-4444-8444-444444444444", body, header, backend))
			.status,
		404,
		"unknown provider",
	);
	assertEquals(
		(await post("not-a-uuid", body, header, backend)).status,
		404,
		"no provider id",
	);
	const mocksOff = await post(BANK_PROVIDER_ID, body, header, backend, {
		PAYMENT_BANK_BRAND_1: BANK_KEY,
	});
	assertEquals(mocksOff.status, 500, "mock off");
	assertEquals(backend.callsTo("checkout_settle").length, 0, "nothing settled");
});

Deno.test("a database that cannot be reached answers 500 so the service sends the transfer again", async () => {
	const backend = fakeBackend({
		checkout_provider: () => bankRow,
		checkout_settle: () =>
			Promise.reject(new UpstreamError("supabase", "network")),
	});
	const body = transfer();
	const response = await post(
		BANK_PROVIDER_ID,
		body,
		{ "x-mock-signature": await mockSignature(BANK_KEY, body, NOW) },
		backend,
	);
	assertEquals(response.status, 500, "retry");
});

Deno.test("a repeated transfer is answered as handled", async () => {
	const body = transfer();
	const response = await post(
		BANK_PROVIDER_ID,
		body,
		{ "x-mock-signature": await mockSignature(BANK_KEY, body, NOW) },
		backendWith("replayed"),
	);
	assertEquals(
		[response.status, await response.json()],
		[200, { ok: true }],
		"replayed",
	);
});
