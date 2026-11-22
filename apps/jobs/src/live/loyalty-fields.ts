// G-11 (docs/test-gaps.md): what the synced POS data actually carries for
// loyalty, store by store. This module is the pure half of the check: it takes
// counts and dates that the reader (loyalty-fields-queries.ts) aggregated in SQL
// and turns them into shares, booleans and one line per store. It never sees a
// phone, a customer id, a voucher code, a discount name or a store name, so it
// cannot print one: stores are labelled store-1, store-2 (ordinal by id) and a
// store's mapped discount entries entry-1, entry-2.

export type IsoDate = string;

export const WINDOW_BUSINESS_DAYS = 30;
// A mapped discount entry that has not appeared for this many days, on a store
// whose rail uses it, fails the check: 13 days quiet passes, 14 fails.
export const ENTRY_QUIET_LIMIT_DAYS = 14;

const RAILS = [
	"pos_payment_discount",
	"crm_code_pool",
	"crm_callback",
] as const;
const DISCOUNT_RAIL = "pos_payment_discount";

export type RailLabel = (typeof RAILS)[number] | "none" | "other";

export interface StoreCounts {
	// Kept in memory only to order and join; never printed.
	readonly storeId: string;
	// The store's current rail as the database names it, or null without one.
	readonly rail: string | null;
	// Non-voided invoices of the window, and how many carry each field.
	readonly invoices: number;
	readonly voided: number;
	readonly withPhone: number;
	readonly withCustomerId: number;
	readonly withVoucherCode: number;
	readonly withMappedDiscountEntry: number;
	readonly withZeroPricePromoLine: number;
	readonly receiptMissing: number;
	// (store, business day, receipt number) groups held by more than one invoice.
	readonly receiptDuplicateGroups: number;
}

export interface RailEntry {
	readonly storeId: string;
	// The business day the store's current rail began.
	readonly railFrom: IsoDate;
	// The latest business day of the window on which an invoice carried the
	// entry's name, or null when none did.
	readonly lastSeen: IsoDate | null;
}

export interface LoyaltyFieldsInput {
	// The latest business day of any invoice in scope (the data's own today).
	readonly asOf: IsoDate;
	readonly asOfDaysAgo: number;
	readonly stores: readonly StoreCounts[];
	readonly entries: readonly RailEntry[];
}

export interface StoreLine {
	readonly store: string;
	readonly rail: RailLabel;
	readonly invoices: number;
	readonly voided: number;
	readonly with_phone: number;
	readonly with_phone_pct: number;
	readonly with_customer_id: number;
	readonly with_customer_id_pct: number;
	readonly with_voucher_code: number;
	readonly with_voucher_code_pct: number;
	readonly with_discount_entry: number;
	readonly with_discount_entry_pct: number;
	readonly with_zero_price_line: number;
	readonly with_zero_price_line_pct: number;
	readonly receipt_missing: number;
	readonly receipt_duplicate_groups: number;
	readonly receipt_numbers_unique: boolean;
	readonly rail_entries: number;
	readonly stale_entries: number;
}

export interface EntryLine {
	readonly store: string;
	readonly entry: string;
	readonly quiet_days: number;
	readonly seen_in_window: boolean;
	readonly stale: boolean;
}

export type FailureReason = "no_store_in_scope" | "stale_entry";

export interface Evaluation {
	readonly asOfDaysAgo: number;
	readonly stores: readonly StoreLine[];
	readonly entries: readonly EntryLine[];
	readonly pass: boolean;
	readonly reason: FailureReason | null;
	readonly receiptNumbersUnique: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(date: IsoDate): number {
	const match = ISO_DATE.exec(date);
	if (match === null) {
		throw new Error("a business date must be written yyyy-mm-dd");
	}
	const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
		number,
		number,
		number,
	];
	const time = Date.UTC(year, month - 1, day);
	const parsed = new Date(time);
	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		throw new Error("a business date must be a real calendar day");
	}
	return time / 86_400_000;
}

// Whole days from one business day to a later one (negative when it is earlier).
export function daysBetween(from: IsoDate, to: IsoDate): number {
	return dayNumber(to) - dayNumber(from);
}

// A share of a total as a percentage with one decimal; an empty total is 0.
export function percentOf(part: number, total: number): number {
	if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
		return 0;
	}
	return Math.round((part * 1000) / total) / 10;
}

// How long an entry has been quiet: the clock starts at the later of its last
// sighting and the day the rail began, because an entry cannot appear under a
// rail that did not exist yet. Never seen counts from the rail's first day.
export function quietDays(entry: RailEntry, asOf: IsoDate): number {
	const start =
		entry.lastSeen !== null && entry.lastSeen > entry.railFrom
			? entry.lastSeen
			: entry.railFrom;
	return daysBetween(start, asOf);
}

export function isStale(
	quiet: number,
	limit: number = ENTRY_QUIET_LIMIT_DAYS,
): boolean {
	return quiet >= limit;
}

function railLabel(rail: string | null): RailLabel {
	if (rail === null) return "none";
	return (RAILS as readonly string[]).includes(rail)
		? (rail as RailLabel)
		: "other";
}

export function evaluate(input: LoyaltyFieldsInput): Evaluation {
	const sorted = [...input.stores].sort((left, right) =>
		left.storeId < right.storeId ? -1 : left.storeId > right.storeId ? 1 : 0,
	);
	const labels = new Map(
		sorted.map((store, index) => [store.storeId, `store-${index + 1}`]),
	);
	const entryLines: EntryLine[] = [];
	const rails = new Map(sorted.map((store) => [store.storeId, store.rail]));
	const entryCount = new Map<string, number>();
	const staleCount = new Map<string, number>();
	for (const entry of input.entries) {
		const label = labels.get(entry.storeId);
		if (label === undefined) {
			throw new Error("a mapped entry belongs to a store outside the scope");
		}
		const ordinal = (entryCount.get(entry.storeId) ?? 0) + 1;
		entryCount.set(entry.storeId, ordinal);
		// Only a store whose rail uses discount entries can fail on one.
		if (rails.get(entry.storeId) !== DISCOUNT_RAIL) continue;
		const quiet = quietDays(entry, input.asOf);
		const stale = isStale(quiet);
		if (stale) {
			staleCount.set(entry.storeId, (staleCount.get(entry.storeId) ?? 0) + 1);
		}
		entryLines.push({
			store: label,
			entry: `entry-${ordinal}`,
			quiet_days: quiet,
			seen_in_window: entry.lastSeen !== null,
			stale,
		});
	}
	const storeLines = sorted.map((store): StoreLine => {
		const count = (value: number) => ({
			value,
			pct: percentOf(value, store.invoices),
		});
		const phone = count(store.withPhone);
		const customer = count(store.withCustomerId);
		const voucher = count(store.withVoucherCode);
		const entry = count(store.withMappedDiscountEntry);
		const zero = count(store.withZeroPricePromoLine);
		return {
			store: labels.get(store.storeId) ?? "store-0",
			rail: railLabel(store.rail),
			invoices: store.invoices,
			voided: store.voided,
			with_phone: phone.value,
			with_phone_pct: phone.pct,
			with_customer_id: customer.value,
			with_customer_id_pct: customer.pct,
			with_voucher_code: voucher.value,
			with_voucher_code_pct: voucher.pct,
			with_discount_entry: entry.value,
			with_discount_entry_pct: entry.pct,
			with_zero_price_line: zero.value,
			with_zero_price_line_pct: zero.pct,
			receipt_missing: store.receiptMissing,
			receipt_duplicate_groups: store.receiptDuplicateGroups,
			receipt_numbers_unique: store.receiptDuplicateGroups === 0,
			rail_entries: entryLines.filter(
				(line) => line.store === labels.get(store.storeId),
			).length,
			stale_entries: staleCount.get(store.storeId) ?? 0,
		};
	});
	const stale = entryLines.filter((line) => line.stale).length;
	const reason: FailureReason | null =
		storeLines.length === 0
			? "no_store_in_scope"
			: stale > 0
				? "stale_entry"
				: null;
	return {
		asOfDaysAgo: input.asOfDaysAgo,
		stores: storeLines,
		entries: entryLines,
		pass: reason === null,
		reason,
		receiptNumbersUnique: storeLines.every(
			(line) => line.receipt_numbers_unique,
		),
	};
}

const CHECK = "loyalty-fields";

// One JSON object per line, like the live checks of @fnb/reports.
export function renderReport(evaluation: Evaluation): string[] {
	const line = (facts: object) => JSON.stringify({ check: CHECK, ...facts });
	return [
		line({
			window_business_days: WINDOW_BUSINESS_DAYS,
			entry_quiet_limit_days: ENTRY_QUIET_LIMIT_DAYS,
			stores: evaluation.stores.length,
			as_of_days_ago: evaluation.asOfDaysAgo,
		}),
		...evaluation.stores.map((store) => line(store)),
		...evaluation.entries.map((entry) => line(entry)),
		line({
			result: evaluation.pass ? "pass" : "fail",
			...(evaluation.reason === null ? {} : { reason: evaluation.reason }),
			stores: evaluation.stores.length,
			rail_entries_checked: evaluation.entries.length,
			stale_entries: evaluation.entries.filter((entry) => entry.stale).length,
			receipt_numbers_unique: evaluation.receiptNumbersUnique,
		}),
	];
}

// The last line of defence: a report is refused when any line looks like a
// phone (a 0 and nine digits, or +84), a uuid or an e-mail address.
const IDENTIFIER_SHAPES: readonly RegExp[] = [
	/0\d{9}/,
	/\+84\d/,
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
	/[^\s"@]+@[^\s"@]+\.[A-Za-z]{2,}/,
];

export function looksLikeIdentifier(text: string): boolean {
	return IDENTIFIER_SHAPES.some((shape) => shape.test(text));
}

export function assertNoIdentifiers(lines: readonly string[]): void {
	if (lines.some(looksLikeIdentifier)) {
		throw Object.assign(
			new Error(
				"the report would carry something that looks like an identifier",
			),
			{ code: "IDENTIFIER_SHAPE" },
		);
	}
}
