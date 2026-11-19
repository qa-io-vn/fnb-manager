import { randomBytes, randomUUID } from "node:crypto";
import {
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
} from "./settings-fixture";

const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

export const ROSTER_NAMES = {
	manager: "Quản lý chung E2E",
	storeManager: "Quản lý cửa hàng 1 E2E",
	storeOneStaff: "Nhân viên cửa hàng 1 E2E",
	storeTwoStaff: "Nhân viên cửa hàng 2 E2E",
} as const;

export interface AnnouncementsFixture {
	readonly storeOneStaffId: string;
	readonly storeOneStaffEmail: string;
	teardown(): Promise<void>;
}

function fixtureHex(fixture: SettingsFixture): string {
	if (!fixture.slug.startsWith(FIXTURE_SLUG_PREFIX)) {
		throw new Error(
			"the announcements fixture writes only to a settings fixture tenant",
		);
	}
	return fixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
}

export async function prepareAnnouncementsFixture(
	fixture: SettingsFixture,
): Promise<AnnouncementsFixture> {
	fixtureHex(fixture);
	const [storeOne, storeTwo] = fixture.storeIds;
	const owner = fixture.logins.owner.userId;
	const storeOneStaffId = randomUUID();
	const storeOneStaffEmail = `e2e-staff-${randomBytes(4).toString("hex")}@example.com`;
	const sql = openFixtureDatabase();
	try {
		await sql.begin(async (tx) => {
			await tx`
				insert into auth.users (
					instance_id, id, aud, role, email, email_confirmed_at,
					raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
					confirmation_token, recovery_token, email_change_token_new, email_change,
					email_change_token_current, phone_change, phone_change_token, reauthentication_token,
					is_sso_user, is_anonymous
				)
				values (
					${AUTH_INSTANCE_ID}, ${storeOneStaffId}, 'authenticated', 'authenticated', ${storeOneStaffEmail}, now(),
					'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
					'', '', '', '', '', '', '', '', false, false
				)
			`;
			await tx`
				update public.tenant_members
				set store_ids = ${[storeTwo]}::uuid[]
				where tenant_id = ${fixture.tenantId} and user_id = ${fixture.logins.staff.userId}
			`;
			await tx`
				insert into public.tenant_members (tenant_id, user_id, role, store_ids)
				values (${fixture.tenantId}, ${storeOneStaffId}, 'staff'::public.tenant_role, ${[storeOne]}::uuid[])
			`;
			const roster = [
				{
					name: ROSTER_NAMES.manager,
					role: "manager",
					stores: null,
					userId: fixture.logins.manager.userId,
				},
				{
					name: ROSTER_NAMES.storeManager,
					role: "manager",
					stores: [storeOne],
					userId: fixture.logins["store-manager"].userId,
				},
				{
					name: ROSTER_NAMES.storeOneStaff,
					role: "staff",
					stores: [storeOne],
					userId: storeOneStaffId,
				},
				{
					name: ROSTER_NAMES.storeTwoStaff,
					role: "staff",
					stores: [storeTwo],
					userId: fixture.logins.staff.userId,
				},
			] as const;
			for (const row of roster) {
				await tx`
					insert into public.staff_roster (
						tenant_id, display_name, role, store_ids, status, user_id, paired_at, created_by
					)
					values (
						${fixture.tenantId}, ${row.name}, ${row.role}::public.tenant_role,
						${row.stores === null ? null : [...row.stores]}::uuid[], 'active', ${row.userId}, now(), ${owner}
					)
				`;
			}
		});
	} finally {
		await sql.end();
	}
	let removed = false;
	return {
		storeOneStaffId,
		storeOneStaffEmail,
		async teardown() {
			if (removed) return;
			removed = true;
			const cleanup = openFixtureDatabase();
			try {
				await cleanup`delete from auth.users where id = ${storeOneStaffId}`;
			} finally {
				await cleanup.end();
			}
		},
	};
}
