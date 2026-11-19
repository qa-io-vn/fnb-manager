import {
	type IsoInstant,
	instant,
	instantOrNull,
	oneOf,
	type Row,
	rows,
	single,
	text,
	textOrNull,
} from "../team/read";

export const REQUEST_FUNCTIONS = {
	kinds: "approval_request_kinds_of",
	submit: "submit_request",
	mine: "my_requests",
	queue: "approval_queue",
	decide: "decide_request",
} as const;

export const MAX_DETAILS_LENGTH = 1000;
export const MAX_REFUSAL_LENGTH = 500;

export const REQUEST_STATUSES = ["pending", "approved", "refused"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_DECISIONS = ["approved", "refused"] as const;
export type RequestDecision = (typeof REQUEST_DECISIONS)[number];

export interface RequestKind {
	readonly key: string;
	readonly label: string;
}

export interface RequestInput {
	readonly storeId: string;
	readonly kindKey: string;
	readonly details: string;
}

export interface SubmitReceipt {
	readonly id: string;
	readonly status: RequestStatus;
}

export interface OwnRequest {
	readonly id: string;
	readonly storeId: string;
	readonly kindKey: string;
	readonly kindLabel: string | null;
	readonly details: string;
	readonly status: RequestStatus;
	readonly requestedAt: IsoInstant;
	readonly decidedAt: IsoInstant | null;
	readonly refusalReason: string | null;
}

export interface PendingRequest {
	readonly id: string;
	readonly storeId: string;
	readonly kindKey: string;
	readonly kindLabel: string | null;
	readonly details: string;
	readonly requesterName: string | null;
	readonly requestedAt: IsoInstant;
}

export type RequestDecisionInput =
	| { readonly decision: "approved" }
	| { readonly decision: "refused"; readonly reason: string };

export interface DecisionReceipt {
	readonly id: string;
	readonly status: RequestDecision;
}

export interface RequestsApi {
	kinds(): Promise<RequestKind[]>;
	submit(input: RequestInput): Promise<SubmitReceipt>;
	mine(): Promise<OwnRequest[]>;
	queue(): Promise<PendingRequest[]>;
	decide(id: string, input: RequestDecisionInput): Promise<DecisionReceipt>;
}

export function readKinds(value: unknown): RequestKind[] {
	return rows(value, "request kinds")
		.filter((row) => row.active !== false)
		.map((row) => ({
			key: text(row.key, "request kind"),
			label: text(row.label, "request kind label"),
		}));
}

export function readSubmitReceipt(value: unknown): SubmitReceipt {
	const row = single(value, "request receipt");
	return {
		id: text(row.request_id, "request id"),
		status: oneOf(REQUEST_STATUSES, row.status, "request status"),
	};
}

export function readOwnRequests(value: unknown): OwnRequest[] {
	return rows(value, "own requests").map((row) => ({
		id: text(row.request_id, "request id"),
		storeId: text(row.store_id, "request store"),
		kindKey: text(row.kind_key, "request kind"),
		kindLabel: textOrNull(row.kind_label, "request kind label"),
		details: text(row.details, "request details"),
		status: oneOf(REQUEST_STATUSES, row.status, "request status"),
		requestedAt: instant(row.requested_at, "request time"),
		decidedAt: instantOrNull(row.decided_at, "decision time"),
		refusalReason: textOrNull(row.refusal_reason, "refusal reason"),
	}));
}

export function readQueue(value: unknown): PendingRequest[] {
	return rows(value, "approval queue").map((row) => ({
		id: text(row.request_id, "request id"),
		storeId: text(row.store_id, "request store"),
		kindKey: text(row.kind_key, "request kind"),
		kindLabel: textOrNull(row.kind_label, "request kind label"),
		details: text(row.details, "request details"),
		requesterName: textOrNull(row.requester_name, "requester"),
		requestedAt: instant(row.requested_at, "request time"),
	}));
}

export function readDecisionReceipt(value: unknown): DecisionReceipt {
	const row = single(value, "decision");
	return {
		id: text(row.request_id, "request id"),
		status: oneOf(REQUEST_DECISIONS, row.status, "decision"),
	};
}

export function submitArgs(input: RequestInput): Row {
	return {
		p_store_id: input.storeId,
		p_kind_key: input.kindKey,
		p_details: input.details.trim(),
	};
}

export function decideArgs(id: string, input: RequestDecisionInput): Row {
	return input.decision === "approved"
		? { p_request_id: id, p_decision: "approved" }
		: {
				p_request_id: id,
				p_decision: "refused",
				p_reason: input.reason.trim(),
			};
}

export function sortOwnRequests(requests: readonly OwnRequest[]): OwnRequest[] {
	return [...requests].sort((a, b) =>
		b.requestedAt === a.requestedAt
			? a.id.localeCompare(b.id)
			: b.requestedAt.localeCompare(a.requestedAt),
	);
}

export function sortQueue(
	requests: readonly PendingRequest[],
): PendingRequest[] {
	return [...requests].sort((a, b) =>
		a.requestedAt === b.requestedAt
			? a.id.localeCompare(b.id)
			: a.requestedAt.localeCompare(b.requestedAt),
	);
}
