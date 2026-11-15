import { randomBytes, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { anonymousClient } from "./local-stack";

export const LOCAL_DATABASE_URL =
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const FIXTURE_SLUG_PREFIX = "e2e-settings-";
export const SETTINGS_ROLES = [
	"owner",
	"manager",
	"store-manager",
	"staff",
	"viewer",
] as const;
export type SettingsRole = (typeof SETTINGS_ROLES)[number];

const FIXTURE_PASSWORD = "e2e-settings-login";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const FIXTURE_EMAIL_SHAPE =
	"^e2e-(owner|manager|store-manager|staff|viewer)-[0-9a-f]{8}@example\\.com$";
const LEFTOVER_AGE = "1 hour";
const SALES_DAYS = 35;
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

const MEMBERSHIPS: Readonly<
	Record<SettingsRole, { role: string; firstStoreOnly: boolean }>
> = {
	owner: { role: "owner", firstStoreOnly: false },
	manager: { role: "manager", firstStoreOnly: false },
	"store-manager": { role: "manager", firstStoreOnly: true },
	staff: { role: "staff", firstStoreOnly: false },
	viewer: { role: "viewer", firstStoreOnly: false },
};

export interface SettingsLogin {
	readonly userId: string;
	readonly email: string;
	readonly password: string;
}

export interface SettingsFixture {
	readonly tenantId: string;
	readonly slug: string;
	readonly name: string;
	readonly accountId: string;
	readonly storeIds: readonly [string, string];
	readonly sales: { readonly from: string; readonly to: string };
	readonly logins: Readonly<Record<SettingsRole, SettingsLogin>>;
	clientAs(role: SettingsRole): Promise<SupabaseClient>;
	signIn(page: Page, role: SettingsRole): Promise<void>;
	teardown(): Promise<void>;
}

type Sql = postgres.Sql;

export function fixtureDatabaseUrl(
	env: Readonly<Record<string, string | undefined>> = process.env,
): string {
	const url = env.E2E_DATABASE_URL ?? LOCAL_DATABASE_URL;
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		throw new Error("E2E_DATABASE_URL is not a database URL");
	}
	if (!LOOPBACK_HOSTS.has(host)) {
		throw new Error(
			"E2E_DATABASE_URL must point at a loopback host; the settings fixture never writes to another database",
		);
	}
	return url;
}

export function openFixtureDatabase(
	env: Readonly<Record<string, string | undefined>> = process.env,
): Sql {
	const sql = postgres(fixtureDatabaseUrl(env), {
		max: 1,
		onnotice: () => undefined,
	});
	const hosts = sql.options.host;
	if (
		sql.options.path !== false ||
		hosts.length === 0 ||
		hosts.some((host) => !LOOPBACK_HOSTS.has(host))
	) {
		void sql.end({ timeout: 0 });
		throw new Error(
			"E2E_DATABASE_URL must point at a loopback host; the settings fixture never writes to another database",
		);
	}
	return sql;
}

export async function removeLeftovers(
	sql: Sql,
	olderThan: string = LEFTOVER_AGE,
): Promise<void> {
	await sql`
		delete from public.tenants
		where slug like ${`${FIXTURE_SLUG_PREFIX}%`}
			and created_at < now() - ${olderThan}::interval
	`;
	await sql`
		delete from auth.users u
		where u.email ~ ${FIXTURE_EMAIL_SHAPE}
			and u.created_at < now() - ${olderThan}::interval
			and not exists (
				select 1
				from public.tenant_members m
				join public.tenants t on t.id = m.tenant_id
				where m.user_id = u.id
					and t.slug not like ${`${FIXTURE_SLUG_PREFIX}%`}
			)
	`;
}

async function insertLogins(
	sql: Sql,
	hex: string,
): Promise<Record<SettingsRole, SettingsLogin>> {
	const logins = {} as Record<SettingsRole, SettingsLogin>;
	for (const role of SETTINGS_ROLES) {
		const userId = randomUUID();
		const email = `e2e-${role}-${hex}@example.com`;
		await sql`
			insert into auth.users (
				instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
				raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
				confirmation_token, recovery_token, email_change_token_new, email_change,
				email_change_token_current, phone_change, phone_change_token, reauthentication_token,
				is_sso_user, is_anonymous
			)
			values (
				${AUTH_INSTANCE_ID}, ${userId}, 'authenticated', 'authenticated', ${email},
				extensions.crypt(${FIXTURE_PASSWORD}, extensions.gen_salt('bf')), now(),
				'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
				'', '', '', '', '', '', '', '', false, false
			)
		`;
		await sql`
			insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
			values (
				${randomUUID()}, ${userId}, ${userId}, 'email',
				jsonb_build_object('sub', ${userId}::text, 'email', ${email}::text, 'email_verified', true, 'phone_verified', false),
				now(), now(), now()
			)
		`;
		logins[role] = { userId, email, password: FIXTURE_PASSWORD };
	}
	return logins;
}

async function insertTenant(
	sql: Sql,
	ids: {
		tenantId: string;
		accountId: string;
		storeIds: readonly [string, string];
	},
	slug: string,
	name: string,
): Promise<void> {
	const [first, second] = ids.storeIds;
	await sql`
		insert into public.tenants (id, slug, name, timezone)
		values (${ids.tenantId}, ${slug}, ${name}, ${TIME_ZONE})
	`;
	await sql`
		insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
		values (${ids.accountId}, ${ids.tenantId}, 'mock', ${slug}, ${`${name} POS`})
	`;
	await sql`
		insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, timezone, settings)
		values
			(${first}, ${ids.tenantId}, ${ids.accountId}, 'e2e-store-1', 'E1', 'Cửa hàng thử 1', ${TIME_ZONE}, '{"incremental_sync": false}'::jsonb),
			(${second}, ${ids.tenantId}, ${ids.accountId}, 'e2e-store-2', 'E2', 'Cửa hàng thử 2', ${TIME_ZONE}, '{"incremental_sync": false}'::jsonb)
	`;
	await sql`
		insert into public.item_types (tenant_id, pos_account_id, external_id, name)
		values
			(${ids.tenantId}, ${ids.accountId}, 'TYPE-DRINK', 'Đồ uống'),
			(${ids.tenantId}, ${ids.accountId}, 'TYPE-SNACK', 'Ăn vặt')
	`;
	await sql`
		insert into public.items (tenant_id, pos_account_id, external_id, name, item_type_external_id, list_price)
		values
			(${ids.tenantId}, ${ids.accountId}, 'ITEM-1', 'Trà sữa', 'TYPE-DRINK', 35000),
			(${ids.tenantId}, ${ids.accountId}, 'ITEM-2', 'Trà đào', 'TYPE-DRINK', 40000),
			(${ids.tenantId}, ${ids.accountId}, 'ITEM-3', 'Cà phê', 'TYPE-DRINK', 30000),
			(${ids.tenantId}, ${ids.accountId}, 'ITEM-4', 'Bánh flan', 'TYPE-SNACK', 20000),
			(${ids.tenantId}, ${ids.accountId}, 'ITEM-5', 'Hạt hướng dương', 'TYPE-SNACK', 15000),
			(${ids.tenantId}, ${ids.accountId}, 'ITEM-6', 'Món chưa phân loại', null, 25000)
	`;
	await sql`
		insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
		values
			(${ids.tenantId}, ${ids.accountId}, 'CASH', 'Tiền mặt', 'cash'),
			(${ids.tenantId}, ${ids.accountId}, 'WALLET', 'Ví đối tác', 'other')
	`;
}

async function insertSales(
	sql: Sql,
	tenantId: string,
	accountId: string,
	storeIds: readonly [string, string],
): Promise<{ from: string; to: string }> {
	const [range] = await sql<{ from_date: string; to_date: string }[]>`
		select
			((now() at time zone ${TIME_ZONE})::date - ${SALES_DAYS}::integer)::text as from_date,
			((now() at time zone ${TIME_ZONE})::date - 1)::text as to_date
	`;
	if (range === undefined) throw new Error("no sales range");
	await sql`
		create temp table e2e_sale_plan on commit drop as
		select
			s.store_id,
			s.store_no,
			d::date as business_date,
			n as sale_no,
			'ITEM-' || (((s.store_no * 31 + extract(doy from d)::integer * 7 + n * 13) % 6) + 1) as item_id
		from unnest(${[...storeIds]}::uuid[]) with ordinality as s (store_id, store_no)
		cross join generate_series(${range.from_date}::date, ${range.to_date}::date, interval '1 day') d
		cross join lateral generate_series(1, 6 + ((extract(doy from d)::integer + s.store_no::integer) % 5)) n
	`;
	await sql`
		insert into public.invoices (
			tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date,
			gross_amount, net_amount, paid_amount, primary_payment_method_external_id, primary_payment_method_name
		)
		select
			${tenantId}, p.store_id, ${accountId},
			'E2E-' || p.store_no || '-' || to_char(p.business_date, 'YYYYMMDD') || '-' || p.sale_no,
			p.sale_no::text,
			(p.business_date + time '08:00' + (p.sale_no * interval '47 minutes')) at time zone ${TIME_ZONE},
			p.business_date,
			i.list_price, i.list_price, i.list_price,
			case when p.sale_no % 3 = 0 then 'WALLET' else 'CASH' end,
			case when p.sale_no % 3 = 0 then 'Ví đối tác' else 'Tiền mặt' end
		from e2e_sale_plan p
		join public.items i on i.pos_account_id = ${accountId} and i.external_id = p.item_id
	`;
	await sql`
		insert into public.invoice_lines (
			tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name,
			item_type_external_id, item_type_name, quantity, unit_price, gross_amount, net_amount
		)
		select inv.tenant_id, inv.store_id, inv.id, 'L1', 'item', it.external_id, it.name, it.item_type_external_id, t.name,
			1, inv.gross_amount, inv.gross_amount, inv.net_amount
		from e2e_sale_plan p
		join public.invoices inv
			on inv.store_id = p.store_id
			and inv.external_id = 'E2E-' || p.store_no || '-' || to_char(p.business_date, 'YYYYMMDD') || '-' || p.sale_no
		join public.items it on it.pos_account_id = ${accountId} and it.external_id = p.item_id
		left join public.item_types t on t.pos_account_id = it.pos_account_id and t.external_id = it.item_type_external_id
	`;
	return { from: range.from_date, to: range.to_date };
}

async function insertMembers(
	sql: Sql,
	tenantId: string,
	firstStore: string,
	logins: Readonly<Record<SettingsRole, SettingsLogin>>,
): Promise<void> {
	for (const role of SETTINGS_ROLES) {
		const membership = MEMBERSHIPS[role];
		await sql`
			insert into public.tenant_members (tenant_id, user_id, role, store_ids)
			values (
				${tenantId}, ${logins[role].userId}, ${membership.role}::public.tenant_role,
				${membership.firstStoreOnly ? [firstStore] : null}::uuid[]
			)
		`;
	}
}

async function signInAs(page: Page, login: SettingsLogin): Promise<void> {
	await page.goto("/#/dang-nhap");
	await page.getByLabel("E-mail").fill(login.email);
	await page.getByLabel("Mật khẩu").fill(login.password);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
}

export async function createSettingsFixture(): Promise<SettingsFixture> {
	const sql = openFixtureDatabase();
	try {
		await removeLeftovers(sql);
		const hex = randomBytes(4).toString("hex");
		const slug = `${FIXTURE_SLUG_PREFIX}${hex}`;
		const name = `E2E settings ${hex}`;
		const tenantId = randomUUID();
		const accountId = randomUUID();
		const storeIds = [randomUUID(), randomUUID()] as const;
		const created = await sql.begin(async (tx) => {
			const madeLogins = await insertLogins(tx as unknown as Sql, hex);
			await insertTenant(
				tx as unknown as Sql,
				{ tenantId, accountId, storeIds },
				slug,
				name,
			);
			await insertMembers(
				tx as unknown as Sql,
				tenantId,
				storeIds[0],
				madeLogins,
			);
			const range = await insertSales(
				tx as unknown as Sql,
				tenantId,
				accountId,
				storeIds,
			);
			await tx`select app.refresh_analytics(${tenantId}::uuid, ${range.from}::date, ${range.to}::date)`;
			return { logins: madeLogins, sales: range };
		});
		const { logins, sales } = created;
		let removed = false;
		return {
			tenantId,
			slug,
			name,
			accountId,
			storeIds,
			sales,
			logins,
			async clientAs(role) {
				const client = anonymousClient();
				const { error } = await client.auth.signInWithPassword({
					email: logins[role].email,
					password: logins[role].password,
				});
				if (error) throw error;
				return client;
			},
			signIn: (page, role) => signInAs(page, logins[role]),
			async teardown() {
				if (removed) return;
				removed = true;
				try {
					await sql`delete from public.tenants where id = ${tenantId}`;
				} finally {
					try {
						await sql`
							delete from auth.users
							where id in ${sql(SETTINGS_ROLES.map((role) => logins[role].userId))}
						`;
					} finally {
						await sql.end();
					}
				}
			},
		};
	} catch (failure) {
		await sql.end();
		throw failure;
	}
}
