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

export function syntheticBrand(slug: string, brand: string): SyntheticBrand {
	const short =
		slug === SIMULATED_TENANT ? "sim" : slug.replace(/^zalo-it-/, "it-");
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
