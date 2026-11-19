import type {
	QueueAction,
	QueueItem,
	QueueKind,
	QueueOutcomeState,
} from "../loyalty/contract";
import {
	type AmountProblem,
	amountProblem,
	isOverdue,
	type ReasonProblem,
	readAdjustment,
	reasonProblem,
} from "../loyalty/model";

export const NO_INVOICE = "none";

export interface QueueDraft {
	readonly choice: string | null;
	readonly reason: string;
	readonly stamps: string;
	readonly points: string;
}

export type QueueProblem =
	| { readonly field: "choice" }
	| { readonly field: "amount"; readonly problem: AmountProblem }
	| { readonly field: "reason"; readonly problem: ReasonProblem };

export type QueueCheck =
	| { readonly ok: true; readonly action: QueueAction }
	| { readonly ok: false; readonly problems: readonly QueueProblem[] };

export function initialDraft(item: QueueItem): QueueDraft {
	return {
		choice: null,
		reason: "",
		stamps: String(item.stamps),
		points: String(item.points),
	};
}

export function choicesOf(item: QueueItem): readonly string[] {
	if (item.kind === "match")
		return [
			...(item.match?.candidates.map((candidate) => candidate.invoiceId) ?? []),
			NO_INVOICE,
		];
	return ["approved", "refused"];
}

export function needsAmount(item: QueueItem, draft: QueueDraft): boolean {
	return item.kind !== "match" && draft.choice === "approved";
}

export function queueAction(item: QueueItem, draft: QueueDraft): QueueCheck {
	const problems: QueueProblem[] = [];
	if (draft.choice === null || !choicesOf(item).includes(draft.choice))
		problems.push({ field: "choice" });
	const stamps = readAdjustment(draft.stamps);
	const points = readAdjustment(draft.points);
	if (needsAmount(item, draft)) {
		const amount = amountProblem(stamps, points, true);
		if (amount !== null) problems.push({ field: "amount", problem: amount });
	}
	const reason = reasonProblem(draft.reason);
	if (reason !== null) problems.push({ field: "reason", problem: reason });
	if (problems.length > 0 || draft.choice === null)
		return { ok: false, problems };
	const trimmed = draft.reason.trim();
	if (item.kind === "match") {
		return {
			ok: true,
			action: {
				kind: "match",
				itemId: item.id,
				invoiceId: draft.choice === NO_INVOICE ? null : draft.choice,
				reason: trimmed,
			},
		};
	}
	const approved = draft.choice === "approved";
	return {
		ok: true,
		action: {
			kind: "decide",
			itemId: item.id,
			decision: approved ? "approved" : "refused",
			reason: trimmed,
			stamps: approved ? (stamps ?? 0) : 0,
			points: approved ? (points ?? 0) : 0,
		},
	};
}

export function choiceKey(kind: QueueKind, choice: string): string {
	if (kind === "match") return "queue.match.none";
	if (choice === "refused") return "queue.refuse";
	return kind === "dispute"
		? "queue.dispute.accept"
		: "queue.adjustment.approve";
}

export function outcomeKey(state: QueueOutcomeState): string {
	return `queue.done.${state}`;
}

export interface QueueSummary {
	readonly open: number;
	readonly overdue: number;
}

export function queueSummary(
	items: readonly QueueItem[],
	now: Date,
): QueueSummary {
	return {
		open: items.length,
		overdue: items.filter((item) => isOverdue(item, now)).length,
	};
}

export function ageHours(item: QueueItem, now: Date): number {
	return Math.max(
		0,
		Math.floor((now.getTime() - Date.parse(item.createdAt)) / 3600_000),
	);
}
