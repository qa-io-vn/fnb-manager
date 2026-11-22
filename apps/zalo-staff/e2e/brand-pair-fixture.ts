import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { RpcCredentials } from "@fnb/zalo-mini/testing/network-scan";
import { localApiUrl } from "./local-loop";
import {
	connect,
	localDatabaseUrl,
	removeTenant,
	type Sql,
} from "./pairing-fixture";

// A synthetic tenant with two brands (G-27): brand-1 ("A") has the stores A1 and A2, brand-2 ("B") has the store B1,
// each brand has its own mock Zalo App, OA and staff Mini App, and the tenant has one loyalty programme. The tenant
// is created by the test and removed by it; every login, customer, code and row hangs off the tenant, so removing the
// tenant removes them. Every phone is synthetic (0900000000 to 0900000999).
const FIXTURE_PREFIX = "zalo-it-";
const FIXTURE_NAME = "Brand pair fixture";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

export type BrandKey = "a" | "b";
export type StoreKey = "a1" | "a2" | "b1";
export type PairRole = "owner" | "manager" | "staff";

const BRAND_KEYS: Readonly<Record<BrandKey, string>> = {
	a: "brand-1",
	b: "brand-2",
};
const STORE_BRAND: Readonly<Record<StoreKey, BrandKey>> = {
	a1: "a",
	a2: "a",
	b1: "b",
};
const STORE_NAMES: Readonly<Record<StoreKey, string>> = {
	a1: "Cửa hàng A1",
	a2: "Cửa hàng A2",
	b1: "Cửa hàng B1",
};
const STORE_KEYS: readonly StoreKey[] = ["a1", "a2", "b1"];

export interface PairBrand {
	readonly key: BrandKey;
	readonly brandKey: string;
	readonly id: string;
	readonly appId: string;
	readonly oaId: string;
	readonly storeKeys: readonly StoreKey[];
}

export interface PairStore {
	readonly key: StoreKey;
	readonly id: string;
	readonly code: string;
	readonly name: string;
	readonly brand: BrandKey;
}

export interface PairMember {
	readonly email: string;
	readonly password: string;
	readonly userId: string;
	readonly mockUser: string;
	readonly mockName: string;
	readonly role: PairRole;
	/** the stores of the login's scope; null is every store of the tenant */
	readonly scope: readonly StoreKey[] | null;
}

export interface PairCustomer {
	/** national form, 0900000nnn */
	readonly phone: string;
	readonly membershipId: string;
	readonly store: StoreKey;
}

/** what the loyalty functions wrote in the whole tenant: a cross-brand attempt must leave it as it was */
export interface TenantTraces {
	readonly ledger: number;
	readonly stamps: number;
	readonly checkins: Readonly<Record<string, number>>;
	readonly bills: number;
	readonly refusals: number;
	readonly audits: number;
}

export interface PairCleanup {
	readonly tenants: number;
	readonly logins: number;
}

export interface BrandPairFixture {
	readonly slug: string;
	readonly tenantId: string;
	readonly brands: Readonly<Record<BrandKey, PairBrand>>;
	readonly stores: Readonly<Record<StoreKey, PairStore>>;
	newMember(
		role: PairRole,
		scope: readonly StoreKey[] | null,
	): Promise<PairMember>;
	/** the session of a member as the data API sees it (a password sign-in), for role checks by RPC */
	session(member: PairMember): Promise<RpcCredentials>;
	/** a customer who joined through the brand of `store`, made by the loyalty functions */
	seedMember(store: StoreKey): Promise<PairCustomer>;
	/** a fresh single-use member code of a customer at a store, as the customer app would show it */
	issueCode(customer: PairCustomer, store: StoreKey): Promise<string>;
	setStoreMode(store: StoreKey, mode: "pos_sync" | "staff"): Promise<void>;
	codeIsLive(store: StoreKey, code: string): Promise<boolean>;
	traces(): Promise<TenantTraces>;
	/** how many checked-in rows (any status but issued) and ledger rows a customer holds */
	customerRows(customer: PairCustomer): Promise<{
		readonly ledger: number;
		readonly checkins: number;
	}>;
	/** the audit events of the tenant (a refused bill leaves one) as action and details text, oldest first */
	audits(): Promise<readonly { action: string; details: string }[]>;
	cleanup(): Promise<PairCleanup>;
}

export function e164(national: string): string {
	return `+84${national.slice(1)}`;
}

async function insertLogin(
	sql: Sql,
	email: string,
): Promise<{ userId: string; password: string }> {
	const userId = randomUUID();
	const password = randomBytes(18).toString("base64url");
	await sql`
		insert into auth.users (
			instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
			confirmation_token, recovery_token, email_change_token_new, email_change,
			email_change_token_current, phone_change, phone_change_token, reauthentication_token,
			is_sso_user, is_anonymous
		)
		values (
			${AUTH_INSTANCE_ID}::uuid, ${userId}::uuid, 'authenticated', 'authenticated', ${email},
			extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
			'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
			'', '', '', '', '', '', '', '', false, false
		)
	`;
	await sql`
		insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
		values (
			gen_random_uuid(), ${userId}::uuid, ${userId}, 'email',
			jsonb_build_object('sub', ${userId}::text, 'email', ${email}::text, 'email_verified', true, 'phone_verified', false),
			now(), now(), now()
		)
	`;
	return { userId, password };
}

async function deleteStaleFixtures(sql: Sql): Promise<void> {
	const stale = await sql<{ id: string }>`
		select id::text as id from public.tenants
		where slug like ${`${FIXTURE_PREFIX}%`} and name like ${`${FIXTURE_NAME}%`}
			and created_at < now() - interval '1 hour'
	`;
	for (const tenant of stale) await removeTenant(sql, tenant.id);
}

export async function openBrandPairFixture(): Promise<BrandPairFixture> {
	const url = localDatabaseUrl();
	if (url === "") throw new Error("DATABASE_URL is not the local stack");
	const sql = await connect(url);
	await deleteStaleFixtures(sql);
	const suffix = randomBytes(4).toString("hex");
	const slug = `${FIXTURE_PREFIX}${suffix}`;
	const [tenant] = await sql<{ id: string }>`
		insert into public.tenants (slug, name) values (${slug}, ${`${FIXTURE_NAME} ${suffix}`})
		returning id::text as id
	`;
	if (tenant === undefined)
		throw new Error("the fixture tenant was not created");
	const tenantId = tenant.id;
	const logins: string[] = [];
	const used = new Set<string>();
	let finished = false;
	const cleanup = async (): Promise<PairCleanup> => {
		if (finished) return { tenants: 0, logins: 0 };
		finished = true;
		try {
			await removeTenant(sql, tenantId);
			const [left] = await sql<{ tenants: number; logins: number }>`
				select
					(select count(*) from public.tenants where id = ${tenantId}::uuid)::integer as tenants,
					(select count(*) from auth.users where id = any(${logins}::uuid[]))::integer as logins
			`;
			const remaining = {
				tenants: Number(left?.tenants ?? 0),
				logins: Number(left?.logins ?? 0),
			};
			if (remaining.tenants + remaining.logins > 0)
				throw new Error(
					`the fixture tenant was not removed: ${JSON.stringify(remaining)}`,
				);
			return remaining;
		} finally {
			await sql.end({ timeout: 5 });
		}
	};
	let brands: Record<BrandKey, PairBrand>;
	let stores: Record<StoreKey, PairStore>;
	try {
		const [account] = await sql<{ id: string }>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenantId}::uuid, 'mock', ${`${slug}-till`}, 'Simulated till')
			returning id::text as id
		`;
		const made: Partial<Record<StoreKey, PairStore>> = {};
		for (const key of STORE_KEYS) {
			const [store] = await sql<{ id: string }>`
				insert into public.stores (tenant_id, pos_account_id, external_id, name)
				values (${tenantId}::uuid, ${account?.id ?? ""}::uuid, ${`${slug}-${key}`}, ${STORE_NAMES[key]})
				returning id::text as id
			`;
			if (store === undefined) throw new Error(`store ${key} was not created`);
			made[key] = {
				key,
				id: store.id,
				code: `${slug}-${key}`,
				name: STORE_NAMES[key],
				brand: STORE_BRAND[key],
			};
		}
		stores = made as Record<StoreKey, PairStore>;
		await sql`
			insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, notification_basis, status)
			values (${tenantId}::uuid, 'Synthetic programme', date '2026-01-01', 'not_required',
				'Synthetic tenant for local testing only', 'active')
		`;
		const brandRows: Partial<Record<BrandKey, PairBrand>> = {};
		for (const [index, key] of (["a", "b"] as const).entries()) {
			const number = index + 1;
			const storeKeys = STORE_KEYS.filter(
				(store) => STORE_BRAND[store] === key,
			);
			const storeIds = storeKeys.map((store) => stores[store].id);
			const appId = `mock-${suffix}-app-${number}`;
			const oaId = `mock-${suffix}-oa-${number}`;
			const [brand] = await sql<{ id: string }>`
				insert into public.brands (tenant_id, brand_key, display_name, store_ids)
				values (${tenantId}::uuid, ${BRAND_KEYS[key]}, ${`Quán Mẫu ${number}`}, ${storeIds}::uuid[])
				returning id::text as id
			`;
			if (brand === undefined) throw new Error(`brand ${key} was not created`);
			await sql`
				insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name, status)
				values (${tenantId}::uuid, ${brand.id}::uuid, ${appId}, ${`ZALO_APP_SECRET_BRAND_${number}`}, 'active')
			`;
			await sql`
				insert into public.oas (tenant_id, brand_id, external_id, secret_name)
				values (${tenantId}::uuid, ${brand.id}::uuid, ${oaId}, ${`ZALO_OA_SECRET_BRAND_${number}`})
			`;
			await sql`
				insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title,
					header_title_vi, header_title_en, header_color_light, header_color_dark,
					text_color_light, text_color_dark)
				values (${tenantId}::uuid, ${brand.id}::uuid, 'staff', ${`mock-${suffix}-staff-${number}`}, false,
					${`Nhân viên Quán Mẫu ${number}`}, ${`Quán Mẫu ${number}`}, ${`Sample Shop ${number}`},
					'#0A6B56', '#17161A', 'white', 'white')
			`;
			brandRows[key] = {
				key,
				brandKey: BRAND_KEYS[key],
				id: brand.id,
				appId,
				oaId,
				storeKeys,
			};
		}
		brands = brandRows as Record<BrandKey, PairBrand>;
	} catch (error) {
		await cleanup();
		throw error;
	}
	const newPhone = (): string => {
		let phone = "";
		do {
			phone = `0900000${randomInt(100, 700)}`;
		} while (used.has(phone));
		used.add(phone);
		return phone;
	};
	return {
		slug,
		tenantId,
		brands,
		stores,
		async newMember(role, scope) {
			const member = randomBytes(3).toString("hex");
			const email = `${slug}-${role}-${member}@example.com`;
			const { userId, password } = await insertLogin(sql, email);
			logins.push(userId);
			const storeIds =
				scope === null ? null : scope.map((store) => stores[store].id);
			await sql`
				insert into public.tenant_members (tenant_id, user_id, role, store_ids)
				values (${tenantId}::uuid, ${userId}::uuid, ${role}::public.tenant_role, ${storeIds}::uuid[])
			`;
			return {
				email,
				password,
				userId,
				mockUser: `mock-it-${member}`,
				mockName: "Nhân viên thử nghiệm",
				role,
				scope,
			};
		},
		async session(member) {
			const api = localApiUrl();
			const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
			if (api === "" || key === "")
				throw new Error("the local API address and publishable key are needed");
			const response = await fetch(`${api}/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { "content-type": "application/json", apikey: key },
				body: JSON.stringify({
					email: member.email,
					password: member.password,
				}),
			});
			const body = (await response.json()) as { access_token?: string };
			if (!response.ok || body.access_token === undefined)
				throw new Error(`the staff sign-in answered ${response.status}`);
			return {
				url: `${api}/rest/v1/rpc/staff_member_lookup`,
				headers: { authorization: `Bearer ${body.access_token}`, apikey: key },
			};
		},
		async seedMember(store) {
			const phone = newPhone();
			const brand = brands[STORE_BRAND[store]];
			const [customer] = await sql<{ id: string }>`
				select app.loyalty_customer_for_phone(${tenantId}::uuid, ${phone}, now())::text as id
			`;
			const [joined] = await sql<{ id: string }>`
				select app.loyalty_join(${tenantId}::uuid, ${customer?.id ?? null}::uuid, 'mini_app', ${stores[store].id}::uuid,
					${brand.id}::uuid, ${`mock-it-c-${randomBytes(4).toString("hex")}`}, now())::text as id
			`;
			if (joined === undefined) throw new Error("the member was not joined");
			return { phone, membershipId: joined.id, store };
		},
		async issueCode(customer, store) {
			const [issued] = await sql<{ code: string }>`
				select code from app.loyalty_issue_checkin_code(${customer.membershipId}::uuid, ${stores[store].id}::uuid, now())
			`;
			if (issued === undefined) throw new Error("no member code was issued");
			return issued.code;
		},
		async setStoreMode(store, mode) {
			await sql`
				update public.loyalty_store_settings
				set confirmation = ${mode}, bill_audit_sample_pct = 0
				where store_id = ${stores[store].id}::uuid
			`;
		},
		async codeIsLive(store, code) {
			const [row] = await sql<{ live: boolean }>`
				select (status = 'issued' and expires_at > now()) as live from public.pending_checkins
				where store_id = ${stores[store].id}::uuid and code = ${code}
				order by created_at desc limit 1
			`;
			return row?.live === true;
		},
		async traces() {
			const [row] = await sql<Record<string, unknown>>`
				select
					(select count(*) from public.loyalty_ledger where tenant_id = ${tenantId}::uuid)::integer as ledger,
					coalesce((select sum(stamp_delta) from public.loyalty_ledger where tenant_id = ${tenantId}::uuid), 0)::integer as stamps,
					coalesce((
						select jsonb_object_agg(x.status, x.n) from (
							select status::text as status, count(*)::integer as n from public.pending_checkins
							where tenant_id = ${tenantId}::uuid group by status
						) x
					), '{}'::jsonb) as checkins,
					(select count(*) from public.bill_captures where tenant_id = ${tenantId}::uuid)::integer as bills,
					(select count(*) from public.loyalty_refusals where tenant_id = ${tenantId}::uuid)::integer as refusals,
					(select count(*) from public.loyalty_audit_events where tenant_id = ${tenantId}::uuid)::integer as audits
			`;
			return {
				ledger: Number(row?.ledger ?? 0),
				stamps: Number(row?.stamps ?? 0),
				checkins: (row?.checkins ?? {}) as Record<string, number>,
				bills: Number(row?.bills ?? 0),
				refusals: Number(row?.refusals ?? 0),
				audits: Number(row?.audits ?? 0),
			};
		},
		async customerRows(customer) {
			const [row] = await sql<Record<string, unknown>>`
				select
					(select count(*) from public.loyalty_ledger l where l.membership_id = ${customer.membershipId}::uuid)::integer as ledger,
					(select count(*) from public.pending_checkins c where c.membership_id = ${customer.membershipId}::uuid and c.status <> 'issued')::integer as checkins
			`;
			return {
				ledger: Number(row?.ledger ?? 0),
				checkins: Number(row?.checkins ?? 0),
			};
		},
		async audits() {
			const rows = await sql<{ action: string; details: string }>`
				select action, details::text as details from public.loyalty_audit_events
				where tenant_id = ${tenantId}::uuid order by occurred_at, id
			`;
			return rows.map((row) => ({ action: row.action, details: row.details }));
		},
		cleanup,
	};
}
