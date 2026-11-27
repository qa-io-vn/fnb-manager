import { emailValid } from "./checks.js";

/**
 * The company invoice email (C18 step 3, "gửi email"): sent only through this interface. There is no real email
 * provider yet; the mock records what it would send, and the einvoice-job function runs it where EINVOICE_MAILER=mock.
 * Most e-invoice providers email the buyer themselves (an issued answer then says emailed, and no mail is sent here).
 *
 * The message is built from the request's data, which the database already checked: no line breaks or markup in the
 * names, an address without spaces. It is still escaped for HTML and refused for a header when a line break appears,
 * so nothing a customer typed can add a header or a script (C18-S2).
 */

export interface InvoiceMail {
	readonly to: string;
	readonly companyName: string;
	readonly taxCode: string;
	readonly orderLabel: string | null;
	readonly storeName: string;
	readonly invoiceNo: string | null;
	readonly series: string | null;
	readonly lookupCode: string | null;
	readonly lookupUrl: string | null;
	readonly amount: number | null;
}

export interface ComposedMail {
	readonly to: string;
	readonly subject: string;
	readonly text: string;
	readonly html: string;
}

export interface InvoiceMailer {
	readonly kind: string;
	send(mail: ComposedMail): Promise<void>;
}

export type MailErrorClass =
	| "timeout"
	| "unavailable"
	| "rejected"
	| "no_mailer"
	| "unknown";

export class MailError extends Error {
	readonly errorClass: MailErrorClass;

	constructor(
		errorClass: MailErrorClass,
		message = "the email could not be sent",
	) {
		super(message);
		this.name = "MailError";
		this.errorClass = errorClass;
	}
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
const LINE_BREAK_OR_CONTROL = /[\u0000-\u001f\u007f]/;

export function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) => HTML_ESCAPES[character] ?? character,
	);
}

function headerSafe(value: string): string {
	if (LINE_BREAK_OR_CONTROL.test(value)) {
		throw new MailError("rejected", "a header value carries a line break");
	}
	return value;
}

function money(amount: number): string {
	return `${amount.toLocaleString("vi-VN").replace(/,/g, ".")}đ`;
}

/** The email of a company invoice: a subject, a plain text and an HTML body with every value escaped. */
export function composeInvoiceMail(mail: InvoiceMail): ComposedMail {
	if (!emailValid(mail.to)) {
		throw new MailError(
			"rejected",
			"the address is not one an invoice can be sent to",
		);
	}
	const order = mail.orderLabel === null ? "" : ` ${mail.orderLabel}`;
	const subject = headerSafe(`Hóa đơn điện tử đơn${order} – ${mail.storeName}`);
	const facts: [string, string][] = [
		["Đơn vị mua", mail.companyName],
		["Mã số thuế", mail.taxCode],
	];
	if (mail.series !== null || mail.invoiceNo !== null) {
		facts.push([
			"Ký hiệu, số hóa đơn",
			`${mail.series ?? ""} ${mail.invoiceNo ?? ""}`.trim(),
		]);
	}
	if (mail.amount !== null) {
		facts.push(["Tổng tiền", money(mail.amount)]);
	}
	if (mail.lookupCode !== null) {
		facts.push(["Mã tra cứu", mail.lookupCode]);
	}
	const lines = [
		`${mail.storeName} gửi bạn hóa đơn điện tử của đơn${order}.`,
		"",
		...facts.map(([label, value]) => `${label}: ${value}`),
	];
	if (mail.lookupUrl !== null) {
		lines.push("", `Tra cứu hóa đơn: ${mail.lookupUrl}`);
	}
	const html = [
		`<p>${escapeHtml(`${mail.storeName} gửi bạn hóa đơn điện tử của đơn${order}.`)}</p>`,
		"<dl>",
		...facts.map(
			([label, value]) =>
				`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
		),
		"</dl>",
		...(mail.lookupUrl !== null && /^https:\/\/[^\s"<>]+$/.test(mail.lookupUrl)
			? [`<p><a href="${escapeHtml(mail.lookupUrl)}">Tra cứu hóa đơn</a></p>`]
			: []),
	].join("\n");
	return { to: headerSafe(mail.to), subject, text: lines.join("\n"), html };
}

/** The mock mailer: records each message, sends nothing; can be told to fail with a class. */
export function createMockMailer(
	options: { failWith?: MailErrorClass } = {},
): InvoiceMailer & {
	readonly sent: ComposedMail[];
} {
	const sent: ComposedMail[] = [];
	return {
		kind: "mock",
		sent,
		async send(mail) {
			if (options.failWith !== undefined) {
				throw new MailError(options.failWith);
			}
			sent.push(mail);
		},
	};
}
