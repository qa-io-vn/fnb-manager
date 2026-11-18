import type { Sql } from "postgres";
import { UsageError } from "../context.js";
import type {
	BrandConfig,
	BrandOverview,
	MiniAppConfig,
	OaConfig,
	ZaloAppConfig,
} from "./zalo-config.js";

export interface StoreRow {
	readonly id: string;
	readonly external_id: string;
}

export type RowChange = "created" | "unchanged";

export interface RowReport {
	readonly row: string;
	readonly change: RowChange;
}

export class BrandConflictError extends Error {
	readonly conflicts: readonly string[];

	constructor(conflicts: readonly string[]) {
		super(`the stored rows differ: ${conflicts.join("; ")}`);
		this.name = "BrandConflictError";
		this.conflicts = conflicts;
	}
}

export async function tenantStores(
	sql: Sql,
	tenantId: string,
): Promise<StoreRow[]> {
	return sql<StoreRow[]>`
		select id::text as id, external_id from public.stores where tenant_id = ${tenantId}::uuid
	`;
}

export function resolveStoreIds(
	stores: readonly StoreRow[],
	wanted: readonly string[],
): string[] {
	const unknown: string[] = [];
	const ambiguous: string[] = [];
	const ids = wanted.map((value) => {
		const matches = stores.filter(
			(store) => store.external_id === value || store.id === value,
		);
		if (matches.length === 0) {
			unknown.push(value);
		} else if (matches.length > 1) {
			ambiguous.push(value);
		}
		return matches[0]?.id ?? "";
	});
	if (unknown.length > 0) {
		throw new UsageError(
			`${unknown.length} store value(s) are not stores of this tenant`,
		);
	}
	if (ambiguous.length > 0) {
		throw new UsageError(
			`${ambiguous.length} store value(s) match stores of several POS accounts; give the store id instead`,
		);
	}
	return [...new Set(ids)].sort();
}

function differing(
	stored: Readonly<Record<string, unknown>>,
	wanted: Readonly<Record<string, unknown>>,
): string[] {
	return Object.keys(wanted).filter((field) => {
		const left = stored[field];
		const right = wanted[field];
		if (typeof left === "string" && typeof right === "string") {
			return field.includes("color")
				? left.toUpperCase() !== right.toUpperCase()
				: left !== right;
		}
		return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
	});
}

function appFields(app: ZaloAppConfig) {
	return {
		external_id: app.id,
		secret_name: app.secretName,
		status: app.status,
	};
}

function oaFields(oa: OaConfig) {
	return {
		external_id: oa.id,
		secret_name: oa.secretName,
		package_tier: oa.packageTier,
		package_expires_on: oa.packageExpiresOn,
		verified: oa.verified,
		webhook_mode: oa.webhookMode,
	};
}

function miniAppFields(app: MiniAppConfig) {
	return {
		external_id: app.id,
		title: app.title,
		header_title_vi: app.headerTitleVi,
		header_title_en: app.headerTitleEn,
		header_color_light: app.headerColorLight,
		header_color_dark: app.headerColorDark,
		text_color_light: app.textColorLight,
		text_color_dark: app.textColorDark,
	};
}

export async function applyBrandConfig(
	sql: Sql,
	tenantId: string,
	config: BrandConfig,
	storeIds: readonly string[],
): Promise<RowReport[]> {
	return sql.begin(async (tx) => {
		const reports: RowReport[] = [];
		const conflicts: string[] = [];
		const note = (row: string, change: RowChange) =>
			reports.push({ row, change });
		const conflict = (row: string, fields: readonly string[]) => {
			if (fields.length > 0) {
				conflicts.push(`${row} ${fields.join(", ")}`);
			}
		};

		const storeJson = JSON.stringify(storeIds);
		const [brand] = await tx<
			{ id: string; display_name: string; store_ids: string[] }[]
		>`
			select id::text as id, display_name,
				array(select s::text from unnest(store_ids) as s order by 1) as store_ids
			from public.brands
			where tenant_id = ${tenantId}::uuid and brand_key = ${config.brand}
			for update
		`;
		let brandId: string;
		if (brand === undefined) {
			const [created] = await tx<{ id: string }[]>`
				insert into public.brands (tenant_id, brand_key, display_name, store_ids)
				values (
					${tenantId}::uuid, ${config.brand}, ${config.name},
					array(select jsonb_array_elements_text(${storeJson}::text::jsonb)::uuid)
				)
				returning id::text as id
			`;
			if (created === undefined) {
				throw new Error("the brand insert returned no row");
			}
			brandId = created.id;
			note("brand", "created");
		} else {
			brandId = brand.id;
			conflict(
				"brand",
				differing(brand, {
					display_name: config.name,
					store_ids: [...storeIds],
				}),
			);
			note("brand", "unchanged");
		}

		const [app] = await tx<Record<string, unknown>[]>`
			select external_id, secret_name, status from public.zalo_apps where brand_id = ${brandId}::uuid
		`;
		const wantedApp = appFields(config.zaloApp);
		if (app === undefined) {
			await tx`
				insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name, status)
				values (${tenantId}::uuid, ${brandId}::uuid, ${wantedApp.external_id}, ${wantedApp.secret_name}, ${wantedApp.status})
			`;
			note("Zalo App", "created");
		} else {
			conflict("Zalo App", differing(app, wantedApp));
			note("Zalo App", "unchanged");
		}

		if (config.oa !== null) {
			const wantedOa = oaFields(config.oa);
			const [oa] = await tx<Record<string, unknown>[]>`
				select external_id, secret_name, package_tier, package_expires_on::text as package_expires_on,
					verified, webhook_mode
				from public.oas where brand_id = ${brandId}::uuid
			`;
			if (oa === undefined) {
				await tx`
					insert into public.oas (tenant_id, brand_id, external_id, secret_name, package_tier,
						package_expires_on, verified, webhook_mode)
					values (${tenantId}::uuid, ${brandId}::uuid, ${wantedOa.external_id}, ${wantedOa.secret_name},
						${wantedOa.package_tier}, ${wantedOa.package_expires_on}::date, ${wantedOa.verified},
						${wantedOa.webhook_mode})
				`;
				note("OA", "created");
			} else {
				conflict("OA", differing(oa, wantedOa));
				note("OA", "unchanged");
			}
		}

		for (const miniApp of config.miniApps) {
			const row = `${miniApp.kind} Mini App`;
			const wanted = miniAppFields(miniApp);
			const [stored] = await tx<Record<string, unknown>[]>`
				select external_id, title, header_title_vi, header_title_en, header_color_light,
					header_color_dark, text_color_light, text_color_dark
				from public.mini_apps where brand_id = ${brandId}::uuid and kind = ${miniApp.kind}
			`;
			if (stored === undefined) {
				await tx`
					insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title,
						header_title_vi, header_title_en, header_color_light, header_color_dark,
						text_color_light, text_color_dark)
					values (${tenantId}::uuid, ${brandId}::uuid, ${miniApp.kind}, ${wanted.external_id},
						${miniApp.kind === "customer"}, ${wanted.title}, ${wanted.header_title_vi},
						${wanted.header_title_en}, ${wanted.header_color_light}, ${wanted.header_color_dark},
						${wanted.text_color_light}, ${wanted.text_color_dark})
				`;
				note(row, "created");
			} else {
				conflict(row, differing(stored, wanted));
				note(row, "unchanged");
			}
		}

		if (conflicts.length > 0) {
			throw new BrandConflictError(conflicts);
		}
		return reports;
	});
}

interface OverviewRow {
	brand_key: string;
	display_name: string;
	store_count: number;
	app_id: string | null;
	app_secret_name: string | null;
	app_status: string | null;
	oa_id: string | null;
	oa_secret_name: string | null;
	package_tier: string | null;
	package_expires_on: string | null;
	verified: boolean | null;
	webhook_mode: string | null;
	mini_apps: { kind: string; id: string; title: string }[];
	identities: number;
}

export async function brandOverview(
	sql: Sql,
	tenantId: string,
): Promise<BrandOverview[]> {
	const rows = await sql<OverviewRow[]>`
		select b.brand_key, b.display_name, cardinality(b.store_ids)::integer as store_count,
			a.external_id as app_id, a.secret_name as app_secret_name, a.status as app_status,
			o.external_id as oa_id, o.secret_name as oa_secret_name, o.package_tier,
			o.package_expires_on::text as package_expires_on, o.verified, o.webhook_mode,
			coalesce(
				(select json_agg(json_build_object('kind', m.kind, 'id', m.external_id, 'title', m.title)
					order by m.kind = 'customer')
				 from public.mini_apps m where m.brand_id = b.id),
				'[]'::json
			) as mini_apps,
			(select count(*)::integer from public.zalo_identities i where i.zalo_app_id = a.id) as identities
		from public.brands b
		left join public.zalo_apps a on a.brand_id = b.id
		left join public.oas o on o.brand_id = b.id
		where b.tenant_id = ${tenantId}::uuid
		order by char_length(b.brand_key), b.brand_key
	`;
	return rows.map((row) => ({
		brand: row.brand_key,
		name: row.display_name,
		storeCount: row.store_count,
		appId: row.app_id,
		appSecretName: row.app_secret_name,
		appStatus: row.app_status,
		oaId: row.oa_id,
		oaSecretName: row.oa_secret_name,
		oaTier: row.package_tier,
		oaExpiresOn: row.package_expires_on,
		oaVerified: row.verified,
		webhookMode: row.webhook_mode,
		miniApps: row.mini_apps,
		identities: row.identities,
	}));
}

export async function brandAppId(
	sql: Sql,
	tenantId: string,
	brandKey: string,
): Promise<string | null> {
	const [row] = await sql<{ id: string }[]>`
		select a.id::text as id
		from public.zalo_apps a
		join public.brands b on b.id = a.brand_id
		where b.tenant_id = ${tenantId}::uuid and b.brand_key = ${brandKey}
	`;
	return row?.id ?? null;
}

export async function issueBindingCode(
	sql: Sql,
	tenantId: string,
	userId: string,
	zaloAppId: string,
): Promise<{ code: string; expiresAt: Date }> {
	const [issued] = await sql<{ code: string }[]>`
		select app.issue_zalo_binding_code(${tenantId}::uuid, ${userId}::uuid, ${zaloAppId}::uuid) as code
	`;
	const [stored] = await sql<{ expires_at: Date }[]>`
		select expires_at from app.zalo_binding_codes
		where zalo_app_id = ${zaloAppId}::uuid and user_id = ${userId}::uuid
	`;
	if (issued === undefined || stored === undefined) {
		throw new Error("the binding code was not stored");
	}
	return { code: issued.code, expiresAt: stored.expires_at };
}
