import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { LoyaltySource } from "../loyalty/source";
import type { OperationsSource } from "../operations/source";
import { useReadyTenantScope } from "../state/tenant-scope";
import type { ManualSettingsSource } from "./manual/source";
import { useSettingsSourceState } from "./settings-source-context";
import type { CatchUpStatus, SettingsSource } from "./source";
import type { StaffSettingsSource } from "./staff/source";

export const SETTINGS_QUERY_ROOT = "settings";

export type SettingsRead =
	| "membership"
	| "itemTypes"
	| "reportSettings"
	| "catchUp"
	| "tenantProfile"
	| "defaultLanguage"
	| "storeProfiles"
	| "items"
	| "paymentMethods"
	| "feeRates"
	| "holidays"
	| "itemCosts"
	| "targets"
	| "legalDocuments"
	| "staffRoster"
	| "staffRevenue"
	| "staffApps"
	| "staffContact"
	| "checklistTemplates"
	| "loyaltyProgrammes"
	| "loyaltyStaffPhones"
	| "rewards"
	| "rewardRails"
	| "rewardDiscountDays";

export function settingsQueryKey(
	sourceKind: SettingsSource["kind"],
	tenantId: string,
	read: SettingsRead,
	...parts: readonly (string | number)[]
) {
	return [SETTINGS_QUERY_ROOT, sourceKind, tenantId, read, ...parts] as const;
}

export function isTenantSettingsKey(
	queryKey: readonly unknown[],
	tenantId: string,
): boolean {
	return queryKey[0] === SETTINGS_QUERY_ROOT && queryKey[2] === tenantId;
}

export async function invalidateSettings(
	queryClient: QueryClient,
	tenantId: string,
): Promise<void> {
	await queryClient.invalidateQueries({
		predicate: (query) => isTenantSettingsKey(query.queryKey, tenantId),
	});
}

type SettingsLoad<T> = (
	source: SettingsSource,
	tenantId: string,
	manual: ManualSettingsSource,
	staff: StaffSettingsSource,
	operations: OperationsSource | null,
	loyalty: LoyaltySource | null,
) => Promise<T>;

function useSettingsRead<T>(
	read: SettingsRead | readonly [SettingsRead, ...(string | number)[]],
	load: SettingsLoad<T>,
	pollEvery: (data: T | undefined, failed: boolean) => number | false = () =>
		false,
	enabled = true,
) {
	const state = useSettingsSourceState();
	const { tenant } = useReadyTenantScope();
	const ready = state.status === "ready" ? state : null;
	const [name, ...parts] = typeof read === "string" ? [read] : read;
	return useQuery({
		queryKey: settingsQueryKey(
			ready?.source.kind ?? "demo",
			tenant.id,
			name,
			...parts,
		),
		queryFn: () => {
			if (ready === null) throw new Error("settings source not ready");
			return load(
				ready.source,
				tenant.id,
				ready.manual,
				ready.staff,
				ready.operations ?? null,
				ready.loyalty ?? null,
			);
		},
		enabled: ready !== null && enabled,
		refetchInterval: (query) =>
			pollEvery(query.state.data, query.state.status === "error"),
	});
}

export function useMembership() {
	return useSettingsRead("membership", (source, tenantId) =>
		source.membership(tenantId),
	);
}

export function useItemTypes() {
	return useSettingsRead("itemTypes", (source, tenantId) =>
		source.itemTypes(tenantId),
	);
}

export function useReportSettings() {
	return useSettingsRead("reportSettings", (source, tenantId) =>
		source.reportSettings(tenantId),
	);
}

export function useTenantProfile() {
	return useSettingsRead("tenantProfile", (source, tenantId) =>
		source.tenantProfile(tenantId),
	);
}

export function useTenantDefaultLanguage() {
	return useSettingsRead("defaultLanguage", (source, tenantId) =>
		source.defaultLanguage(tenantId),
	);
}

export function useStoreProfiles() {
	return useSettingsRead("storeProfiles", (source, tenantId) =>
		source.storeProfiles(tenantId),
	);
}

export function useItems() {
	return useSettingsRead("items", (source, tenantId) => source.items(tenantId));
}

export function usePaymentMethods() {
	return useSettingsRead("paymentMethods", (source, tenantId) =>
		source.paymentMethods(tenantId),
	);
}

export function useFeeRates() {
	return useSettingsRead("feeRates", (source, tenantId) =>
		source.feeRates(tenantId),
	);
}

export function useHolidays(year: number) {
	return useSettingsRead(["holidays", year], (source, tenantId) =>
		source.holidays(tenantId, year),
	);
}

export function useItemCosts() {
	return useSettingsRead("itemCosts", (_source, tenantId, manual) =>
		manual.itemCosts(tenantId),
	);
}

export function useTargets() {
	return useSettingsRead("targets", (_source, tenantId, manual) =>
		manual.targets(tenantId),
	);
}

export function useLegalDocuments() {
	return useSettingsRead("legalDocuments", (_source, tenantId, manual) =>
		manual.legalDocuments(tenantId),
	);
}

export function useStaffRoster() {
	return useSettingsRead("staffRoster", (_source, tenantId, _manual, staff) =>
		staff.roster(tenantId),
	);
}

export function useStaffRevenueVisibility() {
	return useSettingsRead("staffRevenue", (_source, tenantId, _manual, staff) =>
		staff.staffRevenueVisibility(tenantId),
	);
}

export function useStaffApps() {
	return useSettingsRead("staffApps", (_source, tenantId, _manual, staff) =>
		staff.staffApps(tenantId),
	);
}

export function useStaffContact() {
	return useSettingsRead("staffContact", (_source, tenantId, _manual, staff) =>
		staff.staffContact(tenantId),
	);
}

export function useChecklistTemplates() {
	return useSettingsRead(
		"checklistTemplates",
		(_source, tenantId, _manual, _staff, operations) => {
			if (operations === null) {
				return Promise.reject(new Error("no operations data in this mode"));
			}
			return operations.checklistTemplates(tenantId);
		},
	);
}

function loyaltyOf(loyalty: LoyaltySource | null): LoyaltySource {
	if (loyalty === null) throw new Error("no loyalty data in this mode");
	return loyalty;
}

export function useLoyaltyProgrammes() {
	return useSettingsRead(
		"loyaltyProgrammes",
		(_source, tenantId, _manual, _staff, _operations, loyalty) =>
			loyaltyOf(loyalty).programmes(tenantId),
	);
}

export function useLoyaltyStaffPhones(enabled: boolean) {
	return useSettingsRead(
		"loyaltyStaffPhones",
		(_source, tenantId, _manual, _staff, _operations, loyalty) =>
			loyaltyOf(loyalty).staffPhones(tenantId),
		() => false,
		enabled,
	);
}

export const CATCH_UP_POLL_MS = 60_000;

export function catchUpPollMs(
	status: CatchUpStatus | undefined,
	failed: boolean,
	now: Date,
): number | false {
	if (failed) return CATCH_UP_POLL_MS;
	const today = now.toISOString().slice(0, 10);
	return status !== undefined &&
		status.pendingFrom !== null &&
		status.pendingFrom <= today
		? CATCH_UP_POLL_MS
		: false;
}

export function useCatchUpStatus() {
	return useSettingsRead(
		"catchUp",
		(source, tenantId) => source.catchUpStatus(tenantId),
		(status, failed) => catchUpPollMs(status, failed, new Date()),
	);
}
