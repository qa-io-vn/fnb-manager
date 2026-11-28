import { roundHalfAwayFromZero } from "@fnb/reports";
import { z } from "zod";
import type {
	InvoiceRecord,
	LineRecord,
	NumericValue,
	PaymentRecord,
	RecordOf,
	ShiftRecord,
} from "./columns";
import type { StoreTableId } from "./plan";

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:e([-+]?\d+))?$/i;

function scaledDigits(text: string, scale: number): bigint {
	const match = DECIMAL.exec(text.trim());
	if (!match) throw new RangeError(`cannot read "${text}" as a decimal`);
	const fraction = match[3] ?? "";
	const exponent = Number(match[4] ?? "0");
	const digits = BigInt(`${match[2]}${fraction}`);
	const shift = scale - (fraction.length - exponent);
	let magnitude: bigint;
	if (shift >= 0) {
		magnitude = digits * 10n ** BigInt(shift);
	} else {
		const divisor = 10n ** BigInt(-shift);
		const quotient = digits / divisor;
		magnitude = (digits % divisor) * 2n >= divisor ? quotient + 1n : quotient;
	}
	return match[1] === "-" ? -magnitude : magnitude;
}

export function minorUnits(value: NumericValue, scale: number): bigint {
	if (typeof value === "string") return scaledDigits(value, scale);
	if (!Number.isFinite(value)) throw new RangeError(`cannot scale ${value}`);
	return scaledDigits(String(roundHalfAwayFromZero(value, scale)), scale);
}

export function minorUnitsText(value: NumericValue, scale: number): string {
	return minorUnits(value, scale).toString();
}

export function decimalOf(minor: bigint, scale: number = MONEY_SCALE): number {
	const negative = minor < 0n;
	const digits = (negative ? -minor : minor)
		.toString()
		.padStart(scale + 1, "0");
	const text =
		scale === 0
			? digits
			: `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
	const value = Number(text);
	return negative && value !== 0 ? -value : value;
}

export async function sha256Hex(text: string): Promise<string> {
	return sha256HexOfBytes(new TextEncoder().encode(text));
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		bytes as Uint8Array<ArrayBuffer>,
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function invoiceLine(record: InvoiceRecord): string {
	return [
		record.id,
		record.status,
		minorUnitsText(record.net_amount, MONEY_SCALE),
		minorUnitsText(record.gross_amount, MONEY_SCALE),
		minorUnitsText(record.paid_amount, MONEY_SCALE),
		record.business_date,
	].join("|");
}

export function lineLine(record: LineRecord): string {
	return [
		record.invoice_id,
		record.external_id,
		record.line_kind,
		minorUnitsText(record.quantity, QUANTITY_SCALE),
		minorUnitsText(record.net_amount, MONEY_SCALE),
	].join("|");
}

export function paymentLine(record: PaymentRecord): string {
	return [
		record.invoice_id,
		String(record.sequence_no),
		minorUnitsText(record.amount, MONEY_SCALE),
	].join("|");
}

export function shiftLine(record: ShiftRecord): string {
	return [
		record.id,
		minorUnitsText(record.sales_amount, MONEY_SCALE),
		record.cash_variance_amount === null
			? ""
			: minorUnitsText(record.cash_variance_amount, MONEY_SCALE),
	].join("|");
}

function byInvoiceId(left: InvoiceRecord, right: InvoiceRecord): number {
	return compareCodeUnits(left.id, right.id);
}

function byLineKey(left: LineRecord, right: LineRecord): number {
	return (
		compareCodeUnits(left.invoice_id, right.invoice_id) ||
		compareCodeUnits(left.external_id, right.external_id)
	);
}

function byPaymentKey(left: PaymentRecord, right: PaymentRecord): number {
	return (
		compareCodeUnits(left.invoice_id, right.invoice_id) ||
		left.sequence_no - right.sequence_no
	);
}

function byShiftId(left: ShiftRecord, right: ShiftRecord): number {
	return compareCodeUnits(left.id, right.id);
}

export function canonicalLines<T extends StoreTableId>(
	table: T,
	records: readonly RecordOf<T>[],
): string {
	switch (table) {
		case "invoices":
			return [...(records as readonly InvoiceRecord[])]
				.sort(byInvoiceId)
				.map(invoiceLine)
				.join("\n");
		case "invoice_lines":
			return [...(records as readonly LineRecord[])]
				.sort(byLineKey)
				.map(lineLine)
				.join("\n");
		case "invoice_payments":
			return [...(records as readonly PaymentRecord[])]
				.sort(byPaymentKey)
				.map(paymentLine)
				.join("\n");
		default:
			return [...(records as readonly ShiftRecord[])]
				.sort(byShiftId)
				.map(shiftLine)
				.join("\n");
	}
}

export interface TableTotals {
	readonly rows: number;
	readonly voided: number | null;
	/** Invoices only: the refund documents of later-day native refunds (status `refund`, ADR-071), in the amount and never counted as invoices. */
	readonly refunds?: number;
	readonly amount: bigint;
	readonly fingerprint: string;
}

function sumMinor(values: Iterable<NumericValue>): bigint {
	let total = 0n;
	for (const value of values) total += minorUnits(value, MONEY_SCALE);
	return total;
}

function amountsOf<T extends StoreTableId>(
	table: T,
	records: readonly RecordOf<T>[],
): { amount: bigint; voided: number | null; refunds?: number } {
	switch (table) {
		case "invoices": {
			const invoices = records as readonly InvoiceRecord[];
			const kept = invoices.filter((record) => record.status !== "voided");
			return {
				amount: sumMinor(kept.map((record) => record.net_amount)),
				voided: invoices.length - kept.length,
				refunds: kept.filter((record) => record.status === "refund").length,
			};
		}
		case "invoice_lines":
			return {
				amount: sumMinor(
					(records as readonly LineRecord[]).map((record) => record.net_amount),
				),
				voided: null,
			};
		case "invoice_payments":
			return {
				amount: sumMinor(
					(records as readonly PaymentRecord[]).map((record) => record.amount),
				),
				voided: null,
			};
		default:
			return {
				amount: sumMinor(
					(records as readonly ShiftRecord[]).map(
						(record) => record.sales_amount,
					),
				),
				voided: null,
			};
	}
}

export async function totalsOfRecords<T extends StoreTableId>(
	table: T,
	records: readonly RecordOf<T>[],
): Promise<TableTotals> {
	const { amount, voided, refunds } = amountsOf(table, records);
	return {
		rows: records.length,
		voided,
		...(refunds === undefined || refunds === 0 ? {} : { refunds }),
		amount,
		fingerprint: await sha256Hex(canonicalLines(table, records)),
	};
}

const countField = z
	.union([z.number(), z.string()])
	.transform((value) => Number(value))
	.pipe(z.number().int().nonnegative());
const amountField = z.union([z.number(), z.string()]);
const fingerprintField = z.string().regex(/^[0-9a-f]{64}$/);

export const controlTotalsRow = z.object({
	store_id: z.string(),
	invoices: countField,
	voided_invoices: countField,
	refund_invoices: countField.optional(),
	sales_net_amount: amountField,
	invoice_fingerprint: fingerprintField,
	lines: countField,
	line_net_amount: amountField,
	line_fingerprint: fingerprintField,
	payments: countField,
	payment_amount: amountField,
	payment_fingerprint: fingerprintField,
	shifts: countField,
	shift_sales_amount: amountField,
	shift_fingerprint: fingerprintField,
});

export type ControlTotalsRow = z.infer<typeof controlTotalsRow>;

export interface ControlTotals {
	readonly storeId: string;
	readonly tables: Readonly<Record<StoreTableId, TableTotals>>;
}

export function controlTotalsOf(row: ControlTotalsRow): ControlTotals {
	return {
		storeId: row.store_id,
		tables: {
			invoices: {
				rows: row.invoices,
				voided: row.voided_invoices,
				...(row.refund_invoices ? { refunds: row.refund_invoices } : {}),
				amount: minorUnits(row.sales_net_amount, MONEY_SCALE),
				fingerprint: row.invoice_fingerprint,
			},
			invoice_lines: {
				rows: row.lines,
				voided: null,
				amount: minorUnits(row.line_net_amount, MONEY_SCALE),
				fingerprint: row.line_fingerprint,
			},
			invoice_payments: {
				rows: row.payments,
				voided: null,
				amount: minorUnits(row.payment_amount, MONEY_SCALE),
				fingerprint: row.payment_fingerprint,
			},
			shifts: {
				rows: row.shifts,
				voided: null,
				amount: minorUnits(row.shift_sales_amount, MONEY_SCALE),
				fingerprint: row.shift_fingerprint,
			},
		},
	};
}

export function sameTableTotals(
	left: TableTotals,
	right: TableTotals,
): boolean {
	return (
		left.rows === right.rows &&
		left.voided === right.voided &&
		(left.refunds ?? 0) === (right.refunds ?? 0) &&
		left.amount === right.amount &&
		left.fingerprint === right.fingerprint
	);
}

export function sameControlTotals(
	left: ControlTotals,
	right: ControlTotals,
): boolean {
	return (
		left.storeId === right.storeId &&
		(Object.keys(left.tables) as StoreTableId[]).every((table) =>
			sameTableTotals(left.tables[table], right.tables[table]),
		)
	);
}

export type Verdict =
	| { readonly kind: "verified" }
	| { readonly kind: "reread" }
	| { readonly kind: "unverified"; readonly reason: UnverifiedReason };

export type UnverifiedReason = "changed" | "mismatch";

export function verdictOf(
	own: Readonly<Partial<Record<StoreTableId, TableTotals>>>,
	before: ControlTotals,
	after: ControlTotals,
	rereadsLeft: number,
): Verdict {
	const tables = Object.keys(own) as StoreTableId[];
	const allEqual = tables.every((table) => {
		const mine = own[table];
		return mine !== undefined && sameTableTotals(mine, after.tables[table]);
	});
	if (allEqual) return { kind: "verified" };
	const moved = !sameControlTotals(before, after);
	if (moved && rereadsLeft > 0) return { kind: "reread" };
	return { kind: "unverified", reason: moved ? "changed" : "mismatch" };
}

export interface DailySummaryFigures {
	readonly netAmount: bigint;
	readonly invoices: number;
}

export function dailySummaryMatches(
	figures: DailySummaryFigures,
	control: ControlTotals,
): boolean {
	const invoices = control.tables.invoices;
	return (
		figures.netAmount === invoices.amount &&
		figures.invoices ===
			invoices.rows - (invoices.voided ?? 0) - (invoices.refunds ?? 0)
	);
}

export interface TotalsJson {
	readonly rows: number;
	readonly voided?: number;
	readonly refunds?: number;
	readonly amount: number;
	readonly fingerprint: string;
}

export function totalsJson(totals: TableTotals): TotalsJson {
	return {
		rows: totals.rows,
		...(totals.voided === null ? {} : { voided: totals.voided }),
		...((totals.refunds ?? 0) > 0 ? { refunds: totals.refunds } : {}),
		amount: decimalOf(totals.amount),
		fingerprint: totals.fingerprint,
	};
}
