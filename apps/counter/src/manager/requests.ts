import { clockOf, vietnamDate } from "../lib/time";

/** A request of the inbox as manager_requests answers it (native-till.md section 12). */
export interface StoreRequest {
	readonly id: string;
	readonly kind: "booking" | "workshop" | "hold" | "application";
	readonly status: "new" | "confirmed" | "declined" | "cancelled";
	readonly channel: string;
	readonly party_size: number | null;
	readonly requested_for: string | null;
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
}

export const REQUEST_KINDS = [
	"booking",
	"workshop",
	"hold",
	"application",
] as const;

/** Minutes left before the promised answer (negative when late), or null once answered. */
export function minutesLeft(request: StoreRequest, now: number): number | null {
	if (request.status !== "new" || request.answer_due_at === null) return null;
	const due = Date.parse(request.answer_due_at);
	if (!Number.isFinite(due)) return null;
	const minutes = (due - now) / 60_000;
	return minutes >= 0 ? Math.floor(minutes) : -Math.ceil(-minutes);
}

/** New ones first, the most urgent first among them; the others newest first. */
export function inboxOrder(requests: readonly StoreRequest[]): StoreRequest[] {
	return [...requests].sort((a, b) => {
		if ((a.status === "new") !== (b.status === "new"))
			return a.status === "new" ? -1 : 1;
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

/**
 * The reply a manager copies and sends by hand (an OA message, until ZBS templates exist): the facts of the request in
 * the shop's voice, as plain text. The name and the times are the customer's own data; nothing is markup.
 */
export function replyText(
	request: StoreRequest,
	status: "confirmed" | "declined" | "cancelled",
	message: string,
	store: string,
	t: T,
): string {
	const when =
		request.requested_for === null
			? ""
			: t("reply.when", {
					time: clockOf(request.requested_for),
					date: dateOf(request.requested_for),
				});
	const facts = [
		request.kind === "booking" && request.party_size !== null
			? t("reply.people", { count: request.party_size })
			: null,
		request.subject,
		when === "" ? null : when,
	]
		.filter((part): part is string => part !== null && part !== "")
		.join(", ");
	const key = `reply.${request.kind}.${status}`;
	const base = t(key, { store, name: request.contact_name, facts });
	return message.trim() === "" ? base : `${base} ${message.trim()}`;
}
