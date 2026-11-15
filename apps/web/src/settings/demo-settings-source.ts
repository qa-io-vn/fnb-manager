import { MENU } from "@fnb/connector-mock";
import {
	DEMO_POS_ACCOUNT_ID,
	type DemoRole,
	type DemoSettingsStore,
} from "@fnb/demo-analytics";
import {
	type CatchUpStatus,
	type ItemTypeEntry,
	type Membership,
	NO_CATCH_UP,
	type ReportSettingsState,
	type RoleChange,
	type SettingsSource,
	SettingsWriteError,
} from "./source";

export const DEMO_POS_ACCOUNT_NAME = "Tài khoản POS mẫu";

const DEMO_MEMBERSHIP: Membership = { role: "owner", storeIds: null };

function roleKey(posAccountId: string, itemTypeExternalId: string): string {
	return `${posAccountId}|${itemTypeExternalId}`;
}

export function createDemoSettingsSource(
	store: DemoSettingsStore,
): SettingsSource {
	return {
		kind: "demo",

		async membership(): Promise<Membership> {
			return DEMO_MEMBERSHIP;
		},

		async itemTypes(): Promise<ItemTypeEntry[]> {
			const roleOf = new Map(
				store
					.roles()
					.map((role) => [
						roleKey(role.posAccountId, role.itemTypeExternalId),
						role.role,
					]),
			);
			return MENU.catalog.itemTypes.map((type) => ({
				posAccountId: DEMO_POS_ACCOUNT_ID,
				posAccountName: DEMO_POS_ACCOUNT_NAME,
				itemTypeExternalId: type.externalId,
				name: type.name,
				role: roleOf.get(roleKey(DEMO_POS_ACCOUNT_ID, type.externalId)) ?? null,
			}));
		},

		async saveRoles(_tenantId, changes: readonly RoleChange[]) {
			const next = new Map<string, DemoRole>(
				store
					.roles()
					.map((role) => [
						roleKey(role.posAccountId, role.itemTypeExternalId),
						role,
					]),
			);
			for (const change of changes) {
				next.set(roleKey(change.posAccountId, change.itemTypeExternalId), {
					posAccountId: change.posAccountId,
					itemTypeExternalId: change.itemTypeExternalId,
					role: change.role,
				});
			}
			store.saveRoles([...next.values()]);
		},

		async reportSettings(): Promise<ReportSettingsState> {
			return {
				settings: store.reportSettings(),
				hasRow: store.hasReportSettingsRow(),
			};
		},

		async saveReportSettings(_tenantId, settings) {
			try {
				store.saveReportSettings(settings);
			} catch (error) {
				if (error instanceof RangeError) {
					throw new SettingsWriteError(
						"invalid",
						/^(\w+) must/.exec(error.message)?.[1] ?? null,
					);
				}
				throw error;
			}
		},

		async catchUpStatus(): Promise<CatchUpStatus> {
			return NO_CATCH_UP;
		},

		async refreshChunk(): Promise<CatchUpStatus> {
			return NO_CATCH_UP;
		},
	};
}
