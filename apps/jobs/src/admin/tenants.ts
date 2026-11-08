import type { Sql } from "postgres";

export const LEGAL_FORMS = [
	"household_business",
	"micro_enterprise",
	"small_enterprise",
	"enterprise",
	"unknown",
] as const;

export type LegalForm = (typeof LEGAL_FORMS)[number];

export const TENANT_ROLES = [
	"owner",
	"manager",
	"staff",
	"viewer",
	"publisher",
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export interface TenantRecord {
	id: string;
	slug: string;
	name: string;
	country_code: string;
	currency_code: string;
	timezone: string;
	legal_form: LegalForm;
}

export interface TenantInput {
	slug: string;
	name: string;
	country_code: string;
	currency_code: string;
	timezone: string;
	legal_form: LegalForm;
}

export async function findTenant(
	sql: Sql,
	slug: string,
): Promise<TenantRecord | null> {
	const [row] = await sql<TenantRecord[]>`
		select id, slug, name, country_code, currency_code, timezone, legal_form::text as legal_form
		from public.tenants
		where slug = ${slug}
	`;
	return row ?? null;
}

export async function requireTenant(
	sql: Sql,
	slug: string,
	hideSlug: boolean,
): Promise<TenantRecord> {
	const tenant = await findTenant(sql, slug);
	if (!tenant) {
		throw new Error(
			`no tenant with ${hideSlug ? "that slug" : `slug "${slug}"`}; create it with fnb tenant create`,
		);
	}
	return tenant;
}

export async function insertTenant(
	sql: Sql,
	input: TenantInput,
): Promise<TenantRecord | null> {
	const [row] = await sql<TenantRecord[]>`
		insert into public.tenants (slug, name, country_code, currency_code, timezone, legal_form)
		values (${input.slug}, ${input.name}, ${input.country_code}, ${input.currency_code},
			${input.timezone}, ${input.legal_form}::public.legal_form)
		on conflict (slug) do nothing
		returning id, slug, name, country_code, currency_code, timezone, legal_form::text as legal_form
	`;
	return row ?? null;
}

export function tenantDifferences(
	existing: TenantRecord,
	input: TenantInput,
): string[] {
	const fields = [
		"name",
		"country_code",
		"currency_code",
		"timezone",
		"legal_form",
	] as const;
	return fields.filter((field) => existing[field] !== input[field]);
}

export async function findAuthUserId(
	sql: Sql,
	email: string,
): Promise<string | null> {
	const [row] = await sql<{ id: string }[]>`
		select id from auth.users where lower(email) = lower(${email}) order by created_at limit 1
	`;
	return row?.id ?? null;
}

export type MembershipChange = "created" | "updated" | "unchanged";

export async function upsertMember(
	sql: Sql,
	tenantId: string,
	userId: string,
	role: TenantRole,
): Promise<MembershipChange> {
	const [existing] = await sql<{ role: TenantRole }[]>`
		select role::text as role from public.tenant_members where tenant_id = ${tenantId} and user_id = ${userId}
	`;
	if (existing?.role === role) {
		return "unchanged";
	}
	await sql`
		insert into public.tenant_members (tenant_id, user_id, role)
		values (${tenantId}, ${userId}, ${role}::public.tenant_role)
		on conflict (tenant_id, user_id) do update set role = excluded.role
	`;
	return existing ? "updated" : "created";
}

export async function deleteTenant(sql: Sql, slug: string): Promise<number> {
	const result = await sql`delete from public.tenants where slug = ${slug}`;
	return result.count;
}
