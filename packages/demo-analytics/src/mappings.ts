import { DEMO_POS_ACCOUNT_ID, type DemoRole, demoRoles } from "./calendar.js";

export type DemoRoleName = DemoRole["role"];

export interface CategoryOverride {
	readonly posAccountId: string;
	readonly itemExternalId: string;
	readonly itemTypeExternalId: string;
	readonly itemTypeName: string | null;
}

export interface IngestMappings {
	readonly ingestVersion: number;
	accountOf(storeId: string): string;
	roleOf(
		accountId: string,
		itemTypeExternalId: string | null,
	): DemoRoleName | null;
	mapsRole(accountId: string, role: DemoRoleName): boolean;
	overrideOf(accountId: string, itemKey: string): CategoryOverride | null;
}

export class RoleTable {
	private readonly byAccount = new Map<string, Map<string, DemoRoleName>>();

	constructor(roles: readonly DemoRole[]) {
		for (const role of roles) {
			const account =
				this.byAccount.get(role.posAccountId) ??
				new Map<string, DemoRoleName>();
			account.set(role.itemTypeExternalId, role.role);
			this.byAccount.set(role.posAccountId, account);
		}
	}

	roleOf(
		accountId: string,
		itemTypeExternalId: string | null,
	): DemoRoleName | null {
		if (itemTypeExternalId === null) return null;
		return this.byAccount.get(accountId)?.get(itemTypeExternalId) ?? null;
	}

	mapsRole(accountId: string, role: DemoRoleName): boolean {
		for (const mapped of this.byAccount.get(accountId)?.values() ?? []) {
			if (mapped === role) return true;
		}
		return false;
	}

	hasRoles(accountId: string): boolean {
		return (this.byAccount.get(accountId)?.size ?? 0) > 0;
	}
}

const DEFAULT_ROLES = new RoleTable(demoRoles());

export const DEFAULT_INGEST_MAPPINGS: IngestMappings = {
	ingestVersion: 0,
	accountOf: () => DEMO_POS_ACCOUNT_ID,
	roleOf: (accountId, itemTypeExternalId) =>
		DEFAULT_ROLES.roleOf(accountId, itemTypeExternalId),
	mapsRole: (accountId, role) => DEFAULT_ROLES.mapsRole(accountId, role),
	overrideOf: () => null,
};
