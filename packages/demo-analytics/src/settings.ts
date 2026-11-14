import { MENU } from "@fnb/connector-mock";
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

const REPORT_SETTING_RANGES: readonly [
	keyof ReportSettings,
	number,
	number,
	number,
][] = [
	["menuWindowDays", 7, 91, 0],
	["menuPopularityFactor", 0.1, 1, 3],
	["menuLowSampleItems", 2, 50, 0],
	["cashAbsThreshold", 0, Number.MAX_SAFE_INTEGER, 2],
	["cashRelThreshold", 0, 0.1, 4],
	["peakHours", 1, 6, 0],
	["deadHourRatio", 0.1, 0.9, 3],
	["busyHourRatio", 1.05, 3, 3],
	["promoPreWeeks", 2, 8, 0],
];

function checkReportSettings(settings: ReportSettings): void {
	for (const [field, low, high, digits] of REPORT_SETTING_RANGES) {
		const value = settings[field];
		const scaled = value * 10 ** digits;
		if (
			!(value >= low && value <= high) ||
			Math.abs(scaled - Math.round(scaled)) > 1e-9
		) {
			throw new RangeError(
				`${field} must lie between ${low} and ${high} with at most ${digits} decimals`,
			);
		}
	}
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
		const named = overrides.map((override) => ({
			...override,
			itemTypeName:
				MENU.catalog.itemTypes.find(
					(type) => type.externalId === override.itemTypeExternalId,
				)?.name ?? null,
		}));
		this.snapshot = { ...this.snapshot, overrides: named };
		this.overrideIndex = DemoSettingsStore.indexOverrides(named);
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
		if (settings !== null) checkReportSettings(settings);
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
