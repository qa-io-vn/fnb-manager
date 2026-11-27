import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildCheckoutOrder,
	callbackMacInput,
	checkoutAppIdOf,
	checkoutReply,
	createOrderMacInput,
	createZaloPaymentApi,
	notifyMacInput,
	overallMacInput,
	type PaymentFetch,
	type PaymentRequestInit,
	ProviderUnavailableError,
	referenceFromExtradata,
	statusFromOrder,
	verifyCheckoutCallback,
	verifyCheckoutNotify,
} from "../../src/index.js";

// payments:unit/zalo-checkout: the strings each MAC signs (the documented formats, word for word), the MACs against
// node:crypto as an oracle, the createOrder parameters, and the security cases of the callback and notify: forged
// and tampered signatures (each MAC alone), a missing overallMac, another app, failures, malformed bodies; the server
// APIs' requests and answers through a fake fetch.

const KEY = "synthetic-checkout-key";
const APP = "synthetic-app-1";
const oracle = (data: string) =>
	createHmac("sha256", KEY).update(data, "utf8").digest("hex");

describe("createOrder", () => {
	it("signs the sorted parameters as key=value, item as JSON, extradata and method as they are", () => {
		const params = {
			amount: 64_000,
			desc: "Cửa hàng mẫu",
			item: [
				{ id: "line-1", amount: 35_000 },
				{ id: "line-2", amount: 29_000 },
			],
			extradata: '{"ref":"ZC7K2M9Q4T"}',
			method: '{"id":"ZALOPAY_SANDBOX","isCustom":false}',
		};
		expect(createOrderMacInput(params)).toBe(
			'amount=64000&desc=Cửa hàng mẫu&extradata={"ref":"ZC7K2M9Q4T"}&item=[{"id":"line-1","amount":35000},{"id":"line-2","amount":29000}]&method={"id":"ZALOPAY_SANDBOX","isCustom":false}',
		);
		expect(createOrderMacInput({ ...params, method: null })).not.toContain(
			"method=",
		);
	});

	it("builds the parameters with the order's lines, the reference in extradata and the MAC", async () => {
		const order = await buildCheckoutOrder(
			{
				amount: 64_000,
				description: "Cửa hàng mẫu\n· Đơn trực tuyến",
				lines: [
					{ id: "line-1", amount: 35_000 },
					{ id: "line-2", amount: 29_000 },
				],
				reference: "ZC7K2M9Q4T",
				walletMethod: "ZALOPAY",
				sandbox: true,
			},
			KEY,
		);
		expect(order.desc).toBe("Cửa hàng mẫu · Đơn trực tuyến");
		expect(order.item).toHaveLength(2);
		expect(JSON.parse(order.extradata)).toEqual({ ref: "ZC7K2M9Q4T" });
		expect(JSON.parse(order.method ?? "")).toEqual({
			id: "ZALOPAY_SANDBOX",
			isCustom: false,
		});
		expect(order.mac).toBe(oracle(createOrderMacInput(order)));
		expect(order.mac).toMatch(/^[0-9a-f]{64}$/);
	});

	it("lists one line for the order when the lines do not add up to the total (a stamp reward)", async () => {
		const order = await buildCheckoutOrder(
			{
				amount: 29_000,
				description: "x",
				lines: [
					{ id: "line-1", amount: 35_000 },
					{ id: "line-2", amount: 29_000 },
				],
				reference: "ZC7K2M9Q4T",
				walletMethod: null,
				sandbox: false,
			},
			KEY,
		);
		expect(order.item).toEqual([{ id: "ZC7K2M9Q4T", amount: 29_000 }]);
		expect(order.method).toBeNull();
	});

	it("forces the live wallet without _SANDBOX and cuts the description at 100 characters", async () => {
		const order = await buildCheckoutOrder(
			{
				amount: 1,
				description: "x".repeat(150),
				lines: [],
				reference: "ZC7K2M9Q4T",
				walletMethod: "MOMO",
				sandbox: false,
			},
			KEY,
		);
		expect(JSON.parse(order.method ?? "").id).toBe("MOMO");
		expect(order.desc).toHaveLength(100);
	});

	it("refuses an amount below 1 or not whole", async () => {
		for (const amount of [0, -5, 10.5]) {
			await expect(
				buildCheckoutOrder(
					{
						amount,
						description: "x",
						lines: [],
						reference: "ZC7K2M9Q4T",
						walletMethod: null,
						sandbox: false,
					},
					KEY,
				),
			).rejects.toThrow();
		}
	});
});

function callbackData(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		appId: APP,
		orderId: "zorder-1",
		transId: "240101000000001",
		method: "ZALOPAY_SANDBOX",
		transTime: 1_767_225_600_000,
		merchantTransId: "m-1",
		amount: 64_000,
		description: "Cửa hàng mẫu",
		resultCode: 1,
		message: "Giao dịch thành công",
		extradata: encodeURIComponent('{"ref":"ZC7K2M9Q4T"}'),
		paymentChannel: "ZALOPAY_SANDBOX",
		oaMessageToken: "synthetic-oa-token",
		...overrides,
	};
}

function signedCallback(data: Record<string, unknown>): string {
	return JSON.stringify({
		data,
		mac: oracle(
			callbackMacInput({
				appId: String(data.appId),
				amount: Number(data.amount),
				description: String(data.description),
				orderId: String(data.orderId),
				message: String(data.message),
				resultCode: Number(data.resultCode),
				transId: String(data.transId),
			}),
		),
		overallMac: oracle(overallMacInput(data)),
	});
}

describe("the callback", () => {
	it("signs mac in Zalo's fixed order and overallMac over every sorted key", () => {
		const data = callbackData();
		expect(
			callbackMacInput({
				appId: APP,
				amount: 64_000,
				description: "d",
				orderId: "o",
				message: "m",
				resultCode: 1,
				transId: "t",
			}),
		).toBe(
			`appId=${APP}&amount=64000&description=d&orderId=o&message=m&resultCode=1&transId=t`,
		);
		expect(
			overallMacInput(data)
				.split("&")
				.map((pair) => pair.split("=")[0]),
		).toEqual([
			"amount",
			"appId",
			"description",
			"extradata",
			"merchantTransId",
			"message",
			"method",
			"oaMessageToken",
			"orderId",
			"paymentChannel",
			"resultCode",
			"transId",
			"transTime",
		]);
	});

	it("verifies a genuine success into one event with the reference and Zalo's order id", async () => {
		const result = await verifyCheckoutCallback(
			signedCallback(callbackData()),
			KEY,
			APP,
		);
		expect(result).toEqual({
			ok: true,
			events: [
				{
					providerRef: "240101000000001",
					amount: 64_000,
					success: true,
					reason: null,
					reference: "ZC7K2M9Q4T",
					candidates: [],
					platformOrderId: "zorder-1",
					occurredAt: new Date(1_767_225_600_000).toISOString(),
				},
			],
		});
	});

	it("reads a failure as an unsuccessful event with its reason", async () => {
		const result = await verifyCheckoutCallback(
			signedCallback(callbackData({ resultCode: -1, message: "Thất bại" })),
			KEY,
			APP,
		);
		expect(result.ok && result.events[0]?.success).toBe(false);
		expect(result.ok && result.events[0]?.reason).toBe("result -1: Thất bại");
	});

	it("refuses a callback signed with another key", async () => {
		const forged = JSON.parse(signedCallback(callbackData()));
		forged.mac = createHmac("sha256", "attacker").update("x").digest("hex");
		expect(
			await verifyCheckoutCallback(JSON.stringify(forged), KEY, APP),
		).toEqual({ ok: false, refusal: "signature" });
	});

	it("refuses a changed amount (mac) and a changed extradata or method (overallMac only)", async () => {
		const amount = JSON.parse(signedCallback(callbackData()));
		amount.data.amount = 1_000;
		expect(
			await verifyCheckoutCallback(JSON.stringify(amount), KEY, APP),
		).toEqual({ ok: false, refusal: "signature" });
		const extradata = JSON.parse(signedCallback(callbackData()));
		extradata.data.extradata = encodeURIComponent('{"ref":"ZC22222222"}');
		expect(
			await verifyCheckoutCallback(JSON.stringify(extradata), KEY, APP),
		).toEqual({ ok: false, refusal: "signature" });
		const method = JSON.parse(signedCallback(callbackData()));
		method.data.method = "MOMO";
		expect(
			await verifyCheckoutCallback(JSON.stringify(method), KEY, APP),
		).toEqual({ ok: false, refusal: "signature" });
	});

	it("refuses a callback without overallMac, malformed bodies and another app's", async () => {
		const missing = JSON.parse(signedCallback(callbackData()));
		delete missing.overallMac;
		expect(
			await verifyCheckoutCallback(JSON.stringify(missing), KEY, APP),
		).toEqual({ ok: false, refusal: "malformed" });
		for (const body of [
			"",
			"null",
			"[]",
			"{}",
			'{"data":1}',
			'{"data":{"appId":"x"},"mac":"","overallMac":""}',
		]) {
			expect(await verifyCheckoutCallback(body, KEY, APP)).toEqual({
				ok: false,
				refusal: "malformed",
			});
		}
		const other = signedCallback(callbackData({ appId: "synthetic-app-2" }));
		expect(await verifyCheckoutCallback(other, KEY, APP)).toEqual({
			ok: false,
			refusal: "wrong_app",
		});
	});

	it("names its app before verification only to choose the key", () => {
		expect(checkoutAppIdOf(signedCallback(callbackData()))).toBe(APP);
		expect(checkoutAppIdOf('{"data":{"appId":"bad app"}}')).toBeNull();
		expect(checkoutAppIdOf("x")).toBeNull();
	});

	it("reads the reference from extradata only when it is ours", () => {
		expect(
			referenceFromExtradata(encodeURIComponent('{"ref":"FNB7K2M9Q4T"}')),
		).toBe("FNB7K2M9Q4T");
		expect(referenceFromExtradata('{"ref":"FNB7K2M9Q4T"}')).toBe("FNB7K2M9Q4T");
		expect(referenceFromExtradata('{"ref":"fnb7k2m9q4t"}')).toBeNull();
		expect(referenceFromExtradata("%E0%A4%A")).toBeNull();
		expect(referenceFromExtradata(null)).toBeNull();
		expect(referenceFromExtradata("{}")).toBeNull();
	});

	it("answers returnCode 1 handled, 2 duplicate, -1 refused, 0 for an error to retry", () => {
		expect(checkoutReply("accepted").body.returnCode).toBe(1);
		expect(checkoutReply("replayed").body.returnCode).toBe(2);
		expect(checkoutReply("refused").body.returnCode).toBe(-1);
		expect(checkoutReply("error").body.returnCode).toBe(0);
	});
});

describe("the notify", () => {
	const notify = (data: Record<string, string>, mac?: string) =>
		JSON.stringify({
			data,
			mac:
				mac ??
				oracle(
					notifyMacInput(
						data as { appId: string; orderId: string; method: string },
					),
				),
		});

	it("signs appId, orderId and method in that order", () => {
		expect(notifyMacInput({ appId: "a", orderId: "o", method: "COD" })).toBe(
			"appId=a&orderId=o&method=COD",
		);
	});

	it("verifies a genuine notify and refuses a forged, malformed or foreign one", async () => {
		const data = { appId: APP, orderId: "zorder-2", method: "COD" };
		expect(await verifyCheckoutNotify(notify(data), KEY, APP)).toEqual({
			ok: true,
			notify: data,
		});
		expect(
			await verifyCheckoutNotify(notify(data, "0".repeat(64)), KEY, APP),
		).toEqual({ ok: false, refusal: "signature" });
		expect(
			await verifyCheckoutNotify(notify({ ...data, method: "cod" }), KEY, APP),
		).toEqual({ ok: false, refusal: "malformed" });
		expect(
			await verifyCheckoutNotify(
				notify({ ...data, appId: "synthetic-app-2" }),
				KEY,
				APP,
			),
		).toEqual({
			ok: false,
			refusal: "wrong_app",
		});
	});
});

describe("the server APIs", () => {
	function fakeFetch(answer: unknown, status = 200) {
		const calls: { url: string; init: PaymentRequestInit }[] = [];
		const fetch: PaymentFetch = async (url, init) => {
			calls.push({ url, init });
			return new Response(
				typeof answer === "string" ? answer : JSON.stringify(answer),
				{ status },
			);
		};
		return { calls, fetch };
	}

	it("asks the order status with a MAC over appId, orderId and the private key", async () => {
		const { calls, fetch } = fakeFetch({
			error: 0,
			data: {
				returnCode: 1,
				transId: "t-1",
				amount: 64_000,
				extradata: encodeURIComponent('{"ref":"ZC7K2M9Q4T"}'),
				method: "ZALOPAY",
			},
		});
		const api = createZaloPaymentApi({ appId: APP, privateKey: KEY, fetch });
		const status = await api.getOrderStatus("zorder-1");
		expect(status).toEqual({
			state: "paid",
			transId: "t-1",
			amount: 64_000,
			reference: "ZC7K2M9Q4T",
			method: "ZALOPAY",
			message: null,
		});
		const url = new URL(calls[0]?.url ?? "");
		expect(`${url.origin}${url.pathname}`).toBe(
			"https://payment-mini.zalo.me/api/transaction/get-status",
		);
		expect(url.searchParams.get("mac")).toBe(
			oracle(`appId=${APP}&orderId=zorder-1&privateKey=${KEY}`),
		);
		expect(calls[0]?.url).not.toContain(KEY);
		expect(calls[0]?.init.method).toBe("GET");
	});

	it("reads processing, failed and unknown statuses", async () => {
		for (const [answer, state] of [
			[{ returnCode: 0 }, "processing"],
			[{ isProcessing: true }, "processing"],
			[{ returnCode: -1 }, "failed"],
			[{ returnCode: 7 }, "unknown"],
		] as const) {
			const api = createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: fakeFetch(answer).fetch,
			});
			expect((await api.getOrderStatus("zorder-1")).state).toBe(state);
		}
	});

	it("turns an HTTP error, a network failure or junk into an unavailable provider", async () => {
		await expect(
			createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: fakeFetch({}, 502).fetch,
			}).getOrderStatus("o"),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
		await expect(
			createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: fakeFetch("<html>").fetch,
			}).getOrderStatus("o"),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
		await expect(
			createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: async () => {
					throw new TypeError("network");
				},
			}).getOrderStatus("o"),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
	});

	it("creates a refund with a MAC over appId, transId, amount, description and the key", async () => {
		const { calls, fetch } = fakeFetch({ refundId: "r-1", returnCode: 2 });
		const api = createZaloPaymentApi({ appId: APP, privateKey: KEY, fetch });
		expect(await api.createRefund("t-1", 64_000, "Hoàn tiền đơn huỷ")).toEqual({
			state: "pending",
			providerRefundId: "r-1",
		});
		const body = JSON.parse(calls[0]?.init.body ?? "{}");
		expect(calls[0]?.url).toBe(
			"https://payment-mini.zalo.me/api/refund/create",
		);
		expect(body).toEqual({
			appId: APP,
			transId: "t-1",
			amount: 64_000,
			description: "Hoàn tiền đơn huỷ",
			mac: oracle(
				`appId=${APP}&transId=t-1&amount=64000&description=Hoàn tiền đơn huỷ&privateKey=${KEY}`,
			),
		});
		expect(JSON.stringify(body)).not.toContain(KEY);
	});

	it("reads a refund succeeded (1), pending (above 1) and failed (below 1)", async () => {
		const answer = async (returnCode: number) =>
			createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: fakeFetch({ refundId: "r-1", returnCode, returnMessage: "x" })
					.fetch,
			}).createRefund("t-1", 1, "");
		expect((await answer(1)).state).toBe("succeeded");
		expect((await answer(3)).state).toBe("pending");
		expect(await answer(0)).toEqual({
			state: "failed",
			providerRefundId: "r-1",
			reason: "x",
		});
		expect((await answer(-1)).state).toBe("failed");
	});

	it("asks a refund's status and reports a bank-transfer order with their MACs", async () => {
		const status = fakeFetch({ returnCode: 1 });
		expect(
			await createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: status.fetch,
			}).getRefundStatus("r-1"),
		).toEqual({
			state: "succeeded",
			providerRefundId: "r-1",
		});
		expect(new URL(status.calls[0]?.url ?? "").searchParams.get("mac")).toBe(
			oracle(`appId=${APP}&refundId=r-1&privateKey=${KEY}`),
		);
		const report = fakeFetch({ err: 0, msg: "ok" });
		expect(
			await createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: report.fetch,
			}).reportPurchase("zorder-3", 1),
		).toBe(true);
		expect(report.calls[0]?.url).toBe(
			`https://payment-mini.zalo.me/api/transaction/${APP}/purchase-payment`,
		);
		expect(JSON.parse(report.calls[0]?.init.body ?? "{}").mac).toBe(
			oracle(`appId=${APP}&orderId=zorder-3&resultCode=1&privateKey=${KEY}`),
		);
		expect(
			await createZaloPaymentApi({
				appId: APP,
				privateKey: KEY,
				fetch: fakeFetch({ err: -5 }).fetch,
			}).reportPurchase("z", 1),
		).toBe(false);
	});

	it("turns an order status into the seam's answer", () => {
		expect(
			statusFromOrder(
				{
					state: "processing",
					transId: null,
					amount: null,
					reference: null,
					method: null,
					message: null,
				},
				"z",
			),
		).toEqual({
			state: "processing",
		});
		const failed = statusFromOrder(
			{
				state: "failed",
				transId: null,
				amount: null,
				reference: null,
				method: null,
				message: "x",
			},
			"z",
		);
		expect(failed.state === "failed" && failed.event.providerRef).toBe(
			"order:z",
		);
		expect(
			statusFromOrder(
				{
					state: "paid",
					transId: null,
					amount: 1,
					reference: null,
					method: null,
					message: null,
				},
				"z",
			),
		).toEqual({
			state: "unknown",
		});
	});
});
