import type { Sql } from "postgres";
import {
	type LoyaltyFieldsInput,
	type RailEntry,
	type StoreCounts,
	WINDOW_BUSINESS_DAYS,
} from "./loyalty-fields.js";

// The reader of the G-11 check. It reads only synced tables (invoices and
// invoice_lines) and the rail mapping of the loyalty programme (coupon_rails,
// coupon_rail_rewards), aggregates in SQL and returns counts and dates: no
// phone, customer id, voucher code, discount name or store name ever reaches
// this process. It makes no POS call and writes nothing.

export interface ReadOptions {
	// A tenant slug that limits the scope; null or absent reads every store of
	// the database it is given.
	readonly tenantSlug?: string | null;
}

interface StoreRow {
	store_id: string;
	rail: string | null;
	invoices: number;
	voided: number;
	with_phone: number;
	with_customer_id: number;
	with_voucher_code: number;
	with_mapped_discount: number;
	with_zero_price_promo: number;
	receipt_missing: number;
}

// Opens its own read-only transaction: every statement below is a select.
export function readLoyaltyFieldsReadOnly(
	client: Sql,
	options: ReadOptions = {},
): Promise<LoyaltyFieldsInput> {
	return client.begin("read only", (tx) =>
		readLoyaltyFields(tx as unknown as Sql, options),
	) as Promise<LoyaltyFieldsInput>;
}

// Takes an open transaction and refuses one that is not read-only.
export async function readLoyaltyFields(
	sql: Sql,
	options: ReadOptions = {},
): Promise<LoyaltyFieldsInput> {
	const [mode] = await sql<{ read_only: string }[]>`
		select current_setting('transaction_read_only') as read_only
	`;
	if (mode?.read_only !== "on") {
		throw new Error(
			"the loyalty fields check reads in a read-only transaction",
		);
	}
	const slug = options.tenantSlug ?? null;
	const scope = sql`
		select s.id, s.timezone
		from public.stores s
		join public.tenants t on t.id = s.tenant_id
		where ${slug}::text is null or t.slug = ${slug}
	`;

	const [bounds] = await sql<{ as_of: string; as_of_days_ago: number }[]>`
		with scope as (${scope})
		select
			coalesce(max(i.business_date), current_date)::text as as_of,
			(current_date - coalesce(max(i.business_date), current_date))::int as as_of_days_ago
		from scope
		left join public.invoices i on i.store_id = scope.id
	`;
	const asOf = bounds?.as_of ?? "";
	const window = WINDOW_BUSINESS_DAYS - 1;

	const counted = await sql<StoreRow[]>`
		with scope as (${scope})
		select
			scope.id::text as store_id,
			(
				select r.rail::text
				from public.coupon_rails r
				where r.store_id = scope.id and r.active_until is null and r.active_from <= now()
				limit 1
			) as rail,
			count(i.id) filter (where i.status <> 'voided')::int as invoices,
			count(i.id) filter (where i.status = 'voided')::int as voided,
			count(i.id) filter (
				where i.status <> 'voided' and nullif(btrim(i.customer_phone), '') is not null
			)::int as with_phone,
			count(i.id) filter (where i.status <> 'voided' and i.customer_id is not null)::int as with_customer_id,
			count(i.id) filter (
				where i.status <> 'voided' and nullif(btrim(i.voucher_code), '') is not null
			)::int as with_voucher_code,
			count(i.id) filter (
				where i.status <> 'voided'
					and nullif(btrim(i.bill_discount_name), '') is not null
					and exists (
						select 1
						from public.coupon_rail_rewards w
						where w.store_id = i.store_id
							and w.pos_discount_name is not null
							and lower(btrim(w.pos_discount_name)) = lower(btrim(i.bill_discount_name))
					)
			)::int as with_mapped_discount,
			count(i.id) filter (
				where i.status <> 'voided'
					and exists (
						select 1
						from public.invoice_lines l
						where l.invoice_id = i.id
							and l.line_kind = 'item'
							and l.net_amount = 0
							and (
								nullif(btrim(l.promotion_external_id), '') is not null
								or nullif(btrim(l.promotion_name), '') is not null
							)
					)
			)::int as with_zero_price_promo,
			count(i.id) filter (
				where i.status <> 'voided' and nullif(btrim(i.receipt_no), '') is null
			)::int as receipt_missing
		from scope
		left join public.invoices i
			on i.store_id = scope.id
			and i.business_date between ${asOf}::date - ${window}::int and ${asOf}::date
		group by scope.id
		order by scope.id
	`;

	const duplicated = await sql<{ store_id: string; groups: number }[]>`
		with scope as (${scope})
		select d.store_id::text as store_id, count(*)::int as groups
		from (
			select i.store_id, i.business_date, btrim(i.receipt_no) as receipt_no
			from public.invoices i
			join scope on scope.id = i.store_id
			where i.business_date between ${asOf}::date - ${window}::int and ${asOf}::date
				and nullif(btrim(i.receipt_no), '') is not null
			group by i.store_id, i.business_date, btrim(i.receipt_no)
			having count(*) > 1
		) d
		group by d.store_id
	`;
	const duplicateGroups = new Map(
		duplicated.map((row) => [row.store_id, row.groups]),
	);

	const mapped = await sql<
		{ store_id: string; rail_from: string; last_seen: string | null }[]
	>`
		with scope as (${scope})
		select
			w.store_id::text as store_id,
			(r.active_from at time zone scope.timezone)::date::text as rail_from,
			(
				select max(i.business_date)::text
				from public.invoices i
				where i.store_id = w.store_id
					and i.status <> 'voided'
					and i.business_date between ${asOf}::date - ${window}::int and ${asOf}::date
					and lower(btrim(i.bill_discount_name)) = lower(btrim(w.pos_discount_name))
			) as last_seen
		from scope
		join public.coupon_rails r
			on r.store_id = scope.id and r.active_until is null and r.active_from <= now()
		join public.coupon_rail_rewards w
			on w.store_id = scope.id and w.active and w.pos_discount_name is not null
		order by w.store_id, w.reward_key
	`;

	const stores: StoreCounts[] = counted.map((row) => ({
		storeId: row.store_id,
		rail: row.rail,
		invoices: row.invoices,
		voided: row.voided,
		withPhone: row.with_phone,
		withCustomerId: row.with_customer_id,
		withVoucherCode: row.with_voucher_code,
		withMappedDiscountEntry: row.with_mapped_discount,
		withZeroPricePromoLine: row.with_zero_price_promo,
		receiptMissing: row.receipt_missing,
		receiptDuplicateGroups: duplicateGroups.get(row.store_id) ?? 0,
	}));
	const entries: RailEntry[] = mapped.map((row) => ({
		storeId: row.store_id,
		railFrom: row.rail_from,
		lastSeen: row.last_seen,
	}));
	return {
		asOf,
		asOfDaysAgo: bounds?.as_of_days_ago ?? 0,
		stores,
		entries,
	};
}
