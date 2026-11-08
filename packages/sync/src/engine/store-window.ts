import { windowDates } from "@fnb/connector-core";
import { adjustmentEvents, eventKey } from "../mapping/event.js";
import { buildEventIndex } from "../plan/event-index.js";
import { hasWrites, plannedCounts, planStoreDay } from "../plan/store-day.js";
import type {
	ExistingInvoice,
	InvoiceEventRow,
	SaleWrite,
	StatusChange,
	StoreRecord,
	TableCounts,
} from "../rows.js";
import { adjustmentStatusChanges } from "./adjustment-status.js";
import { addCounts } from "./counts.js";
import {
	currentBusinessDate,
	groupExisting,
	inspectDay,
	salesByDate,
} from "./day-buckets.js";
import {
	confirmsEmptyDay,
	controlCounts,
	projectedTotals,
} from "./day-totals.js";
import { type PulledData, pullStoreWindow } from "./pull.js";
import { writeShifts } from "./shift-cash.js";
import { recheckDates, writeChecks } from "./store-checks.js";
import type { StoreScope, StoreWindowContext } from "./store-window-context.js";
import type { StoreWindowSummary } from "./types.js";

export type { StoreWindowContext } from "./store-window-context.js";

function emptySummary(store: StoreRecord): StoreWindowSummary {
	return {
		storeId: store.id,
		externalId: store.external_id,
		name: store.name,
		pulledSales: 0,
		inserted: 0,
		updated: 0,
		statusChanged: 0,
		unchanged: 0,
		voided: 0,
		edited: 0,
		voidsSkipped: 0,
		movedOutOfWindow: 0,
		newAdjustmentEvents: 0,
		shifts: 0,
		touchedDates: [],
		checks: { available: false, matched: 0, unmatched: 0, rows: [] },
	};
}

function recorder(context: StoreWindowContext) {
	return async (
		planned: TableCounts,
		apply: () => Promise<TableCounts>,
	): Promise<void> => {
		addCounts(context.tables, context.dryRun ? planned : await apply());
	};
}

function supersededIds(pulled: PulledData): Set<string> {
	return new Set(
		pulled.adjustments
			.filter((adjustment) => adjustment.kind === "edited")
			.flatMap((adjustment) =>
				adjustment.relatedSaleExternalId
					? [adjustment.relatedSaleExternalId]
					: [],
			),
	);
}

function redatedDates(
	byDate: ReadonlyMap<string, readonly SaleWrite[]>,
	existingById: ReadonlyMap<string, ExistingInvoice>,
	inWindow: ReadonlySet<string>,
): string[] {
	return [...byDate.values()].flatMap((sales) =>
		sales.flatMap((sale) => {
			const existing = existingById.get(sale.invoice.external_id);
			return existing && !inWindow.has(existing.business_date)
				? [existing.business_date]
				: [];
		}),
	);
}

function adjustedDates(
	changes: readonly StatusChange[],
	newEvents: readonly InvoiceEventRow[],
	existingById: ReadonlyMap<string, ExistingInvoice>,
	inWindow: ReadonlySet<string>,
): string[] {
	const changed = changes.flatMap((change) => {
		const existing = existingById.get(change.external_id);
		return existing && change.from.includes(existing.status) ? [existing] : [];
	});
	const reported = newEvents.flatMap((event) => {
		const existing = existingById.get(event.invoice_external_id);
		return existing ? [existing] : [];
	});
	return [...changed, ...reported]
		.map((invoice) => invoice.business_date)
		.filter((date) => !inWindow.has(date));
}

async function syncLockedStoreWindow(
	context: StoreWindowContext,
	store: StoreRecord,
): Promise<StoreWindowSummary> {
	const { repository, window } = context;
	const scope: StoreScope = {
		context,
		store,
		capabilities: context.connector.describe().capabilities,
		dates: windowDates(window),
	};
	const record = recorder(context);
	const inWindow = new Set(scope.dates);
	const range = { from: window.fromDate, to: window.toDate };
	const pulled = await pullStoreWindow(scope);
	const byDate = salesByDate(scope, pulled.sales);
	for (const sales of byDate.values()) {
		inspectDay(scope, sales);
	}

	const reported = adjustmentEvents(pulled.adjustments, {
		tenantId: store.tenant_id,
		storeId: store.id,
	});
	context.flags.add("adjustment_repeated", "info", reported.repeated);
	context.flags.add("adjustments_merged", "info", reported.merged);
	const superseded = supersededIds(pulled);
	const incomingIds = new Set(
		[...byDate.values()].flatMap((sales) =>
			sales.map((sale) => sale.invoice.external_id),
		),
	);
	const referenced = [
		...new Set([
			...incomingIds,
			...reported.events.map((event) => event.invoice_external_id),
			...superseded,
		]),
	].sort();
	const state = await repository.loadStoreWindow(store.id, range, referenced);
	const existingById = new Map(
		state.invoices.map((invoice) => [invoice.external_id, invoice]),
	);
	const existingByDate = groupExisting(state.invoices);
	const knownEventKeys = new Set(state.events.map(eventKey));
	const newReportEvents = reported.events.filter(
		(event) => !knownEventKeys.has(eventKey(event)),
	);
	const events = buildEventIndex(state.events, reported.events);
	const counts = controlCounts(pulled.controlTotals);
	const movedOutOfWindow = (existing: ExistingInvoice): boolean =>
		!inWindow.has(currentBusinessDate(scope, existing));

	const summary = emptySummary(store);
	summary.pulledSales = incomingIds.size;
	summary.newAdjustmentEvents = newReportEvents.length;
	const touched = new Set(redatedDates(byDate, existingById, inWindow));

	for (const date of scope.dates) {
		const incoming = byDate.get(date) ?? [];
		const plan = planStoreDay({
			tenantId: store.tenant_id,
			storeId: store.id,
			businessDate: date,
			incoming,
			existingById,
			existingOnDate: existingByDate.get(date) ?? [],
			incomingIds,
			events,
			supersededIds: superseded,
			allowVoids: incoming.length > 0 || confirmsEmptyDay(counts, date),
			movedOutOfWindow,
			detectedAt: context.detectedAt,
		});
		summary.inserted += plan.stats.inserted;
		summary.updated += plan.stats.updated;
		summary.statusChanged += plan.stats.statusChanged;
		summary.unchanged += plan.stats.unchanged;
		summary.voided += plan.stats.voided;
		summary.edited += plan.stats.edited;
		summary.voidsSkipped += plan.stats.voidsSkipped;
		summary.movedOutOfWindow += plan.stats.movedOutOfWindow;
		if (plan.stats.voidsSkipped > 0) {
			context.flags.add("empty_day_kept", "warn");
		}
		context.flags.add(
			"business_date_moved_out_of_window",
			"warn",
			plan.stats.movedOutOfWindow,
		);
		if (hasWrites(plan)) {
			await record(plannedCounts(plan), () =>
				repository.applyStoreDay(plan.write),
			);
		}
	}

	if (reported.events.length > 0) {
		const statusChanges = adjustmentStatusChanges(reported.events);
		for (const date of adjustedDates(
			statusChanges,
			newReportEvents,
			existingById,
			inWindow,
		)) {
			touched.add(date);
		}
		await record({ invoice_events: newReportEvents.length }, () =>
			repository.applyAdjustments({
				tenant_id: store.tenant_id,
				store_id: store.id,
				events: reported.events,
				status_changes: statusChanges,
			}),
		);
	}

	if (pulled.shifts) {
		summary.shifts = await writeShifts(
			scope,
			pulled.shifts,
			pulled.sales,
			record,
		);
	}

	summary.touchedDates = [...touched].sort();
	if (pulled.controlTotals) {
		const local = context.dryRun
			? projectedTotals(byDate)
			: await repository.localDayTotals(store.id, range);
		const rows = await writeChecks(
			scope,
			scope.dates,
			pulled.controlTotals,
			local,
			record,
		);
		if (!context.dryRun) {
			rows.push(...(await recheckDates(scope, summary.touchedDates, record)));
		}
		const matched = rows.filter((row) => row.is_matched).length;
		summary.checks = {
			available: true,
			matched,
			unmatched: rows.length - matched,
			rows,
		};
	}

	return summary;
}

export function syncStoreWindow(
	context: StoreWindowContext,
	store: StoreRecord,
): Promise<StoreWindowSummary> {
	return context.repository.withStoreLock(store.id, () =>
		syncLockedStoreWindow(context, store),
	);
}
