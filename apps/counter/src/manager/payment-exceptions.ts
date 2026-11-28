import type { SupabaseClient } from "@supabase/supabase-js";
import { RpcError, rpc } from "../lib/rpc";

// The managers' queue of money a verified provider reported and the server did not apply to an order (ADR-068;
// docs/api.md 3.29): a transfer of another amount, a late one, a second payment of a paid order, a reference nobody
// issued. manager_payment_exceptions lists a store's (newest first, at most 200; open, resolved or all in one call),
// with who resolved each one by name and which account received the money; manager_resolve_payment_exception closes
// one as refunded (handed back outside the app) or dismissed, with a note of 1 to 200 characters on one line. The
// answers are read strictly here; the server decides every state and checks the note again.

export const EXCEPTION_REASONS = [
	"amount_differs",
	"late",
	"duplicate",
	"unknown_reference",
] as const;

export const EXCEPTION_METHODS = ["vietqr", "zalo_checkout"] as const;

export const EXCEPTION_STATUSES = ["open", "refunded", "dismissed"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

/** The resolutions the server takes (manager_resolve_payment_exception); both are final. */
export const RESOLUTIONS = ["refunded", "dismissed"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** The page's filters; the server answers each in one call ("resolved": both resolutions, "all": no status). */
export const EXCEPTION_FILTERS = ["open", "resolved", "all"] as const;
export type ExceptionFilter = (typeof EXCEPTION_FILTERS)[number];

/** What manager_payment_exceptions filters by: a status, both resolutions, or null for all. */
export type ExceptionQuery = ExceptionStatus | "resolved" | null;

/** Which of the tenant's accounts received the money: a store's own or the brand-wide one. */
export const ACCOUNT_SCOPES = ["store", "brand"] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

/** The receiving account as the server describes it: never the full number, never the payer's. */
export interface ReceivingAccount {
	readonly scope: AccountScope;
	/** a VietQR account's bank; null for a wallet */
	readonly bank_name: string | null;
	/** the last 4 characters of a VietQR account's number when the money arrived */
	readonly account_tail: string | null;
}

/** The note's limit, in characters as the server counts them (code points). */
export const NOTE_MAX = 200;

/** How many the page lists at most; the server answers at most 200. */
export const LIST_LIMIT = 100;

export interface PaymentException {
	readonly id: string;
	readonly reason: string;
	readonly method: string;
	readonly amount: number;
	readonly expected_amount: number | null;
	readonly reference: string | null;
	readonly order_id: string | null;
	readonly order_no: string | null;
	readonly source: string;
	readonly received_at: string;
	readonly status: ExceptionStatus;
	readonly resolved_at: string | null;
	readonly resolved_by: string | null;
	/** who resolved it, by name (the roster's, else their Zalo sign-in's); null while open or when no name is known */
	readonly resolved_by_name: string | null;
	readonly resolution_note: string | null;
	/** null when the server does not say (an answer from before it did) */
	readonly account: ReceivingAccount | null;
}

export interface PaymentExceptions {
	/** The store's open exceptions, whatever the filter (the badge's count). */
	readonly open: number;
	readonly exceptions: readonly PaymentException[];
}

export interface ResolveAnswer {
	readonly state: string;
	readonly replayed: boolean;
	readonly refusal: string | null;
}

type Row = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: Row, key: string): string {
	const value = row[key];
	if (typeof value !== "string" || value === "")
		throw new Error(`a payment exception has no ${key}`);
	return value;
}

function optionalText(row: Row, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== "string")
		throw new Error(`a payment exception's ${key} is not text`);
	return value;
}

function amount(value: unknown, key: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error(
			`a payment exception's ${key} is not a whole number of dong`,
		);
	return value;
}

function instant(row: Row, key: string): string {
	const value = text(row, key);
	if (!Number.isFinite(Date.parse(value)))
		throw new Error(`a payment exception's ${key} is not a time`);
	return value;
}

/** The receiving account, or null when the answer has none. */
export function readReceivingAccount(value: unknown): ReceivingAccount | null {
	if (value === null || value === undefined) return null;
	if (!isRow(value))
		throw new Error("a payment exception's account is not an object");
	const scope = value.scope;
	if (
		typeof scope !== "string" ||
		!(ACCOUNT_SCOPES as readonly string[]).includes(scope)
	)
		throw new Error("a payment exception's account has no known scope");
	return {
		scope: scope as AccountScope,
		bank_name: optionalText(value, "bank_name"),
		account_tail: optionalText(value, "account_tail"),
	};
}

/** One exception of the list, or an error for a malformed one (the page then says it could not load). */
export function readPaymentException(value: unknown): PaymentException {
	if (!isRow(value)) throw new Error("a payment exception is not an object");
	const status = value.status;
	if (
		typeof status !== "string" ||
		!(EXCEPTION_STATUSES as readonly string[]).includes(status)
	)
		throw new Error("a payment exception has no known status");
	const expected = value.expected_amount;
	const resolvedAt = optionalText(value, "resolved_at");
	if ((status === "open") !== (resolvedAt === null))
		throw new Error("a payment exception's status and resolution disagree");
	return {
		id: text(value, "id"),
		reason: text(value, "reason"),
		method: text(value, "method"),
		amount: amount(value.amount, "amount"),
		expected_amount:
			expected === null || expected === undefined
				? null
				: amount(expected, "expected_amount"),
		reference: optionalText(value, "reference"),
		order_id: optionalText(value, "order_id"),
		order_no: optionalText(value, "order_no"),
		source: text(value, "source"),
		received_at: instant(value, "received_at"),
		status: status as ExceptionStatus,
		resolved_at: resolvedAt,
		resolved_by: optionalText(value, "resolved_by"),
		resolved_by_name: optionalText(value, "resolved_by_name"),
		resolution_note: optionalText(value, "resolution_note"),
		account: readReceivingAccount(value.account),
	};
}

export function readPaymentExceptions(value: unknown): PaymentExceptions {
	if (!isRow(value))
		throw new Error("the payment exceptions are not an object");
	const open = value.open;
	if (typeof open !== "number" || !Number.isSafeInteger(open) || open < 0)
		throw new Error("the payment exceptions have no open count");
	if (!Array.isArray(value.exceptions))
		throw new Error("the payment exceptions have no list");
	return { open, exceptions: value.exceptions.map(readPaymentException) };
}

/** One call of the server's list: a status, both resolutions, or null for all. */
export async function managerPaymentExceptions(
	client: SupabaseClient,
	store: string,
	status: ExceptionQuery,
	limit = LIST_LIMIT,
): Promise<PaymentExceptions> {
	return readPaymentExceptions(
		await rpc<unknown>(client, "manager_payment_exceptions", {
			p_store: store,
			p_status: status,
			p_limit: limit,
		}),
	);
}

/** What a filter asks the server for. */
export function queryOf(filter: ExceptionFilter): ExceptionQuery {
	return filter === "all" ? null : filter;
}

/** The list of a filter, in one call: the server filters and orders it (newest first) under the limit. */
export async function exceptionsFor(
	client: SupabaseClient,
	store: string,
	filter: ExceptionFilter,
	limit = LIST_LIMIT,
): Promise<PaymentExceptions> {
	return await managerPaymentExceptions(client, store, queryOf(filter), limit);
}

export async function resolvePaymentException(
	client: SupabaseClient,
	exception: string,
	resolution: Resolution,
	note: string,
): Promise<ResolveAnswer> {
	const answer = await rpc<unknown>(
		client,
		"manager_resolve_payment_exception",
		{ p_exception: exception, p_resolution: resolution, p_note: note },
	);
	if (
		!isRow(answer) ||
		typeof answer.state !== "string" ||
		typeof answer.replayed !== "boolean" ||
		!(answer.refusal === null || typeof answer.refusal === "string")
	)
		throw new Error("the resolution's answer is malformed");
	return {
		state: answer.state,
		replayed: answer.replayed,
		refusal: answer.refusal,
	};
}

// ---------------------------------------------------------------------------------------------------------------
// The words and the rules of the page

/** The kind in words; a reason the page does not know is worded in general. */
export function reasonKey(reason: string): string {
	return (EXCEPTION_REASONS as readonly string[]).includes(reason)
		? `paymentExceptions.reason.${reason}`
		: "paymentExceptions.reason.other";
}

/** The kind's one-line explanation. */
export function reasonDetailKey(reason: string): string {
	return (EXCEPTION_REASONS as readonly string[]).includes(reason)
		? `paymentExceptions.reasonDetail.${reason}`
		: "paymentExceptions.reasonDetail.other";
}

/** The provider in words (the method of its account); another is "the payment gateway". */
export function methodKey(method: string): string {
	return (EXCEPTION_METHODS as readonly string[]).includes(method)
		? `paymentExceptions.method.${method}`
		: "paymentExceptions.method.other";
}

/** The status's pill: open waits for a manager, a resolution is settled. */
export function statusTone(
	status: ExceptionStatus,
): "warning" | "positive" | "neutral" {
	return status === "open"
		? "warning"
		: status === "refunded"
			? "positive"
			: "neutral";
}

export function resolvable(exception: Pick<PaymentException, "status">) {
	return exception.status === "open";
}

/** The badge's count: the store's open exceptions as the server counts them. */
export function openCount(list: PaymentExceptions | undefined): number {
	return list === undefined ? 0 : list.open;
}

/** Whether the list may hold more than it shows (it reached the limit). */
export function mayHoldMore(
	list: Pick<PaymentExceptions, "exceptions">,
	limit = LIST_LIMIT,
): boolean {
	return list.exceptions.length >= limit;
}

export type NoteProblem =
	| { readonly kind: "empty" }
	| { readonly kind: "long"; readonly length: number }
	| { readonly kind: "control" };

// the characters PostgreSQL's [[:cntrl:]] matches on the server: C0, DEL and C1
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what the check refuses
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * The note as the server takes it: trimmed, 1 to 200 characters (code points, as char_length counts them), on one line
 * without control characters. The trimmed note is what is sent.
 */
export function checkNote(input: string): {
	readonly note: string | null;
	readonly problem: NoteProblem | null;
} {
	const note = input.trim();
	if (note === "") return { note: null, problem: { kind: "empty" } };
	if (CONTROL.test(note)) return { note: null, problem: { kind: "control" } };
	const length = [...note].length;
	if (length > NOTE_MAX)
		return { note: null, problem: { kind: "long", length } };
	return { note, problem: null };
}

export function noteProblemWords(problem: NoteProblem): {
	readonly key: string;
	readonly params: Readonly<Record<string, number>>;
} {
	switch (problem.kind) {
		case "empty":
			return { key: "paymentExceptions.note.empty", params: {} };
		case "control":
			return { key: "paymentExceptions.note.control", params: {} };
		default:
			return {
				key: "paymentExceptions.note.long",
				params: { max: NOTE_MAX, count: problem.length },
			};
	}
}

/** What the server's answer to a resolution means for the manager. */
export type ResolveOutcome =
	| { readonly kind: "resolved"; readonly replayed: boolean }
	| { readonly kind: "already"; readonly state: string };

export function resolveOutcome(
	answer: ResolveAnswer,
	chosen: Resolution,
): ResolveOutcome {
	if (answer.refusal === null && answer.state === chosen)
		return { kind: "resolved", replayed: answer.replayed };
	return { kind: "already", state: answer.state };
}

/** A refusal of a call in words: not allowed (42501, also an unknown id), a note refused (22023), no network. */
export function failureKey(error: unknown): string {
	if (error instanceof RpcError) {
		if (error.forbidden) return "paymentExceptions.refusal.forbidden";
		if (error.code === "22023") return "paymentExceptions.refusal.invalid";
		if (error.network) return "common.network";
	}
	return "common.failed";
}

/** Who resolved it, by the server's name (an owner included); null when it knows none (the page says "a manager or the owner"). */
export function resolverName(
	exception: Pick<PaymentException, "status" | "resolved_by_name">,
): string | null {
	return exception.status === "open" ? null : exception.resolved_by_name;
}

/**
 * The receiving account in words: a VietQR account's bank with the last characters of its number ("Ngân hàng mẫu
 * ···6789"), or a null label when the page words the provider instead (a wallet); and the key of its scope. Null when
 * the server said nothing about the account.
 */
export function accountWords(
	account: ReceivingAccount | null,
): { readonly label: string | null; readonly scopeKey: string } | null {
	if (account === null) return null;
	const label =
		account.bank_name === null
			? null
			: account.account_tail === null
				? account.bank_name
				: `${account.bank_name} ···${account.account_tail}`;
	return { label, scopeKey: `paymentExceptions.scope.${account.scope}` };
}
