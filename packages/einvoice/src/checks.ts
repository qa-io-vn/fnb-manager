import {
	type AdjustRequest,
	type Buyer,
	type CancelRequest,
	EInvoiceRefusedError,
	type IssueRequest,
	type OriginalInvoice,
	type SellerSettings,
} from "./types.js";

/**
 * The checks of a company and of a document, the same as the database's (app.einvoice_tax_code,
 * app.einvoice_text_valid, app.einvoice_email_valid), run again before anything is sent: the screens check for the
 * person typing, the database decides, and an adapter never sends what the provider would refuse or what could break
 * an email header.
 */

const TAX_CODE = /^[0-9]{10}(-[0-9]{3})?$/;
const BARE_13 = /^[0-9]{13}$/;
const SERIES = /^[CK][0-9]{2}M[A-Z0-9]{2}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
const CONTROL_OR_MARKUP = /[\u0000-\u001f\u007f<>{}]/;
const EMAIL =
	/^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_AMOUNT = 100_000_000;

/** A tax code as an invoice prints it, or null: 10 digits or 10-3, spaces around trimmed, 13 bare digits hyphenated. */
export function normaliseTaxCode(value: string): string | null {
	const trimmed = value.replace(/^ +| +$/g, "");
	if (BARE_13.test(trimmed)) {
		return `${trimmed.slice(0, 10)}-${trimmed.slice(10)}`;
	}
	return TAX_CODE.test(trimmed) ? trimmed : null;
}

/** A name or address an invoice can carry: 1 to max characters, trimmed, one line, no markup or template braces. */
export function textValid(value: string, max: number): boolean {
	return (
		value.length >= 1 &&
		[...value].length <= max &&
		value === value.trim() &&
		value.trim() !== "" &&
		!CONTROL_OR_MARKUP.test(value)
	);
}

export function emailValid(value: string): boolean {
	const local = value.split("@")[0] ?? "";
	return value.length <= 254 && local.length <= 64 && EMAIL.test(value);
}

export function buyerValid(buyer: Buyer): boolean {
	return (
		normaliseTaxCode(buyer.taxCode) === buyer.taxCode &&
		textValid(buyer.companyName, 200) &&
		textValid(buyer.address, 300) &&
		emailValid(buyer.email)
	);
}

export function sellerValid(seller: SellerSettings): boolean {
	return (
		normaliseTaxCode(seller.sellerTaxCode) === seller.sellerTaxCode &&
		SERIES.test(seller.series) &&
		(seller.template === "2"
			? seller.vatRate === "none"
			: seller.vatRate !== "none")
	);
}

function wholeDong(value: number, min: number): boolean {
	return Number.isSafeInteger(value) && value >= min && value <= MAX_AMOUNT;
}

function originalValid(original: OriginalInvoice): boolean {
	return (
		UUID.test(original.invoiceId) &&
		original.providerRef !== "" &&
		Number.isSafeInteger(original.amount) &&
		original.amount >= 0
	);
}

function refuse(message: string): never {
	throw new EInvoiceRefusedError("rejected_data", message);
}

/** A sale or company invoice: our id, a seller, lines of whole đồng that add up to a positive amount, a valid buyer. */
export function checkIssue(request: IssueRequest): void {
	if (!UUID.test(request.invoiceId)) refuse("the document id is not a uuid");
	if (!sellerValid(request.seller))
		refuse("the seller settings are not complete");
	if (!wholeDong(request.amount, 1))
		refuse("an invoice is for a positive whole number of đồng");
	if (request.lines.length === 0 || request.lines.length > 60)
		refuse("an invoice has 1 to 60 lines");
	let sum = 0;
	for (const line of request.lines) {
		if (
			!textValid(line.name, 200) ||
			!Number.isSafeInteger(line.quantity) ||
			line.quantity < 1 ||
			!Number.isSafeInteger(line.unitPrice) ||
			!Number.isSafeInteger(line.amount) ||
			Math.abs(line.amount) > MAX_AMOUNT
		) {
			refuse("a line is out of shape");
		}
		sum += line.amount;
	}
	if (sum !== request.amount) refuse("the lines do not add up to the amount");
	if (request.buyer !== null && !buyerValid(request.buyer))
		refuse("the buyer is out of shape");
}

export function checkAdjust(request: AdjustRequest): void {
	if (!UUID.test(request.invoiceId)) refuse("the document id is not a uuid");
	if (!sellerValid(request.seller))
		refuse("the seller settings are not complete");
	if (!originalValid(request.original))
		refuse("the original document is out of shape");
	if (
		!Number.isSafeInteger(request.amount) ||
		request.amount === 0 ||
		Math.abs(request.amount) > MAX_AMOUNT ||
		request.original.amount + request.amount < 0
	) {
		refuse(
			"an adjustment changes the amount by whole đồng and never below zero",
		);
	}
}

export function checkCancel(request: CancelRequest): void {
	if (!UUID.test(request.invoiceId)) refuse("the document id is not a uuid");
	if (!sellerValid(request.seller))
		refuse("the seller settings are not complete");
	if (!originalValid(request.original))
		refuse("the original document is out of shape");
}
