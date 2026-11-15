import type { IsoDate } from "@fnb/reports";
import { DEMO_POS_ACCOUNT_ID, type DemoRole, demoRoles } from "./calendar.js";

export type DemoRoleName = DemoRole["role"];

export interface CategoryOverride {
	readonly posAccountId: string;
	readonly itemExternalId: string;
	readonly itemTypeExternalId: string;
	readonly itemTypeName: string | null;
}

export interface DemoFeeRate {
	readonly storeId: string | null;
	readonly paymentMethodExternalId: string;
	readonly feePct: number;
	readonly fixedFeeAmount: number;
	readonly effectiveFrom: IsoDate;
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
	feeRateOf(
		storeId: string,
		paymentMethodExternalId: string | null,
		businessDate: IsoDate,
	): DemoFeeRate | null;
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

function storeRowsFirstThenLatest(left: DemoFeeRate, right: DemoFeeRate) {
	const leftTenantWide = left.storeId === null ? 1 : 0;
	const rightTenantWide = right.storeId === null ? 1 : 0;
	if (leftTenantWide !== rightTenantWide) {
		return leftTenantWide - rightTenantWide;
	}
	if (left.effectiveFrom === right.effectiveFrom) return 0;
	return left.effectiveFrom > right.effectiveFrom ? -1 : 1;
}

export class FeeRateTable {
	private readonly byMethod = new Map<string, readonly DemoFeeRate[]>();

	constructor(rates: readonly DemoFeeRate[]) {
		const grouped = new Map<string, DemoFeeRate[]>();
		for (const rate of rates) {
			const list = grouped.get(rate.paymentMethodExternalId) ?? [];
			list.push(rate);
			grouped.set(rate.paymentMethodExternalId, list);
		}
		for (const [method, list] of grouped) {
			this.byMethod.set(method, list.sort(storeRowsFirstThenLatest));
		}
	}

	rateOf(
		storeId: string,
		paymentMethodExternalId: string | null,
		businessDate: IsoDate,
	): DemoFeeRate | null {
		if (paymentMethodExternalId === null) return null;
		for (const rate of this.byMethod.get(paymentMethodExternalId) ?? []) {
			if (rate.effectiveFrom > businessDate) continue;
			if (rate.storeId !== null && rate.storeId !== storeId) continue;
			return rate;
		}
		return null;
	}

	appliesTo(storeId: string): boolean {
		for (const list of this.byMethod.values()) {
			if (
				list.some((rate) => rate.storeId === null || rate.storeId === storeId)
			)
				return true;
		}
		return false;
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
	feeRateOf: () => null,
};
