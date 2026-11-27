import { describe, expect, it } from "vitest";
import {
	createPaymentProvider,
	type PaymentAttempt,
	type PaymentFetch,
	type ProviderConfig,
	ProviderConfigError,
	parseVietQr,
	readProviderConfig,
} from "../../src/index.js";

// payments:unit/provider: the provider rows the database answers (valid and every malformed class), the providers
// they make (a mock only in sandbox where mocks are allowed), and the seam's operations through each adapter.

const vietqr: ProviderConfig = {
	id: "11111111-1111-4111-8111-111111111111",
	method: "vietqr",
	adapter: "sepay",
	mode: "live",
	secretName: "PAYMENT_BANK_BRAND_1",
	settings: {
		bank_bin: "970400",
		bank_name: "Ngân hàng mẫu",
		account_number: "0123456789",
		account_name: "CUA HANG MAU",
		reference_prefix: "FNB",
	},
	appId: null,
};

const checkout: ProviderConfig = {
	id: "22222222-2222-4222-8222-222222222222",
	method: "zalo_checkout",
	adapter: "zalo_checkout",
	mode: "sandbox",
	secretName: "ZALO_CHECKOUT_KEY_BRAND_1",
	settings: { wallet_method: "ZALOPAY" },
	appId: "synthetic-app-1",
};

const attempt: PaymentAttempt = {
	paymentId: "33333333-3333-4333-8333-333333333333",
	orderId: "44444444-4444-4444-8444-444444444444",
	method: "vietqr",
	amount: 64_000,
	reference: "FNB7K2M9Q4T",
	expiresAt: "2026-11-28T03:15:00.000Z",
	description: "Cửa hàng mẫu",
	lines: [{ id: "l1", amount: 64_000 }],
};

describe("readProviderConfig", () => {
	const row = {
		id: vietqr.id,
		method: "vietqr",
		adapter: "sepay",
		mode: "live",
		secret_name: "PAYMENT_BANK_BRAND_1",
		settings: vietqr.settings,
		app_id: null,
	};

	it("reads a valid row", () => {
		expect(readProviderConfig(row)).toEqual(vietqr);
		// a row switched off still verifies the notifications of attempts opened before
		expect(readProviderConfig({ ...row, mode: "off" })?.mode).toBe("off");
	});

	it("refuses an unknown mode, another method, a secret name of another family or one shaped like a value", () => {
		for (const overrides of [
			{ mode: "paused" },
			{ method: "cash" },
			{ secret_name: "SUPABASE_SERVICE_ROLE_KEY" },
			{ secret_name: "ZALO_CHECKOUT_KEY_BRAND_1" },
			{ secret_name: "PAYMENT_BANK_" },
			{ id: "x" },
			{ settings: null },
			{ app_id: "bad id" },
		]) {
			expect(readProviderConfig({ ...row, ...overrides })).toBeNull();
		}
		expect(readProviderConfig(null)).toBeNull();
	});
});

describe("a VietQR provider", () => {
	it("makes a dynamic payload of the attempt's amount and reference, and the popup's live method", async () => {
		const provider = createPaymentProvider(vietqr, {
			secret: "s",
			allowMock: false,
		});
		const created = await provider.createPayment(attempt);
		expect(created.checkout).toBeNull();
		expect(created.qr?.popupMethod).toBe("BANK");
		expect(created.qr?.accountName).toBe("CUA HANG MAU");
		expect(parseVietQr(created.qr?.payload ?? "")).toEqual({
			bankBin: "970400",
			accountNumber: "0123456789",
			amount: 64_000,
			purpose: "FNB7K2M9Q4T",
			dynamic: true,
		});
		expect(
			await provider.queryStatus({
				paymentId: attempt.paymentId,
				reference: attempt.reference,
				amount: 1,
				platformOrderId: null,
			}),
		).toEqual({
			state: "unsupported",
		});
		expect(
			await provider.refund({
				refundId: "r",
				providerRef: "p",
				amount: 1,
				description: "",
			}),
		).toEqual({ state: "unsupported" });
	});

	it("refuses incomplete settings", () => {
		for (const settings of [
			{ ...vietqr.settings, bank_bin: "1" },
			{ ...vietqr.settings, account_name: "Cửa hàng" },
			{ ...vietqr.settings, reference_prefix: "F" },
		]) {
			expect(() =>
				createPaymentProvider(
					{ ...vietqr, settings },
					{ secret: "s", allowMock: false },
				),
			).toThrow(ProviderConfigError);
		}
		expect(() =>
			createPaymentProvider(
				{ ...vietqr, adapter: "payos" },
				{ secret: "s", allowMock: false },
			),
		).toThrow(ProviderConfigError);
		expect(() =>
			createPaymentProvider(vietqr, { secret: "", allowMock: false }),
		).toThrow(ProviderConfigError);
	});

	it("runs the mock only in sandbox and only where mocks are allowed", () => {
		const mock = { ...vietqr, adapter: "mock", mode: "sandbox" as const };
		expect(() =>
			createPaymentProvider(mock, { secret: "s", allowMock: false }),
		).toThrow(/mock/);
		expect(() =>
			createPaymentProvider(
				{ ...mock, mode: "live" },
				{ secret: "s", allowMock: true },
			),
		).toThrow(/mock/);
		const provider = createPaymentProvider(mock, {
			secret: "s",
			allowMock: true,
			mockLedger: {
				find: (reference) =>
					reference === "FNB7K2M9Q4T" ? { id: "tx-9", amount: 64_000 } : null,
			},
		});
		expect(provider.adapter).toBe("mock");
		return Promise.all([
			expect(
				provider.queryStatus({
					paymentId: "p",
					reference: "FNB7K2M9Q4T",
					amount: 64_000,
					platformOrderId: null,
				}),
			).resolves.toMatchObject({
				state: "paid",
				event: { providerRef: "mock:tx-9", amount: 64_000 },
			}),
			expect(
				provider.queryStatus({
					paymentId: "p",
					reference: "FNB22222222",
					amount: 1,
					platformOrderId: null,
				}),
			).resolves.toEqual({
				state: "processing",
			}),
			expect(provider.createPayment(attempt)).resolves.toMatchObject({
				qr: { popupMethod: "BANK_SANDBOX" },
			}),
		]);
	});
});

describe("a Checkout SDK provider", () => {
	it("makes createOrder parameters with the sandbox wallet and a MAC", async () => {
		const provider = createPaymentProvider(checkout, {
			secret: "synthetic-checkout-key",
			allowMock: false,
		});
		const created = await provider.createPayment({
			...attempt,
			method: "zalo_checkout",
			reference: "ZC7K2M9Q4T",
		});
		expect(created.qr).toBeNull();
		expect(JSON.parse(created.checkout?.method ?? "").id).toBe(
			"ZALOPAY_SANDBOX",
		);
		expect(created.checkout?.mac).toMatch(/^[0-9a-f]{64}$/);
	});

	it("asks Zalo through the fetch it is given, and nothing without a linked order", async () => {
		const urls: string[] = [];
		const fetch: PaymentFetch = async (url) => {
			urls.push(url);
			return new Response(
				JSON.stringify({
					returnCode: 1,
					transId: "t-9",
					amount: 64_000,
					extradata: '{"ref":"ZC7K2M9Q4T"}',
				}),
			);
		};
		const provider = createPaymentProvider(checkout, {
			secret: "k",
			fetch,
			allowMock: false,
			zaloBaseUrl: "http://127.0.0.1:9",
		});
		expect(
			await provider.queryStatus({
				paymentId: "p",
				reference: "ZC7K2M9Q4T",
				amount: 64_000,
				platformOrderId: null,
			}),
		).toEqual({ state: "unknown" });
		expect(urls).toHaveLength(0);
		const answer = await provider.queryStatus({
			paymentId: "p",
			reference: "ZC7K2M9Q4T",
			amount: 64_000,
			platformOrderId: "zorder-1",
		});
		expect(answer).toMatchObject({
			state: "paid",
			event: {
				providerRef: "t-9",
				reference: "ZC7K2M9Q4T",
				platformOrderId: "zorder-1",
			},
		});
		expect(urls[0]).toMatch(
			/^http:\/\/127\.0\.0\.1:9\/api\/transaction\/get-status\?/,
		);
	});

	it("refuses a row without the Mini App's id or with an unknown wallet", () => {
		expect(() =>
			createPaymentProvider(
				{ ...checkout, appId: null },
				{ secret: "k", allowMock: false },
			),
		).toThrow(ProviderConfigError);
		expect(() =>
			createPaymentProvider(
				{ ...checkout, settings: { wallet_method: "BANK" } },
				{ secret: "k", allowMock: false },
			),
		).toThrow(ProviderConfigError);
	});
});
