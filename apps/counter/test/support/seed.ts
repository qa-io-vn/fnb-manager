import { randomBytes, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";

/**
 * A synthetic native tenant on the local stack for the counter's integration and end-to-end tests (never the real
 * tenant): a slug starting with "ct-", two native stores A and B of one brand, the brand's Zalo App, a published staff
 * notice, a menu (a coffee with two sizes and an ice group, a tea, a bread that earns no stamp), three tables at A and
 * one at B, and people with logins made through the Auth admin API (so sessions can be minted and passwords used):
 * an owner, a manager of A, two staff members of A and one of B, all bound to Zalo identities and with a current staff
 * notice consent. Everything goes with the tenant at the end.
 */

export interface LocalStack {
	readonly databaseUrl: string;
	readonly supabaseUrl: string;
	readonly secretKey: string;
	readonly publishableKey: string;
}

export function localStackFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): LocalStack | null {
	const databaseUrl = env.COUNTER_DATABASE_URL ?? "";
	const supabaseUrl = env.SUPABASE_URL ?? "";
	const secretKey = env.SUPABASE_SECRET_KEY ?? "";
	const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? "";
	const loopback =
		/^(https?|postgresql):\/\/([^@/]*@)?(127\.0\.0\.1|localhost):\d+/;
	if (
		!loopback.test(databaseUrl) ||
		!loopback.test(supabaseUrl) ||
		secretKey === "" ||
		publishableKey === ""
	) {
		return null;
	}
	return {
		databaseUrl,
		supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
		secretKey,
		publishableKey,
	};
}

export interface SeededPerson {
	readonly id: string;
	readonly email: string;
	readonly password: string;
	readonly zaloId: string;
	readonly name: string;
}

export interface SeededTenant {
	readonly slug: string;
	readonly tenantId: string;
	readonly brandId: string;
	readonly zaloAppId: string;
	readonly externalAppId: string;
	readonly appSecret: string;
	readonly secretName: string;
	readonly noticeVersion: string;
	readonly storeA: string;
	readonly storeB: string;
	readonly storeCodeA: string;
	readonly people: {
		readonly owner: SeededPerson;
		readonly manager: SeededPerson;
		readonly staff: SeededPerson;
		readonly staff2: SeededPerson;
		readonly staffB: SeededPerson;
	};
	readonly tables: {
		readonly t1: string;
		readonly t2: string;
		readonly t3: string;
		readonly b1: string;
	};
	readonly items: {
		readonly coffee: string;
		readonly tea: string;
		readonly bread: string;
	};
	readonly sizes: {
		readonly coffeeM: string;
		readonly coffeeL: string;
		readonly tea: string;
		readonly bread: string;
	};
	readonly options: { readonly lessIce: string; readonly noIce: string };
}

export const COFFEE_M = 29_000;
export const COFFEE_L = 35_000;
export const TEA = 39_000;
export const BREAD = 25_000;

async function adminFetch(
	stack: LocalStack,
	path: string,
	init: RequestInit,
): Promise<Record<string, unknown>> {
	const response = await fetch(`${stack.supabaseUrl}/auth/v1${path}`, {
		...init,
		headers: {
			apikey: stack.secretKey,
			...(stack.secretKey.startsWith("sb_")
				? {}
				: { authorization: `Bearer ${stack.secretKey}` }),
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`auth admin ${path}: HTTP ${response.status} ${text.slice(0, 200)}`,
		);
	}
	return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

export async function createLogin(
	stack: LocalStack,
	email: string,
	password: string,
): Promise<string> {
	const user = await adminFetch(stack, "/admin/users", {
		method: "POST",
		body: JSON.stringify({ email, password, email_confirm: true }),
	});
	if (typeof user.id !== "string")
		throw new Error("the Auth admin API answered no user id");
	return user.id;
}

export async function deleteLogin(
	stack: LocalStack,
	id: string,
): Promise<void> {
	try {
		await adminFetch(stack, `/admin/users/${id}`, { method: "DELETE" });
	} catch {
		// the tenant cleanup removes what it can
	}
}

const HOURS = Object.fromEntries(
	["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
		day,
		[["00:00", "24:00"]],
	]),
);

export function connect(stack: LocalStack): Sql {
	return postgres(stack.databaseUrl, {
		max: 2,
		idle_timeout: 5,
		onnotice: () => undefined,
	});
}

export async function seedCounterTenant(
	stack: LocalStack,
	sql: Sql,
	prefix = "ct",
): Promise<SeededTenant> {
	const hex = randomBytes(4).toString("hex");
	const slug = `${prefix}-${hex}`;
	const tenantId = randomUUID();
	const accountId = randomUUID();
	const storeA = randomUUID();
	const storeB = randomUUID();
	const brandId = randomUUID();
	const zaloAppId = randomUUID();
	const externalAppId = `${slug}-app`;
	const appSecret = `synthetic-secret-${randomBytes(12).toString("hex")}`;
	const noticeVersion = "2026-11-01";
	const storeCodeA = `${slug}-a`;

	await sql`insert into public.tenants (id, slug, name) values (${tenantId}, ${slug}, 'Synthetic counter tenant')`;
	await sql`insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
		values (${accountId}, ${tenantId}, 'mock', ${`${slug}-account`}, 'Synthetic account')`;
	for (const [id, code, name] of [
		[storeA, storeCodeA, "Cửa hàng mẫu A"],
		[storeB, `${slug}-b`, "Cửa hàng mẫu B"],
	] as const) {
		await sql`insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
			values (${id}, ${tenantId}, ${accountId}, ${code}, ${code}, ${name}, ${sql.json(HOURS as never)})`;
		await sql`insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required, late_order_minutes)
			values (${id}, ${tenantId}, 'native', true, array['table', 'takeaway'], array['counter'], false, 10)`;
	}
	await sql`insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
		values (${brandId}, ${tenantId}, 'brand-1', 'Synthetic brand', array[${storeA}::uuid, ${storeB}::uuid])`;
	await sql`insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
		values (${zaloAppId}, ${tenantId}, ${brandId}, ${externalAppId}, 'ZALO_APP_SECRET_BRAND_1', 'active')`;
	await sql`insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
		values (${tenantId}, 'staff_notice', 'vi', ${noticeVersion}, 'Thông báo cho nhân viên', 'Nội dung mẫu của thông báo.', 'published', now() - interval '1 day')`;

	const person = async (
		key: string,
		name: string,
		role: "owner" | "manager" | "staff",
		stores: readonly string[] | null,
		roster: boolean,
	): Promise<SeededPerson> => {
		const email = `${slug}-${key}@example.com`;
		const password = `pw-${randomBytes(12).toString("hex")}`;
		const id = await createLogin(stack, email, password);
		await sql`insert into public.tenant_members (tenant_id, user_id, role, store_ids)
			values (${tenantId}, ${id}, ${role}, ${stores === null ? null : [...stores]}::uuid[])`;
		if (roster) {
			await sql`insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
				values (${tenantId}, ${name}, ${role}, ${stores === null ? null : [...stores]}::uuid[], 'active', ${id}, now())`;
			await sql`select app.record_staff_ops_consent(${tenantId}::uuid, ${id}::uuid, ${noticeVersion}, now(), now())`;
		}
		const zaloId = `${slug}-zalo-${key}`;
		await sql`insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id, display_name)
			values (${tenantId}, ${zaloAppId}, ${zaloId}, ${id}, ${name})`;
		return { id, email, password, zaloId, name };
	};
	const owner = await person("owner", "Chủ quán mẫu", "owner", null, false);
	const manager = await person(
		"manager",
		"Quản lý mẫu",
		"manager",
		[storeA],
		true,
	);
	const staff = await person("staff", "Thu ngân mẫu", "staff", [storeA], true);
	const staff2 = await person("staff2", "Pha chế mẫu", "staff", [storeA], true);
	const staffB = await person("staffb", "Nhân viên B", "staff", [storeB], true);

	const categories = {
		coffee: randomUUID(),
		tea: randomUUID(),
		bread: randomUUID(),
	};
	for (const [id, name, order] of [
		[categories.coffee, "Cà phê", 1],
		[categories.tea, "Trà", 2],
		[categories.bread, "Bánh", 3],
	] as const) {
		await sql`insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order) values (${id}, ${tenantId}, ${brandId}, ${name}, ${order})`;
	}
	const items = {
		coffee: randomUUID(),
		tea: randomUUID(),
		bread: randomUUID(),
	};
	await sql`insert into public.menu_items (id, tenant_id, brand_id, category_id, name, description, sort_order, labels)
		values (${items.coffee}, ${tenantId}, ${brandId}, ${categories.coffee}, 'Cà phê sữa', 'Đậm, ngọt vừa', 1, array['best_seller'])`;
	await sql`insert into public.menu_items (id, tenant_id, brand_id, category_id, name, sort_order)
		values (${items.tea}, ${tenantId}, ${brandId}, ${categories.tea}, 'Trà đào', 1)`;
	await sql`insert into public.menu_items (id, tenant_id, brand_id, category_id, name, sort_order, counts_for_stamps)
		values (${items.bread}, ${tenantId}, ${brandId}, ${categories.bread}, 'Bánh chuối', 1, false)`;
	const sizes = {
		coffeeM: randomUUID(),
		coffeeL: randomUUID(),
		tea: randomUUID(),
		bread: randomUUID(),
	};
	await sql`insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
		values (${sizes.coffeeM}, ${tenantId}, ${brandId}, ${items.coffee}, 'Vừa', ${COFFEE_M}, 1, true),
			(${sizes.coffeeL}, ${tenantId}, ${brandId}, ${items.coffee}, 'Lớn', ${COFFEE_L}, 2, false),
			(${sizes.tea}, ${tenantId}, ${brandId}, ${items.tea}, null, ${TEA}, 1, true),
			(${sizes.bread}, ${tenantId}, ${brandId}, ${items.bread}, null, ${BREAD}, 1, true)`;
	const iceGroup = randomUUID();
	const options = { lessIce: randomUUID(), noIce: randomUUID() };
	await sql`insert into public.menu_option_groups (id, tenant_id, brand_id, name, min_select, max_select)
		values (${iceGroup}, ${tenantId}, ${brandId}, 'Đá', 0, 1)`;
	await sql`insert into public.menu_options (id, tenant_id, brand_id, group_id, name, price_delta, sort_order)
		values (${options.lessIce}, ${tenantId}, ${brandId}, ${iceGroup}, 'Ít đá', 0, 1),
			(${options.noIce}, ${tenantId}, ${brandId}, ${iceGroup}, 'Không đá', 0, 2)`;
	await sql`insert into public.menu_item_option_groups (tenant_id, brand_id, item_id, group_id)
		values (${tenantId}, ${brandId}, ${items.coffee}, ${iceGroup})`;
	const tables = {
		t1: randomUUID(),
		t2: randomUUID(),
		t3: randomUUID(),
		b1: randomUUID(),
	};
	for (const [id, store, label, order] of [
		[tables.t1, storeA, "Bàn 1", 1],
		[tables.t2, storeA, "Bàn 2", 2],
		[tables.t3, storeA, "Bàn 3", 3],
		[tables.b1, storeB, "Bàn B1", 1],
	] as const) {
		await sql`insert into public.store_tables (id, tenant_id, store_id, label, area, sort_order)
			values (${id}, ${tenantId}, ${store}, ${label}, 'Tầng 1', ${order})`;
	}
	return {
		slug,
		tenantId,
		brandId,
		zaloAppId,
		externalAppId,
		appSecret,
		secretName: "ZALO_APP_SECRET_BRAND_1",
		noticeVersion,
		storeA,
		storeB,
		storeCodeA,
		people: { owner, manager, staff, staff2, staffB },
		tables,
		items,
		sizes,
		options,
	};
}

/** Removes the tenant (everything of it cascades) and the logins it made, including those made by pairing. */
export async function dropCounterTenant(
	stack: LocalStack,
	sql: Sql,
	seeded: SeededTenant,
): Promise<void> {
	const extra = await sql<{ id: string }[]>`
		select distinct user_id as id from public.tenant_members where tenant_id = ${seeded.tenantId}
		union select distinct user_id from public.staff_roster where tenant_id = ${seeded.tenantId} and user_id is not null
		union select distinct user_id from app.customer_logins where tenant_id = ${seeded.tenantId}
	`;
	await sql`delete from public.tenants where id = ${seeded.tenantId}`;
	const ids = new Set([
		...Object.values(seeded.people).map((person) => person.id),
		...extra.map((row) => row.id),
	]);
	for (const id of ids) {
		await deleteLogin(stack, id);
	} // customers made directly in auth.users (and anything the admin API kept) go by their synthetic address
	await sql`delete from auth.users where email like ${`${seeded.slug}-%@example.com`}`;
}

/** A customer of the tenant (a Zalo login of the customer Mini App), for placing orders as the app does. */
export async function seedCustomer(
	sql: Sql,
	seeded: SeededTenant,
): Promise<string> {
	const id = randomUUID();
	await sql`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
		values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
			${`${seeded.slug}-customer-${id.slice(0, 8)}@example.com`},
			${sql.json({ kind: "customer", tenant_id: seeded.tenantId } as never)})`;
	await sql`insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
		values (${seeded.tenantId}, ${seeded.zaloAppId}, ${`${seeded.slug}-cust-${id.slice(0, 8)}`}, ${id})`;
	return id;
}

export async function tableToken(
	sql: Sql,
	seeded: SeededTenant,
	tableId: string,
): Promise<string> {
	const [row] = await sql<{ token: string }[]>`
		select app.table_qr_token(${seeded.tenantId}::uuid, ${tableId}::uuid, (select qr_version from public.store_tables where id = ${tableId})) as token`;
	if (row === undefined) throw new Error("no table token");
	return row.token;
}

/** Places a pay-at-the-counter table order as the customer app does (the database's own function, as the customer). */
export async function placeCustomerOrder(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
	input: {
		readonly table: string;
		readonly lines: readonly {
			readonly size: string;
			readonly qty: number;
			readonly options?: readonly string[];
		}[];
		readonly expectedTotal: number;
	},
): Promise<{
	readonly state: string;
	readonly order: { readonly id: string; readonly display_no: string } | null;
}> {
	const token = await tableToken(sql, seeded, input.table);
	return await sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({
			sub: customer,
			role: "authenticated",
			app_metadata: { kind: "customer", tenant_id: seeded.tenantId },
		})}, true)`;
		const [row] = await tx<
			{
				r: { state: string; order: { id: string; display_no: string } | null };
			}[]
		>`
			select app.customer_place_order(${tx.json({
				request_id: randomUUID(),
				store: seeded.storeCodeA,
				type: "table",
				table_token: token,
				payment: "counter",
				lines: input.lines.map((line) => ({
					size: line.size,
					qty: line.qty,
					options: line.options ?? [],
				})),
				expected_total: input.expectedTotal,
			} as never)}::jsonb, now()) as r`;
		if (row === undefined) throw new Error("no answer");
		return row.r;
	});
}

/**
 * Store A takes takeaway bookings (C17): VietQR among its ways to pay (takeaway is prepaid), 15 minutes to prepare,
 * 15-minute slots of 6 orders. `restoreTakeawayBooking` puts the seed's values back (pay at the counter only, 10
 * minutes), so other suites find the store as seeded.
 */
export async function allowTakeawayBooking(
	sql: Sql,
	seeded: SeededTenant,
): Promise<void> {
	await sql`update public.store_ordering_settings
		set payment_methods = array['counter', 'vietqr'], prep_minutes = 15, takeaway_slot_minutes = 15, takeaway_slot_limit = 6
		where store_id = ${seeded.storeA}`;
}

export async function restoreTakeawayBooking(
	sql: Sql,
	seeded: SeededTenant,
): Promise<void> {
	await sql`update public.store_ordering_settings
		set payment_methods = array['counter'], prep_minutes = 10, takeaway_slot_minutes = 15, takeaway_slot_limit = 6
		where store_id in (${seeded.storeA}, ${seeded.storeB})`;
}

/**
 * A bookable pick-up slot on the database's clock: the first 15-minute boundary at least `minutesAhead` minutes away
 * (the stores are open all day, their business day starting at midnight), or the first bookable slot when that one
 * would fall on the next business day, which the server does not offer while today still has slots.
 */
export async function nextSlot(
	sql: Sql,
	minutesAhead: number,
): Promise<string> {
	const [row] = await sql<{ slot: Date; first: Date }[]>`
		select to_timestamp(ceil(extract(epoch from now() + make_interval(mins => ${minutesAhead})) / 900) * 900) as slot,
			to_timestamp(ceil(extract(epoch from now() + interval '15 minutes 5 seconds') / 900) * 900) as first`;
	if (row === undefined) throw new Error("no clock");
	const day = (at: Date) =>
		new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
	return (
		day(row.slot) === day(row.first) ? row.slot : row.first
	).toISOString();
}

/**
 * A customer's takeaway booked for `pickupAt` and paid by VietQR, as the app and the server's payment confirmation do
 * it (customer_place_order, then the checkout seams the payment functions call): an accepted, paid order that waits as
 * scheduled until its preparation start. Needs `allowTakeawayBooking` first.
 */
export async function bookTakeaway(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
	pickupAt: string,
): Promise<{ readonly id: string; readonly displayNo: string }> {
	const placed = await sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({
			sub: customer,
			role: "authenticated",
			app_metadata: { kind: "customer", tenant_id: seeded.tenantId },
		})}, true)`;
		const [row] = await tx<
			{
				r: {
					state: string;
					refusal: string | null;
					order: { id: string } | null;
				};
			}[]
		>`
			select app.customer_place_order(${tx.json({
				request_id: randomUUID(),
				store: seeded.storeCodeA,
				type: "takeaway",
				payment: "vietqr",
				pickup_at: pickupAt,
				lines: [{ size: seeded.sizes.coffeeM, qty: 1, options: [] }],
				expected_total: COFFEE_M,
			} as never)}::jsonb, now()) as r`;
		return row?.r;
	});
	const id = placed?.order?.id;
	if (placed?.state !== "awaiting_payment" || id === undefined)
		throw new Error(
			`the booking was refused: ${placed?.refusal ?? placed?.state}`,
		);
	const key = `ct-${randomUUID().replace(/-/g, "")}`;
	const [start] = await sql<{ r: { payment_id: string } }[]>`
		select app.checkout_payment_start(${customer}::uuid, ${id}::uuid, 'vietqr', ${key}, now()) as r`;
	await sql`select app.checkout_payment_confirm('vietqr', ${`ref-${key}`}, ${start?.r.payment_id ?? ""}::uuid, ${COFFEE_M}, true, null, now())`;
	const [order] = await sql<{ display_no: string }[]>`
		select app.order_display_no(order_no) as display_no from public.orders where id = ${id} and status = 'accepted'`;
	if (order === undefined) throw new Error("the booking was not paid");
	return { id, displayNo: order.display_no };
}

/** The customer app's poll of the menu: which items are unavailable right now (acceptance criterion 2). */
export async function customerUnavailableItems(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
): Promise<string[]> {
	return await sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({
			sub: customer,
			role: "authenticated",
			app_metadata: { kind: "customer", tenant_id: seeded.tenantId },
		})}, true)`;
		const [row] = await tx<{ r: { unavailable_items: string[] } }[]>`
			select app.customer_menu_version(${seeded.storeCodeA}, now()) as r`;
		return row?.r.unavailable_items ?? [];
	});
}

/** A customer pressing "Gọi nhân viên" at a table. */
export async function callStaff(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
	table: string,
): Promise<void> {
	const token = await tableToken(sql, seeded, table);
	await sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({
			sub: customer,
			role: "authenticated",
			app_metadata: { kind: "customer", tenant_id: seeded.tenantId },
		})}, true)`;
		await tx`select app.customer_call_staff(${seeded.storeCodeA}, ${token}, now())`;
	});
}

/** Runs a database call as a customer of the tenant's app, as PostgREST would (the customer's claims, one transaction). */
export async function asCustomer<T>(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
	run: (tx: Sql) => Promise<T>,
): Promise<T> {
	return (await sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({
			sub: customer,
			role: "authenticated",
			app_metadata: { kind: "customer", tenant_id: seeded.tenantId },
		})}, true)`;
		return await run(tx as unknown as Sql);
	})) as T;
}

/** A customer who joined with a phone: a synthetic customer record linked to a new login of the app. */
export async function seedJoinedCustomer(
	sql: Sql,
	seeded: SeededTenant,
	name: string,
	phone: string,
): Promise<string> {
	const login = await seedCustomer(sql, seeded);
	const customerId = randomUUID();
	await sql`insert into public.customers (id, tenant_id, name, phone) values (${customerId}, ${seeded.tenantId}, ${name}, ${phone})`;
	await sql`update app.customer_logins set customer_id = ${customerId} where user_id = ${login}`;
	return login;
}

/** A new member code of the customer's stamp card, as the app's C20 asks it (customer_stamp_code). */
export async function issueStampCode(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
): Promise<unknown> {
	return await asCustomer(sql, seeded, customer, async (tx) => {
		const [row] = await tx<
			{ r: unknown }[]
		>`select public.customer_stamp_code() as r`;
		return row?.r;
	});
}

/** A booking the customer asks for at store A, at a given instant (customer_submit_request). */
export async function submitBooking(
	sql: Sql,
	seeded: SeededTenant,
	customer: string,
	at: string,
): Promise<{ readonly id: string; readonly version: number }> {
	return await asCustomer(sql, seeded, customer, async (tx) => {
		const [row] = await tx<
			{ r: { state: string; request: { id: string; version: number } } }[]
		>`select public.customer_submit_request(${tx.json({
			request_id: randomUUID(),
			store: seeded.storeCodeA,
			kind: "booking",
			name: "Khách Mẫu",
			phone: "0900000001",
			party_size: 4,
			at,
		} as never)}) as r`;
		if (row?.r.state !== "submitted")
			throw new Error(
				`the booking was not submitted: ${JSON.stringify(row?.r)}`,
			);
		return row.r.request;
	});
}
