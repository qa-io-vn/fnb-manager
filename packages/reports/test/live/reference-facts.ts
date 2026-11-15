import type { AnalyticsRow, IsoDate, ThemeRow } from "../../src/index.js";
import { addDays, daysBetween, minDate } from "../../src/index.js";
import type { DateWindow, ValueRowKind } from "./reference-sheet.js";

export type ProfileRow = ThemeRow<"hour_profile">;
export type HeatmapRow = ThemeRow<"hour_weekday_heatmap">;
export type TotalsRow = ThemeRow<"range_totals">;
export type PaymentRow = AnalyticsRow<"payment_summary">;
export type ItemRow = AnalyticsRow<"item_summary">;

export interface WindowFacts {
	readonly invoices: number | null;
	readonly net: number | null;
	readonly hourNet: ReadonlyMap<number, number>;
	readonly weekdayNet: ReadonlyMap<number, number>;
	readonly payments: readonly PaymentRow[];
}

export interface WindowIdentities {
	readonly totalsAgree: boolean;
	readonly heatmapAgrees: boolean;
	readonly paymentSharesSumToOne: boolean;
}

export interface WindowInput {
	readonly profile: readonly ProfileRow[];
	readonly heatmap: readonly HeatmapRow[];
	readonly totals: TotalsRow | undefined;
	readonly payments: readonly PaymentRow[];
}

const MONEY_EPSILON = 0.5;
const SHARE_SUM_EPSILON = 1e-4;
const WEEKEND = [5, 6, 7] as const;
const SUNDAY = 7;

function summed<Row>(
	rows: readonly Row[],
	keyOf: (row: Row) => number | null,
	amountOf: (row: Row) => number,
): Map<number, number> {
	const totals = new Map<number, number>();
	for (const row of rows) {
		const key = keyOf(row);
		if (key === null) continue;
		totals.set(key, (totals.get(key) ?? 0) + amountOf(row));
	}
	return totals;
}

function sameAmounts(
	left: ReadonlyMap<number, number>,
	right: ReadonlyMap<number, number>,
): boolean {
	const keys = new Set([...left.keys(), ...right.keys()]);
	return [...keys].every(
		(key) =>
			Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0)) < MONEY_EPSILON,
	);
}

function total(values: Iterable<number>): number {
	let sum = 0;
	for (const value of values) sum += value;
	return sum;
}

export function windowFactsOf(input: WindowInput): {
	facts: WindowFacts;
	identities: WindowIdentities;
} {
	const all = input.profile.filter((row) => row.scope === "all");
	const summary = all.find((row) => row.hour_local === null);
	const hourNet = summed(
		all,
		(row) => row.hour_local,
		(row) => row.net_amount,
	);
	const weekdayNet = summed(
		input.profile.filter((row) => row.scope === "weekday"),
		(row) => row.weekday,
		(row) => row.net_amount,
	);
	const heatmapHours = summed(
		input.heatmap,
		(row) => row.hour_local,
		(row) => row.net_amount,
	);
	const heatmapWeekdays = summed(
		input.heatmap,
		(row) => row.weekday,
		(row) => row.net_amount,
	);
	const net = summary?.net_amount ?? null;
	const invoices = summary?.invoices ?? null;
	const shareSum = total(input.payments.map((row) => row.share ?? 0));
	return {
		facts: { invoices, net, hourNet, weekdayNet, payments: input.payments },
		identities: {
			totalsAgree:
				summary !== undefined &&
				input.totals !== undefined &&
				invoices === input.totals.invoices &&
				Math.abs((net ?? 0) - (input.totals.net_amount ?? 0)) < MONEY_EPSILON,
			heatmapAgrees:
				sameAmounts(heatmapHours, hourNet) &&
				sameAmounts(heatmapWeekdays, weekdayNet) &&
				Math.abs(total(heatmapHours.values()) - (net ?? 0)) < MONEY_EPSILON,
			paymentSharesSumToOne:
				input.payments.length > 0 && Math.abs(shareSum - 1) < SHARE_SUM_EPSILON,
		},
	};
}

function shareOf(part: number, whole: number | null): number | null {
	return whole === null || whole === 0 ? null : part / whole;
}

export function rowValue(
	kind: ValueRowKind,
	facts: WindowFacts,
): number | null {
	switch (kind.kind) {
		case "invoices":
			return facts.invoices;
		case "net":
			return facts.net;
		case "averageTicket":
			return facts.net === null ? null : shareOf(facts.net, facts.invoices);
		case "hourNet":
			return facts.hourNet.get(kind.hour) ?? 0;
		case "hourShare": {
			let sum = 0;
			for (let hour = kind.from; hour <= kind.to; hour += 1) {
				sum += facts.hourNet.get(hour) ?? 0;
			}
			return shareOf(sum, facts.net);
		}
		case "weekendShare":
			return shareOf(
				total(WEEKEND.map((day) => facts.weekdayNet.get(day) ?? 0)),
				total(facts.weekdayNet.values()),
			);
		case "sundayNet":
			return facts.weekdayNet.get(SUNDAY) ?? 0;
	}
}

function comparable(text: string): string {
	return text
		.normalize("NFC")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")")
		.trim();
}

function withoutTones(text: string): string {
	return comparable(text)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replaceAll("đ", "d")
		.normalize("NFC");
}

export function paymentRowsFor(
	payments: readonly PaymentRow[],
	label: string,
): PaymentRow[] {
	const wanted = comparable(label);
	if (wanted === "cash") return payments.filter((row) => row.kind === "cash");
	if (wanted === "transfer") {
		return payments.filter((row) => row.kind === "bank_transfer");
	}
	return payments.filter((row) =>
		comparable(row.payment_method_name ?? "").includes(wanted),
	);
}

export function paymentInvoiceShareOf(
	payments: readonly PaymentRow[],
	label: string,
): number | null {
	const invoices = total(payments.map((row) => row.invoices));
	const matched = paymentRowsFor(payments, label);
	return invoices === 0 || matched.length === 0
		? null
		: total(matched.map((row) => row.invoices)) / invoices;
}

function namesOf(row: ItemRow): string[] {
	const names = [row.item_name];
	if (row.base_name !== null) {
		names.push(
			row.size_label === null
				? row.base_name
				: `${row.base_name} (${row.size_label})`,
		);
	}
	return names;
}

function rowsNamed(
	rows: readonly ItemRow[],
	name: string,
	key: (text: string) => string,
): ItemRow[] {
	const wanted = key(name);
	return rows.filter((row) => namesOf(row).map(key).includes(wanted));
}

export function sellerRows(rows: readonly ItemRow[], name: string): ItemRow[] {
	const bare = name.replace(/\s*\([^()]*\)\s*$/, "");
	const attempts: [string, (text: string) => string][] = [
		[name, comparable],
		[name, withoutTones],
		...(bare === name
			? []
			: ([
					[bare, comparable],
					[bare, withoutTones],
				] as [string, (text: string) => string][])),
	];
	for (const [wanted, key] of attempts) {
		const named = rowsNamed(rows, wanted, key);
		if (named.length > 0) return named;
	}
	return [];
}

export function chunksOf(window: DateWindow, days: number): DateWindow[] {
	const chunks: DateWindow[] = [];
	let from: IsoDate = window.from;
	while (from <= window.to) {
		const end = addDays(from, days - 1);
		const to = minDate(end, window.to);
		chunks.push({ from, to });
		from = addDays(to, 1);
	}
	return chunks;
}

export function windowDays(window: DateWindow): number {
	return daysBetween(window.from, window.to) + 1;
}
