import { MENU } from "@fnb/connector-mock";
import { type HolidayEntry, VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	addMonths,
	asOfDate,
	DEFAULT_REPORT_SETTINGS,
	firstOfMonth,
	type IsoDate,
	type ReportSettings,
} from "@fnb/reports";
import {
	DEMO_DAY_START_MINUTES,
	DEMO_POS_ACCOUNT_ID,
	DEMO_TIME_ZONE,
	type DemoRole,
	type DemoStoreId,
	demoOpeningHours,
	demoRoles,
	demoStoreIds,
	demoStores,
	demoTargets,
	type OpeningHours,
} from "./calendar.js";
import {
	type CategoryOverride,
	type DemoFeeRate,
	type DemoRoleName,
	FeeRateTable,
	type IngestMappings,
	RoleTable,
} from "./mappings.js";
import {
	checkReportSettings,
	DemoSettingsError,
	FEE_PERCENT,
	keyOf,
	MONEY_AMOUNT,
	openingHoursValid,
	requireChoice,
	requireDate,
	requireNumber,
	requireNumberOrNull,
	requireOneOf,
	requireText,
	requireTextOrNull,
	requireTimestampOrNull,
	requireUnique,
	SEAT_COUNT,
} from "./settings-checks.js";

export const DEMO_LEGAL_FORMS = [
	"household_business",
	"micro_enterprise",
	"small_enterprise",
	"enterprise",
	"unknown",
] as const;

export type DemoLegalForm = (typeof DEMO_LEGAL_FORMS)[number];

export interface DemoTenantProfile {
	readonly name: string;
	readonly countryCode: string;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly legalForm: DemoLegalForm;
}

export interface DemoStoreProfile {
	readonly storeId: DemoStoreId;
	readonly code: string | null;
	readonly openingHours: OpeningHours | null;
	readonly seatCount: number | null;
}

export interface DemoItemCost {
	readonly storeId: string | null;
	readonly itemExternalId: string;
	readonly costAmount: number;
	readonly effectiveFrom: IsoDate;
}

export const DEMO_PERIOD_KINDS = ["month", "week"] as const;

export interface DemoTarget {
	readonly storeId: string;
	readonly periodKind: (typeof DEMO_PERIOD_KINDS)[number];
	readonly periodStart: IsoDate;
	readonly netTargetAmount: number;
}

export interface DemoHoliday {
	readonly countryCode: string;
	readonly holidayDate: IsoDate;
	readonly name: string;
	readonly kind: "custom";
}

export const DEMO_LEGAL_DOCUMENT_KINDS = [
	"privacy_notice",
	"information_protection_rules",
	"consent_wording",
] as const;

export type DemoLegalDocumentKind = (typeof DEMO_LEGAL_DOCUMENT_KINDS)[number];

export interface DemoLegalDocument {
	readonly kind: DemoLegalDocumentKind;
	readonly versionLabel: string;
	readonly language: string;
	readonly title: string;
	readonly body: string;
	readonly publishedAt: string | null;
}

export interface DemoSettingsSnapshot {
	readonly tenant: DemoTenantProfile;
	readonly reportSettings: ReportSettings | null;
	readonly stores: readonly DemoStoreProfile[];
	readonly storeAccounts: Readonly<Record<string, string>>;
	readonly roles: readonly DemoRole[];
	readonly overrides: readonly CategoryOverride[];
	readonly costs: readonly DemoItemCost[];
	readonly feeRates: readonly DemoFeeRate[];
	readonly targets: readonly DemoTarget[];
	readonly holidays: readonly DemoHoliday[];
	readonly legalDocuments: readonly DemoLegalDocument[];
}

export type { DemoFeeRate };

export const DEMO_TENANT_PROFILE: DemoTenantProfile = {
	name: "Demo",
	countryCode: "VN",
	currencyCode: "VND",
	timeZone: DEMO_TIME_ZONE,
	legalForm: "unknown",
};

export const DEMO_STORE_PROFILES: readonly DemoStoreProfile[] = [
	{
		storeId: "MOCK-S1",
		code: "CH1",
		openingHours: demoOpeningHours,
		seatCount: 40,
	},
	{ storeId: "MOCK-S2", code: "CH2", openingHours: null, seatCount: null },
];

const ROLE_NAMES: readonly DemoRoleName[] = [
	"drink",
	"topping",
	"food",
	"snack",
	"other",
];

const DEMO_ITEM_TYPES: ReadonlyMap<string, string> = new Map(
	MENU.catalog.itemTypes.map((type) => [type.externalId, type.name]),
);

const DEMO_ITEM_TYPE_IDS: ReadonlySet<string> = new Set(DEMO_ITEM_TYPES.keys());

const DEMO_STORES: ReadonlySet<string> = new Set(demoStoreIds());

const GLOBAL_HOLIDAYS: Readonly<Record<string, readonly HolidayEntry[]>> = {
	VN: VIETNAM_HOLIDAYS,
};

export function currentDemoAsOf(now: Date = new Date()): IsoDate {
	return asOfDate(
		[
			{
				timeZone: DEMO_TIME_ZONE,
				businessDayStartMinutes: DEMO_DAY_START_MINUTES,
			},
		],
		now,
	);
}

export function demoTargetRows(asOf: IsoDate): DemoTarget[] {
	const lastMonth = firstOfMonth(addDays(asOf, 1));
	const rows: DemoTarget[] = [];
	for (const store of demoStores(asOf)) {
		if (!store.hasMonthlyTargets) continue;
		for (
			let month = firstOfMonth(store.openedOn);
			month <= lastMonth;
			month = addMonths(month, 1)
		) {
			const amount = demoTargets(store, month);
			if (amount === null) continue;
			rows.push({
				storeId: store.id,
				periodKind: "month",
				periodStart: month,
				netTargetAmount: amount,
			});
		}
	}
	return rows;
}

export function demoSettings(
	asOf: IsoDate = currentDemoAsOf(),
): DemoSettingsSnapshot {
	return {
		tenant: DEMO_TENANT_PROFILE,
		reportSettings: null,
		stores: DEMO_STORE_PROFILES,
		storeAccounts: {},
		roles: demoRoles(),
		overrides: [],
		costs: [],
		feeRates: [],
		targets: demoTargetRows(asOf),
		holidays: [],
		legalDocuments: [],
	};
}

function overrideKey(accountId: string, itemExternalId: string): string {
	return keyOf(accountId, itemExternalId);
}

function checkTenant(tenant: DemoTenantProfile): DemoTenantProfile {
	return {
		name: requireText("name", tenant.name),
		countryCode: requireText("countryCode", tenant.countryCode),
		currencyCode: requireText("currencyCode", tenant.currencyCode),
		timeZone: requireText("timeZone", tenant.timeZone),
		legalForm: requireChoice("legalForm", tenant.legalForm, DEMO_LEGAL_FORMS),
	};
}

function checkStoreProfile(profile: DemoStoreProfile): DemoStoreProfile {
	const storeId = requireOneOf(
		"storeId",
		requireText("storeId", profile.storeId),
		DEMO_STORES,
		"a demo store",
	) as DemoStoreId;
	if (!openingHoursValid(profile.openingHours)) {
		throw new DemoSettingsError(
			"openingHours",
			"format",
			"be null or map mon to sun onto [open, close] pairs of H:MM times from 0:00 to 24:00",
		);
	}
	return {
		storeId,
		code: requireTextOrNull("code", profile.code),
		openingHours:
			profile.openingHours === null
				? null
				: structuredClone(profile.openingHours),
		seatCount: requireNumberOrNull("seatCount", profile.seatCount, SEAT_COUNT),
	};
}

function checkStoreProfiles(
	profiles: readonly DemoStoreProfile[],
): DemoStoreProfile[] {
	const checked = profiles.map(checkStoreProfile);
	requireUnique(checked, "storeId", "store", (profile) => profile.storeId);
	return checked;
}

function checkStoreAccounts(
	storeAccounts: Readonly<Record<string, string>>,
): Record<string, string> {
	const checked: Record<string, string> = {};
	for (const [storeId, accountId] of Object.entries(storeAccounts)) {
		requireOneOf("storeId", storeId, DEMO_STORES, "a demo store");
		checked[storeId] = requireText("posAccountId", accountId);
	}
	return checked;
}

function requireItemTypeOfAccount(
	field: string,
	posAccountId: unknown,
	itemTypeExternalId: unknown,
	accounts: ReadonlySet<string>,
): void {
	requireOneOf(
		"posAccountId",
		requireText("posAccountId", posAccountId),
		accounts,
		"a POS account of the demo",
	);
	requireOneOf(
		field,
		requireText(field, itemTypeExternalId),
		DEMO_ITEM_TYPE_IDS,
		"an item type of the same POS account",
	);
}

function checkRoles(
	roles: readonly DemoRole[],
	accounts: ReadonlySet<string>,
): DemoRole[] {
	const checked = roles.map((role) => {
		requireItemTypeOfAccount(
			"itemTypeExternalId",
			role.posAccountId,
			role.itemTypeExternalId,
			accounts,
		);
		return {
			posAccountId: role.posAccountId,
			itemTypeExternalId: role.itemTypeExternalId,
			role: requireChoice("role", role.role, ROLE_NAMES),
		};
	});
	requireUnique(
		checked,
		"itemTypeExternalId",
		"POS account and item type",
		(role) => keyOf(role.posAccountId, role.itemTypeExternalId),
	);
	return checked;
}

function checkOverrides(
	overrides: readonly CategoryOverride[],
	accounts: ReadonlySet<string>,
): CategoryOverride[] {
	const checked = overrides.map((override) => {
		requireItemTypeOfAccount(
			"itemTypeExternalId",
			override.posAccountId,
			override.itemTypeExternalId,
			accounts,
		);
		return {
			posAccountId: override.posAccountId,
			itemExternalId: requireText("itemExternalId", override.itemExternalId),
			itemTypeExternalId: override.itemTypeExternalId,
			itemTypeName: DEMO_ITEM_TYPES.get(override.itemTypeExternalId) ?? null,
		};
	});
	requireUnique(checked, "itemExternalId", "POS account and item", (override) =>
		overrideKey(override.posAccountId, override.itemExternalId),
	);
	return checked;
}

function checkStoreScope(storeId: unknown): string | null {
	if (storeId === null) return null;
	return requireOneOf(
		"storeId",
		requireText("storeId", storeId),
		DEMO_STORES,
		"a demo store or be null",
	);
}

function checkCosts(costs: readonly DemoItemCost[]): DemoItemCost[] {
	const checked = costs.map((cost) => ({
		storeId: checkStoreScope(cost.storeId),
		itemExternalId: requireText("itemExternalId", cost.itemExternalId),
		costAmount: requireNumber("costAmount", cost.costAmount, MONEY_AMOUNT),
		effectiveFrom: requireDate("effectiveFrom", cost.effectiveFrom),
	}));
	requireUnique(checked, "effectiveFrom", "store, item and date", (cost) =>
		keyOf(cost.storeId, cost.itemExternalId, cost.effectiveFrom),
	);
	return checked;
}

function checkFeeRates(rates: readonly DemoFeeRate[]): DemoFeeRate[] {
	const checked = rates.map((rate) => ({
		storeId: checkStoreScope(rate.storeId),
		paymentMethodExternalId: requireText(
			"paymentMethodExternalId",
			rate.paymentMethodExternalId,
		),
		feePct: requireNumber("feePct", rate.feePct, FEE_PERCENT),
		fixedFeeAmount: requireNumber(
			"fixedFeeAmount",
			rate.fixedFeeAmount,
			MONEY_AMOUNT,
		),
		effectiveFrom: requireDate("effectiveFrom", rate.effectiveFrom),
	}));
	requireUnique(
		checked,
		"effectiveFrom",
		"store, payment method and date",
		(rate) =>
			keyOf(rate.storeId, rate.paymentMethodExternalId, rate.effectiveFrom),
	);
	return checked;
}

function checkTargets(targets: readonly DemoTarget[]): DemoTarget[] {
	const checked = targets.map((target) => ({
		storeId: requireOneOf(
			"storeId",
			requireText("storeId", target.storeId),
			DEMO_STORES,
			"a demo store",
		),
		periodKind: requireChoice(
			"periodKind",
			target.periodKind,
			DEMO_PERIOD_KINDS,
		),
		periodStart: requireDate("periodStart", target.periodStart),
		netTargetAmount: requireNumber(
			"netTargetAmount",
			target.netTargetAmount,
			MONEY_AMOUNT,
		),
	}));
	requireUnique(checked, "periodStart", "store, period kind and start", (row) =>
		keyOf(row.storeId, row.periodKind, row.periodStart),
	);
	return checked;
}

function checkHolidays(holidays: readonly DemoHoliday[]): DemoHoliday[] {
	const checked = holidays.map((holiday) => ({
		countryCode: requireText("countryCode", holiday.countryCode),
		holidayDate: requireDate("holidayDate", holiday.holidayDate),
		name: requireText("name", holiday.name),
		kind: requireChoice("kind", holiday.kind, ["custom"] as const),
	}));
	requireUnique(checked, "name", "country, date and name", (holiday) =>
		keyOf(holiday.countryCode, holiday.holidayDate, holiday.name),
	);
	return checked;
}

function checkLegalDocuments(
	documents: readonly DemoLegalDocument[],
): DemoLegalDocument[] {
	const checked = documents.map((document) => ({
		kind: requireChoice("kind", document.kind, DEMO_LEGAL_DOCUMENT_KINDS),
		versionLabel: requireText("versionLabel", document.versionLabel),
		language: requireText("language", document.language),
		title: requireText("title", document.title),
		body: requireText("body", document.body),
		publishedAt: requireTimestampOrNull("publishedAt", document.publishedAt),
	}));
	requireUnique(checked, "versionLabel", "kind, language and version", (row) =>
		keyOf(row.kind, row.language, row.versionLabel),
	);
	return checked;
}

function accountsOf(
	storeAccounts: Readonly<Record<string, string>>,
): Set<string> {
	return new Set([DEMO_POS_ACCOUNT_ID, ...Object.values(storeAccounts)]);
}

function checkSnapshot(snapshot: DemoSettingsSnapshot): DemoSettingsSnapshot {
	const storeAccounts = checkStoreAccounts(snapshot.storeAccounts);
	const accounts = accountsOf(storeAccounts);
	return {
		tenant: checkTenant(snapshot.tenant),
		reportSettings:
			snapshot.reportSettings === null
				? null
				: checkReportSettings(snapshot.reportSettings),
		stores: checkStoreProfiles(snapshot.stores),
		storeAccounts,
		roles: checkRoles(snapshot.roles, accounts),
		overrides: checkOverrides(snapshot.overrides, accounts),
		costs: checkCosts(snapshot.costs),
		feeRates: checkFeeRates(snapshot.feeRates),
		targets: checkTargets(snapshot.targets),
		holidays: checkHolidays(snapshot.holidays),
		legalDocuments: checkLegalDocuments(snapshot.legalDocuments),
	};
}

function calendarOf(
	tenant: DemoTenantProfile,
	holidays: readonly DemoHoliday[],
): readonly HolidayEntry[] {
	const global = GLOBAL_HOLIDAYS[tenant.countryCode] ?? [];
	const custom = holidays.filter(
		(holiday) => holiday.countryCode === tenant.countryCode,
	);
	if (custom.length === 0) return global;
	return [
		...global,
		...custom.map((holiday) => ({
			holidayDate: holiday.holidayDate,
			name: holiday.name,
			kind: holiday.kind,
		})),
	];
}

type IngestEffect = "query" | "ingest";

export class DemoSettingsStore implements IngestMappings {
	private snapshotValue: DemoSettingsSnapshot;
	private versionCount = 0;
	private ingestVersionCount = 0;
	private roleTable: RoleTable;
	private overrideIndex: Map<string, CategoryOverride>;
	private feeRateTable: FeeRateTable;
	private calendar: readonly HolidayEntry[];

	constructor(initial: DemoSettingsSnapshot = demoSettings()) {
		const checked = checkSnapshot(initial);
		this.snapshotValue = checked;
		this.roleTable = new RoleTable(checked.roles);
		this.overrideIndex = DemoSettingsStore.indexOverrides(checked.overrides);
		this.feeRateTable = new FeeRateTable(checked.feeRates);
		this.calendar = calendarOf(checked.tenant, checked.holidays);
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

	snapshot(): DemoSettingsSnapshot {
		return this.snapshotValue;
	}

	private commit(next: DemoSettingsSnapshot, effect: IngestEffect): void {
		const previous = this.snapshotValue;
		this.snapshotValue = next;
		if (next.roles !== previous.roles) {
			this.roleTable = new RoleTable(next.roles);
		}
		if (next.overrides !== previous.overrides) {
			this.overrideIndex = DemoSettingsStore.indexOverrides(next.overrides);
		}
		if (next.feeRates !== previous.feeRates) {
			this.feeRateTable = new FeeRateTable(next.feeRates);
		}
		if (
			next.tenant !== previous.tenant ||
			next.holidays !== previous.holidays
		) {
			this.calendar = calendarOf(next.tenant, next.holidays);
		}
		this.versionCount += 1;
		if (effect === "ingest") this.ingestVersionCount += 1;
	}

	private knownAccounts(
		storeAccounts: Readonly<Record<string, string>> = this.snapshotValue
			.storeAccounts,
	): Set<string> {
		return new Set([
			...accountsOf(storeAccounts),
			...this.snapshotValue.roles.map((role) => role.posAccountId),
			...this.snapshotValue.overrides.map((override) => override.posAccountId),
		]);
	}

	accountOf(storeId: string): string {
		return this.snapshotValue.storeAccounts[storeId] ?? DEMO_POS_ACCOUNT_ID;
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

	feeRateOf(
		storeId: string,
		paymentMethodExternalId: string | null,
		businessDate: IsoDate,
	): DemoFeeRate | null {
		return this.feeRateTable.rateOf(
			storeId,
			paymentMethodExternalId,
			businessDate,
		);
	}

	tenantProfile(): DemoTenantProfile {
		return this.snapshotValue.tenant;
	}

	storeProfiles(): readonly DemoStoreProfile[] {
		return this.snapshotValue.stores;
	}

	storeAccounts(): Readonly<Record<string, string>> {
		return this.snapshotValue.storeAccounts;
	}

	roles(): readonly DemoRole[] {
		return this.snapshotValue.roles;
	}

	overrides(): readonly CategoryOverride[] {
		return this.snapshotValue.overrides;
	}

	costs(): readonly DemoItemCost[] {
		return this.snapshotValue.costs;
	}

	feeRates(): readonly DemoFeeRate[] {
		return this.snapshotValue.feeRates;
	}

	targets(): readonly DemoTarget[] {
		return this.snapshotValue.targets;
	}

	customHolidays(): readonly DemoHoliday[] {
		return this.snapshotValue.holidays;
	}

	holidays(): readonly HolidayEntry[] {
		return this.calendar;
	}

	legalDocuments(): readonly DemoLegalDocument[] {
		return this.snapshotValue.legalDocuments;
	}

	hasReportSettingsRow(): boolean {
		return this.snapshotValue.reportSettings !== null;
	}

	reportSettings(): ReportSettings {
		return this.snapshotValue.reportSettings ?? DEFAULT_REPORT_SETTINGS;
	}

	saveTenantProfile(tenant: DemoTenantProfile): void {
		this.commit(
			{ ...this.snapshotValue, tenant: checkTenant(tenant) },
			"query",
		);
	}

	saveStoreProfile(profile: DemoStoreProfile): void {
		const checked = checkStoreProfile(profile);
		const stores = [
			...this.snapshotValue.stores.filter(
				(known) => known.storeId !== checked.storeId,
			),
			checked,
		].sort((left, right) => (left.storeId < right.storeId ? -1 : 1));
		this.commit({ ...this.snapshotValue, stores }, "query");
	}

	saveStoreAccounts(storeAccounts: Readonly<Record<string, string>>): void {
		this.commit(
			{
				...this.snapshotValue,
				storeAccounts: checkStoreAccounts(storeAccounts),
			},
			"ingest",
		);
	}

	saveRoles(roles: readonly DemoRole[]): void {
		this.commit(
			{
				...this.snapshotValue,
				roles: checkRoles(roles, this.knownAccounts()),
			},
			"ingest",
		);
	}

	saveOverrides(overrides: readonly CategoryOverride[]): void {
		this.commit(
			{
				...this.snapshotValue,
				overrides: checkOverrides(overrides, this.knownAccounts()),
			},
			"ingest",
		);
	}

	saveCosts(costs: readonly DemoItemCost[]): void {
		this.commit({ ...this.snapshotValue, costs: checkCosts(costs) }, "query");
	}

	saveFeeRates(feeRates: readonly DemoFeeRate[]): void {
		this.commit(
			{ ...this.snapshotValue, feeRates: checkFeeRates(feeRates) },
			"ingest",
		);
	}

	saveTargets(targets: readonly DemoTarget[]): void {
		this.commit(
			{ ...this.snapshotValue, targets: checkTargets(targets) },
			"query",
		);
	}

	saveHolidays(holidays: readonly DemoHoliday[]): void {
		this.commit(
			{ ...this.snapshotValue, holidays: checkHolidays(holidays) },
			"query",
		);
	}

	saveLegalDocuments(documents: readonly DemoLegalDocument[]): void {
		this.commit(
			{
				...this.snapshotValue,
				legalDocuments: checkLegalDocuments(documents),
			},
			"query",
		);
	}

	saveReportSettings(settings: ReportSettings | null): void {
		this.commit(
			{
				...this.snapshotValue,
				reportSettings:
					settings === null ? null : checkReportSettings(settings),
			},
			"query",
		);
	}

	storeProfile(storeId: string): DemoStoreProfile | null {
		return (
			this.snapshotValue.stores.find(
				(profile) => profile.storeId === storeId,
			) ?? null
		);
	}

	openingHoursOf(storeId: string): OpeningHours | null {
		return this.storeProfile(storeId)?.openingHours ?? null;
	}

	seatCount(storeId: string): number | null {
		return this.storeProfile(storeId)?.seatCount ?? null;
	}

	rolesConfigured(storeId: string): boolean {
		return this.roleTable.hasRoles(this.accountOf(storeId));
	}

	feeRatesConfigured(storeId: string): boolean {
		return this.feeRateTable.appliesTo(storeId);
	}

	costsConfigured(storeId: string): boolean {
		return this.snapshotValue.costs.some(
			(cost) => cost.storeId === null || cost.storeId === storeId,
		);
	}
}
