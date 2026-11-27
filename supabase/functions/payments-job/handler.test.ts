import { hmacSha256Hex } from "@fnb/payments";
import type { ZaloFetch } from "@fnb/zalo";
import {
	APP_ID,
	assert,
	assertEquals,
	CHECKOUT_KEY,
	CHECKOUT_PROVIDER_ID,
	checkoutRow,
	ENVIRONMENT,
	fakeBackend,
	PAYMENT_ID,
} from "../_shared/payments-fakes.ts";
import { handlePaymentsJob } from "./handler.ts";

// payments-job: the ticket gate, then each kind of work against a fake Zalo payment API: a re-query that finds the
// payment (settled as the callback would be, bound to the attempt), one still processing (only noted), one naming
// another reference (never applied, a client that linked another order), a refund sent and followed, a report, and
// Zalo unreachable (noted, counted, nothing settled).

const URL_ = "http://127.0.0.1:54321/functions/v1/payments-job";
const TICKET = "77777777-7777-4777-8777-777777777777";
const REFUND_ID = "88888888-8888-4888-8888-888888888888";

function zalo(answers: Record<string, unknown>, failing = false) {
	const calls: { url: string; body: string | undefined }[] = [];
	const fetch: ZaloFetch = async (url, init) => {
		calls.push({ url, body: init.body });
		if (failing) {
			throw new TypeError("network");
		}
		const path = new URL(url).pathname;
		return new Response(JSON.stringify(answers[path] ?? {}), { status: 200 });
	};
	return { calls, fetch };
}

function backendWith(work: Record<string, unknown>, claim = true) {
	return fakeBackend({
		checkout_job_claim: () => claim,
		checkout_job_work: () => ({
			requery: [],
			refunds: [],
			reports: [],
			...work,
		}),
		checkout_settle: () => ({ outcome: "confirmed" }),
		checkout_job_note: () => ({ state: "noted" }),
		checkout_refund_confirm: () => ({ state: "succeeded" }),
		zalo_relay_current: () => null,
	});
}

async function run(
	backend: ReturnType<typeof fakeBackend>,
	fetch: ZaloFetch,
	ticket: unknown = TICKET,
): Promise<Response> {
	return await handlePaymentsJob(
		new Request(URL_, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ticket }),
		}),
		ENVIRONMENT,
		{ backend, fetch },
	);
}

const requeryItem = {
	payment_id: PAYMENT_ID,
	reference: "ZC7K2M9Q4T",
	amount: 64000,
	platform_order_id: "zorder-1",
	provider: checkoutRow,
};

Deno.test("a malformed ticket is 400 and a refused ticket 401, with no work done", async () => {
	const backend = backendWith({ requery: [requeryItem] }, false);
	assertEquals(
		(await run(backend, zalo({}).fetch, "x")).status,
		400,
		"malformed",
	);
	assertEquals((await run(backend, zalo({}).fetch)).status, 401, "refused");
	assertEquals(backend.callsTo("checkout_job_work").length, 0, "no work asked");
});

Deno.test("a re-query that finds the payment settles it as the callback would, bound to its attempt", async () => {
	const backend = backendWith({ requery: [requeryItem] });
	const api = zalo({
		"/api/transaction/get-status": {
			returnCode: 1,
			transId: "t-9",
			amount: 64000,
			extradata: encodeURIComponent('{"ref":"ZC7K2M9Q4T"}'),
		},
	});
	const answer = await (await run(backend, api.fetch)).json();
	assertEquals(answer.settled, 1, "settled");
	assertEquals(
		backend.callsTo("checkout_settle")[0]?.args,
		{
			p_request: {
				provider_id: CHECKOUT_PROVIDER_ID,
				provider_ref: "t-9",
				payment_id: PAYMENT_ID,
				platform_order_id: "zorder-1",
				amount: 64000,
				success: true,
				reason: null,
				source: "requery",
			},
		},
		"the settlement",
	);
	const mac = new URL(api.calls[0]?.url ?? "").searchParams.get("mac");
	assertEquals(
		mac,
		await hmacSha256Hex(
			CHECKOUT_KEY,
			`appId=${APP_ID}&orderId=zorder-1&privateKey=${CHECKOUT_KEY}`,
		),
		"signed",
	);
	assertEquals(
		backend.callsTo("checkout_job_note").length,
		1,
		"the re-query is noted",
	);
});

Deno.test("a payment still processing is only noted; one naming another reference is never applied", async () => {
	const processing = backendWith({ requery: [requeryItem] });
	await run(
		processing,
		zalo({ "/api/transaction/get-status": { returnCode: 0 } }).fetch,
	);
	assertEquals(
		processing.callsTo("checkout_settle").length,
		0,
		"not settled while processing",
	);
	const other = backendWith({ requery: [requeryItem] });
	await run(
		other,
		zalo({
			"/api/transaction/get-status": {
				returnCode: 1,
				transId: "t-9",
				amount: 64000,
				extradata: encodeURIComponent('{"ref":"ZC22222222"}'),
			},
		}).fetch,
	);
	assertEquals(
		other.callsTo("checkout_settle").length,
		0,
		"another order's payment is not applied",
	);
	assertEquals(other.callsTo("checkout_job_note").length, 1, "only noted");
});

Deno.test("a refund is sent, then followed until Zalo settles it", async () => {
	const item = {
		refund_id: REFUND_ID,
		amount: 35000,
		provider_ref: "t-9",
		provider_refund_id: null,
		description: "Hoàn tiền",
		provider: checkoutRow,
	};
	const sending = backendWith({ refunds: [item] });
	const api = zalo({
		"/api/refund/create": { refundId: "r-1", returnCode: 2 },
	});
	assertEquals(
		(await (await run(sending, api.fetch)).json()).refunds_sent,
		1,
		"sent",
	);
	assertEquals(
		JSON.parse(api.calls[0]?.body ?? "{}").transId,
		"t-9",
		"for the payment's transaction",
	);
	assertEquals(
		sending.callsTo("checkout_job_note")[0]?.args,
		{
			p_request: {
				kind: "refund",
				refund_id: REFUND_ID,
				provider_refund_id: "r-1",
				error: null,
			},
		},
		"the refund id is kept",
	);
	const following = backendWith({
		refunds: [{ ...item, provider_refund_id: "r-1" }],
	});
	await run(following, zalo({ "/api/refund": { returnCode: 1 } }).fetch);
	assertEquals(
		following.callsTo("checkout_refund_confirm")[0]?.args,
		{
			p_refund: REFUND_ID,
			p_success: true,
			p_provider_ref: "r-1",
			p_reason: null,
		},
		"settled by Zalo's answer",
	);
});

Deno.test("a paid bank-transfer popup is reported to Zalo", async () => {
	const backend = backendWith({
		reports: [
			{
				payment_id: PAYMENT_ID,
				platform_order_id: "zorder-3",
				provider: checkoutRow,
			},
		],
	});
	const api = zalo({
		[`/api/transaction/${APP_ID}/purchase-payment`]: { err: 0 },
	});
	assertEquals(
		(await (await run(backend, api.fetch)).json()).reported,
		1,
		"reported",
	);
	assertEquals(
		backend.callsTo("checkout_job_note")[0]?.args,
		{
			p_request: {
				kind: "report",
				payment_id: PAYMENT_ID,
				ok: true,
				error: null,
			},
		},
		"noted",
	);
});

Deno.test("Zalo unreachable: everything is noted and counted, nothing settled", async () => {
	const backend = backendWith({
		requery: [requeryItem],
		refunds: [
			{
				refund_id: REFUND_ID,
				amount: 1,
				provider_ref: "t-9",
				provider_refund_id: null,
				description: "x",
				provider: checkoutRow,
			},
		],
		reports: [
			{
				payment_id: PAYMENT_ID,
				platform_order_id: "zorder-3",
				provider: checkoutRow,
			},
		],
	});
	const answer = await (await run(backend, zalo({}, true).fetch)).json();
	assertEquals(answer.errors, 3, "three errors");
	assertEquals(
		backend.callsTo("checkout_settle").length +
			backend.callsTo("checkout_refund_confirm").length,
		0,
		"nothing settled",
	);
	assertEquals(backend.callsTo("checkout_job_note").length, 3, "each noted");
	assert(answer.settled === 0, "none settled");
});
