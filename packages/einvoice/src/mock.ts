import { checkAdjust, checkCancel, checkIssue } from "./checks.js";
import {
	type AdjustRequest,
	type CancelRequest,
	type EInvoiceMode,
	type EInvoiceProvider,
	EInvoiceRefusedError,
	EInvoiceUnavailableError,
	type InvoiceLookup,
	type IssuedInvoice,
	type IssueRequest,
	type ReplaceRequest,
	type SellerSettings,
} from "./types.js";

/**
 * The mock provider: what the job, the counter and the e2e runs use until a provider is chosen, refused live by the
 * database and run by the function only where EINVOICE_MOCK=on. It keeps the documents it made in a ledger keyed by our
 * document id (a second issue under the same id is refused as a duplicate, as a strict provider would), numbers them
 * per series, derives a lookup code from the key and the id, gives the tax authority's code of an invoice made from a
 * cash register, refuses to cancel (the law keeps a valid invoice; the job adjusts to zero instead) unless told, and
 * can be scripted to fail, including the case that matters most: it makes the document and the answer is lost.
 */

export type MockOperation = "issue" | "replace" | "adjust" | "cancel" | "query";

export interface MockFailure {
	readonly operation: MockOperation;
	readonly failure:
		| "timeout"
		| "unavailable"
		| "rate_limited"
		| "rejected_data"
		| "rejected_auth";
	/** the provider made the document, then the answer was lost (a timeout after the work) */
	readonly afterWork?: boolean;
}

export interface MockDocument extends Omit<IssuedInvoice, "operation"> {
	readonly invoiceId: string;
	readonly kind: "sale" | "replacement" | "adjustment" | "cancellation";
	readonly originalRef: string | null;
	readonly buyerTaxCode: string | null;
	state: "valid" | "replaced" | "cancelled";
}

/** The mock's memory: shared between providers made for one test, so a second run sees what the first one made. */
export class MockLedger {
	readonly documents = new Map<string, MockDocument>();
	private readonly sequences = new Map<string, number>();
	readonly calls: MockOperation[] = [];

	next(series: string): number {
		const value = (this.sequences.get(series) ?? 0) + 1;
		this.sequences.set(series, value);
		return value;
	}

	byRef(providerRef: string): MockDocument | undefined {
		for (const document of this.documents.values()) {
			if (document.providerRef === providerRef) {
				return document;
			}
		}
		return undefined;
	}
}

export interface MockOptions {
	readonly secret: string;
	readonly mode: EInvoiceMode;
	readonly ledger?: MockLedger;
	/** failures to answer, in order, for the operations they name */
	readonly script?: MockFailure[];
	readonly cancelSupported?: boolean;
	/** whether the mock emails the buyer of a company invoice itself (most providers can) */
	readonly sendsEmail?: boolean;
	readonly clock?: () => Date;
	/** buyer tax codes the mock refuses as unknown to the tax authority */
	readonly unknownTaxCodes?: readonly string[];
}

export const MOCK_LOOKUP_BASE = "https://einvoice.mock.invalid/tra-cuu/";
const encoder = new TextEncoder();
const LOOKUP_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

async function lookupCodeOf(
	secret: string,
	invoiceId: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const bytes = new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			key,
			encoder.encode(`lookup:${invoiceId}`),
		),
	);
	let code = "";
	for (let index = 0; index < 10; index += 1) {
		code += LOOKUP_ALPHABET[(bytes[index] ?? 0) % 32];
	}
	return code;
}

export function createMockProvider(options: MockOptions): EInvoiceProvider {
	if (options.secret === "") {
		throw new Error("the mock provider needs a key to derive its lookup codes");
	}
	const ledger = options.ledger ?? new MockLedger();
	const script = options.script ?? [];
	const clock = options.clock ?? (() => new Date());
	const unknown = new Set(options.unknownTaxCodes ?? ["0000000000"]);

	function scripted(operation: MockOperation): MockFailure | undefined {
		ledger.calls.push(operation);
		const index = script.findIndex((entry) => entry.operation === operation);
		if (index < 0) {
			return undefined;
		}
		const [entry] = script.splice(index, 1);
		return entry;
	}

	function fail(failure: MockFailure): never {
		if (
			failure.failure === "rejected_data" ||
			failure.failure === "rejected_auth"
		) {
			throw new EInvoiceRefusedError(failure.failure);
		}
		throw new EInvoiceUnavailableError(failure.failure);
	}

	async function make(
		invoiceId: string,
		kind: MockDocument["kind"],
		seller: SellerSettings,
		amount: number,
		originalRef: string | null,
		buyerTaxCode: string | null,
	): Promise<MockDocument> {
		if (ledger.documents.has(invoiceId)) {
			throw new EInvoiceRefusedError(
				"rejected_duplicate",
				"a document already exists under this id",
			);
		}
		const symbol = `${seller.template}${seller.series}`;
		const number = ledger.next(symbol);
		const issuedAt = clock();
		const lookupCode = await lookupCodeOf(options.secret, invoiceId);
		const document: MockDocument = {
			invoiceId,
			kind,
			providerRef: `mock-${invoiceId}`,
			invoiceNo: String(number).padStart(8, "0"),
			series: symbol,
			lookupCode,
			lookupUrl: `${MOCK_LOOKUP_BASE}${lookupCode}`,
			taxAuthorityCode: `M${seller.template}-${String(issuedAt.getUTCFullYear()).slice(2)}-MOCK0-${String(number).padStart(11, "0")}`,
			amount,
			issuedAt: issuedAt.toISOString(),
			emailed: buyerTaxCode !== null && options.sendsEmail === true,
			originalRef,
			buyerTaxCode,
			state: "valid",
		};
		ledger.documents.set(invoiceId, document);
		return document;
	}

	function answer(document: MockDocument): IssuedInvoice {
		return {
			operation:
				document.kind === "adjustment"
					? "adjust"
					: document.kind === "cancellation"
						? "cancel"
						: document.originalRef === null
							? "issue"
							: "replace",
			providerRef: document.providerRef,
			invoiceNo: document.invoiceNo,
			series: document.series,
			lookupCode: document.lookupCode,
			lookupUrl: document.lookupUrl,
			taxAuthorityCode: document.taxAuthorityCode,
			amount: document.amount,
			issuedAt: document.issuedAt,
			emailed: document.emailed,
		};
	}

	function validOriginal(providerRef: string): MockDocument {
		const original = ledger.byRef(providerRef);
		if (original === undefined || original.state !== "valid") {
			throw new EInvoiceRefusedError(
				"rejected_data",
				"the original document is unknown or no longer valid",
			);
		}
		return original;
	}

	async function work<T>(
		operation: MockOperation,
		run: () => Promise<T>,
	): Promise<T> {
		const failure = scripted(operation);
		if (failure !== undefined && failure.afterWork !== true) {
			fail(failure);
		}
		const result = await run();
		if (failure !== undefined) {
			fail(failure);
		}
		return result;
	}

	return {
		adapter: "mock",
		mode: options.mode,
		async issue(request: IssueRequest) {
			checkIssue(request);
			if (request.buyer !== null && unknown.has(request.buyer.taxCode)) {
				throw new EInvoiceRefusedError("rejected_data", "unknown tax code");
			}
			return answer(
				await work("issue", () =>
					make(
						request.invoiceId,
						request.buyer === null ? "sale" : "replacement",
						request.seller,
						request.amount,
						null,
						request.buyer?.taxCode ?? null,
					),
				),
			);
		},
		async query(invoiceId: string) {
			const failure = scripted("query");
			if (failure !== undefined) {
				fail(failure);
			}
			const document = ledger.documents.get(invoiceId);
			return document === undefined ? null : answer(document);
		},
		async replace(request: ReplaceRequest) {
			checkIssue(request);
			if (unknown.has(request.buyer.taxCode)) {
				throw new EInvoiceRefusedError("rejected_data", "unknown tax code");
			}
			return answer(
				await work("replace", async () => {
					const original = validOriginal(request.original.providerRef);
					const document = await make(
						request.invoiceId,
						"replacement",
						request.seller,
						request.amount,
						original.providerRef,
						request.buyer.taxCode,
					);
					original.state = "replaced";
					return document;
				}),
			);
		},
		async adjust(request: AdjustRequest) {
			checkAdjust(request);
			return answer(
				await work("adjust", async () => {
					const original = validOriginal(request.original.providerRef);
					return await make(
						request.invoiceId,
						"adjustment",
						request.seller,
						request.amount,
						original.providerRef,
						null,
					);
				}),
			);
		},
		async cancel(request: CancelRequest) {
			checkCancel(request);
			if (options.cancelSupported !== true) {
				ledger.calls.push("cancel");
				return "unsupported" as const;
			}
			return answer(
				await work("cancel", async () => {
					const original = validOriginal(request.original.providerRef);
					const document = await make(
						request.invoiceId,
						"cancellation",
						request.seller,
						-request.original.amount,
						original.providerRef,
						null,
					);
					original.state = "cancelled";
					return document;
				}),
			);
		},
		async lookup(providerRef: string): Promise<InvoiceLookup | null> {
			const document = ledger.byRef(providerRef);
			return document === undefined ||
				document.lookupCode === null ||
				document.lookupUrl === null
				? null
				: { lookupCode: document.lookupCode, lookupUrl: document.lookupUrl };
		},
	};
}
