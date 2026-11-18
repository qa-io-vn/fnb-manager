import type { Sql } from "postgres";
import { MEMBER_ROLES, type MemberRole } from "../session.js";
import { isMockId, LocalLoopError } from "./options.js";

export interface StaffMiniAppRow {
	readonly title: string;
	readonly header_title_vi: string;
	readonly header_title_en: string;
	readonly header_color_light: string;
	readonly header_color_dark: string;
	readonly text_color_light: "black" | "white";
	readonly text_color_dark: "black" | "white";
}

export interface LoopTarget {
	readonly tenantId: string;
	readonly tenantSlug: string;
	readonly brand: string;
	readonly brandId: string;
	readonly storeCount: number;
	readonly zaloAppId: string;
	readonly zaloAppExternalId: string;
	readonly secretName: string;
	readonly appStatus: string;
	readonly oaExternalId: string | null;
	readonly miniAppExternalIds: readonly string[];
	readonly staffMiniApp: StaffMiniAppRow | null;
}

export interface LoopMember {
	readonly userId: string;
	readonly role: MemberRole;
}

export const BRAND_ROW_TABLES: readonly string[] = [
	"public.zalo_apps",
	"public.oas",
	"public.mini_apps",
	"public.zalo_identities",
	"public.zalo_tokens",
	"public.zbs_templates",
	"public.gmf_groups",
	"public.oa_events",
	"app.oa_event_days",
	"app.zalo_binding_codes",
];

export async function loadLoopTarget(
	sql: Sql,
	tenantSlug: string,
	brand: string,
): Promise<LoopTarget> {
	const [tenant] = await sql<{ id: string }[]>`
		select id::text as id from public.tenants where slug = ${tenantSlug}
	`;
	if (tenant === undefined) {
		throw new LocalLoopError(`the local stack has no tenant ${tenantSlug}`);
	}
	const [row] = await sql<
		{
			brand_id: string;
			store_count: number;
			app_id: string | null;
			app_external_id: string | null;
			secret_name: string | null;
			status: string | null;
			oa_external_id: string | null;
			mini_app_ids: string[];
			staff: StaffMiniAppRow | null;
		}[]
	>`
		select b.id::text as brand_id, cardinality(b.store_ids)::integer as store_count,
			a.id::text as app_id, a.external_id as app_external_id, a.secret_name, a.status,
			o.external_id as oa_external_id,
			array(select m.external_id from public.mini_apps m where m.brand_id = b.id order by m.kind) as mini_app_ids,
			(select json_build_object(
				'title', m.title, 'header_title_vi', m.header_title_vi, 'header_title_en', m.header_title_en,
				'header_color_light', m.header_color_light, 'header_color_dark', m.header_color_dark,
				'text_color_light', m.text_color_light, 'text_color_dark', m.text_color_dark)
			 from public.mini_apps m where m.brand_id = b.id and m.kind = 'staff') as staff
		from public.brands b
		left join public.zalo_apps a on a.brand_id = b.id
		left join public.oas o on o.brand_id = b.id
		where b.tenant_id = ${tenant.id}::uuid and b.brand_key = ${brand}
	`;
	if (
		row === undefined ||
		row.app_id === null ||
		row.app_external_id === null ||
		row.secret_name === null ||
		row.status === null
	) {
		throw new LocalLoopError(
			`${brand} has no Zalo App in ${tenantSlug}; add it with fnb zalo config set --tenant ${tenantSlug} --file docs/private/zalo/${brand}.json`,
		);
	}
	return {
		tenantId: tenant.id,
		tenantSlug,
		brand,
		brandId: row.brand_id,
		storeCount: row.store_count,
		zaloAppId: row.app_id,
		zaloAppExternalId: row.app_external_id,
		secretName: row.secret_name,
		appStatus: row.status,
		oaExternalId: row.oa_external_id,
		miniAppExternalIds: row.mini_app_ids,
		staffMiniApp: row.staff,
	};
}

export function startProblems(target: LoopTarget): string[] {
	const problems: string[] = [];
	if (!isMockId(target.zaloAppExternalId)) {
		problems.push(
			`${target.brand}'s Zalo App is not a mock app (mock-…); the local loop binds mock Zalo users to mock apps only`,
		);
	}
	if (target.appStatus !== "active") {
		problems.push(`${target.brand}'s Zalo App is disabled`);
	}
	return problems;
}

export async function findMember(
	sql: Sql,
	tenantId: string,
	email: string,
): Promise<LoopMember | null> {
	const [row] = await sql<{ user_id: string; role: string }[]>`
		select m.user_id::text as user_id, m.role::text as role
		from public.tenant_members m
		join auth.users u on u.id = m.user_id
		where m.tenant_id = ${tenantId}::uuid and lower(u.email) = lower(${email})
	`;
	if (row === undefined) {
		return null;
	}
	const role = MEMBER_ROLES.find((name) => name === row.role);
	if (role === undefined) {
		throw new LocalLoopError("the member has a role the Mini Apps do not know");
	}
	return { userId: row.user_id, role };
}

export async function identityOwner(
	sql: Sql,
	zaloAppId: string,
	zaloUserId: string,
): Promise<string | null> {
	const [row] = await sql<{ user_id: string }[]>`
		select user_id::text as user_id from public.zalo_identities
		where zalo_app_id = ${zaloAppId}::uuid and zalo_user_id = ${zaloUserId}
	`;
	return row?.user_id ?? null;
}

export async function issueBindingCode(
	sql: Sql,
	target: LoopTarget,
	userId: string,
): Promise<string> {
	const [row] = await sql<{ code: string }[]>`
		select app.issue_zalo_binding_code(${target.tenantId}::uuid, ${userId}::uuid, ${target.zaloAppId}::uuid) as code
	`;
	if (row === undefined) {
		throw new LocalLoopError("no binding code was issued");
	}
	return row.code;
}

export interface BrandRows {
	readonly identities: readonly string[];
	readonly dependentRows: number;
	readonly foreignTables: readonly string[];
}

export function forgetProblems(target: LoopTarget, rows: BrandRows): string[] {
	const problems: string[] = [];
	const ids = [
		target.zaloAppExternalId,
		...(target.oaExternalId === null ? [] : [target.oaExternalId]),
		...target.miniAppExternalIds,
	];
	const real = ids.filter((id) => !isMockId(id)).length;
	if (real > 0) {
		problems.push(
			`${real} of ${target.brand}'s Zalo ids are not mock ids (mock-…); forget removes mock configuration only`,
		);
	}
	const realIdentities = rows.identities.filter((id) => !isMockId(id)).length;
	if (realIdentities > 0) {
		problems.push(
			`${realIdentities} bound identities are not mock Zalo users; forget removes mock identities only`,
		);
	}
	if (rows.dependentRows > 0) {
		problems.push(
			`${rows.dependentRows} token, template, group or OA event rows hang off ${target.brand}`,
		);
	}
	if (rows.foreignTables.length > 0) {
		problems.push(
			`${rows.foreignTables.join(", ")} refer to the Zalo configuration tables; remove the brand by hand`,
		);
	}
	return problems;
}

export async function brandRows(
	sql: Sql,
	target: LoopTarget,
): Promise<BrandRows> {
	const identities = await sql<{ zalo_user_id: string }[]>`
		select zalo_user_id from public.zalo_identities where zalo_app_id = ${target.zaloAppId}::uuid
	`;
	const [dependent] = await sql<{ rows: number }[]>`
		select (
			(select count(*) from public.zalo_tokens t where t.brand_id = ${target.brandId}::uuid)
			+ (select count(*) from public.zbs_templates z join public.oas o on o.id = z.oa_id where o.brand_id = ${target.brandId}::uuid)
			+ (select count(*) from public.gmf_groups g join public.oas o on o.id = g.oa_id where o.brand_id = ${target.brandId}::uuid)
			+ (select count(*) from public.oa_events e join public.oas o on o.id = e.oa_id where o.brand_id = ${target.brandId}::uuid)
			+ (select count(*) from app.oa_event_days d join public.oas o on o.id = d.oa_id where o.brand_id = ${target.brandId}::uuid)
		)::integer as rows
	`;
	const foreign = await sql<{ referencing: string }[]>`
		select distinct c.conrelid::regclass::text as referencing
		from pg_constraint c
		where c.contype = 'f'
			and c.confrelid in (
				'public.brands'::regclass, 'public.zalo_apps'::regclass, 'public.oas'::regclass,
				'public.mini_apps'::regclass, 'public.zalo_identities'::regclass
			)
	`;
	const known = new Set(
		BRAND_ROW_TABLES.map((name) => name.replace(/^public\./, "")),
	);
	return {
		identities: identities.map((row) => row.zalo_user_id),
		dependentRows: dependent?.rows ?? 0,
		foreignTables: foreign
			.map((row) => row.referencing)
			.filter((name) => !known.has(name.replace(/^public\./, "")))
			.sort(),
	};
}

export async function forgetBrand(sql: Sql, target: LoopTarget): Promise<void> {
	await sql`
		delete from public.brands where id = ${target.brandId}::uuid and tenant_id = ${target.tenantId}::uuid
	`;
}
