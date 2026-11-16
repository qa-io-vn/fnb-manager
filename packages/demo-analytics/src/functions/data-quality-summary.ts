import { addDays, type IsoDate, type ThemeRow } from "@fnb/reports";
import type { DemoStoreDefinition } from "../calendar.js";
import { PgDecimal } from "../pg-numeric.js";
import { demoItemCatalogue } from "./catalogue.js";
import { openingHoursPresent } from "./opening-hours.js";
import {
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const DATA_QUALITY_SUMMARY_MAX_DAYS = 400;
export const RECEIPT_LOOKBACK_DAYS = 120;

const MIN_RECEIPT_DAYS = 20;
const RESTART_SHARE = PgDecimal.parse("0.9");
const RESTART_MAX_NUMBER = 3n;
const SHIFT_WINDOW_DAYS_BEFORE = 2;
const EVENT_DAYS_AFTER = 1;
const DAY_MS = 86_400_000;

type Row = ThemeRow<"data_quality_summary">;

interface Counts {
	invoices: number;
	items: number;
	modifiers: number;
	catalogueModifiers: number;
	identified: number;
	unattributed: number;
}

function emptyCounts(): Counts {
	return {
		invoices: 0,
		items: 0,
		modifiers: 0,
		catalogueModifiers: 0,
		identified: 0,
		unattributed: 0,
	};
}

function ratio(part: number, whole: number): number | null {
	if (whole <= 0) return null;
	return PgDecimal.integer(part)
		.div(PgDecimal.integer(whole))
		.round(6)
		.toNumber();
}

function shared(counts: Counts) {
	return {
		invoices: counts.invoices,
		item_lines: counts.items,
		modifier_lines: counts.modifiers,
		modifier_line_share: ratio(
			counts.modifiers,
			counts.items + counts.modifiers,
		),
		catalogue_modifier_lines: counts.catalogueModifiers,
		identified_invoices: counts.identified,
		capture_rate: ratio(counts.identified, counts.invoices),
		identified_customers: 0,
		loyalty_consents: 0,
		marketing_consents: 0,
		consent_coverage: null,
		unattributed_events: counts.unattributed,
	};
}

export const dataQualitySummary: ThemeHandler<"data_quality_summary"> = (
	store,
	args,
	context,
) => {
	requireThemeStoreIds("data_quality_summary", args.store_ids);
	requireThemeDateRange(
		"data_quality_summary",
		args.from_date,
		args.to_date,
		DATA_QUALITY_SUMMARY_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const mappings = store.mappings();
	const visible = store.visibleStores(args.store_ids);
	const receiptsFrom = addDays(args.to_date, -(RECEIPT_LOOKBACK_DAYS - 1));
	const windowsFrom = addDays(args.from_date, -SHIFT_WINDOW_DAYS_BEFORE);
	const readFrom = [windowsFrom, receiptsFrom].sort()[0] as IsoDate;
	const readTo = addDays(args.to_date, EVENT_DAYS_AFTER);
	const total = emptyCounts();
	const storeRows: Row[] = [];
	for (const definition of visible) {
		const counts = storeCounts(
			store,
			definition,
			args.from_date,
			args.to_date,
			{
				readFrom,
				readTo,
				windowsFrom,
				modifiers: demoItemCatalogue(mappings.accountOf(definition.id))
					?.modifiers,
			},
		);
		for (const key of Object.keys(total) as (keyof Counts)[]) {
			total[key] += counts.counts[key];
		}
		const profile = context.settings.storeProfile(definition.id);
		const receipts = receiptFacts(
			store,
			definition,
			receiptsFrom,
			args.to_date,
		);
		storeRows.push({
			store_id: definition.id,
			...shared(counts.counts),
			e_invoice_status: profile?.eInvoiceStatus ?? "unknown",
			tran_no_reset_period: profile?.tranNoResetPeriod ?? "unknown",
			member_capture_status: profile?.memberCaptureStatus ?? "unknown",
			opening_hours_known: openingHoursPresent(profile?.openingHours ?? null),
			seat_count: profile?.seatCount ?? null,
			opened_on: profile?.openedOn ?? null,
			receipt_days: receipts.days,
			receipt_restarts_daily: receipts.restarts,
		});
	}
	return [
		{
			store_id: null,
			...shared(total),
			e_invoice_status: null,
			tran_no_reset_period: null,
			member_capture_status: null,
			opening_hours_known: null,
			seat_count: null,
			opened_on: null,
			receipt_days: null,
			receipt_restarts_daily: null,
		},
		...storeRows,
	];
};

interface Bounds {
	readonly readFrom: IsoDate;
	readonly readTo: IsoDate;
	readonly windowsFrom: IsoDate;
	readonly modifiers: ReadonlySet<string> | undefined;
}

function storeCounts(
	store: Parameters<ThemeHandler<"data_quality_summary">>[0],
	definition: DemoStoreDefinition,
	from: IsoDate,
	to: IsoDate,
	bounds: Bounds,
): { counts: Counts } {
	const counts = emptyCounts();
	const windows: { from: number; to: number }[] = [];
	const shiftIds = new Set<string>();
	const days = store.daysOf(definition, bounds.readFrom, bounds.readTo);
	for (const day of days) {
		for (const shift of day.shifts) {
			shiftIds.add(shift.shiftExternalId);
			if (
				shift.businessDate >= bounds.windowsFrom &&
				shift.businessDate <= addDays(to, EVENT_DAYS_AFTER)
			) {
				const opened = Date.parse(shift.openedAt);
				windows.push({
					from: opened,
					to:
						shift.closedAt === null
							? opened + DAY_MS
							: Date.parse(shift.closedAt),
				});
			}
		}
		if (day.date < from || day.date > to) continue;
		counts.invoices += day.daily?.invoices ?? 0;
		counts.items += day.itemLines;
		counts.modifiers += day.daily?.modifierLines ?? 0;
		counts.identified += day.daily?.identifiedInvoices ?? 0;
		if (bounds.modifiers !== undefined) {
			for (const [key, lines] of day.itemLinesByExternalId) {
				if (bounds.modifiers.has(key)) counts.catalogueModifiers += lines;
			}
		}
	}
	for (const day of days) {
		for (const event of day.events) {
			if (event.businessDate < from || event.businessDate > to) continue;
			const at = Date.parse(event.occurredAt);
			const unattributed =
				event.saleExists && event.saleShiftExternalId !== null
					? !shiftIds.has(event.saleShiftExternalId)
					: !windows.some((window) => at >= window.from && at < window.to);
			if (unattributed) counts.unattributed += 1;
		}
	}
	return { counts };
}

function receiptFacts(
	store: Parameters<ThemeHandler<"data_quality_summary">>[0],
	definition: DemoStoreDefinition,
	from: IsoDate,
	to: IsoDate,
): { days: number | null; restarts: boolean | null } {
	let numeric = 0;
	let restarts = 0;
	for (const day of store.daysOf(definition, from, to)) {
		const receipts = day.receipts;
		if (receipts === null || !receipts.allDigits) continue;
		numeric += 1;
		if (receipts.smallest !== null && receipts.smallest <= RESTART_MAX_NUMBER) {
			restarts += 1;
		}
	}
	if (numeric < MIN_RECEIPT_DAYS) return { days: null, restarts: null };
	return {
		days: numeric,
		restarts:
			PgDecimal.integer(restarts).compare(
				RESTART_SHARE.mul(PgDecimal.integer(numeric)),
			) >= 0,
	};
}
