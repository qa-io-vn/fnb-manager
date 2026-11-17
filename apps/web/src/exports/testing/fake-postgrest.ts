import { createHash } from "node:crypto";
import type {
	ExportClient,
	ExportQuery,
	ExportResponse,
	ExportRpcCall,
} from "../reader";

export interface FakeStore {
	readonly id: string;
	readonly label: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
	readonly historyStart: string | null;
}

export interface FakeInvoice {
	readonly id: string;
	readonly store_id: string;
	readonly external_id: string;
	readonly receipt_no: string | null;
	readonly business_date: string;
	readonly sold_at: string;
	readonly status: "completed" | "edited" | "voided";
	readonly net_amount: string;
	readonly gross_amount: string;
	readonly paid_amount: string;
	readonly customer_phone: string | null;
	readonly customer_name: string | null;
}

export interface FakeLine {
	readonly invoice_id: string;
	readonly store_id: string;
	readonly external_id: string;
	readonly line_kind: string;
	readonly item_name: string;
	readonly quantity: string;
	readonly net_amount: string;
	readonly note: string | null;
}

export interface FakePayment {
	readonly invoice_id: string;
	readonly store_id: string;
	readonly business_date: string;
	readonly sequence_no: number;
	readonly payment_method_name: string | null;
	readonly amount: string;
	readonly reference_no: string | null;
}

export interface FakeShift {
	readonly id: string;
	readonly store_id: string;
	readonly external_id: string;
	readonly name: string | null;
	readonly cashier_name: string | null;
	readonly opened_at: string;
	readonly business_date: string;
	readonly sales_amount: string;
	readonly cash_variance_amount: string | null;
}

export interface FakeTables {
	invoices: FakeInvoice[];
	invoice_lines: FakeLine[];
	invoice_payments: FakePayment[];
	shifts: FakeShift[];
}

export interface FakeRequest {
	readonly table: string;
	readonly select: string;
	readonly filters: readonly string[];
	readonly order: readonly string[];
	readonly limit: number | null;
	readonly returned: number;
}

export interface FakePostgrestOptions {
	readonly stores: readonly FakeStore[];
	readonly tables: FakeTables;
	readonly serverCap?: number;
	readonly beforeRequest?: (index: number, tables: FakeTables) => void;
	readonly beforeRpc?: (
		name: string,
		index: number,
		tables: FakeTables,
	) => void;
	readonly controlTotalsOverride?: (
		row: Record<string, unknown>,
		call: number,
	) => Record<string, unknown>;
}

export interface FakePostgrest {
	readonly client: ExportClient;
	readonly requests: FakeRequest[];
	readonly rpcCalls: { name: string; args: Record<string, unknown> }[];
	readonly tables: FakeTables;
	maxInFlight(): number;
	startedRequests(): number;
}

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

const MAX_STORE_IDS = 50;
const MAX_CONTROL_DAYS = 92;
const MAX_REPORT_ROWS = 900;

function valueAt(row: Row, column: string): unknown {
	if (!column.includes(".")) return row[column];
	const [embedded, field] = column.split(".") as [string, string];
	const nested = row[embedded];
	return typeof nested === "object" && nested !== null
		? (nested as Row)[field]
		: undefined;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

function compareValues(left: unknown, right: string): number {
	if (typeof left === "number") return left - Number(right);
	const text = String(left);
	if (TIMESTAMP.test(text) && TIMESTAMP.test(right)) {
		return Date.parse(text) - Date.parse(right);
	}
	return text < right ? -1 : text > right ? 1 : 0;
}

function operatorPredicate(
	column: string,
	operator: string,
	value: string,
): Predicate {
	return (row) => {
		const current = valueAt(row, column);
		if (current === null || current === undefined) return false;
		const order = compareValues(current, value);
		switch (operator) {
			case "eq":
				return order === 0;
			case "gt":
				return order > 0;
			case "gte":
				return order >= 0;
			case "lt":
				return order < 0;
			case "lte":
				return order <= 0;
			default:
				throw new Error(`fake PostgREST: unsupported operator ${operator}`);
		}
	};
}

function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quoted = false;
	let current = "";
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index] as string;
		if (quoted) {
			current += character;
			if (character === "\\") {
				current += text[index + 1] ?? "";
				index += 1;
			} else if (character === '"') {
				quoted = false;
			}
			continue;
		}
		if (character === '"') quoted = true;
		if (character === "(") depth += 1;
		if (character === ")") depth -= 1;
		if (character === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += character;
	}
	if (current !== "") parts.push(current);
	return parts;
}

function unquoted(value: string): string {
	if (!value.startsWith('"')) return value;
	return value.slice(1, -1).replace(/\\(.)/g, "$1");
}

function conditionPredicate(condition: string): Predicate {
	const group = /^(and|or)\((.*)\)$/.exec(condition);
	if (group) {
		const members = splitTopLevel(group[2] as string).map(conditionPredicate);
		return group[1] === "and"
			? (row) => members.every((member) => member(row))
			: (row) => members.some((member) => member(row));
	}
	const match = /^([a-z_.]+)\.(eq|gt|gte|lt|lte)\.(.*)$/.exec(condition);
	if (!match) throw new Error(`fake PostgREST: cannot read ${condition}`);
	return operatorPredicate(
		match[1] as string,
		match[2] as string,
		unquoted(match[3] as string),
	);
}

export function orPredicate(filters: string): Predicate {
	const members = splitTopLevel(filters).map(conditionPredicate);
	return (row) => members.some((member) => member(row));
}

function selectedColumns(select: string): {
	columns: string[];
	embedded: { name: string; columns: string[] } | null;
} {
	const columns: string[] = [];
	let embedded: { name: string; columns: string[] } | null = null;
	for (const part of splitTopLevel(select)) {
		const match = /^([a-z_]+)!inner\((.*)\)$/.exec(part);
		if (match) {
			embedded = {
				name: match[1] as string,
				columns: (match[2] as string).split(","),
			};
		} else {
			columns.push(part);
		}
	}
	return { columns, embedded };
}

const DEFAULT_ROW: Readonly<Record<string, Row>> = {
	invoices: {
		opened_at: null,
		closed_at: null,
		table_name: null,
		area_name: null,
		sale_type: null,
		source_name: null,
		shift_external_id: null,
		device_code: null,
		guest_count: null,
		item_discount_amount: "0.00",
		bill_discount_amount: "0.00",
		extra_discount_amount: "0.00",
		bill_discount_name: null,
		voucher_name: null,
		voucher_amount: "0.00",
		partner_marketing_amount: "0.00",
		service_charge_amount: "0.00",
		shipping_fee_amount: "0.00",
		vat_amount: "0.00",
		primary_payment_method_name: null,
		employee_name: null,
		voucher_code: null,
	},
	invoice_lines: {
		parent_line_external_id: null,
		item_external_id: null,
		base_name: null,
		size_label: null,
		item_type_name: null,
		item_class_name: null,
		unit_name: null,
		package_external_id: null,
		list_unit_price: null,
		unit_price: "0.00",
		gross_amount: "0.00",
		discount_amount: "0.00",
		promotion_name: null,
	},
	invoice_payments: {
		payment_method_external_id: null,
		fee_amount: "0.00",
		partner_transaction_id: null,
	},
	shifts: {
		closed_at: null,
		orders_count: 0,
		opening_float_amount: null,
		expected_cash_amount: null,
		cash_drawer_amount: null,
		changed_after_close: false,
		status: null,
		device_code: null,
	},
};

const DECIMAL_TEXT = /^-?\d+\.\d+$/;

function asJsonValue(value: unknown): unknown {
	return typeof value === "string" && DECIMAL_TEXT.test(value)
		? Number(value)
		: value;
}

function minorText(decimal: string, scale: number): string {
	const negative = decimal.startsWith("-");
	const [whole, fraction = ""] = (negative ? decimal.slice(1) : decimal).split(
		".",
	);
	const digits = BigInt(
		`${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`,
	);
	return (negative ? -digits : digits).toString();
}

function sumMinor(values: readonly string[]): bigint {
	return values.reduce(
		(total, value) => total + BigInt(minorText(value, 2)),
		0n,
	);
}

function decimalFromMinor(minor: bigint): number {
	return Number(minor) / 100;
}

function sha256(lines: readonly string[]): string {
	return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

function byText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function oracleControlTotals(
	tables: FakeTables,
	storeId: string,
	from: string,
	to: string,
): Record<string, unknown> {
	const invoices = tables.invoices.filter(
		(row) =>
			row.store_id === storeId &&
			row.business_date >= from &&
			row.business_date <= to,
	);
	const invoiceIds = new Set(invoices.map((row) => row.id));
	const lines = tables.invoice_lines.filter((row) =>
		invoiceIds.has(row.invoice_id),
	);
	const payments = tables.invoice_payments.filter(
		(row) =>
			row.store_id === storeId &&
			row.business_date >= from &&
			row.business_date <= to,
	);
	const shifts = tables.shifts.filter(
		(row) =>
			row.store_id === storeId &&
			row.business_date >= from &&
			row.business_date <= to,
	);
	const kept = invoices.filter((row) => row.status !== "voided");
	return {
		store_id: storeId,
		invoices: invoices.length,
		voided_invoices: invoices.length - kept.length,
		sales_net_amount: decimalFromMinor(
			sumMinor(kept.map((row) => row.net_amount)),
		),
		invoice_fingerprint: sha256(
			[...invoices]
				.sort((left, right) => byText(left.id, right.id))
				.map((row) =>
					[
						row.id,
						row.status,
						minorText(row.net_amount, 2),
						minorText(row.gross_amount, 2),
						minorText(row.paid_amount, 2),
						row.business_date,
					].join("|"),
				),
		),
		lines: lines.length,
		line_net_amount: decimalFromMinor(
			sumMinor(lines.map((row) => row.net_amount)),
		),
		line_fingerprint: sha256(
			[...lines]
				.sort(
					(left, right) =>
						byText(left.invoice_id, right.invoice_id) ||
						byText(left.external_id, right.external_id),
				)
				.map((row) =>
					[
						row.invoice_id,
						row.external_id,
						row.line_kind,
						minorText(row.quantity, 3),
						minorText(row.net_amount, 2),
					].join("|"),
				),
		),
		payments: payments.length,
		payment_amount: decimalFromMinor(
			sumMinor(payments.map((row) => row.amount)),
		),
		payment_fingerprint: sha256(
			[...payments]
				.sort(
					(left, right) =>
						byText(left.invoice_id, right.invoice_id) ||
						left.sequence_no - right.sequence_no,
				)
				.map((row) =>
					[
						row.invoice_id,
						String(row.sequence_no),
						minorText(row.amount, 2),
					].join("|"),
				),
		),
		shifts: shifts.length,
		shift_sales_amount: decimalFromMinor(
			sumMinor(shifts.map((row) => row.sales_amount)),
		),
		shift_fingerprint: sha256(
			[...shifts]
				.sort((left, right) => byText(left.id, right.id))
				.map((row) =>
					[
						row.id,
						minorText(row.sales_amount, 2),
						row.cash_variance_amount === null
							? ""
							: minorText(row.cash_variance_amount, 2),
					].join("|"),
				),
		),
	};
}

const ZERO_TOTALS = {
	days_with_data: 0,
	gross_amount: 0,
	item_discount_amount: 0,
	bill_discount_amount: 0,
	voucher_amount: 0,
	discount_amount: 0,
	paid_amount: 0,
	cash_amount: 0,
	items_sold: 0,
	voucher_invoices: 0,
	member_invoices: 0,
	identified_invoices: 0,
	voided_invoices: 0,
	voided_amount: 0,
	edited_invoices: 0,
	avg_ticket: null,
	items_per_ticket: null,
	avg_item_price: null,
	cash_share: null,
	voucher_share: null,
	member_share: null,
	identified_share: null,
	discount_rate: null,
};

function datesFrom(from: string, to: string): string[] {
	const dates: string[] = [];
	for (
		let cursor = new Date(`${from}T00:00:00Z`);
		cursor.toISOString().slice(0, 10) <= to;
		cursor = new Date(cursor.getTime() + 86_400_000)
	) {
		dates.push(cursor.toISOString().slice(0, 10));
	}
	return dates;
}

function dailyRow(
	tables: FakeTables,
	storeIds: readonly string[],
	date: string,
	storeId: string | null,
): Row {
	const kept = tables.invoices.filter(
		(row) =>
			storeIds.includes(row.store_id) &&
			row.business_date === date &&
			row.status !== "voided",
	);
	return {
		store_id: storeId,
		bucket_start: date,
		bucket_end: date,
		iso_year: null,
		iso_week: null,
		weekday: 1,
		calendar_days: 1,
		excluded_days: 0,
		tet_days: 0,
		holiday_kind: null,
		checked_days: 0,
		matched_days: 0,
		...ZERO_TOTALS,
		invoices: kept.length,
		net_amount: decimalFromMinor(sumMinor(kept.map((row) => row.net_amount))),
	};
}

export function createFakePostgrest(
	options: FakePostgrestOptions,
): FakePostgrest {
	const requests: FakeRequest[] = [];
	const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
	const tables = options.tables;
	let inFlight = 0;
	let peak = 0;
	let rpcIndex = 0;
	let requestIndex = 0;
	const controlCalls = new Map<string, number>();

	const respond = async (
		work: () => ExportResponse,
	): Promise<ExportResponse> => {
		inFlight += 1;
		peak = Math.max(peak, inFlight);
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
		try {
			return work();
		} finally {
			inFlight -= 1;
		}
	};

	const fromTable = (table: string) => ({
		select(select: string): ExportQuery {
			const filters: string[] = [];
			const predicates: Predicate[] = [];
			const order: string[] = [];
			let limit: number | null = null;
			const index = requestIndex;
			requestIndex += 1;
			const response = respond(() => {
				options.beforeRequest?.(index, tables);
				const { columns, embedded } = selectedColumns(select);
				const source =
					(tables as unknown as Record<string, Row[]>)[table] ?? [];
				const joined = source.map((row) => {
					const full: Row = { ...DEFAULT_ROW[table], ...row };
					if (embedded) {
						const invoice = tables.invoices.find(
							(candidate) => candidate.id === row.invoice_id,
						);
						full[embedded.name] = invoice
							? Object.fromEntries(
									embedded.columns.map((column) => [
										column,
										(invoice as unknown as Row)[column],
									]),
								)
							: null;
					}
					return full;
				});
				const matching = joined
					.filter((row) => !embedded || row[embedded.name] !== null)
					.filter((row) => predicates.every((predicate) => predicate(row)))
					.sort((left, right) => {
						for (const column of order) {
							const leftValue = valueAt(left, column);
							const rightValue = valueAt(right, column);
							const difference =
								typeof leftValue === "number" && typeof rightValue === "number"
									? leftValue - rightValue
									: byText(String(leftValue), String(rightValue));
							if (difference !== 0) return difference;
						}
						return 0;
					});
				const cap = Math.min(
					limit ?? Number.POSITIVE_INFINITY,
					options.serverCap ?? Number.POSITIVE_INFINITY,
				);
				const page = matching.slice(0, cap).map((row) => {
					const shaped: Row = {};
					for (const column of columns)
						shaped[column] = asJsonValue(row[column]);
					if (embedded) shaped[embedded.name] = row[embedded.name];
					return shaped;
				});
				requests.push({
					table,
					select,
					filters,
					order,
					limit,
					returned: page.length,
				});
				return { data: JSON.parse(JSON.stringify(page)), error: null };
			});
			const filter = (
				column: string,
				operator: "eq" | "gt" | "gte" | "lt" | "lte",
				value: string,
			) => {
				filters.push(`${column}=${operator}.${value}`);
				predicates.push(operatorPredicate(column, operator, value));
				return query;
			};
			const query: ExportQuery = Object.assign(response, {
				eq: (column: string, value: string) => filter(column, "eq", value),
				gt: (column: string, value: string) => filter(column, "gt", value),
				gte: (column: string, value: string) => filter(column, "gte", value),
				lt: (column: string, value: string) => filter(column, "lt", value),
				lte: (column: string, value: string) => filter(column, "lte", value),
				or: (expression: string) => {
					filters.push(`or=(${expression})`);
					predicates.push(orPredicate(expression));
					return query;
				},
				order: (column: string) => {
					order.push(column);
					return query;
				},
				limit: (count: number) => {
					limit = count;
					return query;
				},
				abortSignal: () => query,
			});
			return query;
		},
	});

	const rpcResponse = (
		name: string,
		args: Record<string, unknown>,
	): ExportResponse => {
		const storeIds = (args.store_ids as string[]) ?? [];
		if (storeIds.length > MAX_STORE_IDS) {
			return {
				data: null,
				error: { message: `${name} needs store_ids with 0 to 50 store ids` },
			};
		}
		const days =
			typeof args.from_date === "string" && typeof args.to_date === "string"
				? datesFrom(args.from_date, args.to_date).length
				: 0;
		if (name === "export_control_totals" && days > MAX_CONTROL_DAYS) {
			return {
				data: null,
				error: { message: "export_control_totals covers at most 92 days" },
			};
		}
		if (
			name === "period_series" &&
			days * (args.include_stores === true ? storeIds.length + 1 : 1) >
				MAX_REPORT_ROWS
		) {
			return {
				data: null,
				error: { message: "period_series returns at most 900 rows" },
			};
		}
		if (name === "export_control_totals") {
			const storeId = storeIds[0] as string;
			const key = `${storeId}|${args.from_date}|${args.to_date}`;
			const count = (controlCalls.get(key) ?? 0) + 1;
			controlCalls.set(key, count);
			const row = oracleControlTotals(
				tables,
				storeId,
				args.from_date as string,
				args.to_date as string,
			);
			return {
				data: [options.controlTotalsOverride?.(row, count) ?? row],
				error: null,
			};
		}
		if (name === "store_profiles") {
			return {
				data: options.stores
					.filter((store) => storeIds.includes(store.id))
					.map((store) => ({ store_id: store.id, label: store.label })),
				error: null,
			};
		}
		if (name === "store_coverage") {
			return {
				data: options.stores
					.filter((store) => storeIds.includes(store.id))
					.map((store) => ({
						store_id: store.id,
						opened_on: null,
						first_sales_on: store.historyStart,
						last_sales_on: null,
						history_start: store.historyStart,
						store_as_of_date: args.to_date,
						sales_days: 0,
						checked_days: 0,
						matched_days: 0,
						unmatched_days: 0,
						unchecked_sales_days: 0,
						stale_days: 0,
						last_refreshed_at: null,
					})),
				error: null,
			};
		}
		if (name === "period_series") {
			const dates = datesFrom(args.from_date as string, args.to_date as string);
			const rows: Row[] = [];
			for (const date of dates)
				rows.push(dailyRow(tables, storeIds, date, null));
			if (args.include_stores === true) {
				for (const storeId of storeIds) {
					for (const date of dates) {
						rows.push(dailyRow(tables, [storeId], date, storeId));
					}
				}
			}
			return { data: rows, error: null };
		}
		return { data: null, error: { message: `unknown function ${name}` } };
	};

	const rpc = (name: string, args: Record<string, unknown>): ExportRpcCall => {
		const index = rpcIndex;
		rpcIndex += 1;
		const response = respond(() => {
			options.beforeRpc?.(name, index, tables);
			rpcCalls.push({ name, args });
			return rpcResponse(name, args);
		});
		const call: ExportRpcCall = Object.assign(response, {
			abortSignal: () => call,
		});
		return call;
	};

	return {
		client: { from: fromTable, rpc },
		requests,
		rpcCalls,
		tables,
		maxInFlight: () => peak,
		startedRequests: () => requestIndex,
	};
}
