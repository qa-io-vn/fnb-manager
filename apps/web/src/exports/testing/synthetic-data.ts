import { businessDate, businessDayStart } from "@fnb/core";
import { addDays } from "@fnb/reports";
import type {
	FakeInvoice,
	FakeLine,
	FakePayment,
	FakeShift,
	FakeStore,
	FakeTables,
} from "./fake-postgrest";

export const STORE_ONE: FakeStore = {
	id: "11111111-1111-4111-8111-111111111111",
	label: "S1",
	name: "Cửa hàng mẫu số 1",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 300,
	historyStart: "2026-08-15",
};

export const STORE_TWO: FakeStore = {
	id: "22222222-2222-4222-8222-222222222222",
	label: "S2",
	name: 'Quán "Đêm"; số 2, tầng 1',
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	historyStart: "2026-09-02",
};

const ITEM_NAMES = [
	"Trà sữa trân châu",
	"Cà phê sữa đá",
	"=SUM(A1:A9)",
	"+84 ưu đãi",
	"Bánh mì, pa tê",
	'Nước ép "cam"',
];

function hex(value: number, width: number): string {
	return value.toString(16).padStart(width, "0");
}

function syntheticId(prefix: number, sequence: number): string {
	const tail = hex(sequence, 12);
	return `${hex(prefix, 8)}-0000-4000-8000-${tail}`;
}

function money(minor: number): string {
	const negative = minor < 0;
	const digits = String(Math.abs(minor)).padStart(3, "0");
	return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function quantity(thousandths: number): string {
	const digits = String(thousandths).padStart(4, "0");
	return `${digits.slice(0, -3)}.${digits.slice(-3)}`;
}

export interface SyntheticOptions {
	readonly stores: readonly FakeStore[];
	readonly from: string;
	readonly to: string;
	readonly invoicesPerDay: number;
}

export function syntheticTables(options: SyntheticOptions): FakeTables {
	const tables: FakeTables = {
		invoices: [],
		invoice_lines: [],
		invoice_payments: [],
		shifts: [],
	};
	let sequence = 0;
	options.stores.forEach((store, storeIndex) => {
		for (let date = options.from; date <= options.to; date = addDays(date, 1)) {
			const dayStart = businessDayStart(
				date,
				store.timeZone,
				store.businessDayStartMinutes,
			);
			for (let shiftNo = 0; shiftNo < 2; shiftNo += 1) {
				sequence += 1;
				const openedAt = new Date(
					dayStart.getTime() + shiftNo * 8 * 3_600_000 + 60_000,
				);
				tables.shifts.push({
					id: syntheticId(0x50000000 + storeIndex, sequence),
					store_id: store.id,
					external_id: `CA-${date}-${shiftNo}`,
					name: shiftNo === 0 ? "cashier@example.com" : "Ca chiều",
					cashier_name: "Thu ngân Lê",
					opened_at: openedAt.toISOString().replace(".000Z", "+00:00"),
					business_date: businessDate(
						openedAt,
						store.timeZone,
						store.businessDayStartMinutes,
					),
					sales_amount: money(1_000_000 + sequence * 37),
					cash_variance_amount:
						sequence % 3 === 0 ? null : money((sequence % 7) * 500 - 1500),
				});
			}
			for (let number = 0; number < options.invoicesPerDay; number += 1) {
				sequence += 1;
				const id = syntheticId(0x30000000 + storeIndex, sequence);
				const status =
					sequence % 11 === 0
						? "voided"
						: sequence % 13 === 0
							? "edited"
							: "completed";
				const lineCount = 1 + (sequence % 3);
				let net = 0;
				for (let line = 0; line < lineCount; line += 1) {
					const lineNet =
						1_500_000 +
						((sequence * 17 + line * 5) % 900) * 1000 +
						(line === 1 ? 50 : 0);
					net += lineNet;
					tables.invoice_lines.push({
						invoice_id: id,
						store_id: store.id,
						external_id: line === 2 ? "L10" : `L${line + 1}`,
						line_kind: line === 1 ? "modifier" : "item",
						item_name: ITEM_NAMES[
							(sequence + line) % ITEM_NAMES.length
						] as string,
						quantity: quantity(1000 + (line === 1 ? 500 : 0)),
						net_amount: money(lineNet),
						note: line === 0 ? "ít đá" : null,
					});
				}
				const soldAt = new Date(dayStart.getTime() + (number + 1) * 600_000);
				tables.invoices.push({
					id,
					store_id: store.id,
					external_id: `HD-${sequence}`,
					receipt_no: String(sequence % 5 === 0 ? `0${sequence}` : sequence),
					business_date: date,
					sold_at: soldAt.toISOString().replace(".000Z", "+00:00"),
					status,
					net_amount: money(net),
					gross_amount: money(net + 200_000),
					paid_amount: money(status === "voided" ? 0 : net),
					customer_phone: number % 4 === 0 ? "0900000000" : null,
					customer_name: number % 4 === 0 ? "Khách Nguyễn" : null,
				});
				if (status !== "voided") {
					const split = number % 6 === 0 ? 2 : 1;
					for (let tender = 1; tender <= split; tender += 1) {
						tables.invoice_payments.push({
							invoice_id: id,
							store_id: store.id,
							business_date: date,
							sequence_no: tender,
							payment_method_name: tender === 1 ? "Tiền mặt" : "Ví điện tử",
							amount: money(
								split === 1 ? net : tender === 1 ? net - 500_000 : 500_000,
							),
							reference_no: tender === 2 ? "REF-001" : null,
						});
					}
				}
			}
		}
	});
	return tables;
}

export function cloneTables(tables: FakeTables): FakeTables {
	return {
		invoices: [...tables.invoices],
		invoice_lines: [...tables.invoice_lines],
		invoice_payments: [...tables.invoice_payments],
		shifts: [...tables.shifts],
	};
}

export const TINY_STORE: FakeStore = {
	id: "11111111-1111-4111-8111-111111111111",
	label: "S1",
	name: "Cửa hàng thử",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	historyStart: "2026-10-05",
};

export const TINY_INVOICES: readonly FakeInvoice[] = [
	{
		id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		store_id: TINY_STORE.id,
		external_id: "HD-1",
		receipt_no: "0001",
		business_date: "2026-10-05",
		sold_at: "2026-10-05T02:00:00+00:00",
		status: "completed",
		net_amount: "52300.00",
		gross_amount: "55000.00",
		paid_amount: "52300.00",
		customer_phone: null,
		customer_name: null,
	},
	{
		id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
		store_id: TINY_STORE.id,
		external_id: "HD-2",
		receipt_no: "0002",
		business_date: "2026-10-05",
		sold_at: "2026-10-05T03:00:00+00:00",
		status: "voided",
		net_amount: "35000.00",
		gross_amount: "35000.00",
		paid_amount: "0.00",
		customer_phone: null,
		customer_name: null,
	},
	{
		id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
		store_id: TINY_STORE.id,
		external_id: "HD-3",
		receipt_no: "0003",
		business_date: "2026-10-06",
		sold_at: "2026-10-06T04:00:00+00:00",
		status: "edited",
		net_amount: "120500.50",
		gross_amount: "125000.00",
		paid_amount: "120500.50",
		customer_phone: null,
		customer_name: null,
	},
];

export const TINY_LINES: readonly FakeLine[] = [
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		store_id: TINY_STORE.id,
		external_id: "L1",
		line_kind: "item",
		item_name: "Trà sữa",
		quantity: "1.000",
		net_amount: "40000.00",
		note: null,
	},
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		store_id: TINY_STORE.id,
		external_id: "L2",
		line_kind: "modifier",
		item_name: "Trân châu",
		quantity: "2.000",
		net_amount: "12300.00",
		note: null,
	},
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
		store_id: TINY_STORE.id,
		external_id: "L1",
		line_kind: "item",
		item_name: "Cà phê",
		quantity: "1.000",
		net_amount: "35000.00",
		note: null,
	},
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
		store_id: TINY_STORE.id,
		external_id: "L10",
		line_kind: "item",
		item_name: "Trà đào",
		quantity: "1.500",
		net_amount: "90000.00",
		note: null,
	},
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
		store_id: TINY_STORE.id,
		external_id: "L2",
		line_kind: "item",
		item_name: "Bánh flan",
		quantity: "1.000",
		net_amount: "30500.50",
		note: null,
	},
];

export const TINY_PAYMENTS: readonly FakePayment[] = [
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		store_id: TINY_STORE.id,
		business_date: "2026-10-05",
		sequence_no: 1,
		payment_method_name: "Tiền mặt",
		amount: "52300.00",
		reference_no: null,
	},
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
		store_id: TINY_STORE.id,
		business_date: "2026-10-06",
		sequence_no: 1,
		payment_method_name: "Tiền mặt",
		amount: "100000.00",
		reference_no: null,
	},
	{
		invoice_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
		store_id: TINY_STORE.id,
		business_date: "2026-10-06",
		sequence_no: 2,
		payment_method_name: "Ví điện tử",
		amount: "20500.50",
		reference_no: null,
	},
];

export const TINY_SHIFTS: readonly FakeShift[] = [
	{
		id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
		store_id: TINY_STORE.id,
		external_id: "CA-1",
		name: "Ca sáng",
		cashier_name: null,
		opened_at: "2026-10-05T00:30:00+00:00",
		business_date: "2026-10-05",
		sales_amount: "52300.00",
		cash_variance_amount: "-1000.00",
	},
	{
		id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
		store_id: TINY_STORE.id,
		external_id: "CA-2",
		name: "Ca chiều",
		cashier_name: null,
		opened_at: "2026-10-06T00:30:00+00:00",
		business_date: "2026-10-06",
		sales_amount: "120500.50",
		cash_variance_amount: null,
	},
];

export function tinyTables(): FakeTables {
	return {
		invoices: [...TINY_INVOICES],
		invoice_lines: [...TINY_LINES],
		invoice_payments: [...TINY_PAYMENTS],
		shifts: [...TINY_SHIFTS],
	};
}
