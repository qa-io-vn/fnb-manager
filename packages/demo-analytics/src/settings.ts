import { DEFAULT_REPORT_SETTINGS, type ReportSettings } from "@fnb/reports";
import type { DemoStoreId } from "./calendar.js";

export interface DemoStoreProfile {
	readonly storeId: DemoStoreId;
	readonly code: string | null;
	readonly seatCount: number | null;
}

export interface DemoSettingsSnapshot {
	readonly reportSettings: ReportSettings | null;
	readonly stores: readonly DemoStoreProfile[];
	readonly rolesConfigured: boolean;
	readonly feeRateStoreIds: readonly string[] | "tenant";
	readonly costStoreIds: readonly string[] | "tenant";
}

export const DEMO_STORE_PROFILES: readonly DemoStoreProfile[] = [
	{ storeId: "MOCK-S1", code: "CH1", seatCount: 40 },
	{ storeId: "MOCK-S2", code: "CH2", seatCount: null },
];

export function demoSettings(): DemoSettingsSnapshot {
	return {
		reportSettings: null,
		stores: DEMO_STORE_PROFILES,
		rolesConfigured: true,
		feeRateStoreIds: [],
		costStoreIds: [],
	};
}

function appliesTo(scope: readonly string[] | "tenant", storeId: string) {
	return scope === "tenant" || scope.includes(storeId);
}

export class DemoSettingsStore {
	private snapshot: DemoSettingsSnapshot;
	private versionCount = 0;

	constructor(initial: DemoSettingsSnapshot = demoSettings()) {
		this.snapshot = initial;
	}

	get version(): number {
		return this.versionCount;
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

	rolesConfigured(): boolean {
		return this.snapshot.rolesConfigured;
	}

	feeRatesConfigured(storeId: string): boolean {
		return appliesTo(this.snapshot.feeRateStoreIds, storeId);
	}

	costsConfigured(storeId: string): boolean {
		return appliesTo(this.snapshot.costStoreIds, storeId);
	}
}
