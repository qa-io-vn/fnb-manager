import {
	DEFAULT_REPORT_SETTINGS,
	type IsoDate,
	type ReportSettings,
} from "@fnb/reports";
import {
	DEMO_POS_ACCOUNT_ID,
	type DemoRole,
	type DemoStoreId,
	demoRoles,
} from "./calendar.js";
import {
	type CategoryOverride,
	type DemoRoleName,
	type IngestMappings,
	RoleTable,
} from "./mappings.js";

export interface DemoStoreProfile {
	readonly storeId: DemoStoreId;
	readonly code: string | null;
	readonly seatCount: number | null;
}

export interface DemoItemCost {
	readonly storeId: string | null;
	readonly itemExternalId: string;
	readonly costAmount: number;
	readonly effectiveFrom: IsoDate;
}

export interface DemoSettingsSnapshot {
	readonly reportSettings: ReportSettings | null;
	readonly stores: readonly DemoStoreProfile[];
	readonly storeAccounts: Readonly<Record<string, string>>;
	readonly roles: readonly DemoRole[];
	readonly overrides: readonly CategoryOverride[];
	readonly costs: readonly DemoItemCost[];
	readonly feeRateStoreIds: readonly string[] | "tenant";
}

export const DEMO_STORE_PROFILES: readonly DemoStoreProfile[] = [
	{ storeId: "MOCK-S1", code: "CH1", seatCount: 40 },
	{ storeId: "MOCK-S2", code: "CH2", seatCount: null },
];

export function demoSettings(): DemoSettingsSnapshot {
	return {
		reportSettings: null,
		stores: DEMO_STORE_PROFILES,
		storeAccounts: {},
		roles: demoRoles(),
		overrides: [],
		costs: [],
		feeRateStoreIds: [],
	};
}

function appliesTo(scope: readonly string[] | "tenant", storeId: string) {
	return scope === "tenant" || scope.includes(storeId);
}

function overrideKey(accountId: string, itemExternalId: string): string {
	return `${accountId}\u0000${itemExternalId}`;
}

export class DemoSettingsStore implements IngestMappings {
	private snapshot: DemoSettingsSnapshot;
	private versionCount = 0;
	private ingestVersionCount = 0;
	private roleTable: RoleTable;
	private overrideIndex: Map<string, CategoryOverride>;

	constructor(initial: DemoSettingsSnapshot = demoSettings()) {
		this.snapshot = initial;
		this.roleTable = new RoleTable(initial.roles);
		this.overrideIndex = DemoSettingsStore.indexOverrides(initial.overrides);
	}

	private static indexOverrides(
		overrides: readonly CategoryOverride[],
	): Map<string, CategoryOverride> {
		return new Map(
			overrides.map((override) => [
				overrideKey(override.posAccountId, override.itemExternalId),
				override,
			]),
		);
	}

	get version(): number {
		return this.versionCount;
	}

	get ingestVersion(): number {
		return this.ingestVersionCount;
	}

	accountOf(storeId: string): string {
		return this.snapshot.storeAccounts[storeId] ?? DEMO_POS_ACCOUNT_ID;
	}

	roleOf(
		accountId: string,
		itemTypeExternalId: string | null,
	): DemoRoleName | null {
		return this.roleTable.roleOf(accountId, itemTypeExternalId);
	}

	mapsRole(accountId: string, role: DemoRoleName): boolean {
		return this.roleTable.mapsRole(accountId, role);
	}

	overrideOf(accountId: string, itemKey: string): CategoryOverride | null {
		return this.overrideIndex.get(overrideKey(accountId, itemKey)) ?? null;
	}

	roles(): readonly DemoRole[] {
		return this.snapshot.roles;
	}

	overrides(): readonly CategoryOverride[] {
		return this.snapshot.overrides;
	}

	costs(): readonly DemoItemCost[] {
		return this.snapshot.costs;
	}

	saveStoreAccounts(storeAccounts: Readonly<Record<string, string>>): void {
		this.snapshot = { ...this.snapshot, storeAccounts };
		this.mappingsChanged();
	}

	saveRoles(roles: readonly DemoRole[]): void {
		this.snapshot = { ...this.snapshot, roles };
		this.roleTable = new RoleTable(roles);
		this.mappingsChanged();
	}

	saveOverrides(overrides: readonly CategoryOverride[]): void {
		this.snapshot = { ...this.snapshot, overrides };
		this.overrideIndex = DemoSettingsStore.indexOverrides(overrides);
		this.mappingsChanged();
	}

	saveCosts(costs: readonly DemoItemCost[]): void {
		for (const cost of costs) {
			if (!(cost.costAmount >= 0)) {
				throw new RangeError("item cost must be zero or more");
			}
		}
		this.snapshot = { ...this.snapshot, costs };
		this.versionCount += 1;
	}

	private mappingsChanged(): void {
		this.versionCount += 1;
		this.ingestVersionCount += 1;
	}

	hasReportSettingsRow(): boolean {
		return this.snapshot.reportSettings !== null;
	}

	reportSettings(): ReportSettings {
		return this.snapshot.reportSettings ?? DEFAULT_REPORT_SETTINGS;
	}

	saveReportSettings(settings: ReportSettings | null): void {
		this.snapshot = { ...this.snapshot, reportSettings: settings };
		this.versionCount += 1;
	}

	storeProfile(storeId: string): DemoStoreProfile | null {
		return (
			this.snapshot.stores.find((profile) => profile.storeId === storeId) ??
			null
		);
	}

	seatCount(storeId: string): number | null {
		return this.storeProfile(storeId)?.seatCount ?? null;
	}

	rolesConfigured(storeId: string): boolean {
		return this.roleTable.hasRoles(this.accountOf(storeId));
	}

	feeRatesConfigured(storeId: string): boolean {
		return appliesTo(this.snapshot.feeRateStoreIds, storeId);
	}

	costsConfigured(storeId: string): boolean {
		return this.snapshot.costs.some(
			(cost) => cost.storeId === null || cost.storeId === storeId,
		);
	}
}
