import {
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
} from "./settings-fixture";

export interface StaffFixtureRow {
	readonly name: string;
	readonly role: "staff" | "manager";
	readonly stores: readonly (0 | 1)[];
}

export const STAFF_FIXTURE_ROWS: readonly StaffFixtureRow[] = [
	{ name: "Nhân viên E2E 1", role: "staff", stores: [0] },
	{ name: "Nhân viên E2E 2", role: "staff", stores: [1] },
	{ name: "Quản lý E2E 1", role: "manager", stores: [0, 1] },
];

export const STAFF_APP_TITLE = "Nhân viên thử";
export const STAFF_BRAND_KEY = "brand-907";

export interface StaffFixture {
	readonly miniAppId: string;
	readonly zaloAppId: string;
	readonly rosterIds: Readonly<Record<string, string>>;
}

export interface StaffFixtureCounts {
	readonly roster: number;
	readonly brands: number;
	readonly zaloApps: number;
	readonly miniApps: number;
}

function fixtureHex(fixture: SettingsFixture): string {
	if (!fixture.slug.startsWith(FIXTURE_SLUG_PREFIX)) {
		throw new Error(
			"the staff fixture writes only to a settings fixture tenant",
		);
	}
	return fixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
}

export async function ensureStaffFixture(
	fixture: SettingsFixture,
): Promise<StaffFixture> {
	const hex = fixtureHex(fixture);
	const miniAppId = `e2e-staff-${hex}`;
	const zaloAppExternalId = `e2e-zalo-${hex}`;
	const owner = fixture.logins.owner.userId;
	const sql = openFixtureDatabase();
	try {
		return await sql.begin(async (tx) => {
			for (const row of STAFF_FIXTURE_ROWS) {
				const storeIds = row.stores.map((index) => fixture.storeIds[index]);
				await tx`
					insert into public.staff_roster (tenant_id, display_name, role, store_ids, created_by)
					select ${fixture.tenantId}, ${row.name}, ${row.role}::public.tenant_role, ${storeIds}::uuid[], ${owner}
					where not exists (
						select 1 from public.staff_roster r
						where r.tenant_id = ${fixture.tenantId} and r.display_name = ${row.name}
					)
				`;
			}
			await tx`
				insert into public.brands (tenant_id, brand_key, display_name, store_ids, created_by)
				values (${fixture.tenantId}, ${STAFF_BRAND_KEY}, 'Thương hiệu thử', ${[...fixture.storeIds]}::uuid[], ${owner})
				on conflict (tenant_id, brand_key) do nothing
			`;
			await tx`
				insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name, status, created_by)
				select ${fixture.tenantId}, b.id, ${zaloAppExternalId}, 'ZALO_APP_SECRET_BRAND907', 'disabled', ${owner}
				from public.brands b
				where b.tenant_id = ${fixture.tenantId} and b.brand_key = ${STAFF_BRAND_KEY}
				on conflict (brand_id) do nothing
			`;
			await tx`
				insert into public.mini_apps (
					tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en,
					header_color_light, header_color_dark, text_color_light, text_color_dark, created_by
				)
				select ${fixture.tenantId}, b.id, 'staff', ${miniAppId}, false, ${STAFF_APP_TITLE}, 'Nhân viên', 'Staff',
					'#FFFFFF', '#1F1F1F', 'black', 'white', ${owner}
				from public.brands b
				where b.tenant_id = ${fixture.tenantId} and b.brand_key = ${STAFF_BRAND_KEY}
				on conflict (brand_id, kind) do nothing
			`;
			const [app] = await tx<{ id: string }[]>`
				select id from public.zalo_apps
				where tenant_id = ${fixture.tenantId} and external_id = ${zaloAppExternalId}
			`;
			if (app === undefined) throw new Error("no fixture Zalo App");
			const rows = await tx<{ id: string; display_name: string }[]>`
				select id, display_name from public.staff_roster
				where tenant_id = ${fixture.tenantId}
					and display_name in ${tx(STAFF_FIXTURE_ROWS.map((row) => row.name))}
			`;
			return {
				miniAppId,
				zaloAppId: app.id,
				rosterIds: Object.fromEntries(
					rows.map((row) => [row.display_name, row.id]),
				),
			};
		});
	} finally {
		await sql.end();
	}
}

export async function staffFixtureCounts(
	fixture: SettingsFixture,
): Promise<StaffFixtureCounts> {
	fixtureHex(fixture);
	const sql = openFixtureDatabase();
	try {
		const [counts] = await sql<StaffFixtureCounts[]>`
			select
				(select count(*)::int from public.staff_roster where tenant_id = ${fixture.tenantId}) as roster,
				(select count(*)::int from public.brands where tenant_id = ${fixture.tenantId}) as brands,
				(select count(*)::int from public.zalo_apps where tenant_id = ${fixture.tenantId}) as "zaloApps",
				(select count(*)::int from public.mini_apps where tenant_id = ${fixture.tenantId}) as "miniApps"
		`;
		if (counts === undefined) throw new Error("no counts");
		return counts;
	} finally {
		await sql.end();
	}
}
