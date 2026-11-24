import {
	type Amounts,
	LOYALTY_REFUSAL_REASONS,
	type LoyaltyEntryKind,
	type LoyaltyRefusalReason,
	type MatchedPath,
	parseClawbackReason,
} from "@fnb/core";
import type { IsoDate } from "@fnb/reports";
import type {
	TableColumn,
	TableRow,
	TableSpec,
} from "../components/report-card/types";
import type { MessageKey, Translate } from "../i18n";
import { todayIn } from "../lib/business-dates";
import type { Formatters } from "../lib/format";
import { formatFullPhone } from "./mask-phone";
import type {
	InvoiceReference,
	LedgerEntryRow,
	MemberRow,
	MembershipStatus,
	QueueItemRow,
	QueueReason,
	QueueState,
	ReconciliationItemRow,
	ReconciliationReason,
	ShiftAnomaly,
} from "./source";

export const MEMBERSHIP_STATUS_KEYS: Readonly<
	Record<MembershipStatus, MessageKey>
> = {
	active: "loyalty.memberStatus.active",
	suspended: "loyalty.memberStatus.suspended",
	closed: "loyalty.memberStatus.closed",
};

export const ENTRY_KIND_KEYS: Readonly<Record<LoyaltyEntryKind, MessageKey>> = {
	earn: "loyalty.entry.earn",
	confirm: "loyalty.entry.confirm",
	clawback: "loyalty.entry.clawback",
	redeem: "loyalty.entry.redeem",
	adjust: "loyalty.entry.adjust",
	expire: "loyalty.entry.expire",
};

export const PATH_KEYS: Readonly<Record<MatchedPath, MessageKey>> = {
	A: "loyalty.path.A",
	B: "loyalty.path.B",
	C: "loyalty.path.C",
	D: "loyalty.path.D",
	E: "loyalty.path.E",
};

export const REFUSAL_KEYS: Readonly<Record<LoyaltyRefusalReason, MessageKey>> =
	{
		below_minimum: "loyalty.refusal.below_minimum",
		daily_cap: "loyalty.refusal.daily_cap",
		excluded_phone: "loyalty.refusal.excluded_phone",
		excluded_source: "loyalty.refusal.excluded_source",
		already_earned: "loyalty.refusal.already_earned",
		invoice_not_completed: "loyalty.refusal.invoice_not_completed",
		programme_inactive: "loyalty.refusal.programme_inactive",
		membership_inactive: "loyalty.refusal.membership_inactive",
		staff_mode: "loyalty.refusal.staff_mode",
	};

export const QUEUE_REASON_KEYS: Readonly<Record<QueueReason, MessageKey>> = {
	two_candidates: "loyalty.queue.reason.two_candidates",
	duplicate_receipt: "loyalty.queue.reason.duplicate_receipt",
};

export const RECONCILIATION_REASON_KEYS: Readonly<
	Record<ReconciliationReason, MessageKey>
> = {
	verified_without_invoice:
		"loyalty.reconciliation.reason.verified_without_invoice",
	discount_without_redemption:
		"loyalty.reconciliation.reason.discount_without_redemption",
	amount_mismatch: "loyalty.reconciliation.reason.amount_mismatch",
	confirmed_invoice_voided:
		"loyalty.reconciliation.reason.confirmed_invoice_voided",
	other: "loyalty.reconciliation.reason.other",
};

export const QUEUE_STATE_KEYS: Readonly<Record<QueueState, MessageKey>> = {
	open: "loyalty.queue.state.open",
	resolved: "loyalty.queue.state.resolved",
	dismissed: "loyalty.queue.state.dismissed",
};

const LEDGER_REASON_KEYS: Readonly<Record<string, MessageKey>> = {
	welcome: "loyalty.reason.welcome",
	invoice_voided: "loyalty.reason.invoice_voided",
	invoice_edited: "loyalty.reason.invoice_edited",
	dismissed: "loyalty.reason.dismissed",
	...REFUSAL_KEYS,
};

function reasonCodeText(t: Translate, reason: string): string {
	const key = LEDGER_REASON_KEYS[reason];
	return key === undefined ? reason : t(key);
}

function shortfallText(
	t: Translate,
	count: (value: number) => string,
	short: Amounts,
): string {
	const stamps = t(
		short.stamps === 1 ? "loyalty.shortfall.stamp" : "loyalty.shortfall.stamps",
		{ count: count(short.stamps) },
	);
	const points = t(
		short.points === 1 ? "loyalty.shortfall.point" : "loyalty.shortfall.points",
		{ count: count(short.points) },
	);
	if (short.stamps > 0 && short.points > 0) {
		return t("loyalty.shortfall.both", { stamps, points });
	}
	return short.stamps > 0 ? stamps : points;
}

/**
 * A ledger row's reason in words: a known code translated, and a capped
 * clawback's "short by n" (ADR-046) read back and worded, so a manager sees what
 * the programme wrote off. Anything else, a manager's own words included, is
 * shown as it is.
 */
export function reasonText(
	t: Translate,
	reason: string | null,
	count: (value: number) => string = String,
): string | null {
	if (reason === null) return null;
	const clawback = parseClawbackReason(reason);
	if (clawback === null) return reasonCodeText(t, reason);
	return t("loyalty.reason.shortfall", {
		reason: reasonCodeText(t, clawback.reason),
		short: shortfallText(t, count, clawback.short),
	});
}

/** A phone as the database masked it; never unmasked in the browser. */
export function phoneText(t: Translate, masked: string | null): string {
	return masked ?? t("loyalty.phone.none");
}

/** The lookup result: the full phone the database gave an owner, else the masked one. */
export function lookupPhoneText(t: Translate, member: MemberRow): string {
	if (member.phoneFull !== null) {
		return formatFullPhone(member.phoneFull) ?? member.phoneFull;
	}
	return phoneText(t, member.phoneMasked);
}

export interface StoreName {
	readonly id: string;
	readonly name: string;
}

export function storeName(
	t: Translate,
	stores: readonly StoreName[],
	storeId: string | null,
): string {
	if (storeId === null) return t("loyalty.store.none");
	return (
		stores.find((store) => store.id === storeId)?.name ??
		t("loyalty.store.other")
	);
}

export interface TableContext {
	readonly t: Translate;
	readonly formatters: Formatters;
	readonly timeZone: string;
	readonly stores: readonly StoreName[];
}

export function momentText(
	formatters: Formatters,
	timeZone: string,
	iso: string | null,
): string | null {
	if (iso === null) return null;
	const instant = new Date(iso);
	return `${formatters.date(todayIn(timeZone, instant))} ${formatters.time(instant)}`;
}

export function memberColumns(t: Translate): TableColumn[] {
	return [
		{ key: "phone", label: t("loyalty.column.phone"), kind: "text" },
		{ key: "joined", label: t("loyalty.column.joined"), kind: "date" },
		{ key: "status", label: t("loyalty.column.status"), kind: "text" },
		{ key: "stamps", label: t("loyalty.column.stamps"), kind: "count" },
		{ key: "points", label: t("loyalty.column.points"), kind: "count" },
		{ key: "pending", label: t("loyalty.column.pending"), kind: "count" },
		{ key: "lastVisit", label: t("loyalty.column.lastVisit"), kind: "date" },
	];
}

export function memberTableRows(
	members: readonly MemberRow[],
	context: TableContext,
): TableRow[] {
	return members.map((member) => ({
		id: member.membershipId,
		cells: {
			phone: phoneText(context.t, member.phoneMasked),
			joined: todayIn(context.timeZone, new Date(member.joinedAt)),
			status: context.t(MEMBERSHIP_STATUS_KEYS[member.status]),
			stamps: member.balance.stamps,
			points: member.balance.points,
			pending: member.balance.pendingStamps + member.balance.pendingPoints,
			lastVisit: member.balance.lastVisit,
		},
	}));
}

export function invoiceText(
	t: Translate,
	formatters: Formatters,
	invoice: InvoiceReference | null,
): string | null {
	if (invoice === null) return null;
	return t("loyalty.invoice.reference", {
		receipt: invoice.receiptNo ?? invoice.externalId,
		date: formatters.date(invoice.businessDate),
	});
}

export function entryState(
	t: Translate,
	entry: LedgerEntryRow,
	entries: readonly LedgerEntryRow[],
): string | null {
	if (entry.entryKind === "earn") {
		const clawed = entries.some(
			(other) =>
				other.entryKind === "clawback" && other.sourceEntryId === entry.id,
		);
		if (clawed) return t("loyalty.entryState.clawedBack");
		if (!entry.pending) return null;
		const confirmed = entries.some(
			(other) =>
				other.entryKind === "confirm" && other.sourceEntryId === entry.id,
		);
		return t(
			confirmed ? "loyalty.entryState.confirmed" : "loyalty.entryState.pending",
		);
	}
	return entry.pending ? t("loyalty.entryState.pending") : null;
}

export function ledgerInOrder(
	entries: readonly LedgerEntryRow[],
): LedgerEntryRow[] {
	return [...entries].sort((left, right) =>
		left.occurredAt === right.occurredAt
			? right.id.localeCompare(left.id)
			: right.occurredAt.localeCompare(left.occurredAt),
	);
}

export function ledgerTable(
	entries: readonly LedgerEntryRow[],
	context: TableContext,
): TableSpec {
	const { t, formatters, timeZone } = context;
	return {
		caption: t("loyalty.ledger.caption"),
		columns: [
			{ key: "when", label: t("loyalty.column.when"), kind: "text" },
			{ key: "kind", label: t("loyalty.column.kind"), kind: "text" },
			{ key: "stamps", label: t("loyalty.column.stampDelta"), kind: "count" },
			{ key: "points", label: t("loyalty.column.pointDelta"), kind: "count" },
			{ key: "value", label: t("loyalty.column.value"), kind: "money" },
			{ key: "path", label: t("loyalty.column.path"), kind: "text" },
			{ key: "invoice", label: t("loyalty.column.invoice"), kind: "text" },
			{ key: "store", label: t("loyalty.column.store"), kind: "text" },
			{ key: "reason", label: t("loyalty.column.reason"), kind: "text" },
			{ key: "state", label: t("loyalty.column.state"), kind: "text" },
		],
		rows: ledgerInOrder(entries).map((entry) => ({
			id: entry.id,
			cells: {
				when: momentText(formatters, timeZone, entry.occurredAt),
				kind: t(ENTRY_KIND_KEYS[entry.entryKind]),
				stamps: entry.stampDelta,
				points: entry.pointDelta,
				value: entry.valueAmount,
				path:
					entry.matchedPath === null ? null : t(PATH_KEYS[entry.matchedPath]),
				invoice: invoiceText(t, formatters, entry.invoice),
				store: storeName(t, context.stores, entry.storeId),
				reason: reasonText(t, entry.reason, formatters.count),
				state: entryState(t, entry, entries),
			},
		})),
	};
}

export function openQueueItems(items: readonly QueueItemRow[]): QueueItemRow[] {
	return items
		.filter((item) => item.state === "open")
		.sort((left, right) =>
			left.createdAt === right.createdAt
				? left.id.localeCompare(right.id)
				: left.createdAt.localeCompare(right.createdAt),
		);
}

/** The open path D items, oldest first. */
export function openReconciliationItems(
	items: readonly ReconciliationItemRow[],
): ReconciliationItemRow[] {
	return items
		.filter((item) => item.state === "open")
		.sort((left, right) =>
			left.createdAt === right.createdAt
				? left.id.localeCompare(right.id)
				: left.createdAt.localeCompare(right.createdAt),
		);
}

/** The path D items that are no longer open, latest first. */
export function closedReconciliationItems(
	items: readonly ReconciliationItemRow[],
): ReconciliationItemRow[] {
	return items
		.filter((item) => item.state !== "open")
		.sort((left, right) =>
			(right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? ""),
		);
}

export function closedQueueItems(
	items: readonly QueueItemRow[],
): QueueItemRow[] {
	return items
		.filter((item) => item.state !== "open")
		.sort((left, right) =>
			(right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? ""),
		);
}

export function candidatesInOrder(item: QueueItemRow): InvoiceReference[] {
	return [...item.candidates].sort((left, right) =>
		left.soldAt === right.soldAt
			? left.externalId.localeCompare(right.externalId)
			: left.soldAt.localeCompare(right.soldAt),
	);
}

export const RESOLUTION_REASON_MAX = 200;

export type ResolutionIssue =
	| "reasonRequired"
	| "reasonTooLong"
	| "choiceRequired";

export function resolutionIssue(
	choice: string | null,
	reason: string,
	dismiss: boolean,
): ResolutionIssue | null {
	const trimmed = reason.trim();
	if (!dismiss && choice === null) return "choiceRequired";
	if (trimmed === "") return "reasonRequired";
	if ([...trimmed].length > RESOLUTION_REASON_MAX) return "reasonTooLong";
	return null;
}

export function queueHistoryTable(
	items: readonly QueueItemRow[],
	context: TableContext,
): TableSpec {
	const { t, formatters, timeZone } = context;
	return {
		caption: t("loyalty.queue.history.caption"),
		columns: [
			{ key: "created", label: t("loyalty.column.created"), kind: "text" },
			{ key: "store", label: t("loyalty.column.store"), kind: "text" },
			{ key: "phone", label: t("loyalty.column.phone"), kind: "text" },
			{ key: "path", label: t("loyalty.column.path"), kind: "text" },
			{ key: "reason", label: t("loyalty.column.queueReason"), kind: "text" },
			{ key: "state", label: t("loyalty.column.state"), kind: "text" },
			{ key: "chosen", label: t("loyalty.column.chosen"), kind: "text" },
			{ key: "note", label: t("loyalty.column.note"), kind: "text" },
			{ key: "resolved", label: t("loyalty.column.resolved"), kind: "text" },
		],
		rows: items.map((item) => ({
			id: item.id,
			cells: {
				created: momentText(formatters, timeZone, item.createdAt),
				store: storeName(t, context.stores, item.storeId),
				phone: phoneText(t, item.phoneMasked),
				path: t(PATH_KEYS[item.matchedPath]),
				reason: t(QUEUE_REASON_KEYS[item.reason]),
				state: t(QUEUE_STATE_KEYS[item.state]),
				chosen: invoiceText(
					t,
					formatters,
					item.candidates.find(
						(invoice) => invoice.id === item.chosenInvoiceId,
					) ?? null,
				),
				note: item.resolutionReason,
				resolved: momentText(formatters, timeZone, item.resolvedAt),
			},
		})),
	};
}

export type RefusalCounts = Readonly<Record<LoyaltyRefusalReason, number>>;

export interface AnomalyRow {
	readonly key: string;
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly shiftNumber: number | null;
	readonly earns: number;
	readonly refusals: RefusalCounts;
	readonly refusalsTotal: number;
	readonly adjustments: number;
	readonly checkinsWithoutInvoice: number;
	readonly signals: number;
}

export const SIGNAL_FREE_REFUSALS: readonly LoyaltyRefusalReason[] = [
	"below_minimum",
	"staff_mode",
];

/** The rows of loyalty_shift_anomalies with every refusal reason and the signals to review. */
export function anomalyRows(anomalies: readonly ShiftAnomaly[]): AnomalyRow[] {
	return anomalies
		.map((anomaly): AnomalyRow => {
			const refusals = Object.fromEntries(
				LOYALTY_REFUSAL_REASONS.map((reason) => [
					reason,
					anomaly.refusals[reason] ?? 0,
				]),
			) as Record<LoyaltyRefusalReason, number>;
			const flagged = LOYALTY_REFUSAL_REASONS.filter(
				(reason) => !SIGNAL_FREE_REFUSALS.includes(reason),
			).reduce((total, reason) => total + refusals[reason], 0);
			return {
				key: `${anomaly.storeId}|${anomaly.businessDate}|${anomaly.shiftNumber ?? ""}`,
				storeId: anomaly.storeId,
				businessDate: anomaly.businessDate,
				shiftNumber: anomaly.shiftNumber,
				earns: anomaly.earns,
				refusals,
				refusalsTotal: anomaly.refusalsTotal,
				adjustments: anomaly.adjustments,
				checkinsWithoutInvoice: anomaly.checkinsWithoutInvoice,
				signals: flagged + anomaly.adjustments + anomaly.checkinsWithoutInvoice,
			};
		})
		.sort((left, right) => {
			if (left.businessDate !== right.businessDate) {
				return left.businessDate < right.businessDate ? 1 : -1;
			}
			if (left.storeId !== right.storeId)
				return left.storeId < right.storeId ? -1 : 1;
			return (
				(left.shiftNumber ?? Number.MAX_SAFE_INTEGER) -
				(right.shiftNumber ?? Number.MAX_SAFE_INTEGER)
			);
		});
}

export interface AnomalySummary {
	readonly shifts: number;
	readonly earns: number;
	readonly refusals: number;
	readonly adjustments: number;
	readonly checkinsWithoutInvoice: number;
	readonly flagged: number;
}

export function anomalySummary(rows: readonly AnomalyRow[]): AnomalySummary {
	return rows.reduce<AnomalySummary>(
		(total, row) => ({
			shifts: total.shifts + 1,
			earns: total.earns + row.earns,
			refusals: total.refusals + row.refusalsTotal,
			adjustments: total.adjustments + row.adjustments,
			checkinsWithoutInvoice:
				total.checkinsWithoutInvoice + row.checkinsWithoutInvoice,
			flagged: total.flagged + (row.signals > 0 ? 1 : 0),
		}),
		{
			shifts: 0,
			earns: 0,
			refusals: 0,
			adjustments: 0,
			checkinsWithoutInvoice: 0,
			flagged: 0,
		},
	);
}

export function shiftText(t: Translate, shiftNumber: number | null): string {
	return shiftNumber === null
		? t("loyalty.shift.none")
		: t("loyalty.shift", { number: shiftNumber });
}

export function anomalyTable(
	rows: readonly AnomalyRow[],
	context: TableContext,
): TableSpec {
	const { t } = context;
	const reasons = LOYALTY_REFUSAL_REASONS.filter((reason) =>
		rows.some((row) => row.refusals[reason] > 0),
	);
	return {
		caption: t("loyalty.anomalies.caption"),
		columns: [
			{ key: "store", label: t("loyalty.column.store"), kind: "text" },
			{ key: "date", label: t("loyalty.column.date"), kind: "date" },
			{ key: "shift", label: t("loyalty.column.shift"), kind: "text" },
			{ key: "earns", label: t("loyalty.column.earns"), kind: "count" },
			{ key: "refusals", label: t("loyalty.column.refusals"), kind: "count" },
			...reasons.map(
				(reason): TableColumn => ({
					key: `refusal_${reason}`,
					label: t(REFUSAL_KEYS[reason]),
					kind: "count",
				}),
			),
			{
				key: "adjustments",
				label: t("loyalty.column.adjustments"),
				kind: "count",
			},
			{
				key: "checkins",
				label: t("loyalty.column.checkinsWithoutInvoice"),
				kind: "count",
			},
			{ key: "signals", label: t("loyalty.column.signals"), kind: "count" },
		],
		rows: rows.map((row) => ({
			id: row.key,
			cells: {
				store: storeName(t, context.stores, row.storeId),
				date: row.businessDate,
				shift: shiftText(t, row.shiftNumber),
				earns: row.earns,
				refusals: row.refusalsTotal,
				...Object.fromEntries(
					reasons.map((reason) => [`refusal_${reason}`, row.refusals[reason]]),
				),
				adjustments: row.adjustments,
				checkins: row.checkinsWithoutInvoice,
				signals: row.signals,
			},
		})),
		initialSort: { key: "signals", direction: "descending" },
	};
}

export function loyaltyCsvName(...parts: readonly string[]): string {
	return `${parts
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")}.csv`;
}
