import {
	LOYALTY_REFUSAL_REASONS,
	type LoyaltyEntryKind,
	type LoyaltyRefusalReason,
	type MatchedPath,
} from "@fnb/core";
import type { IsoDate } from "@fnb/reports";
import type {
	TableColumn,
	TableRow,
	TableSpec,
} from "../components/report-card/types";
import type { MessageKey, Translate } from "../i18n";
import {
	businessDateOf,
	type StoreClock,
	todayIn,
} from "../lib/business-dates";
import type { Formatters } from "../lib/format";
import { formatFullPhone, maskPhone } from "./mask-phone";
import type {
	AnomalyInputs,
	InvoiceReference,
	LedgerEntryRow,
	MemberRow,
	MembershipStatus,
	QueueItemRow,
	QueueReason,
	QueueState,
	ShiftRow,
} from "./source";

export interface Balance {
	readonly stamps: number;
	readonly points: number;
	readonly pendingStamps: number;
	readonly pendingPoints: number;
	readonly lastVisit: IsoDate | null;
	readonly entries: number;
}

export const EMPTY_BALANCE: Balance = {
	stamps: 0,
	points: 0,
	pendingStamps: 0,
	pendingPoints: 0,
	lastVisit: null,
	entries: 0,
};

export function balanceOf(entries: readonly LedgerEntryRow[]): Balance {
	const confirmed = new Set(
		entries
			.filter((entry) => entry.entryKind === "confirm")
			.map((entry) => entry.sourceEntryId),
	);
	const openPending = new Set(
		entries
			.filter(
				(entry) =>
					entry.pending &&
					entry.entryKind === "earn" &&
					!confirmed.has(entry.id),
			)
			.map((entry) => entry.id),
	);
	let stamps = 0;
	let points = 0;
	let pendingStamps = 0;
	let pendingPoints = 0;
	let lastVisit: IsoDate | null = null;
	for (const entry of entries) {
		const pending =
			openPending.has(entry.id) ||
			(entry.sourceEntryId !== null && openPending.has(entry.sourceEntryId));
		if (pending) {
			pendingStamps += entry.stampDelta;
			pendingPoints += entry.pointDelta;
		} else {
			stamps += entry.stampDelta;
			points += entry.pointDelta;
		}
		const visit = entry.entryKind === "earn" ? entry.businessDate : null;
		if (visit !== null && (lastVisit === null || visit > lastVisit)) {
			lastVisit = visit;
		}
	}
	return {
		stamps,
		points,
		pendingStamps,
		pendingPoints,
		lastVisit,
		entries: entries.length,
	};
}

export function balancesByMember(
	entries: readonly LedgerEntryRow[],
): Map<string, Balance> {
	const grouped = new Map<string, LedgerEntryRow[]>();
	for (const entry of entries) {
		const list = grouped.get(entry.membershipId) ?? [];
		list.push(entry);
		grouped.set(entry.membershipId, list);
	}
	return new Map(
		[...grouped].map(([membershipId, list]) => [membershipId, balanceOf(list)]),
	);
}

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
	};

export const QUEUE_REASON_KEYS: Readonly<Record<QueueReason, MessageKey>> = {
	two_candidates: "loyalty.queue.reason.two_candidates",
	duplicate_receipt: "loyalty.queue.reason.duplicate_receipt",
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

export function reasonText(t: Translate, reason: string | null): string | null {
	if (reason === null) return null;
	const key = LEDGER_REASON_KEYS[reason];
	return key === undefined ? reason : t(key);
}

export function phoneText(
	t: Translate,
	phone: string | null,
	full = false,
): string {
	const shown = full ? formatFullPhone(phone) : maskPhone(phone);
	return shown ?? t("loyalty.phone.none");
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
	balances: ReadonlyMap<string, Balance>,
	context: TableContext,
): TableRow[] {
	return members.map((member) => {
		const balance = balances.get(member.membershipId) ?? EMPTY_BALANCE;
		return {
			id: member.membershipId,
			cells: {
				phone: phoneText(context.t, member.phone),
				joined: todayIn(context.timeZone, new Date(member.joinedAt)),
				status: context.t(MEMBERSHIP_STATUS_KEYS[member.status]),
				stamps: balance.stamps,
				points: balance.points,
				pending: balance.pendingStamps + balance.pendingPoints,
				lastVisit: balance.lastVisit,
			},
		};
	});
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
				reason: reasonText(t, entry.reason),
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
				phone: phoneText(t, item.phone),
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

export interface StoreShiftClock extends StoreClock {
	readonly id: string;
	readonly name: string;
}

export interface NumberedShift extends ShiftRow {
	readonly businessDate: IsoDate;
	readonly number: number;
}

export function numberedShifts(
	shifts: readonly ShiftRow[],
	stores: readonly StoreShiftClock[],
): NumberedShift[] {
	const groups = new Map<string, (ShiftRow & { businessDate: IsoDate })[]>();
	for (const shift of shifts) {
		const store = stores.find((entry) => entry.id === shift.storeId);
		if (store === undefined) continue;
		const businessDate = businessDateOf(new Date(shift.openedAt), store);
		const key = `${shift.storeId}|${businessDate}`;
		const list = groups.get(key) ?? [];
		list.push({ ...shift, businessDate });
		groups.set(key, list);
	}
	const numbered: NumberedShift[] = [];
	for (const list of groups.values()) {
		list.sort((left, right) => {
			const opened = Date.parse(left.openedAt) - Date.parse(right.openedAt);
			if (opened !== 0) return opened;
			return left.externalId < right.externalId
				? -1
				: left.externalId > right.externalId
					? 1
					: 0;
		});
		list.forEach((shift, index) => {
			numbered.push({ ...shift, number: index + 1 });
		});
	}
	return numbered;
}

function shiftAt(
	shifts: readonly NumberedShift[],
	storeId: string,
	at: string | null,
): NumberedShift | null {
	if (at === null) return null;
	const instant = Date.parse(at);
	let found: NumberedShift | null = null;
	for (const shift of shifts) {
		if (shift.storeId !== storeId) continue;
		const opened = Date.parse(shift.openedAt);
		const closed =
			shift.closedAt === null
				? Number.POSITIVE_INFINITY
				: Date.parse(shift.closedAt);
		if (instant < opened || instant > closed) continue;
		if (found === null || opened > Date.parse(found.openedAt)) found = shift;
	}
	return found;
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

interface MutableAnomaly {
	storeId: string;
	businessDate: IsoDate;
	shiftNumber: number | null;
	earns: number;
	refusals: Record<LoyaltyRefusalReason, number>;
	adjustments: number;
	checkinsWithoutInvoice: number;
}

function noRefusals(): Record<LoyaltyRefusalReason, number> {
	return Object.fromEntries(
		LOYALTY_REFUSAL_REASONS.map((reason) => [reason, 0]),
	) as Record<LoyaltyRefusalReason, number>;
}

export const SIGNAL_FREE_REFUSALS: readonly LoyaltyRefusalReason[] = [
	"below_minimum",
];

export function anomalyRows(
	inputs: AnomalyInputs,
	stores: readonly StoreShiftClock[],
	from: IsoDate,
	to: IsoDate,
): AnomalyRow[] {
	const shifts = numberedShifts(inputs.shifts, stores);
	const byExternal = new Map(
		shifts.map((shift) => [`${shift.storeId}|${shift.externalId}`, shift]),
	);
	const buckets = new Map<string, MutableAnomaly>();
	const bucket = (
		storeId: string,
		businessDate: IsoDate,
		shift: NumberedShift | null,
	): MutableAnomaly | null => {
		const date = shift?.businessDate ?? businessDate;
		if (date < from || date > to) return null;
		const number = shift?.number ?? null;
		const key = `${storeId}|${date}|${number ?? ""}`;
		let found = buckets.get(key);
		if (found === undefined) {
			found = {
				storeId,
				businessDate: date,
				shiftNumber: number,
				earns: 0,
				refusals: noRefusals(),
				adjustments: 0,
				checkinsWithoutInvoice: 0,
			};
			buckets.set(key, found);
		}
		return found;
	};
	const invoiceShift = (
		storeId: string,
		externalId: string | null,
		soldAt: string | null,
	) =>
		(externalId === null
			? undefined
			: byExternal.get(`${storeId}|${externalId}`)) ??
		shiftAt(shifts, storeId, soldAt);
	const clockOf = (storeId: string) =>
		stores.find((store) => store.id === storeId);
	for (const earn of inputs.earns) {
		const target = bucket(
			earn.storeId,
			earn.businessDate,
			invoiceShift(earn.storeId, earn.shiftExternalId, earn.soldAt),
		);
		if (target !== null) target.earns += 1;
	}
	for (const refusal of inputs.refusals) {
		const target = bucket(
			refusal.storeId,
			refusal.businessDate,
			invoiceShift(refusal.storeId, refusal.shiftExternalId, refusal.soldAt),
		);
		if (target !== null) target.refusals[refusal.reason] += 1;
	}
	const timed = (
		events: AnomalyInputs["adjustments"],
		add: (target: MutableAnomaly) => void,
	) => {
		for (const event of events) {
			const clock = clockOf(event.storeId);
			if (clock === undefined) continue;
			const target = bucket(
				event.storeId,
				businessDateOf(new Date(event.at), clock),
				shiftAt(shifts, event.storeId, event.at),
			);
			if (target !== null) add(target);
		}
	};
	timed(inputs.adjustments, (target) => {
		target.adjustments += 1;
	});
	timed(inputs.checkinsWithoutInvoice, (target) => {
		target.checkinsWithoutInvoice += 1;
	});
	return [...buckets.entries()]
		.map(([key, row]) => {
			const refusalsTotal = LOYALTY_REFUSAL_REASONS.reduce(
				(total, reason) => total + row.refusals[reason],
				0,
			);
			const flagged = LOYALTY_REFUSAL_REASONS.filter(
				(reason) => !SIGNAL_FREE_REFUSALS.includes(reason),
			).reduce((total, reason) => total + row.refusals[reason], 0);
			return {
				key,
				...row,
				refusalsTotal,
				signals: flagged + row.adjustments + row.checkinsWithoutInvoice,
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
