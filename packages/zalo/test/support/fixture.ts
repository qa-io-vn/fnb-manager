import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { STAFF_LOGIN_DOMAIN } from "../../src/session.js";
import { ZALO_FIXTURE_SLUG_PREFIX } from "../../src/settings.js";

const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

export type FixtureRole = "owner" | "manager" | "staff" | "viewer";

export interface FixtureLogin {
	readonly userId: string;
	readonly email: string;
	readonly password: string;
}

export interface ZaloFixture {
	readonly tenantId: string;
	readonly slug: string;
	readonly storeIds: readonly string[];
	readonly brandKey: string;
	readonly zaloAppId: string;
	readonly secretName: string;
	addMember(
		role: FixtureRole,
		storeIds: readonly string[] | null,
	): Promise<FixtureLogin>;
	issueBindingCode(userId: string): Promise<string>;
	publishStaffNotice(version: string): Promise<void>;
	cleanup(): Promise<void>;
}

const STAFF_LOGIN_PATTERN = `%@${STAFF_LOGIN_DOMAIN}`;

export async function deleteStaleZaloFixtures(sql: Sql): Promise<void> {
	await sql`
		delete from auth.users u
		using public.staff_roster r
		join public.tenants t on t.id = r.tenant_id
		where u.id = r.user_id
			and u.email like ${STAFF_LOGIN_PATTERN}
			and t.slug like ${`${ZALO_FIXTURE_SLUG_PREFIX}%`}
			and t.created_at < now() - interval '1 hour'
	`;
	await sql`
		delete from public.tenants
		where slug like ${`${ZALO_FIXTURE_SLUG_PREFIX}%`} and created_at < now() - interval '1 hour'
	`;
	await sql`
		delete from auth.users
		where email like ${`${ZALO_FIXTURE_SLUG_PREFIX}%@example.com`} and created_at < now() - interval '1 hour'
	`;
}

async function insertLogin(
	sql: Sql,
	email: string,
	password: string,
): Promise<string> {
	const userId = randomUUID();
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
	return userId;
}

export async function createZaloFixture(sql: Sql): Promise<ZaloFixture> {
	await deleteStaleZaloFixtures(sql);
	const suffix = randomBytes(4).toString("hex");
	const slug = `${ZALO_FIXTURE_SLUG_PREFIX}${suffix}`;
	const brandNumber = randomInt(500, 1000);
	const brandKey = `brand-${brandNumber}`;
	const secretName = `ZALO_APP_SECRET_IT_${brandNumber}`;
	const logins: string[] = [];
	const [tenant] = await sql<{ id: string }[]>`
		insert into public.tenants (slug, name) values (${slug}, ${`Zalo session fixture ${suffix}`})
		returning id::text as id
	`;
	if (tenant === undefined) {
		throw new Error("the fixture tenant was not created");
	}
	const tenantId = tenant.id;
	const cleanup = async () => {
		const staffLogins = await sql<{ id: string }[]>`
			select u.id::text as id
			from public.staff_roster r
			join auth.users u on u.id = r.user_id
			where r.tenant_id = ${tenantId}::uuid and u.email like ${STAFF_LOGIN_PATTERN}
		`;
		await sql`delete from public.tenants where id = ${tenantId}::uuid`;
		for (const login of staffLogins) {
			await sql`delete from auth.users where id = ${login.id}::uuid`;
		}
		if (logins.length > 0) {
			await sql`
				delete from auth.users
				where id in (select jsonb_array_elements_text(${JSON.stringify(logins)}::text::jsonb)::uuid)
			`;
		}
	};
	try {
		const [account] = await sql<{ id: string }[]>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenantId}::uuid, 'mock', ${`${slug}-account`}, 'Synthetic account')
			returning id::text as id
		`;
		const storeIds: string[] = [];
		for (const number of [1, 2, 3]) {
			const [store] = await sql<{ id: string }[]>`
				insert into public.stores (tenant_id, pos_account_id, external_id, name)
				values (${tenantId}::uuid, ${account?.id ?? ""}::uuid, ${`${slug}-store-${number}`},
					${`Cửa hàng thử ${number}`})
				returning id::text as id
			`;
			storeIds.push(store?.id ?? "");
		}
		const brandStores = JSON.stringify(storeIds.slice(0, 2));
		const [brand] = await sql<{ id: string }[]>`
			insert into public.brands (tenant_id, brand_key, display_name, store_ids)
			values (${tenantId}::uuid, ${brandKey}, 'Synthetic brand',
				array(select jsonb_array_elements_text(${brandStores}::text::jsonb)::uuid))
			returning id::text as id
		`;
		const [app] = await sql<{ id: string }[]>`
			insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
			values (${tenantId}::uuid, ${brand?.id ?? ""}::uuid, ${`synthetic-app-${suffix}`}, ${secretName})
			returning id::text as id
		`;
		const zaloAppId = app?.id ?? "";
		return {
			tenantId,
			slug,
			storeIds,
			brandKey,
			zaloAppId,
			secretName,
			async addMember(role, memberStores) {
				const email = `${slug}-${role}-${logins.length + 1}@example.com`;
				const password = randomBytes(18).toString("base64url");
				const userId = await insertLogin(sql, email, password);
				logins.push(userId);
				const storeJson =
					memberStores === null ? null : JSON.stringify([...memberStores]);
				await sql`
					insert into public.tenant_members (tenant_id, user_id, role, store_ids)
					values (
						${tenantId}::uuid, ${userId}::uuid, ${role}::public.tenant_role,
						case when ${storeJson}::text::jsonb is null then null
							else array(select jsonb_array_elements_text(${storeJson}::text::jsonb)::uuid) end
					)
				`;
				return { userId, email, password };
			},
			async issueBindingCode(userId) {
				const [row] = await sql<{ code: string }[]>`
					select app.issue_zalo_binding_code(${tenantId}::uuid, ${userId}::uuid, ${zaloAppId}::uuid) as code
				`;
				if (row === undefined) {
					throw new Error("no binding code was issued");
				}
				return row.code;
			},
			async publishStaffNotice(version) {
				await sql`
					insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
					values (${tenantId}::uuid, 'staff_notice', 'vi', ${version}, 'Thông báo cho nhân viên',
						'Văn bản thử của bộ kiểm thử.', 'published', now() - interval '1 minute')
				`;
			},
			cleanup,
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}
