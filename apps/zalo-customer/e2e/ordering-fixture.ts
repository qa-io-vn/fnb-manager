import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// A synthetic native store on the local stack for the ordering specs (native-till.md; ADR-060 to ADR-065): a tenant
// zalo-it-ordering-<hex> with one store open around the clock, ordering on for table orders paid at the counter, no
// counter presence needed, a small menu, two tables, an owner and a staff member, and (without the local loop) a
// brand with a mock Zalo App and two customer logins. Everything is removed again by cleanup(); nothing else of the
// database is read or written, and no real tenant is touched.

const ZALO_PACKAGE = new URL(
	"../../../packages/zalo/package.json",
	import.meta.url,
);
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
const DAY = [["00:00", "24:00"]];
const OPEN_ALL_DAY = {
	mon: DAY,
	tue: DAY,
	wed: DAY,
	thu: DAY,
	fri: DAY,
	sat: DAY,
	sun: DAY,
};

type Row = Record<string, unknown>;

export interface Sql {
	<T extends Row = Row>(
		strings: TemplateStringsArray,
		...values: readonly unknown[]
	): Promise<T[]>;
	begin<T>(run: (sql: Sql) => Promise<T>): Promise<T>;
	json(value: unknown): unknown;
	end(options?: { readonly timeout?: number }): Promise<void>;
}

export interface NativeMenu {
	readonly brandId: string;
	readonly coffee: string;
	readonly coffeeM: string;
	readonly coffeeL: string;
	readonly cake: string;
	readonly cakeSize: string;
	readonly extraGroup: string;
	readonly shot: string;
	readonly tableId: string;
	readonly tableToken: string;
	readonly otherTableToken: string;
}

export interface OrderingFixture {
	readonly sql: Sql;
	readonly slug: string;
	readonly tenantId: string;
	readonly storeId: string;
	readonly storeCode: string;
	readonly staffId: string;
	readonly ownerId: string;
	/** the customers of the fixture's own brand (empty when the local loop seeds the brand) */
	readonly customers: readonly string[];
	menu(): NativeMenu;
	/** makes the store native with its menu and tables, for the brand of the tenant (the loop's or the fixture's) */
	makeNative(): Promise<NativeMenu>;
	asCustomer<T>(userId: string, run: (sql: Sql) => Promise<T>): Promise<T>;
	asStaff<T>(run: (sql: Sql) => Promise<T>, userId?: string): Promise<T>;
	cleanup(): Promise<void>;
}

async function connect(url: string): Promise<Sql> {
	const require = createRequire(ZALO_PACKAGE);
	const loaded = await import(pathToFileURL(require.resolve("postgres")).href);
	const postgres = (loaded.default ?? loaded) as (
		url: string,
		options: Row,
	) => Sql;
	return postgres(url, {
		max: 1,
		connect_timeout: 10,
		onnotice: () => undefined,
	});
}

async function insertUser(
	sql: Sql,
	id: string,
	email: string,
	appMeta: Row,
): Promise<void> {
	await sql`
		insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
		values (${id}::uuid, ${AUTH_INSTANCE_ID}::uuid, 'authenticated', 'authenticated', ${email},
			${JSON.stringify(appMeta)}::jsonb, now(), now())
	`;
}

export async function openOrderingFixture(
	databaseUrl: string,
	options: { readonly ownBrand: boolean },
): Promise<OrderingFixture> {
	const sql = await connect(databaseUrl);
	const hex = randomBytes(4).toString("hex");
	const slug = `zalo-it-ordering-${hex}`;
	const tenantId = randomUUID();
	const storeId = randomUUID();
	const storeCode = `zit-ord-${hex}`;
	const staffId = randomUUID();
	const ownerId = randomUUID();
	const customers = options.ownBrand ? [randomUUID(), randomUUID()] : [];
	const accountId = randomUUID();
	const removeAll = async (): Promise<void> => {
		const logins = await sql<{ user_id: string }>`
			select l.user_id::text as user_id from app.customer_logins l where l.tenant_id = ${tenantId}::uuid
		`;
		await sql`delete from public.tenants where id = ${tenantId}::uuid`;
		const users = [
			...new Set([
				staffId,
				ownerId,
				...customers,
				...logins.map((row) => row.user_id),
			]),
		];
		await sql`delete from auth.users where id = any(${users}::uuid[])`;
	};
	try {
		await sql`insert into public.tenants (id, slug, name) values (${tenantId}::uuid, ${slug}, 'IT customer ordering')`;
		await sql`
			insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
			values (${accountId}::uuid, ${tenantId}::uuid, 'mock', ${`${slug}-account`}, 'IT account')
		`;
		await sql`
			insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
			values (${storeId}::uuid, ${tenantId}::uuid, ${accountId}::uuid, ${`${slug}-s1`}, ${storeCode}, 'Cửa hàng IT',
				${sql.json(OPEN_ALL_DAY)})
		`;
		await insertUser(sql, staffId, `${slug}-staff@example.com`, {});
		await insertUser(sql, ownerId, `${slug}-owner@example.com`, {});
		await sql`
			insert into public.tenant_members (tenant_id, user_id, role, store_ids)
			values (${tenantId}::uuid, ${staffId}::uuid, 'staff', array[${storeId}::uuid]),
				(${tenantId}::uuid, ${ownerId}::uuid, 'owner', array[${storeId}::uuid])
		`;
		if (options.ownBrand) {
			const brandId = randomUUID();
			const appId = randomUUID();
			await sql`
				insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
				values (${brandId}::uuid, ${tenantId}::uuid, 'brand-1', 'IT brand', array[${storeId}::uuid])
			`;
			await sql`
				insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
				values (${appId}::uuid, ${tenantId}::uuid, ${brandId}::uuid, ${`mock-${slug}-app`}, 'ZALO_APP_SECRET_BRAND_1', 'active')
			`;
			for (const [index, user] of customers.entries()) {
				await insertUser(sql, user, `${slug}-c${index}@example.com`, {
					kind: "customer",
					tenant_id: tenantId,
				});
				await sql`
					insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
					values (${tenantId}::uuid, ${appId}::uuid, ${`mock-${slug}-zalo-${index}`}, ${user}::uuid)
				`;
			}
		}
	} catch (error) {
		// a fixture that could not be made leaves nothing behind
		await removeAll();
		await sql.end({ timeout: 5 });
		throw error;
	}

	let native: NativeMenu | null = null;
	const makeNative = async (): Promise<NativeMenu> => {
		const [brand] = await sql<{ id: string }>`
			select id::text as id from public.brands where tenant_id = ${tenantId}::uuid order by brand_key limit 1
		`;
		if (brand === undefined) throw new Error("the tenant has no brand yet");
		const ids = {
			category: randomUUID(),
			coffee: randomUUID(),
			coffeeM: randomUUID(),
			coffeeL: randomUUID(),
			cake: randomUUID(),
			cakeSize: randomUUID(),
			extraGroup: randomUUID(),
			shot: randomUUID(),
			tableId: randomUUID(),
			otherTable: randomUUID(),
		};
		await sql`
			insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types,
				payment_methods, staff_presence_required, max_waiting_orders)
			values (${storeId}::uuid, ${tenantId}::uuid, 'native', true, array['table'], array['counter'], false, 200)
		`;
		await sql`insert into public.menu_categories (id, tenant_id, brand_id, name) values (${ids.category}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, 'Đồ uống')`;
		await sql`
			insert into public.menu_items (id, tenant_id, brand_id, category_id, name, description, labels)
			values (${ids.coffee}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, ${ids.category}::uuid, 'Cà phê sữa', 'Pha phin', array['best_seller']),
				(${ids.cake}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, ${ids.category}::uuid, 'Bánh chuối', null, '{}')
		`;
		await sql`update public.menu_items set counts_for_stamps = false where id = ${ids.cake}::uuid`;
		await sql`
			insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, is_default, sort_order)
			values (${ids.coffeeM}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, ${ids.coffee}::uuid, 'Vừa', 35000, true, 1),
				(${ids.coffeeL}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, ${ids.coffee}::uuid, 'Lớn', 45000, false, 2),
				(${ids.cakeSize}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, ${ids.cake}::uuid, null, 25000, true, 1)
		`;
		await sql`
			insert into public.menu_option_groups (id, tenant_id, brand_id, name, min_select, max_select)
			values (${ids.extraGroup}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, 'Thêm', 0, 1)
		`;
		await sql`
			insert into public.menu_options (id, tenant_id, brand_id, group_id, name, price_delta)
			values (${ids.shot}::uuid, ${tenantId}::uuid, ${brand.id}::uuid, ${ids.extraGroup}::uuid, 'Thêm một shot', 10000)
		`;
		await sql`
			insert into public.menu_item_option_groups (tenant_id, brand_id, item_id, group_id)
			values (${tenantId}::uuid, ${brand.id}::uuid, ${ids.coffee}::uuid, ${ids.extraGroup}::uuid)
		`;
		await sql`
			insert into public.store_tables (id, tenant_id, store_id, label, area)
			values (${ids.tableId}::uuid, ${tenantId}::uuid, ${storeId}::uuid, 'Bàn 12', 'Tầng 1'),
				(${ids.otherTable}::uuid, ${tenantId}::uuid, ${storeId}::uuid, 'Bàn 3', null)
		`;
		const [first] = await sql<{
			token: string;
		}>`select app.table_qr_token(${tenantId}::uuid, ${ids.tableId}::uuid, 1) as token`;
		const [second] = await sql<{
			token: string;
		}>`select app.table_qr_token(${tenantId}::uuid, ${ids.otherTable}::uuid, 1) as token`;
		native = {
			brandId: brand.id,
			coffee: ids.coffee,
			coffeeM: ids.coffeeM,
			coffeeL: ids.coffeeL,
			cake: ids.cake,
			cakeSize: ids.cakeSize,
			extraGroup: ids.extraGroup,
			shot: ids.shot,
			tableId: ids.tableId,
			tableToken: first?.token ?? "",
			otherTableToken: second?.token ?? "",
		};
		return native;
	};

	const as = <T>(claims: Row, run: (sql: Sql) => Promise<T>): Promise<T> =>
		sql.begin(async (tx) => {
			await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
			await tx`set local role authenticated`;
			return run(tx);
		});

	return {
		sql,
		slug,
		tenantId,
		storeId,
		storeCode,
		staffId,
		ownerId,
		customers,
		menu() {
			if (native === null) throw new Error("makeNative() first");
			return native;
		},
		makeNative,
		asCustomer: (userId, run) =>
			as(
				{
					sub: userId,
					role: "authenticated",
					app_metadata: { kind: "customer", tenant_id: tenantId },
				},
				run,
			),
		asStaff: (run, userId = staffId) =>
			as({ sub: userId, role: "authenticated" }, run),
		async cleanup() {
			await removeAll();
			await sql.end({ timeout: 5 });
		},
	};
}
