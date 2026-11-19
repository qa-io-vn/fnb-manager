import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { LocalLoopError } from "./options.js";

export const SEEDABLE_TENANT_PATTERN =
	/^(loyalty-sim|zalo-it-[a-z0-9-]{1,40})$/;
export const SIMULATED_TENANT = "loyalty-sim";

export interface SyntheticMiniApp {
	readonly kind: "staff" | "customer";
	readonly externalId: string;
	readonly title: string;
	readonly headerTitleVi: string;
	readonly headerTitleEn: string;
}

export interface SyntheticBrand {
	readonly brand: string;
	readonly displayName: string;
	readonly appId: string;
	readonly appSecretName: string;
	readonly oaId: string;
	readonly oaSecretName: string;
	readonly miniApps: readonly SyntheticMiniApp[];
}

export function isSeedableTenant(slug: string): boolean {
	return SEEDABLE_TENANT_PATTERN.test(slug);
}

function tenantShortName(slug: string): string {
	return slug === SIMULATED_TENANT ? "sim" : slug.replace(/^zalo-it-/, "it-");
}

export function syntheticBrand(slug: string, brand: string): SyntheticBrand {
	const short = tenantShortName(slug);
	const number = brand.replace(/^brand-/, "");
	const segment = brand.toUpperCase().replace("-", "_");
	return {
		brand,
		displayName: `Quán Mẫu ${number}`,
		appId: `mock-${short}-app-${number}`,
		appSecretName: `ZALO_APP_SECRET_${segment}`,
		oaId: `mock-${short}-oa-${number}`,
		oaSecretName: `ZALO_OA_SECRET_${segment}`,
		miniApps: [
			{
				kind: "staff",
				externalId: `mock-${short}-staff-${number}`,
				title: `Nhân viên Quán Mẫu ${number}`,
				headerTitleVi: `Quán Mẫu ${number}`,
				headerTitleEn: `Sample Shop ${number}`,
			},
			{
				kind: "customer",
				externalId: `mock-${short}-customer-${number}`,
				title: `Thành viên Quán Mẫu ${number}`,
				headerTitleVi: `Quán Mẫu ${number}`,
				headerTitleEn: `Sample Shop ${number}`,
			},
		],
	};
}

export async function seedSyntheticBrand(
	sql: Sql,
	slug: string,
	brand: string,
): Promise<boolean> {
	if (!isSeedableTenant(slug)) {
		throw new LocalLoopError(
			`only a synthetic tenant (${SIMULATED_TENANT} or zalo-it-…) gets a seeded brand; ${slug} needs fnb zalo config set`,
		);
	}
	const config = syntheticBrand(slug, brand);
	return sql.begin(async (tx) => {
		const [tenant] = await tx<{ id: string }[]>`
			select id::text as id from public.tenants where slug = ${slug}
		`;
		if (tenant === undefined) {
			throw new LocalLoopError(
				`the local stack has no tenant ${slug}; create it with pnpm loyalty:sale -- --setup --tenant ${slug}`,
			);
		}
		const [existing] = await tx<{ id: string }[]>`
			select id::text as id from public.brands
			where tenant_id = ${tenant.id}::uuid and brand_key = ${brand}
		`;
		if (existing !== undefined) {
			return false;
		}
		const [created] = await tx<{ id: string }[]>`
			insert into public.brands (tenant_id, brand_key, display_name, store_ids)
			select ${tenant.id}::uuid, ${brand}, ${config.displayName},
				array(select s.id from public.stores s where s.tenant_id = ${tenant.id}::uuid and s.active order by s.external_id limit 50)
			where exists (select 1 from public.stores s where s.tenant_id = ${tenant.id}::uuid and s.active)
			returning id::text as id
		`;
		if (created === undefined) {
			throw new LocalLoopError(
				`${slug} has no active store for a seeded brand; create them with pnpm loyalty:sale -- --setup --tenant ${slug}`,
			);
		}
		await tx`
			insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name, status)
			values (${tenant.id}::uuid, ${created.id}::uuid, ${config.appId}, ${config.appSecretName}, 'active')
		`;
		await tx`
			insert into public.oas (tenant_id, brand_id, external_id, secret_name)
			values (${tenant.id}::uuid, ${created.id}::uuid, ${config.oaId}, ${config.oaSecretName})
		`;
		for (const miniApp of config.miniApps) {
			await tx`
				insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title,
					header_title_vi, header_title_en, header_color_light, header_color_dark,
					text_color_light, text_color_dark)
				values (${tenant.id}::uuid, ${created.id}::uuid, ${miniApp.kind}, ${miniApp.externalId},
					${miniApp.kind === "customer"}, ${miniApp.title}, ${miniApp.headerTitleVi},
					${miniApp.headerTitleEn}, '#0A6B56', '#17161A', 'white', 'white')
			`;
		}
		return true;
	});
}

const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
export const SYNTHETIC_EMAIL_DOMAIN = "example.com";

export interface SyntheticManager {
	readonly email: string;
	readonly mockUser: string;
}

export function syntheticManager(slug: string): SyntheticManager {
	return {
		email: `${slug}-manager@${SYNTHETIC_EMAIL_DOMAIN}`,
		mockUser: `mock-${tenantShortName(slug)}-manager-1`,
	};
}

export function newLocalPassword(): string {
	return randomBytes(18).toString("base64url");
}

export interface ManagerSetup extends SyntheticManager {
	readonly userId: string;
	readonly created: boolean;
	readonly password: string | null;
	readonly storeNames: readonly string[];
	readonly mockUserBoundElsewhere: boolean;
}

export async function seedSyntheticManager(
	sql: Sql,
	slug: string,
	brand: string,
	options: { readonly newPassword: boolean; readonly password?: () => string },
): Promise<ManagerSetup> {
	if (!isSeedableTenant(slug)) {
		throw new LocalLoopError(
			`only a synthetic tenant (${SIMULATED_TENANT} or zalo-it-…) gets a synthetic manager; ${slug} is refused`,
		);
	}
	const manager = syntheticManager(slug);
	const makePassword = options.password ?? newLocalPassword;
	return sql.begin(async (tx) => {
		const [tenant] = await tx<{ id: string; source: string | null }[]>`
			select t.id::text as id, s.source
			from public.tenants t
			left join app.tenant_ipos_sources s on s.tenant_id = t.id
			where t.slug = ${slug}
		`;
		if (tenant === undefined) {
			throw new LocalLoopError(
				`the local stack has no tenant ${slug}; create it with pnpm loyalty:sale -- --setup --tenant ${slug}`,
			);
		}
		if (tenant.source === "api") {
			throw new LocalLoopError(
				`${slug} is registered as fed by the real iPOS API (app.tenant_ipos_sources); a synthetic manager goes on a synthetic tenant only`,
			);
		}
		const stores = await tx<{ id: string; name: string }[]>`
			select s.id::text as id, s.name from public.stores s
			where s.tenant_id = ${tenant.id}::uuid and s.active
			order by s.external_id
		`;
		if (stores.length === 0) {
			throw new LocalLoopError(
				`${slug} has no active store; create them with pnpm loyalty:sale -- --setup --tenant ${slug}`,
			);
		}
		const [existing] = await tx<{ id: string; kind: string | null }[]>`
			select u.id::text as id, u.raw_app_meta_data ->> 'kind' as kind
			from auth.users u where lower(u.email) = lower(${manager.email})
		`;
		if (existing !== undefined && existing.kind === "customer") {
			throw new LocalLoopError(
				`${manager.email} is a customer login; remove it before setting up the synthetic manager`,
			);
		}
		let userId = existing?.id ?? null;
		let password: string | null = null;
		if (userId === null) {
			password = makePassword();
			const [created] = await tx<{ id: string }[]>`
				insert into auth.users (
					instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
					raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
					confirmation_token, recovery_token, email_change_token_new, email_change,
					email_change_token_current, phone_change, phone_change_token, reauthentication_token,
					is_sso_user, is_anonymous
				)
				values (
					${AUTH_INSTANCE_ID}::uuid, gen_random_uuid(), 'authenticated', 'authenticated', ${manager.email},
					extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
					'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
					'', '', '', '', '', '', '', '', false, false
				)
				returning id::text as id
			`;
			if (created === undefined) {
				throw new LocalLoopError("the synthetic manager login was not created");
			}
			userId = created.id;
			await tx`
				insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
				values (
					gen_random_uuid(), ${userId}::uuid, ${userId}, 'email',
					jsonb_build_object('sub', ${userId}::text, 'email', ${manager.email}::text, 'email_verified', true, 'phone_verified', false),
					now(), now(), now()
				)
			`;
		} else if (options.newPassword) {
			password = makePassword();
			await tx`
				update auth.users
				set encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')), updated_at = now()
				where id = ${userId}::uuid
			`;
		}
		const storeIds = stores.map((store) => store.id);
		await tx`
			insert into public.tenant_members (tenant_id, user_id, role, store_ids)
			values (${tenant.id}::uuid, ${userId}::uuid, 'manager', ${storeIds}::uuid[])
			on conflict (tenant_id, user_id) do update
			set role = excluded.role, store_ids = excluded.store_ids
			where (public.tenant_members.role, public.tenant_members.store_ids)
				is distinct from (excluded.role, excluded.store_ids)
		`;
		const [bound] = await tx<{ user_id: string }[]>`
			select i.user_id::text as user_id
			from public.zalo_identities i
			join public.zalo_apps a on a.id = i.zalo_app_id
			join public.brands b on b.id = a.brand_id
			where b.tenant_id = ${tenant.id}::uuid and b.brand_key = ${brand}
				and i.zalo_user_id = ${manager.mockUser}
		`;
		return {
			...manager,
			userId,
			created: existing === undefined,
			password,
			storeNames: stores.map((store) => store.name),
			mockUserBoundElsewhere: bound !== undefined && bound.user_id !== userId,
		};
	});
}
