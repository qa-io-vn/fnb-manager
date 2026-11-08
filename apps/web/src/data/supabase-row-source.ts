import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { IsoDate } from "../lib/business-dates";
import {
	afterCompositeKey,
	fetchAllByKey,
	fetchAllPages,
	fetchOnce,
} from "./paginate";
import {
	type Freshness,
	type InvoiceLineRow,
	type InvoiceRow,
	type PaymentMethodRow,
	type PaymentRow,
	paymentKinds,
	type RowSource,
	type StoreDates,
	type StoreRow,
	type TenantRow,
	type VerificationRows,
} from "./row-source";

const money = z.coerce.number();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const tenantRow = z.object({
	tenants: z.object({
		id: z.string(),
		name: z.string(),
		currency_code: z.string(),
		timezone: z.string(),
		country_code: z.string(),
	}),
});

const storeRow = z.object({
	id: z.string(),
	tenant_id: z.string(),
	name: z.string(),
	code: z.string().nullable(),
	timezone: z.string(),
	business_day_start_minutes: z.number().int(),
	pos_account_id: z.string(),
});

const invoiceRow = z.object({
	id: z.string(),
	store_id: z.string(),
	business_date: isoDate,
	sold_at: z.string(),
	net_amount: money,
	status: z.enum(["completed", "edited", "voided"]),
});

const lineRow = z.object({
	invoice_id: z.string(),
	external_id: z.string(),
	store_id: z.string(),
	line_kind: z.enum(["item", "modifier", "service", "package", "other"]),
	item_external_id: z.string().nullable(),
	item_name: z.string(),
	quantity: money,
	net_amount: money,
});

const paymentRow = z.object({
	invoice_id: z.string(),
	sequence_no: z.number().int(),
	store_id: z.string(),
	business_date: isoDate,
	payment_method_external_id: z.string().nullable(),
	payment_method_name: z.string().nullable(),
	amount: money,
});

const paymentMethodRow = z.object({
	pos_account_id: z.string(),
	external_id: z.string(),
	name: z.string(),
	kind: z.enum(paymentKinds),
});

const holidayRow = z.object({ holiday_date: isoDate });
const syncRunRow = z.object({ finished_at: z.string() });
const syncCheckRow = z.object({
	store_id: z.string(),
	business_date: isoDate,
	is_matched: z.boolean(),
});

function isEmpty(scope: StoreDates): boolean {
	return scope.storeIds.length === 0 || scope.dates.length === 0;
}

export function createSupabaseRowSource(client: SupabaseClient): RowSource {
	const currentUserId = async () => {
		const { data, error } = await client.auth.getSession();
		const userId = data.session?.user.id;
		if (error || userId === undefined) {
			throw new Error(error?.message ?? "not signed in");
		}
		return userId;
	};

	return {
		kind: "supabase",

		async tenants(): Promise<TenantRow[]> {
			const userId = await currentUserId();
			const rows = await fetchOnce(
				tenantRow,
				client
					.from("tenant_members")
					.select("tenants!inner(id,name,currency_code,timezone,country_code)")
					.eq("user_id", userId)
					.order("tenant_id"),
			);
			return rows.map(({ tenants }) => ({
				id: tenants.id,
				name: tenants.name,
				currencyCode: tenants.currency_code,
				timeZone: tenants.timezone,
				countryCode: tenants.country_code,
			}));
		},

		async stores(tenantId): Promise<StoreRow[]> {
			const rows = await fetchAllPages(storeRow, (from, to) =>
				client
					.from("stores")
					.select(
						"id,tenant_id,name,code,timezone,business_day_start_minutes,pos_account_id",
					)
					.eq("tenant_id", tenantId)
					.eq("active", true)
					.order("name")
					.order("id")
					.range(from, to),
			);
			return rows.map((row) => ({
				id: row.id,
				tenantId: row.tenant_id,
				name: row.name,
				code: row.code,
				timeZone: row.timezone,
				businessDayStartMinutes: row.business_day_start_minutes,
				posAccountId: row.pos_account_id,
			}));
		},

		async paymentMethods(tenantId): Promise<PaymentMethodRow[]> {
			const rows = await fetchAllPages(paymentMethodRow, (from, to) =>
				client
					.from("payment_methods")
					.select("pos_account_id,external_id,name,kind")
					.eq("tenant_id", tenantId)
					.order("id")
					.range(from, to),
			);
			return rows.map((row) => ({
				posAccountId: row.pos_account_id,
				externalId: row.external_id,
				name: row.name,
				kind: row.kind,
			}));
		},

		async excludedDates(tenant, dates): Promise<IsoDate[]> {
			if (dates.length === 0) return [];
			const rows = await fetchAllPages(holidayRow, (from, to) =>
				client
					.from("holidays")
					.select("holiday_date")
					.eq("country_code", tenant.countryCode)
					.in("holiday_date", [...dates])
					.or(`tenant_id.is.null,tenant_id.eq.${tenant.id}`)
					.order("id")
					.range(from, to),
			);
			return [...new Set(rows.map((row) => row.holiday_date))];
		},

		async invoices(scope): Promise<InvoiceRow[]> {
			if (isEmpty(scope)) return [];
			const rows = await fetchAllByKey(
				invoiceRow,
				(row) => row.id,
				(after, pageSize) => {
					const query = client
						.from("invoices")
						.select("id,store_id,business_date,sold_at,net_amount,status")
						.in("store_id", [...scope.storeIds])
						.in("business_date", [...scope.dates]);
					return (after ? query.gt("id", after.id) : query)
						.order("id")
						.limit(pageSize);
				},
			);
			return rows.map((row) => ({
				id: row.id,
				storeId: row.store_id,
				businessDate: row.business_date,
				soldAt: row.sold_at,
				netAmount: row.net_amount,
				status: row.status,
			}));
		},

		async invoiceLines(scope): Promise<InvoiceLineRow[]> {
			if (isEmpty(scope)) return [];
			const rows = await fetchAllByKey(
				lineRow,
				(row) => `${row.invoice_id}|${row.external_id}`,
				(after, pageSize) => {
					const query = client
						.from("invoice_lines")
						.select(
							"invoice_id,external_id,store_id,line_kind,item_external_id,item_name,quantity,net_amount,invoices!inner(business_date)",
						)
						.in("store_id", [...scope.storeIds])
						.in("invoices.business_date", [...scope.dates]);
					return (
						after
							? query.or(
									afterCompositeKey(
										{ column: "invoice_id", value: after.invoice_id },
										{ column: "external_id", value: after.external_id },
									),
								)
							: query
					)
						.order("invoice_id")
						.order("external_id")
						.limit(pageSize);
				},
			);
			return rows.map((row) => ({
				invoiceId: row.invoice_id,
				storeId: row.store_id,
				lineKind: row.line_kind,
				itemExternalId: row.item_external_id,
				itemName: row.item_name,
				quantity: row.quantity,
				netAmount: row.net_amount,
			}));
		},

		async payments(scope): Promise<PaymentRow[]> {
			if (isEmpty(scope)) return [];
			const rows = await fetchAllByKey(
				paymentRow,
				(row) => `${row.invoice_id}|${row.sequence_no}`,
				(after, pageSize) => {
					const query = client
						.from("invoice_payments")
						.select(
							"invoice_id,sequence_no,store_id,business_date,payment_method_external_id,payment_method_name,amount",
						)
						.in("store_id", [...scope.storeIds])
						.in("business_date", [...scope.dates]);
					return (
						after
							? query.or(
									afterCompositeKey(
										{ column: "invoice_id", value: after.invoice_id },
										{ column: "sequence_no", value: after.sequence_no },
									),
								)
							: query
					)
						.order("invoice_id")
						.order("sequence_no")
						.limit(pageSize);
				},
			);
			return rows.map((row) => ({
				invoiceId: row.invoice_id,
				storeId: row.store_id,
				businessDate: row.business_date,
				methodExternalId: row.payment_method_external_id,
				methodName: row.payment_method_name,
				amount: row.amount,
			}));
		},

		async freshness(tenantId): Promise<Freshness> {
			const rows = await fetchOnce(
				syncRunRow,
				client
					.from("sync_runs")
					.select("finished_at")
					.eq("tenant_id", tenantId)
					.eq("status", "succeeded")
					.not("finished_at", "is", null)
					.order("finished_at", { ascending: false })
					.limit(1),
			);
			const latest = rows[0];
			return latest
				? { kind: "synced", finishedAt: new Date(latest.finished_at) }
				: { kind: "never" };
		},

		async verification(scope): Promise<VerificationRows> {
			if (isEmpty(scope)) return { kind: "checked", checks: [] };
			const rows = await fetchAllPages(syncCheckRow, (from, to) =>
				client
					.from("sync_checks")
					.select("store_id,business_date,is_matched")
					.in("store_id", [...scope.storeIds])
					.in("business_date", [...scope.dates])
					.order("id")
					.range(from, to),
			);
			return {
				kind: "checked",
				checks: rows.map((row) => ({
					storeId: row.store_id,
					businessDate: row.business_date,
					isMatched: row.is_matched,
				})),
			};
		},
	};
}
