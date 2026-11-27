import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../lib/rpc";
import { clockOf, vietnamDate } from "../lib/time";

export type RequestStatus =
	| "new"
	| "proposed"
	| "confirmed"
	| "declined"
	| "cancelled";

/** A request of the inbox as manager_requests answers it (native-till.md sections 12 and 16.8). */
export interface StoreRequest {
	readonly id: string;
	readonly kind: "booking" | "workshop" | "hold" | "application";
	readonly status: RequestStatus;
	readonly channel: string;
	readonly party_size: number | null;
	readonly requested_for: string | null;
	/** the other time the store proposed (status proposed), kept after a later answer */
	readonly proposed_for?: string | null;
	readonly subject: string | null;
	readonly note: string | null;
	readonly created_at: string;
	readonly answered_at: string | null;
	readonly answer_message: string | null;
	readonly version: number;
	readonly contact_name: string;
	readonly contact_phone: string | null;
	readonly answer_due_at: string | null;
	readonly overdue: boolean;
	/** who first opened it and when (manager_request_read); null while nobody has */
	readonly read_at?: string | null;
	readonly read_by?: string | null;
	/** when the customer accepted the time proposed in the app (customer_accept_proposal), null otherwise */
	readonly customer_accepted_at?: string | null;
	/** the customer accepted and no owner or manager opened or answered it since (migration customer_accept_proposal) */
	readonly accepted_unseen?: boolean;
	readonly accept_seen_at?: string | null;
	readonly accept_seen_by?: string | null;
}

export interface Inbox {
	readonly requests: readonly StoreRequest[];
	readonly new: number;
	/** the new requests nobody opened yet */
	readonly unread: number;
	/** the requests a customer accepted that no owner or manager opened or answered since */
	readonly accepted_unseen?: number;
	readonly overdue: number;
}

export type Answer = "confirmed" | "proposed" | "declined" | "cancelled";

export const REQUEST_KINDS = [
	"booking",
	"workshop",
	"hold",
	"application",
] as const;

export const inbox = (client: SupabaseClient, store: string) =>
	rpc<Inbox>(client, "manager_requests", {
		p_store: store,
		p_status: null,
		p_limit: 200,
	});

/** Opening a request: the first opening is recorded with who and when (the unread mark goes). */
export const markRead = (client: SupabaseClient, request: string) =>
	rpc<{ state: "read"; request: StoreRequest }>(
		client,
		"manager_request_read",
		{ p_request: request },
	);

/** A message is one line for the database: line breaks typed in the box become spaces. */
export function oneLine(message: string): string {
	return message.trim().replace(/\s*[\r\n]+\s*/g, " ");
}

export const answerRequest = (
	client: SupabaseClient,
	request: Pick<StoreRequest, "id" | "version">,
	answer: Answer,
	message: string,
	proposedFor: string | null = null,
) =>
	rpc<{
		state: "answered" | "conflict" | "refused";
		refusal: string | null;
		replayed?: boolean;
		request?: StoreRequest;
	}>(client, "manager_answer_request", {
		p_request: request.id,
		p_status: answer,
		p_message: oneLine(message) === "" ? null : oneLine(message),
		p_expected_version: request.version,
		p_proposed_for: answer === "proposed" ? proposedFor : null,
	});

/** Whether nobody has opened this new request yet (the row's unread mark). */
export function isUnread(request: StoreRequest): boolean {
	return (
		request.status === "new" &&
		(request.read_at === null || request.read_at === undefined)
	);
}

/**
 * Whether the customer accepted the time proposed in the app and no owner or manager has opened or answered the request
 * since (the inbox's own flag, so the first reading of the contact is kept): the row's "accepted" mark. Only a
 * confirmed request carries it; the server's flag is the truth.
 */
export function isAcceptedUnseen(request: StoreRequest): boolean {
	return request.accepted_unseen === true && request.status === "confirmed";
}

/** Whether opening the request records something: the first reading of a new one, or seeing a customer's acceptance. */
export function needsReading(request: StoreRequest): boolean {
	return isUnread(request) || isAcceptedUnseen(request);
}

/**
 * What the inbox counts as not yet read, on the manager's tab, on Quản lý and in the inbox: the new requests nobody
 * opened and the acceptances nobody saw (each request once: a new request is never an accepted one).
 */
export function unreadCount(
	box: Pick<Inbox, "unread" | "accepted_unseen"> | undefined,
): number {
	if (box === undefined) return 0;
	const accepted = box.accepted_unseen ?? 0;
	return (
		(Number.isSafeInteger(box.unread) && box.unread > 0 ? box.unread : 0) +
		(Number.isSafeInteger(accepted) && accepted > 0 ? accepted : 0)
	);
}

/** Still waiting on the store: new, or another time proposed and the customer's answer awaited. */
export function isOpen(request: StoreRequest): boolean {
	return request.status === "new" || request.status === "proposed";
}

/**
 * The "Chưa xử lý" tab: the open requests, and a customer's acceptance until an owner or manager has seen it (then
 * it moves to "Đã xử lý" with the other confirmed ones).
 */
export function inOpenTab(request: StoreRequest): boolean {
	return isOpen(request) || isAcceptedUnseen(request);
}

/** The answers offered for a request in its state (the database decides again; any other move is not_allowed). */
export function answersFor(request: StoreRequest): readonly Answer[] {
	// only a request that asked for a time can be offered another one (an application asks for none)
	const timed = request.requested_for !== null;
	switch (request.status) {
		case "new":
			return timed
				? ["confirmed", "proposed", "declined"]
				: ["confirmed", "declined"];
		case "proposed":
			return ["confirmed", "proposed", "declined"];
		case "confirmed":
			return ["cancelled"];
		default:
			return [];
	}
}

/** Declining, cancelling and proposing need a message for the customer. */
export function needsMessage(answer: Answer | null): boolean {
	return (
		answer === "declined" || answer === "cancelled" || answer === "proposed"
	);
}

export const PROPOSAL_MIN_MS = 30 * 60_000;
export const PROPOSAL_MAX_MS = 60 * 24 * 3_600_000;

/** The instant of a date and a clock typed in Vietnam time ("2026-11-28", "19:30"), or null when either is malformed. */
export function vietnamInstant(date: string, clock: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clock))
		return null;
	const at = new Date(`${date}T${clock}:00+07:00`);
	return Number.isNaN(at.getTime()) || vietnamDate(at.toISOString()) !== date
		? null
		: at.toISOString();
}

/**
 * Why a proposed time cannot be sent (the database's bounds): malformed, less than 30 minutes ahead, more than 60
 * days ahead, or the very time asked; null when it can.
 */
export function proposalProblem(
	at: string | null,
	request: Pick<StoreRequest, "requested_for">,
	now: number,
): "invalid" | "too_soon" | "too_far" | "same_time" | null {
	if (at === null) return "invalid";
	const when = Date.parse(at);
	if (!Number.isFinite(when)) return "invalid";
	if (when < now + PROPOSAL_MIN_MS) return "too_soon";
	if (when > now + PROPOSAL_MAX_MS) return "too_far";
	if (
		request.requested_for !== null &&
		Date.parse(request.requested_for) === when
	)
		return "same_time";
	return null;
}

/** Minutes left before the promised answer (negative when late), or null once answered. */
export function minutesLeft(request: StoreRequest, now: number): number | null {
	if (request.status !== "new" || request.answer_due_at === null) return null;
	const due = Date.parse(request.answer_due_at);
	if (!Number.isFinite(due)) return null;
	const minutes = (due - now) / 60_000;
	return minutes >= 0 ? Math.floor(minutes) : -Math.ceil(-minutes);
}

/**
 * New ones first (the most urgent first), then the customers' acceptances nobody saw yet (as manager_requests lists
 * them), then the proposals awaiting the customer, then the others; each group but the new ones newest first.
 */
export function inboxOrder(requests: readonly StoreRequest[]): StoreRequest[] {
	const rank = (request: StoreRequest) =>
		request.status === "new"
			? 0
			: isAcceptedUnseen(request)
				? 1
				: request.status === "proposed"
					? 2
					: 3;
	return [...requests].sort((a, b) => {
		if (rank(a) !== rank(b)) return rank(a) - rank(b);
		if (a.status === "new")
			return (a.answer_due_at ?? "").localeCompare(b.answer_due_at ?? "");
		return b.created_at.localeCompare(a.created_at);
	});
}

export function countByKind(
	requests: readonly StoreRequest[],
): Record<string, number> {
	const counts: Record<string, number> = { all: requests.length };
	for (const request of requests)
		counts[request.kind] = (counts[request.kind] ?? 0) + 1;
	return counts;
}

function dateOf(iso: string): string {
	const [year, month, day] = vietnamDate(iso).split("-");
	return `${day}/${month}/${year}`;
}

type T = (key: string, params?: Record<string, string | number>) => string;

function whenOf(iso: string | null | undefined, t: T): string {
	return iso === null || iso === undefined
		? ""
		: t("reply.when", { time: clockOf(iso), date: dateOf(iso) });
}

/**
 * The reply a manager copies and sends by hand (an OA message, until ZBS templates exist): the facts of the request in
 * the shop's voice, as plain text. The name and the times are the customer's own data; nothing is markup. A proposal
 * names the time asked and the time proposed; confirming a proposal (the customer agreed) names the time proposed,
 * which the booking moves to.
 */
export function replyText(
	request: StoreRequest,
	status: Answer,
	message: string,
	store: string,
	t: T,
	proposedFor: string | null = null,
): string {
	const when = whenOf(
		status === "confirmed" && request.status === "proposed"
			? (request.proposed_for ?? request.requested_for)
			: request.requested_for,
		t,
	);
	const facts = [
		request.kind === "booking" && request.party_size !== null
			? t("reply.people", { count: request.party_size })
			: null,
		request.subject,
		status === "proposed" || when === "" ? null : when,
	]
		.filter((part): part is string => part !== null && part !== "")
		.join(", ");
	const base =
		status === "proposed"
			? t("reply.proposed", {
					store,
					name: request.contact_name,
					facts,
					asked: when,
					proposed: whenOf(proposedFor, t),
				})
			: t(`reply.${request.kind}.${status}`, {
					store,
					name: request.contact_name,
					facts,
				});
	const extra = oneLine(message);
	return extra === "" ? base : `${base} ${extra}`;
}
