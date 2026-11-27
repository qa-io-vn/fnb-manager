// The wire contract of the customer's own account functions of the native till (docs/api.md, native-till.md 16.5, 16.6,
// 16.8, 18.2): the stamp card's member code (C20), deleting a login that never joined and the copy of its data (C19),
// and the customer's requests with a time the store proposed, which the customer accepts or cancels. Snake case is the
// wire; the readers return camel case and refuse anything malformed. The member code is a credential for 10 minutes: a
// reader never logs it.

export const ACCOUNT_FUNCTIONS = {
	stampCode: "customer_stamp_code",
	deleteAccount: "customer_delete_account",
	exportData: "customer_export_data",
	requests: "customer_requests",
	cancelRequest: "customer_cancel_request",
	acceptProposal: "customer_accept_proposal",
} as const;

/** The QR payload of a member code: `fnb-stamp:1:` and 22 characters of a 128-bit random token. */
export const STAMP_CODE_QR_PATTERN = /^fnb-stamp:1:[A-Za-z0-9_-]{22}$/;
/** A member number: 8 digits, the last the Luhn check digit of the first seven. */
export const STAMP_CODE_NUMBER_PATTERN = /^\d{8}$/;
const REQUEST_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface StampCode {
	readonly qrPayload: string;
	readonly number: string;
	/** the number as the screen shows it, "1234 5678" */
	readonly displayNumber: string;
	readonly issuedAt: string;
	/** when the app asks for a new code while online (9 minutes on) */
	readonly refreshAt: string;
	/** when the code stops working at the counter (10 minutes on) */
	readonly expiresAt: string;
}

export type StampCodeAnswer =
	| { readonly state: "issued"; readonly code: StampCode }
	| {
			readonly state: "refused";
			/** stamps_off, rate_limited, or another the app words generally */
			readonly refusal: string;
			readonly retryAt: string | null;
	  };

export type DeleteAccountAnswer =
	| { readonly state: "deleted"; readonly deletedAt: string }
	| {
			readonly state: "refused";
			/** member_request (joined with a phone: the deletion request instead), open_orders, refund_pending */
			readonly refusal: string;
			/** how many orders stand in the way (open_orders, refund_pending) */
			readonly orders: number | null;
	  };

export const REQUEST_KINDS = [
	"booking",
	"workshop",
	"hold",
	"application",
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATUSES = [
	"new",
	"proposed",
	"confirmed",
	"declined",
	"cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** A request as its customer sees it: never the phone echoed back. */
export interface CustomerRequest {
	readonly id: string;
	readonly kind: RequestKind;
	readonly store: string;
	readonly status: RequestStatus;
	readonly partySize: number | null;
	readonly requestedFor: string | null;
	/** the other time the store proposed (status proposed) */
	readonly proposedFor: string | null;
	readonly subject: string | null;
	readonly note: string | null;
	readonly createdAt: string;
	readonly answeredAt: string | null;
	readonly answerMessage: string | null;
	readonly cancelledAt: string | null;
	readonly cancelledBy: string | null;
	/** when the customer accepted the time proposed (customer_accept_proposal); null otherwise */
	readonly customerAcceptedAt: string | null;
	readonly version: number;
	readonly contactName: string | null;
}

/**
 * "Đồng ý giờ mới" (customer_accept_proposal): the request confirmed at the time proposed, or a refusal with the
 * request as it is now when the server names it (proposal_expired, not_allowed; null for unknown_request and
 * request_conflict).
 */
export type AcceptProposalAnswer =
	| {
			readonly state: "accepted";
			readonly replayed: boolean;
			readonly request: CustomerRequest;
	  }
	| {
			readonly state: "refused";
			/** proposal_expired, not_allowed, unknown_request, request_conflict, or another the app words generally */
			readonly refusal: string;
			readonly request: CustomerRequest | null;
	  };

export type CancelRequestAnswer =
	| {
			readonly state: "cancelled";
			readonly replayed: boolean;
			readonly request: CustomerRequest;
	  }
	| {
			readonly state: "refused";
			readonly refusal: string;
			readonly request: CustomerRequest | null;
	  };

/**
 * The copy of everything held about the login (customer_export_data). The app shows it as it came, section by section,
 * so the answer is kept as plain JSON values; only its frame is checked.
 */
export interface DataExport {
	readonly generatedAt: string;
	/** the sections in the answer's order, without generated_at (shown apart) */
	readonly sections: readonly {
		readonly key: string;
		readonly value: JsonValue;
	}[];
	/** the whole answer, for copying as one JSON text */
	readonly raw: JsonValue;
}

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

type Row = Readonly<Record<string, unknown>>;

function invalid(what: string): never {
	throw new Error(`the account answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Row)
		: invalid(what);
}

function instant(value: unknown, what: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function optionalInstant(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : instant(value, what);
}

function code(value: unknown, what: string): string {
	return typeof value === "string" && CODE_PATTERN.test(value)
		? value
		: invalid(what);
}

function optionalText(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value : invalid(what);
}

function count(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: invalid(what);
}

function optionalCount(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : count(value, what);
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

export function readStampCodeAnswer(value: unknown): StampCodeAnswer {
	const row = record(value, "member code answer");
	if (row.state === "issued") {
		const given = record(row.code, "member code");
		const qrPayload =
			typeof given.qr_payload === "string" &&
			STAMP_CODE_QR_PATTERN.test(given.qr_payload)
				? given.qr_payload
				: invalid("member code QR");
		const number =
			typeof given.number === "string" &&
			STAMP_CODE_NUMBER_PATTERN.test(given.number)
				? given.number
				: invalid("member number");
		const displayNumber =
			typeof given.display_number === "string" &&
			given.display_number.replace(" ", "") === number
				? given.display_number
				: invalid("member number shown");
		const issuedAt = instant(given.issued_at, "member code issued");
		const refreshAt = instant(given.refresh_at, "member code refresh");
		const expiresAt = instant(given.expires_at, "member code expiry");
		if (
			!(
				Date.parse(issuedAt) <= Date.parse(refreshAt) &&
				Date.parse(refreshAt) <= Date.parse(expiresAt)
			)
		)
			invalid("member code times");
		return {
			state: "issued",
			code: {
				qrPayload,
				number,
				displayNumber,
				issuedAt,
				refreshAt,
				expiresAt,
			},
		};
	}
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: code(row.refusal, "member code refusal"),
			retryAt: optionalInstant(row.retry_at, "member code retry"),
		};
	return invalid("member code state");
}

export function readDeleteAccountAnswer(value: unknown): DeleteAccountAnswer {
	const row = record(value, "deletion answer");
	if (row.state === "deleted" && row.deleted === true)
		return {
			state: "deleted",
			deletedAt: instant(row.deleted_at, "deletion time"),
		};
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: code(row.refusal, "deletion refusal"),
			orders: optionalCount(row.orders, "deletion orders"),
		};
	return invalid("deletion state");
}

export function readCustomerRequest(value: unknown): CustomerRequest {
	const row = record(value, "request");
	return {
		id:
			typeof row.id === "string" && REQUEST_ID_PATTERN.test(row.id)
				? row.id
				: invalid("request id"),
		kind: oneOf(REQUEST_KINDS, row.kind, "request kind"),
		store: typeof row.store === "string" ? row.store : invalid("request store"),
		status: oneOf(REQUEST_STATUSES, row.status, "request status"),
		partySize: optionalCount(row.party_size, "party size"),
		requestedFor: optionalInstant(row.requested_for, "requested time"),
		proposedFor: optionalInstant(row.proposed_for, "proposed time"),
		subject: optionalText(row.subject, "request subject"),
		note: optionalText(row.note, "request note"),
		createdAt: instant(row.created_at, "request created"),
		answeredAt: optionalInstant(row.answered_at, "request answered"),
		answerMessage: optionalText(row.answer_message, "answer message"),
		cancelledAt: optionalInstant(row.cancelled_at, "request cancelled"),
		cancelledBy: optionalText(row.cancelled_by, "request cancelled by"),
		customerAcceptedAt: optionalInstant(
			row.customer_accepted_at,
			"request accepted",
		),
		version: count(row.version, "request version"),
		contactName: optionalText(row.contact_name, "contact name"),
	};
}

export function readCustomerRequests(value: unknown): {
	readonly requests: readonly CustomerRequest[];
} {
	const row = record(value, "requests");
	const requests = Array.isArray(row.requests)
		? row.requests
		: invalid("requests list");
	return { requests: requests.map(readCustomerRequest) };
}

export function readCancelRequestAnswer(value: unknown): CancelRequestAnswer {
	const row = record(value, "cancellation answer");
	if (row.state === "cancelled")
		return {
			state: "cancelled",
			replayed: row.replayed === true,
			request: readCustomerRequest(row.request),
		};
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: code(row.refusal, "cancellation refusal"),
			request:
				row.request === null || row.request === undefined
					? null
					: readCustomerRequest(row.request),
		};
	return invalid("cancellation state");
}

export function readAcceptProposalAnswer(value: unknown): AcceptProposalAnswer {
	const row = record(value, "acceptance answer");
	// a replay answers the request as it is now, which a manager may have cancelled since: its status is the server's
	if (row.state === "accepted")
		return {
			state: "accepted",
			replayed: row.replayed === true,
			request: readCustomerRequest(row.request),
		};
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: code(row.refusal, "acceptance refusal"),
			request:
				row.request === null || row.request === undefined
					? null
					: readCustomerRequest(row.request),
		};
	return invalid("acceptance state");
}

function json(value: unknown, depth: number): JsonValue {
	if (depth > 12) return invalid("export depth");
	if (value === null) return null;
	if (
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	)
		return value;
	if (Array.isArray(value)) return value.map((entry) => json(entry, depth + 1));
	if (typeof value === "object") {
		const out: Record<string, JsonValue> = {};
		for (const [key, entry] of Object.entries(value as Row))
			out[key] = json(entry, depth + 1);
		return out;
	}
	return invalid("export value");
}

export function readDataExport(value: unknown): DataExport {
	const row = record(value, "data export");
	const generatedAt = instant(row.generated_at, "export time");
	record(row.login, "export login");
	record(row.counts, "export counts");
	const raw = json(row, 0);
	return {
		generatedAt,
		sections: Object.entries(row)
			.filter(([key]) => key !== "generated_at")
			.map(([key, entry]) => ({ key, value: json(entry, 1) })),
		raw,
	};
}

export function requestIdArgs(id: string): Readonly<Record<string, unknown>> {
	if (!REQUEST_ID_PATTERN.test(id)) throw new Error("a request id is a UUID");
	return { p_request: id };
}

/** The acceptance's arguments: the request and the app's own id of this acceptance (one per attempt), both UUIDs. */
export function acceptProposalArgs(
	id: string,
	attemptId: string,
): Readonly<Record<string, unknown>> {
	if (!REQUEST_ID_PATTERN.test(id) || !REQUEST_ID_PATTERN.test(attemptId))
		throw new Error("a request and its acceptance are named by UUIDs");
	return { p_request: id, p_request_id: attemptId };
}
