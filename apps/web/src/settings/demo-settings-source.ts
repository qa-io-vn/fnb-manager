import { MENU, mockStore } from "@fnb/connector-mock";
import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	type CategoryOverride,
	currentDemoAsOf,
	DEMO_POS_ACCOUNT_ID,
	type DemoFeeRate,
	type DemoHoliday,
	type DemoRole,
	type DemoSettingsStore,
	type DemoStoreProfile,
	demoStores,
	dressDemoCatalogItem,
	type PaymentKindOverride,
} from "@fnb/demo-analytics";
import { isDefaultReportSettings } from "@fnb/reports";
import {
	byKeys,
	demoAuditOf,
	demoRowId,
	demoWrite,
	forgetDemoSaved,
	markDemoSaved,
	requireUniqueKeys,
} from "./demo-writes";
import {
	type CatchUpStatus,
	type CategoryOverrideChange,
	type FeeRateChange,
	type FeeRateRow,
	type HolidayRow,
	type ItemEntry,
	type ItemTypeEntry,
	type KindOverrideChange,
	type Membership,
	NO_CATCH_UP,
	type PaymentMethodEntry,
	type ReportSettingsState,
	type RoleChange,
	type SettingsSource,
	SettingsWriteError,
	type StoreProfile,
	type StoreProfileChange,
	type TenantProfile,
	yearBounds,
} from "./source";

export const DEMO_POS_ACCOUNT_NAME = "Tài khoản POS mẫu";

const DEMO_MEMBERSHIP: Membership = { role: "owner", storeIds: null };

const TENANT_KEY = "tenant";
const THRESHOLDS_KEY = "thresholds";

function roleKey(posAccountId: string, itemTypeExternalId: string): string {
	return `${posAccountId}|${itemTypeExternalId}`;
}

function roleAuditKey(posAccountId: string, itemTypeExternalId: string) {
	return demoRowId("role", posAccountId, itemTypeExternalId);
}

const feeRateOrder = byKeys<DemoFeeRate>(
	(rate) => rate.paymentMethodExternalId,
	(rate) => rate.storeId,
	(rate) => rate.effectiveFrom,
);

function unchanged<T>(before: T, after: T): boolean {
	return JSON.stringify(before) === JSON.stringify(after);
}

function storeKey(storeId: string): string {
	return demoRowId("store", storeId);
}

function overrideKey(posAccountId: string, itemExternalId: string): string {
	return demoRowId("category", posAccountId, itemExternalId);
}

function kindKey(posAccountId: string, methodExternalId: string): string {
	return demoRowId("kind", posAccountId, methodExternalId);
}

function feeRateId(rate: FeeRateChange | DemoFeeRate): string {
	return demoRowId(
		"fee",
		rate.storeId,
		rate.paymentMethodExternalId,
		rate.effectiveFrom,
	);
}

function customHolidayId(holiday: DemoHoliday): string {
	return demoRowId("holiday", holiday.holidayDate, holiday.name);
}

function tenantProfileOf(store: DemoSettingsStore): TenantProfile {
	const tenant = store.tenantProfile();
	return {
		legalForm: tenant.legalForm,
		defaultLanguage: tenant.defaultLanguage,
		audit: demoAuditOf(store, TENANT_KEY),
	};
}

function storeProfileOf(
	store: DemoSettingsStore,
	profile: DemoStoreProfile,
): StoreProfile | null {
	const definition = demoStores(currentDemoAsOf()).find(
		(candidate) => candidate.id === profile.storeId,
	);
	if (definition === undefined) return null;
	return {
		storeId: profile.storeId,
		posAccountId: store.accountOf(profile.storeId),
		name: definition.name,
		address: mockStore(definition.index, definition.profile).address ?? null,
		timeZone: definition.timeZone,
		businessDayStartMinutes: definition.businessDayStartMinutes,
		code: profile.code,
		openingHours: profile.openingHours,
		seatCount: profile.seatCount,
		openedOn: profile.openedOn,
		eInvoiceStatus: profile.eInvoiceStatus,
		tranNoResetPeriod: profile.tranNoResetPeriod,
		memberCaptureStatus: profile.memberCaptureStatus,
		audit: demoAuditOf(store, storeKey(profile.storeId)),
	};
}

function feeRateRowOf(store: DemoSettingsStore, rate: DemoFeeRate): FeeRateRow {
	const id = feeRateId(rate);
	return {
		id,
		storeId: rate.storeId,
		paymentMethodExternalId: rate.paymentMethodExternalId,
		feePct: rate.feePct,
		fixedFeeAmount: rate.fixedFeeAmount,
		effectiveFrom: rate.effectiveFrom,
		audit: demoAuditOf(store, id),
	};
}

function customHolidayRowOf(
	store: DemoSettingsStore,
	holiday: DemoHoliday,
): HolidayRow {
	const id = customHolidayId(holiday);
	return {
		id,
		countryCode: holiday.countryCode,
		holidayDate: holiday.holidayDate,
		name: holiday.name,
		kind: holiday.kind,
		custom: true,
		audit: demoAuditOf(store, id),
	};
}

export function createDemoSettingsSource(
	store: DemoSettingsStore,
): SettingsSource {
	return {
		kind: "demo",

		async membership(): Promise<Membership> {
			return DEMO_MEMBERSHIP;
		},

		async tenantProfile(): Promise<TenantProfile> {
			return tenantProfileOf(store);
		},

		async updateTenantProfile(_tenantId, change): Promise<TenantProfile> {
			const before = store.tenantProfile();
			const next = { ...before, ...change };
			if (!unchanged(before, next)) {
				demoWrite(() => store.saveTenantProfile(next));
				markDemoSaved(store, [TENANT_KEY]);
			}
			return tenantProfileOf(store);
		},

		async storeProfiles(): Promise<StoreProfile[]> {
			return store
				.storeProfiles()
				.flatMap((profile) => storeProfileOf(store, profile) ?? []);
		},

		async updateStoreProfile(
			_tenantId,
			storeId,
			change: StoreProfileChange,
		): Promise<StoreProfile> {
			const current = store.storeProfile(storeId);
			if (current === null) throw new SettingsWriteError("forbidden");
			const next = { ...current, ...change };
			if (!unchanged(current, next)) {
				demoWrite(() => store.saveStoreProfile(next));
				markDemoSaved(store, [storeKey(storeId)]);
			}
			const saved = store.storeProfile(storeId);
			const profile = saved === null ? null : storeProfileOf(store, saved);
			if (profile === null) throw new SettingsWriteError("forbidden");
			return profile;
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
			return MENU.catalog.itemTypes.map((type) => {
				const role =
					roleOf.get(roleKey(DEMO_POS_ACCOUNT_ID, type.externalId)) ?? null;
				return {
					posAccountId: DEMO_POS_ACCOUNT_ID,
					posAccountName: DEMO_POS_ACCOUNT_NAME,
					itemTypeExternalId: type.externalId,
					name: type.name,
					role,
					audit:
						role === null
							? null
							: demoAuditOf(
									store,
									roleAuditKey(DEMO_POS_ACCOUNT_ID, type.externalId),
								),
				};
			});
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
				const key = roleKey(change.posAccountId, change.itemTypeExternalId);
				if (change.role === null) {
					next.delete(key);
					continue;
				}
				next.set(key, {
					posAccountId: change.posAccountId,
					itemTypeExternalId: change.itemTypeExternalId,
					role: change.role,
				});
			}
			demoWrite(() => store.saveRoles([...next.values()]));
			markDemoSaved(
				store,
				changes
					.filter((change) => change.role !== null)
					.map((change) =>
						roleAuditKey(change.posAccountId, change.itemTypeExternalId),
					),
			);
			forgetDemoSaved(
				store,
				changes
					.filter((change) => change.role === null)
					.map((change) =>
						roleAuditKey(change.posAccountId, change.itemTypeExternalId),
					),
			);
		},

		async items(): Promise<ItemEntry[]> {
			const overrideOf = new Map(
				store
					.overrides()
					.map((override) => [
						overrideKey(override.posAccountId, override.itemExternalId),
						override,
					]),
			);
			const listed = MENU.catalog.items.map((catalogItem): ItemEntry => {
				const item = dressDemoCatalogItem(catalogItem);
				const key = overrideKey(DEMO_POS_ACCOUNT_ID, item.externalId);
				const override = overrideOf.get(key);
				overrideOf.delete(key);
				return {
					posAccountId: DEMO_POS_ACCOUNT_ID,
					itemExternalId: item.externalId,
					name: item.name,
					sizeLabel: item.sizeLabel ?? null,
					listPrice: item.listPrice,
					isModifier: item.isModifier,
					active: item.active,
					inCatalogue: true,
					posItemTypeExternalId: item.itemTypeExternalId ?? null,
					overrideItemTypeExternalId: override?.itemTypeExternalId ?? null,
					audit: override === undefined ? null : demoAuditOf(store, key),
				};
			});
			const unlisted = [...overrideOf.entries()].map(
				([key, override]): ItemEntry => ({
					posAccountId: override.posAccountId,
					itemExternalId: override.itemExternalId,
					name: override.itemExternalId,
					sizeLabel: null,
					listPrice: null,
					isModifier: false,
					active: false,
					inCatalogue: false,
					posItemTypeExternalId: null,
					overrideItemTypeExternalId: override.itemTypeExternalId,
					audit: demoAuditOf(store, key),
				}),
			);
			return [...listed, ...unlisted];
		},

		async saveCategoryOverrides(
			_tenantId,
			changes: readonly CategoryOverrideChange[],
		) {
			const next = new Map<string, CategoryOverride>(
				store
					.overrides()
					.map((override) => [
						overrideKey(override.posAccountId, override.itemExternalId),
						override,
					]),
			);
			for (const change of changes) {
				const key = overrideKey(change.posAccountId, change.itemExternalId);
				if (change.itemTypeExternalId === null) {
					next.delete(key);
					continue;
				}
				next.set(key, {
					posAccountId: change.posAccountId,
					itemExternalId: change.itemExternalId,
					itemTypeExternalId: change.itemTypeExternalId,
					itemTypeName: null,
				});
			}
			demoWrite(() => store.saveOverrides([...next.values()]));
			markDemoSaved(
				store,
				changes
					.filter((change) => change.itemTypeExternalId !== null)
					.map((change) =>
						overrideKey(change.posAccountId, change.itemExternalId),
					),
			);
			forgetDemoSaved(
				store,
				changes
					.filter((change) => change.itemTypeExternalId === null)
					.map((change) =>
						overrideKey(change.posAccountId, change.itemExternalId),
					),
			);
		},

		async paymentMethods(): Promise<PaymentMethodEntry[]> {
			const overrideOf = new Map(
				store
					.paymentKindOverrides()
					.map((override) => [
						kindKey(override.posAccountId, override.paymentMethodExternalId),
						override.kind,
					]),
			);
			return MENU.catalog.paymentMethods.map((method) => {
				const key = kindKey(DEMO_POS_ACCOUNT_ID, method.externalId);
				const overrideKind = overrideOf.get(key) ?? null;
				return {
					posAccountId: DEMO_POS_ACCOUNT_ID,
					posAccountName: DEMO_POS_ACCOUNT_NAME,
					externalId: method.externalId,
					name: method.name,
					posKind: method.kind,
					overrideKind,
					kind: overrideKind ?? method.kind,
					audit: overrideKind === null ? null : demoAuditOf(store, key),
				};
			});
		},

		async saveKindOverrides(_tenantId, changes: readonly KindOverrideChange[]) {
			const next = new Map<string, PaymentKindOverride>(
				store
					.paymentKindOverrides()
					.map((override) => [
						kindKey(override.posAccountId, override.paymentMethodExternalId),
						override,
					]),
			);
			for (const change of changes) {
				const key = kindKey(
					change.posAccountId,
					change.paymentMethodExternalId,
				);
				if (change.kind === null) {
					next.delete(key);
					continue;
				}
				next.set(key, {
					posAccountId: change.posAccountId,
					paymentMethodExternalId: change.paymentMethodExternalId,
					kind: change.kind,
				});
			}
			demoWrite(() => store.savePaymentKindOverrides([...next.values()]));
			markDemoSaved(
				store,
				changes
					.filter((change) => change.kind !== null)
					.map((change) =>
						kindKey(change.posAccountId, change.paymentMethodExternalId),
					),
			);
			forgetDemoSaved(
				store,
				changes
					.filter((change) => change.kind === null)
					.map((change) =>
						kindKey(change.posAccountId, change.paymentMethodExternalId),
					),
			);
		},

		async feeRates(): Promise<FeeRateRow[]> {
			return [...store.feeRates()]
				.sort(feeRateOrder)
				.map((rate) => feeRateRowOf(store, rate));
		},

		async saveFeeRates(_tenantId, rows): Promise<FeeRateRow[]> {
			requireUniqueKeys(rows, feeRateId);
			const next = new Map(
				store.feeRates().map((rate) => [feeRateId(rate), rate]),
			);
			for (const row of rows) next.set(feeRateId(row), { ...row });
			demoWrite(() => store.saveFeeRates([...next.values()]));
			markDemoSaved(store, rows.map(feeRateId));
			const ids = new Set(rows.map(feeRateId));
			return [...store.feeRates()]
				.sort(feeRateOrder)
				.filter((rate) => ids.has(feeRateId(rate)))
				.map((rate) => feeRateRowOf(store, rate));
		},

		async holidays(_tenantId, year): Promise<HolidayRow[]> {
			const { from, to } = yearBounds(year);
			const tenant = store.tenantProfile();
			const inYear = (date: string) => date >= from && date <= to;
			const global: HolidayRow[] = (
				tenant.countryCode === "VN" ? VIETNAM_HOLIDAYS : []
			)
				.filter((holiday) => inYear(holiday.holidayDate))
				.map((holiday) => ({
					id: demoRowId("global", holiday.holidayDate, holiday.name),
					countryCode: tenant.countryCode,
					holidayDate: holiday.holidayDate,
					name: holiday.name,
					kind: holiday.kind,
					custom: false,
					audit: null,
				}));
			const custom = store
				.customHolidays()
				.filter(
					(holiday) =>
						holiday.countryCode === tenant.countryCode &&
						inYear(holiday.holidayDate),
				)
				.map((holiday) => customHolidayRowOf(store, holiday));
			return [...global, ...custom].sort(
				(left, right) =>
					left.holidayDate.localeCompare(right.holidayDate) ||
					Number(left.custom) - Number(right.custom) ||
					left.id.localeCompare(right.id),
			);
		},

		async addHoliday(_tenantId, change): Promise<HolidayRow> {
			const holiday: DemoHoliday = {
				countryCode: store.tenantProfile().countryCode,
				holidayDate: change.holidayDate,
				name: change.name,
				kind: "custom",
			};
			demoWrite(() => store.saveHolidays([...store.customHolidays(), holiday]));
			markDemoSaved(store, [customHolidayId(holiday)]);
			const saved = store
				.customHolidays()
				.find((known) => customHolidayId(known) === customHolidayId(holiday));
			if (saved === undefined) throw new SettingsWriteError("forbidden");
			return customHolidayRowOf(store, saved);
		},

		async deleteHoliday(_tenantId, id) {
			const kept = store
				.customHolidays()
				.filter((holiday) => customHolidayId(holiday) !== id);
			if (kept.length === store.customHolidays().length) return;
			demoWrite(() => store.saveHolidays(kept));
			forgetDemoSaved(store, [id]);
		},

		async reportSettings(): Promise<ReportSettingsState> {
			const hasRow = store.hasReportSettingsRow();
			return {
				settings: store.reportSettings(),
				hasRow,
				audit: hasRow ? demoAuditOf(store, THRESHOLDS_KEY) : null,
			};
		},

		async saveReportSettings(_tenantId, changes) {
			const next = { ...store.reportSettings(), ...changes };
			const backToDefaults = isDefaultReportSettings(next);
			demoWrite(() => store.saveReportSettings(backToDefaults ? null : next));
			if (backToDefaults) forgetDemoSaved(store, [THRESHOLDS_KEY]);
			else markDemoSaved(store, [THRESHOLDS_KEY]);
		},

		async catchUpStatus(): Promise<CatchUpStatus> {
			return NO_CATCH_UP;
		},

		async refreshChunk(): Promise<CatchUpStatus> {
			return NO_CATCH_UP;
		},
	};
}
