import type { SupabaseBackend } from "@fnb/zalo";

/**
 * Test doubles of the payment functions' tests: a backend answering the RPCs a test names (and recording every call),
 * the sessions it knows, synthetic provider rows and keys. Nothing here reaches a database or a provider.
 */

export const CHECKOUT_KEY = "synthetic-checkout-key-for-tests";
export const BANK_KEY = "synthetic-bank-key-for-tests";
export const APP_ID = "synthetic-app-1";
export const CHECKOUT_PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
export const BANK_PROVIDER_ID = "22222222-2222-4222-8222-222222222222";
export const SEPAY_PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
export const USER_ID = "44444444-4444-4444-8444-444444444444";
export const ORDER_ID = "55555555-5555-4555-8555-555555555555";
export const PAYMENT_ID = "66666666-6666-4666-8666-666666666666";
export const SESSION = "synthetic-session-token";

export const checkoutRow = {
	id: CHECKOUT_PROVIDER_ID,
	method: "zalo_checkout",
	adapter: "zalo_checkout",
	mode: "sandbox",
	secret_name: "ZALO_CHECKOUT_KEY_BRAND_1",
	settings: { wallet_method: "ZALOPAY" },
	app_id: APP_ID,
};

export const bankRow = {
	id: BANK_PROVIDER_ID,
	method: "vietqr",
	adapter: "mock",
	mode: "sandbox",
	secret_name: "PAYMENT_BANK_BRAND_1",
	settings: {
		bank_bin: "970400",
		bank_name: "Ngân hàng mẫu",
		account_number: "0123456789",
		account_name: "CUA HANG MAU",
		reference_prefix: "FNB",
	},
	app_id: null,
};

export const sepayRow = {
	...bankRow,
	id: SEPAY_PROVIDER_ID,
	adapter: "sepay",
	mode: "live",
};

export const ENVIRONMENT = {
	ZALO_CHECKOUT_KEY_BRAND_1: CHECKOUT_KEY,
	PAYMENT_BANK_BRAND_1: BANK_KEY,
	PAYMENTS_MOCK: "on",
};

export interface RecordedCall {
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
}

export interface FakePaymentsBackend extends SupabaseBackend {
	readonly calls: RecordedCall[];
	callsTo(name: string): RecordedCall[];
}

export function fakeBackend(
	answers: Readonly<
		Record<string, (args: Readonly<Record<string, unknown>>) => unknown>
	>,
	sessions: Readonly<Record<string, string>> = { [SESSION]: USER_ID },
): FakePaymentsBackend {
	const calls: RecordedCall[] = [];
	const unsupported = () =>
		Promise.reject(new Error("not used by the payment functions"));
	return {
		calls,
		callsTo: (name) => calls.filter((call) => call.name === name),
		async rpc(name, args) {
			calls.push({ name, args });
			const answer = answers[name];
			if (answer === undefined) {
				throw new Error(`no fake answer for ${name}`);
			}
			return await answer(args);
		},
		async sessionUser(token) {
			return sessions[token] ?? null;
		},
		userEmail: unsupported,
		mintSession: unsupported,
		createLogin: unsupported,
		setAppMetadata: unsupported,
		deleteLogin: unsupported,
	};
}

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

export function assertEquals(
	actual: unknown,
	expected: unknown,
	label: string,
): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}
