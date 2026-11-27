import { sellerValid } from "./checks.js";
import {
	createMockProvider,
	type MockFailure,
	type MockLedger,
} from "./mock.js";
import {
	type ConfigMode,
	EInvoiceConfigError,
	type EInvoiceProvider,
	type InvoiceTemplate,
	isRecord,
	type SellerSettings,
	type VatRate,
} from "./types.js";

/**
 * A provider row as the database answers it to the job (public.einvoice_providers, ADR-069): which adapter, the mode,
 * the name of the function secret with its credentials (never the credentials) and the seller's public settings.
 */
export interface EInvoiceProviderConfig {
	readonly id: string;
	readonly adapter: string;
	readonly mode: ConfigMode;
	readonly secretName: string;
	readonly seller: SellerSettings;
}

export const SECRET_NAME_PATTERN = /^EINVOICE_KEY_[A-Z0-9_]{1,40}$/;
/** The adapters the job can run. A real provider's adapter adds its name here and to app.einvoice_provider_valid. */
export const ADAPTERS: readonly string[] = ["mock"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATES: readonly string[] = ["1", "2"];
const VAT_RATES: readonly string[] = ["none", "0", "5", "8", "10"];

export function readSeller(value: unknown): SellerSettings | null {
	if (!isRecord(value)) {
		return null;
	}
	const {
		seller_tax_code: taxCode,
		template,
		series,
		vat_rate: vatRate,
	} = value;
	if (
		typeof taxCode !== "string" ||
		typeof template !== "string" ||
		!TEMPLATES.includes(template) ||
		typeof series !== "string" ||
		typeof vatRate !== "string" ||
		!VAT_RATES.includes(vatRate)
	) {
		return null;
	}
	const seller: SellerSettings = {
		sellerTaxCode: taxCode,
		template: template as InvoiceTemplate,
		series,
		vatRate: vatRate as VatRate,
	};
	return sellerValid(seller) ? seller : null;
}

/** Reads a provider row from a database answer; null when anything is missing or out of shape. */
export function readEInvoiceProviderConfig(
	value: unknown,
): EInvoiceProviderConfig | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, adapter, mode, secret_name: secretName, settings } = value;
	const seller = readSeller(settings);
	if (
		typeof id !== "string" ||
		!UUID.test(id) ||
		typeof adapter !== "string" ||
		(mode !== "sandbox" && mode !== "live" && mode !== "off") ||
		typeof secretName !== "string" ||
		!SECRET_NAME_PATTERN.test(secretName) ||
		seller === null
	) {
		return null;
	}
	return { id, adapter, mode, secretName, seller };
}

export interface ProviderDependencies {
	/** the value of the row's secret, read by the function from its secrets */
	readonly secret: string;
	/** whether the mock may run here (EINVOICE_MOCK=on: local development, tests and e2e only) */
	readonly allowMock: boolean;
	readonly mockLedger?: MockLedger;
	readonly mockScript?: MockFailure[];
	readonly clock?: () => Date;
}

/** The provider of a row; EInvoiceConfigError when the row cannot run here. */
export function createEInvoiceProvider(
	config: EInvoiceProviderConfig,
	dependencies: ProviderDependencies,
): EInvoiceProvider {
	if (config.mode === "off") {
		throw new EInvoiceConfigError("the provider is switched off");
	}
	if (dependencies.secret === "") {
		throw new EInvoiceConfigError("the provider's secret is empty");
	}
	if (config.adapter === "mock") {
		if (config.mode === "live") {
			throw new EInvoiceConfigError("the mock never runs live");
		}
		if (!dependencies.allowMock) {
			throw new EInvoiceConfigError(
				"the mock runs only where EINVOICE_MOCK=on",
			);
		}
		return createMockProvider({
			secret: dependencies.secret,
			mode: config.mode,
			...(dependencies.mockLedger === undefined
				? {}
				: { ledger: dependencies.mockLedger }),
			...(dependencies.mockScript === undefined
				? {}
				: { script: dependencies.mockScript }),
			...(dependencies.clock === undefined
				? {}
				: { clock: dependencies.clock }),
		});
	}
	throw new EInvoiceConfigError(
		`no adapter named ${ADAPTERS.includes(config.adapter) ? config.adapter : "this"} can run here`,
	);
}
