import type {
	SnapshotBrandContent,
	SnapshotContent,
	SnapshotRow,
	SnapshotStoreContent,
} from "@fnb/connector-ipos/snapshot";
import { businessDayStart } from "@fnb/core";
import type { Sql } from "postgres";

export interface SnapshotAccount {
	id: string;
	account_key: string;
}

export interface SnapshotCounts {
	stores: number;
	salesDays: number;
	invoices: number;
	lines: number;
	payments: number;
	voidedLeftOut: number;
	shifts: number;
	controlTotals: number;
	editedOrDeleted: number;
	removedItemEvents: number;
	items: number;
}

export interface DatabaseSnapshot {
	content: SnapshotContent;
	counts: SnapshotCounts;
	rebuilt: string[];
}

interface StoreRow {
	id: string;
	external_id: string;
	code: string | null;
	name: string;
	address: string | null;
	timezone: string;
	business_day_start_minutes: number;
	active: boolean;
	raw: unknown;
}

interface PayloadRecord {
	external_id: string;
	invoice: SnapshotRow;
	lines: Record<string, SnapshotRow>;
	payments: Record<string, SnapshotRow>;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAND_IN_COMPANY = "00000000-0000-4000-8000-00000000c0de";
const STAND_IN_BRAND = "00000000-0000-4000-8000-00000000b0de";
const STAND_IN_USER = "00000000-0000-4000-8000-00000000a0de";

export const REBUILT_PARTS = [
	"item types, item classes, items, sources and payment methods: rebuilt from their columns, since the sync keeps no iPOS payload for them",
	"units: rebuilt from the unit id and name of the stored sale lines, since no unit is stored",
	"control totals: the invoice count and net amount of each store-day come from sync_checks; its gross, discount and voucher amounts are summed from the stored invoices",
	"login and stores: rebuilt from the stores and the company and brand ids of the shift payloads; user and company names are left out",
	"sale lines and payments: each stored payload is merged back onto its invoice payload, which restores the fields the sync left out because they equal the invoice's",
	"voided invoices are left out of the sale report, as iPOS no longer lists them",
	"customizations: rebuilt from the stored option groups (each group keeps its iPOS option, position and customization) with their targets as list_item when the account has any, else from the zero-priced modifiers without targets",
];

function isRow(value: unknown): value is SnapshotRow {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseRecords(payload: string): PayloadRecord[] {
	return payload
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as PayloadRecord)
		.filter((record) => isRow(record.invoice));
}

function sortedEntries(record: Record<string, SnapshotRow>): SnapshotRow[] {
	return Object.entries(record)
		.sort(([left], [right]) => Number(left) - Number(right))
		.map(([, row]) => row);
}

async function storesOf(sql: Sql, accountId: string): Promise<StoreRow[]> {
	return sql<StoreRow[]>`
		select id, external_id, code, name, address, timezone, business_day_start_minutes, active, raw
		from public.stores
		where pos_account_id = ${accountId}
		order by external_id
	`;
}

async function scopeOf(
	sql: Sql,
	storeId: string,
): Promise<{ company: string | null; brand: string | null }> {
	const [row] = await sql<{ company: string | null; brand: string | null }[]>`
		select raw ->> 'company_uid' as company, raw ->> 'brand_uid' as brand
		from public.shifts
		where store_id = ${storeId} and raw ->> 'brand_uid' is not null
		order by opened_at desc
		limit 1
	`;
	return row ?? { company: null, brand: null };
}

interface LineFacts {
	unit_name: string | null;
	item_type_external_id: string | null;
}

async function lineFacts(
	sql: Sql,
	storeId: string,
): Promise<Map<string, LineFacts>> {
	const rows = await sql<(LineFacts & { invoice: string; line: string })[]>`
		select i.external_id as invoice, l.external_id as line, l.unit_name, l.item_type_external_id
		from public.invoice_lines l
		join public.invoices i on i.id = l.invoice_id
		where l.store_id = ${storeId}
	`;
	return new Map(rows.map((row) => [`${row.invoice}\n${row.line}`, row]));
}

interface StoreSales {
	invoices: SnapshotRow[];
	lines: SnapshotRow[];
	payments: SnapshotRow[];
	salesDays: number;
	voidedLeftOut: number;
	brandName: string | null;
}

async function salesOf(
	sql: Sql,
	store: StoreRow,
	units: Map<string, string>,
	typeUids: Map<string, string>,
): Promise<StoreSales> {
	const voided = new Set(
		(
			await sql<{ external_id: string }[]>`
				select external_id from public.invoices
				where store_id = ${store.id} and status = 'voided'
			`
		).map((row) => row.external_id),
	);
	const facts = await lineFacts(sql, store.id);
	const days = await sql<{ payload: string }[]>`
		select payload from public.sale_payloads
		where store_id = ${store.id}
		order by business_date
	`;
	const sales: StoreSales = {
		invoices: [],
		lines: [],
		payments: [],
		salesDays: 0,
		voidedLeftOut: 0,
		brandName: null,
	};
	for (const day of days) {
		let kept = 0;
		for (const record of parseRecords(day.payload)) {
			if (voided.has(record.external_id)) {
				sales.voidedLeftOut += 1;
				continue;
			}
			kept += 1;
			const invoice = record.invoice;
			sales.invoices.push(invoice);
			for (const [lineId, stored] of Object.entries(record.lines ?? {})) {
				const line = { ...invoice, ...stored };
				sales.lines.push(line);
				sales.brandName ??= text(line.brand_name);
				const fact = facts.get(`${record.external_id}\n${lineId}`);
				const unitId = text(line.unit_id);
				if (unitId && fact?.unit_name) {
					units.set(unitId, fact.unit_name);
				}
				const typeId = text(line.item_type_id);
				const resolved = fact?.item_type_external_id ?? null;
				if (
					typeId &&
					resolved &&
					typeId !== resolved &&
					UUID_PATTERN.test(typeId)
				) {
					typeUids.set(resolved, typeId);
				}
			}
			for (const stored of sortedEntries(record.payments ?? {})) {
				if (stored.derivedFromInvoiceHeader === true) {
					continue;
				}
				sales.payments.push({ ...invoice, ...stored });
			}
		}
		if (kept > 0) {
			sales.salesDays += 1;
		}
	}
	return sales;
}

async function shiftsOf(sql: Sql, storeId: string): Promise<SnapshotRow[]> {
	const rows = await sql<{ raw: unknown }[]>`
		select raw from public.shifts
		where store_id = ${storeId} and raw is not null
		order by opened_at
	`;
	return rows.map((row) => row.raw).filter(isRow);
}

function flattenMerged(raw: unknown): SnapshotRow[] {
	if (!isRow(raw)) {
		return [];
	}
	return Array.isArray(raw.merged) ? raw.merged.filter(isRow) : [raw];
}

async function adjustmentsOf(
	sql: Sql,
	storeId: string,
): Promise<{ editedOrDeleted: SnapshotRow[]; removed: SnapshotRow[] }> {
	const events = await sql<{ kind: string; raw: unknown }[]>`
		select kind::text as kind, raw
		from public.invoice_events
		where store_id = ${storeId} and source = 'pos_report' and raw is not null
		order by occurred_at, invoice_external_id
	`;
	const editedOrDeleted = new Map<string, SnapshotRow>();
	const removed = new Map<string, SnapshotRow>();
	for (const event of events) {
		for (const row of flattenMerged(event.raw)) {
			if (event.kind !== "line_removed") {
				editedOrDeleted.set(JSON.stringify(row), row);
				continue;
			}
			const { sale_detail: detail, ...header } = row;
			const id = JSON.stringify(header);
			const known = removed.get(id) ?? { ...header, sale_detail: [] };
			const lines = known.sale_detail as SnapshotRow[];
			for (const line of Array.isArray(detail) ? detail.filter(isRow) : []) {
				if (
					!lines.some(
						(existing) => JSON.stringify(existing) === JSON.stringify(line),
					)
				) {
					lines.push(line);
				}
			}
			removed.set(id, { ...known, total_tran_id: lines.length });
		}
	}
	return {
		editedOrDeleted: [...editedOrDeleted.values()],
		removed: [...removed.values()],
	};
}

async function dayRows(sql: Sql, store: StoreRow): Promise<SnapshotRow[]> {
	const rows = await sql<
		{
			business_date: string;
			invoices: number;
			net: number;
			gross: number | null;
			discount: number | null;
			voucher: number | null;
		}[]
	>`
		select c.business_date::text as business_date,
			c.source_invoice_count as invoices,
			c.source_net_amount::float8 as net,
			t.gross, t.discount, t.voucher
		from public.sync_checks c
		left join (
			select business_date,
				sum(gross_amount)::float8 as gross,
				sum(item_discount_amount + bill_discount_amount)::float8 as discount,
				sum(voucher_amount)::float8 as voucher
			from public.invoices
			where store_id = ${store.id} and status <> 'voided'
			group by business_date
		) t on t.business_date = c.business_date
		where c.store_id = ${store.id} and c.source_invoice_count > 0
		order by c.business_date
	`;
	return rows.map((row) => ({
		date: row.business_date,
		tran_date: businessDayStart(row.business_date, store.timezone, 0).getTime(),
		total_sales: row.invoices,
		revenue_gross: row.gross ?? row.net,
		revenue_net: row.net,
		discount_amount: row.discount ?? 0,
		voucher_amount: row.voucher ?? 0,
		peo_count: 0,
	}));
}

async function coverageOf(
	sql: Sql,
	storeIds: readonly string[],
): Promise<{ from: string | null; to: string | null }> {
	const [row] = await sql<{ from: string | null; to: string | null }[]>`
		select min(d)::text as from, max(d)::text as to
		from (
			select business_date as d from public.sync_checks where store_id = any(${[...storeIds]}::uuid[])
			union all
			select business_date as d from public.sale_payloads where store_id = any(${[...storeIds]}::uuid[])
		) dates
	`;
	return { from: row?.from ?? null, to: row?.to ?? null };
}

interface StoredCustomization {
	name: string | null;
	active: boolean;
	targets: Set<string>;
	options: Map<number, SnapshotRow>;
}

/**
 * The account's customizations as iPOS would list them, rebuilt from the stored option groups (ADR-058 phase 3):
 * each group's raw keeps the customization id and name, the option's position and the iPOS option itself, and its
 * targets give list_item. Null when the database has no option-group tables or the account no group, so the
 * caller falls back to the modifiers.
 */
async function customizationsFromOptionGroups(
	sql: Sql,
	accountId: string,
): Promise<SnapshotRow[] | null> {
	const [present] = await sql<{ ready: boolean }[]>`
		select to_regclass('public.item_option_groups') is not null
			and to_regclass('public.item_option_group_targets') is not null as ready
	`;
	if (!present?.ready) {
		return null;
	}
	const groups = await sql<
		{ active: boolean; raw: unknown; targets: string[] }[]
	>`
		select g.active, g.raw,
			coalesce(
				(select array_agg(t.item_external_id order by t.item_external_id)
				 from public.item_option_group_targets t
				 where t.pos_account_id = g.pos_account_id and t.group_external_id = g.external_id),
				'{}'::text[]
			) as targets
		from public.item_option_groups g
		where g.pos_account_id = ${accountId}
		order by g.external_id
	`;
	const customizations = new Map<string, StoredCustomization>();
	for (const group of groups) {
		const raw = isRow(group.raw) ? group.raw : null;
		const uid = text(raw?.customizationUid);
		const position = raw?.position;
		if (
			!raw ||
			!uid ||
			typeof position !== "number" ||
			!Number.isInteger(position) ||
			!isRow(raw.option)
		) {
			continue;
		}
		const entry = customizations.get(uid) ?? {
			name: text(raw.customizationName),
			active: group.active,
			targets: new Set<string>(),
			options: new Map<number, SnapshotRow>(),
		};
		entry.active ||= group.active;
		for (const target of group.targets) {
			entry.targets.add(target);
		}
		entry.options.set(position, raw.option);
		customizations.set(uid, entry);
	}
	if (customizations.size === 0) {
		return null;
	}
	return [...customizations].map(([uid, entry]) => ({
		id: uid,
		name: entry.name ?? text(entry.options.get(0)?.Name) ?? uid,
		active: entry.active ? 1 : 0,
		list_item: [...entry.targets].sort(),
		data: {
			LstItem_Options: [...entry.options]
				.sort(([left], [right]) => left - right)
				.map(([, option]) => option),
		},
	}));
}

interface MasterRows {
	items: SnapshotRow[];
	itemTypes: SnapshotRow[];
	itemClasses: SnapshotRow[];
	sources: SnapshotRow[];
	paymentMethods: SnapshotRow[];
	promotions: SnapshotRow[];
	packages: SnapshotRow[];
	customizations: SnapshotRow[];
}

async function masterRows(
	sql: Sql,
	accountId: string,
	typeUids: ReadonlyMap<string, string>,
): Promise<MasterRows> {
	const items = await sql<
		{
			external_id: string;
			name: string;
			item_type_external_id: string | null;
			item_class_external_id: string | null;
			list_price: number | null;
			takeaway_price: number | null;
			cost_price: number | null;
			active: boolean;
		}[]
	>`
		select external_id, name, item_type_external_id, item_class_external_id,
			list_price::float8 as list_price, takeaway_price::float8 as takeaway_price,
			cost_price::float8 as cost_price, active
		from public.items where pos_account_id = ${accountId} order by external_id
	`;
	const entries = async (table: string) =>
		sql<{ external_id: string; name: string; active: boolean }[]>`
			select external_id, name, active from ${sql(`public.${table}`)}
			where pos_account_id = ${accountId} order by external_id
		`;
	const raws = async (table: string) =>
		(
			await sql<{ raw: unknown }[]>`
				select raw from ${sql(`public.${table}`)}
				where pos_account_id = ${accountId} and raw is not null
				order by external_id
			`
		)
			.map((row) => row.raw)
			.filter(isRow);
	const typeId = (externalId: string) => typeUids.get(externalId) ?? externalId;
	const fromOptionGroups = await customizationsFromOptionGroups(sql, accountId);
	const customizations = new Map<string, SnapshotRow[]>();
	for (const raw of await raws("customizations")) {
		const uid = text(raw.customizationUid);
		if (!uid || !isRow(raw.option)) {
			continue;
		}
		const options = customizations.get(uid) ?? [];
		if (
			!options.some(
				(option) => JSON.stringify(option) === JSON.stringify(raw.option),
			)
		) {
			options.push(raw.option);
		}
		customizations.set(uid, options);
	}
	return {
		items: items.map((item) => ({
			id: item.external_id,
			item_id: item.external_id,
			item_name: item.name,
			ots_price: item.list_price,
			ta_price: item.takeaway_price,
			cost_price: item.cost_price ?? 0,
			active: item.active ? 1 : 0,
			deleted: false,
			item_type_uid: item.item_type_external_id
				? typeId(item.item_type_external_id)
				: null,
			item_class_uid: item.item_class_external_id,
			unit_uid: null,
		})),
		itemTypes: (await entries("item_types")).map((type) => ({
			id: typeId(type.external_id),
			item_type_id: type.external_id,
			item_type_name: type.name,
			item_type_parent_id: null,
			active: type.active ? 1 : 0,
			deleted: false,
		})),
		itemClasses: (await entries("item_classes")).map((itemClass) => ({
			id: itemClass.external_id,
			item_class_id: itemClass.external_id,
			item_class_name: itemClass.name,
			active: itemClass.active ? 1 : 0,
			deleted: false,
		})),
		sources: (await entries("sources")).map((source) => ({
			id: source.external_id,
			source_id: source.external_id,
			source_name: source.name,
			active: source.active ? 1 : 0,
			deleted: false,
		})),
		paymentMethods: (await entries("payment_methods")).map((method) => ({
			id: method.external_id,
			payment_method_id: method.external_id,
			payment_method_name: method.name,
			active: method.active ? 1 : 0,
			deleted: false,
		})),
		promotions: await raws("promotions"),
		packages: await raws("packages"),
		customizations:
			fromOptionGroups ??
			[...customizations].map(([uid, options]) => ({
				id: uid,
				name: text(options[0]?.Name) ?? uid,
				active: 1,
				list_item: [],
				data: { LstItem_Options: options },
			})),
	};
}

function storeRow(
	store: StoreRow,
	company: string,
	brand: string,
): SnapshotRow {
	return {
		id: store.external_id,
		store_id: store.code,
		store_name: store.name,
		brand_uid: brand,
		company_uid: company,
		address: store.address,
		active: store.active ? 1 : 0,
		open_at: store.business_day_start_minutes / 60,
	};
}

function currencyOf(store: StoreRow): string {
	return isRow(store.raw) && typeof store.raw.currency === "string"
		? store.raw.currency
		: "VND";
}

export async function snapshotFromDatabase(
	sql: Sql,
	account: SnapshotAccount,
): Promise<DatabaseSnapshot> {
	const stores = await storesOf(sql, account.id);
	const units = new Map<string, string>();
	const typeUids = new Map<string, string>();
	const counts: SnapshotCounts = {
		stores: stores.length,
		salesDays: 0,
		invoices: 0,
		lines: 0,
		payments: 0,
		voidedLeftOut: 0,
		shifts: 0,
		controlTotals: 0,
		editedOrDeleted: 0,
		removedItemEvents: 0,
		items: 0,
	};
	const brands = new Map<
		string,
		{ name: string | null; currency: string; stores: StoreRow[] }
	>();
	const storeContents = new Map<string, SnapshotStoreContent>();
	let company: string | null = null;
	for (const store of stores) {
		const scope = await scopeOf(sql, store.id);
		company ??= scope.company;
		const brandUid = scope.brand ?? STAND_IN_BRAND;
		const sales = await salesOf(sql, store, units, typeUids);
		const adjustments = await adjustmentsOf(sql, store.id);
		const shifts = await shiftsOf(sql, store.id);
		const days = await dayRows(sql, store);
		const brand = brands.get(brandUid) ?? {
			name: null,
			currency: currencyOf(store),
			stores: [],
		};
		brand.name ??= sales.brandName;
		brand.stores.push(store);
		brands.set(brandUid, brand);
		storeContents.set(store.id, {
			storeUid: store.external_id,
			items: [],
			customizations: [],
			packages: [],
			invoices: sales.invoices,
			lines: sales.lines,
			payments: sales.payments,
			shifts,
			days,
			editedOrDeleted: adjustments.editedOrDeleted,
			removedItemEvents: adjustments.removed,
		});
		counts.salesDays += sales.salesDays;
		counts.invoices += sales.invoices.length;
		counts.lines += sales.lines.length;
		counts.payments += sales.payments.length;
		counts.voidedLeftOut += sales.voidedLeftOut;
		counts.shifts += shifts.length;
		counts.controlTotals += days.length;
		counts.editedOrDeleted += adjustments.editedOrDeleted.length;
		counts.removedItemEvents += adjustments.removed.length;
	}
	const master = await masterRows(sql, account.id, typeUids);
	counts.items = master.items.length;
	const companyUid = company ?? STAND_IN_COMPANY;
	const unitRows = [...units].map(([unitId, name]) => ({
		id: unitId,
		unit_id: unitId,
		unit_name: name,
	}));
	const brandContents: SnapshotBrandContent[] = [...brands].map(
		([brandUid, brand]) => ({
			brandUid,
			stores: brand.stores.map((store) =>
				storeRow(store, companyUid, brandUid),
			),
			itemTypes: master.itemTypes,
			itemClasses: master.itemClasses,
			units: unitRows,
			sources: master.sources,
			paymentMethods: master.paymentMethods,
			promotions: master.promotions,
			storeContents: brand.stores.flatMap((store) => {
				const content = storeContents.get(store.id);
				return content
					? [
							{
								...content,
								items: master.items.map((item) => ({
									...item,
									store_uid: store.external_id,
								})),
								customizations: master.customizations,
								packages: master.packages,
							},
						]
					: [];
			}),
		}),
	);
	const coverage = await coverageOf(
		sql,
		stores.map((store) => store.id),
	);
	return {
		content: {
			login: {
				user: { id: STAND_IN_USER, email: "snapshot@example.com" },
				company: { id: companyUid, company_name: null, active: 1 },
				brands: [...brands].map(([brandUid, brand]) => ({
					id: brandUid,
					brand_name: brand.name ?? "iPOS snapshot",
					currency: brand.currency,
					active: 1,
				})),
				cities: [],
				stores: brandContents.flatMap((brand) => brand.stores),
			},
			brands: brandContents,
			coveredFrom: coverage.from,
			coveredTo: coverage.to,
		},
		counts,
		rebuilt: [
			...REBUILT_PARTS,
			...(company === null
				? [
						"company and brand ids: no shift payload holds them, stand-in ids were used",
					]
				: []),
		],
	};
}

export async function iposAccountsOf(
	sql: Sql,
	tenantId: string,
): Promise<SnapshotAccount[]> {
	return sql<SnapshotAccount[]>`
		select id, account_key
		from public.pos_accounts
		where tenant_id = ${tenantId} and connector = 'ipos-fabi'
		order by account_key
	`;
}
