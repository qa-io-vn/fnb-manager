import { bankAdapterFor } from "./bank.js";
import {
	type ConfigMode,
	isRecord,
	type PaymentFetch,
	type PaymentMethod,
	type PaymentProvider,
	ProviderConfigError,
	type StatusAnswer,
} from "./types.js";
import {
	ACCOUNT_NUMBER_PATTERN,
	BANK_BIN_PATTERN,
	buildVietQr,
	REFERENCE_PREFIX_PATTERN,
} from "./vietqr.js";
import {
	APP_ID_PATTERN,
	buildCheckoutOrder,
	checkoutReply,
	createZaloPaymentApi,
	isWalletMethod,
	statusFromOrder,
	verifyCheckoutCallback,
	type WalletMethod,
} from "./zalo-checkout.js";

/**
 * A provider row as the database answers it to the payment functions (payment_providers, ADR-067): which method, which
 * adapter, the mode, the name of the function secret holding its key (never the key) and its public settings.
 */
export interface ProviderConfig {
	readonly id: string;
	readonly method: PaymentMethod;
	readonly adapter: string;
	readonly mode: ConfigMode;
	readonly secretName: string;
	readonly settings: Readonly<Record<string, unknown>>;
	/** the customer Mini App's id, for the Checkout SDK */
	readonly appId: string | null;
}

export const SECRET_NAME_PATTERNS: Readonly<Record<PaymentMethod, RegExp>> = {
	zalo_checkout: /^ZALO_CHECKOUT_KEY_[A-Z0-9_]{1,40}$/,
	vietqr: /^PAYMENT_BANK_[A-Z0-9_]{1,40}$/,
};

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a provider row from a database answer; null when anything is missing or out of shape. */
export function readProviderConfig(value: unknown): ProviderConfig | null {
	if (!isRecord(value)) {
		return null;
	}
	const {
		id,
		method,
		adapter,
		mode,
		secret_name: secretName,
		settings,
		app_id: appId,
	} = value;
	if (
		typeof id !== "string" ||
		!UUID_PATTERN.test(id) ||
		(method !== "zalo_checkout" && method !== "vietqr") ||
		typeof adapter !== "string" ||
		(mode !== "sandbox" && mode !== "live" && mode !== "off") ||
		typeof secretName !== "string" ||
		!SECRET_NAME_PATTERNS[method].test(secretName) ||
		!isRecord(settings) ||
		(appId !== null &&
			appId !== undefined &&
			(typeof appId !== "string" || !APP_ID_PATTERN.test(appId)))
	) {
		return null;
	}
	return {
		id,
		method,
		adapter,
		mode,
		secretName,
		settings,
		appId: typeof appId === "string" ? appId : null,
	};
}

export interface VietQrSettings {
	readonly bankBin: string;
	readonly bankName: string;
	readonly accountNumber: string;
	readonly accountName: string;
	readonly referencePrefix: string;
}

export function vietQrSettings(
	settings: Readonly<Record<string, unknown>>,
): VietQrSettings {
	const {
		bank_bin: bankBin,
		bank_name: bankName,
		account_number: accountNumber,
		account_name: accountName,
		reference_prefix: prefix,
	} = settings;
	if (
		typeof bankBin !== "string" ||
		!BANK_BIN_PATTERN.test(bankBin) ||
		typeof accountNumber !== "string" ||
		!ACCOUNT_NUMBER_PATTERN.test(accountNumber) ||
		typeof accountName !== "string" ||
		!/^[A-Z0-9 .-]{1,50}$/.test(accountName) ||
		typeof bankName !== "string" ||
		bankName.trim() === "" ||
		bankName.length > 40 ||
		typeof prefix !== "string" ||
		!REFERENCE_PREFIX_PATTERN.test(prefix)
	) {
		throw new ProviderConfigError(
			"the VietQR settings need bank_bin, bank_name, account_number, account_name and reference_prefix",
		);
	}
	return {
		bankBin,
		bankName,
		accountNumber,
		accountName,
		referencePrefix: prefix,
	};
}

export function walletMethodOf(
	settings: Readonly<Record<string, unknown>>,
): WalletMethod | null {
	const method = settings.wallet_method;
	if (method === undefined || method === null) {
		return null;
	}
	if (!isWalletMethod(method)) {
		throw new ProviderConfigError(
			"wallet_method is one of the Checkout SDK's wallet methods",
		);
	}
	return method;
}

/** A mock bank's view of transfers, for the mock adapter's status queries in tests. */
export interface MockBankLedger {
	find(
		reference: string,
	): { readonly id: string; readonly amount: number } | null;
}

export interface ProviderDependencies {
	/** the value of the row's secret, read by the function from its secrets */
	readonly secret: string;
	/** the fetch for Zalo's payment API (the relay wraps it in the cloud) */
	readonly fetch?: PaymentFetch;
	readonly zaloBaseUrl?: string;
	/** whether the mock adapter may run here (PAYMENTS_MOCK=on: local development and tests only) */
	readonly allowMock: boolean;
	readonly mockLedger?: MockBankLedger;
}

const missingFetch: PaymentFetch = () => {
	throw new ProviderConfigError(
		"this provider has no fetch for its server API",
	);
};

/** The provider of a row: the Checkout SDK for zalo_checkout, a dynamic VietQR with a bank adapter for vietqr. */
export function createPaymentProvider(
	config: ProviderConfig,
	dependencies: ProviderDependencies,
): PaymentProvider {
	if (dependencies.secret === "") {
		throw new ProviderConfigError("the provider's secret is empty");
	}
	if (config.method === "zalo_checkout") {
		if (config.adapter !== "zalo_checkout" || config.appId === null) {
			throw new ProviderConfigError(
				"a Checkout SDK provider needs the customer Mini App's id",
			);
		}
		const appId = config.appId;
		const walletMethod = walletMethodOf(config.settings);
		const api = () =>
			createZaloPaymentApi({
				appId,
				privateKey: dependencies.secret,
				fetch: dependencies.fetch ?? missingFetch,
				...(dependencies.zaloBaseUrl === undefined
					? {}
					: { baseUrl: dependencies.zaloBaseUrl }),
			});
		return {
			adapter: config.adapter,
			method: config.method,
			mode: config.mode,
			async createPayment(attempt) {
				return {
					checkout: await buildCheckoutOrder(
						{
							amount: attempt.amount,
							description: attempt.description,
							lines: attempt.lines,
							reference: attempt.reference,
							walletMethod,
							sandbox: config.mode === "sandbox",
						},
						dependencies.secret,
					),
					qr: null,
					expiresAt: attempt.expiresAt,
				};
			},
			verifyNotification(request) {
				return verifyCheckoutCallback(
					request.rawBody,
					dependencies.secret,
					appId,
				);
			},
			reply: checkoutReply,
			async queryStatus(query): Promise<StatusAnswer> {
				if (query.platformOrderId === null) {
					return { state: "unknown" };
				}
				return statusFromOrder(
					await api().getOrderStatus(query.platformOrderId),
					query.platformOrderId,
				);
			},
			refund(request) {
				return api().createRefund(
					request.providerRef,
					request.amount,
					request.description,
				);
			},
			queryRefund(providerRefundId) {
				return api().getRefundStatus(providerRefundId);
			},
		};
	}
	const bank = bankAdapterFor(config.adapter);
	if (bank === null) {
		throw new ProviderConfigError("no bank adapter has this name");
	}
	if (
		bank.id === "mock" &&
		(!dependencies.allowMock || config.mode !== "sandbox")
	) {
		throw new ProviderConfigError(
			"the mock bank runs only in sandbox mode where mocks are allowed",
		);
	}
	const settings = vietQrSettings(config.settings);
	return {
		adapter: config.adapter,
		method: config.method,
		mode: config.mode,
		async createPayment(attempt) {
			return {
				checkout: null,
				qr: {
					payload: buildVietQr({
						bankBin: settings.bankBin,
						accountNumber: settings.accountNumber,
						amount: attempt.amount,
						purpose: attempt.reference,
					}),
					bankBin: settings.bankBin,
					bankName: settings.bankName,
					accountNumber: settings.accountNumber,
					accountName: settings.accountName,
					amount: attempt.amount,
					reference: attempt.reference,
					popupMethod: config.mode === "sandbox" ? "BANK_SANDBOX" : "BANK",
				},
				expiresAt: attempt.expiresAt,
			};
		},
		verifyNotification(request) {
			return bank.verify(request, dependencies.secret, settings);
		},
		reply: (outcome) => bank.reply(outcome),
		async queryStatus(query) {
			const ledger = dependencies.mockLedger;
			if (bank.id !== "mock" || ledger === undefined) {
				return { state: "unsupported" };
			}
			const found = ledger.find(query.reference);
			if (found === null) {
				return { state: "processing" };
			}
			return {
				state: "paid",
				event: {
					providerRef: `mock:${found.id}`,
					amount: found.amount,
					success: true,
					reason: null,
					reference: query.reference,
					candidates: [],
					platformOrderId: null,
					occurredAt: null,
				},
			};
		},
		async refund() {
			return { state: "unsupported" };
		},
		async queryRefund() {
			return { state: "unsupported" };
		},
	};
}
