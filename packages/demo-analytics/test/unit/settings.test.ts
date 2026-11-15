import { VIETNAM_HOLIDAYS } from "@fnb/core";
import { addDays, addMonths, DEFAULT_REPORT_SETTINGS } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	createDemoReportSource,
	DEMO_POS_ACCOUNT_ID,
	DEMO_PRIVACY_NOTICE_TITLE,
	DEMO_TENANT_PROFILE,
	DemoDayCache,
	type DemoFeeRate,
	type DemoHoliday,
	type DemoItemCost,
	type DemoLegalDocument,
	DemoSettingsError,
	type DemoSettingsRefusal,
	DemoSettingsStore,
	type DemoStoreProfile,
	type DemoTarget,
	demoOpeningHours,
	demoRoles,
	demoSettings,
	demoStoreProfiles,
	demoStores,
	demoTargets,
	feeEstimateMinor,
	isExcludedDemoDay,
	legalDraftSkeleton,
	legalVersionLabel,
	minorUnits,
	type PaymentKindOverride,
} from "../../src/index.js";

const AS_OF = "2026-11-03";
const NOW = new Date("2026-11-04T05:30:00.000Z");
const SECOND_ACCOUNT = "demo-second-account";

function fresh(): DemoSettingsStore {
	return new DemoSettingsStore(demoSettings(AS_OF));
}

function profileDefaults(storeId: "MOCK-S1" | "MOCK-S2"): DemoStoreProfile {
	const profile = demoStoreProfiles(AS_OF).find(
		(candidate) => candidate.storeId === storeId,
	);
	if (profile === undefined) throw new Error(`no profile of ${storeId}`);
	return profile;
}

const KIND_OVERRIDE: PaymentKindOverride = {
	posAccountId: DEMO_POS_ACCOUNT_ID,
	paymentMethodExternalId: "PM-BANK",
	kind: "cash",
};

const COST: DemoItemCost = {
	storeId: null,
	itemExternalId: "DR-001-M",
	costAmount: 15_000,
	effectiveFrom: "2026-10-01",
};

const FEE_RATE: DemoFeeRate = {
	storeId: null,
	paymentMethodExternalId: "PM-EWALLET",
	feePct: 1.237,
	fixedFeeAmount: 200,
	effectiveFrom: "2026-10-15",
};

const TARGET: DemoTarget = {
	storeId: "MOCK-S2",
	periodKind: "month",
	periodStart: "2026-11-01",
	netTargetAmount: 120_000_000,
};

const HOLIDAY: DemoHoliday = {
	countryCode: "VN",
	holidayDate: "2026-10-27",
	name: "Ngày hội chuỗi",
	kind: "custom",
};

const NOTICE: DemoLegalDocument = {
	kind: "privacy_notice",
	versionLabel: "v1",
	language: "vi",
	title: "Thông báo xử lý dữ liệu cá nhân",
	body: "Nội dung mẫu.",
	publishedAt: null,
	retiredAt: null,
};

function refusal(write: () => void): {
	field: string;
	refusal: DemoSettingsRefusal;
} {
	try {
		write();
	} catch (error) {
		if (error instanceof DemoSettingsError) {
			expect(error).toBeInstanceOf(RangeError);
			expect(error.message.startsWith(`${error.field} must `)).toBe(true);
			return { field: error.field, refusal: error.refusal };
		}
		throw error;
	}
	throw new Error("the write was not refused");
}

describe("the demo settings store's defaults", () => {
	it("starts with the demo tenant, the two store profiles, the demo roles and nothing else configured", () => {
		const settings = fresh();
		expect(settings.version).toBe(0);
		expect(settings.ingestVersion).toBe(0);
		expect(settings.tenantProfile()).toEqual(DEMO_TENANT_PROFILE);
		expect(settings.tenantProfile()).toMatchObject({
			countryCode: "VN",
			currencyCode: "VND",
			legalForm: "household_business",
			defaultLanguage: "vi",
		});
		const [established, young] = demoStores(AS_OF);
		expect(settings.storeProfiles()).toEqual([
			{
				storeId: "MOCK-S1",
				code: "CH1",
				openingHours: demoOpeningHours,
				seatCount: 40,
				openedOn: "2024-12-02",
				eInvoiceStatus: "configured",
				tranNoResetPeriod: "daily",
				memberCaptureStatus: "enabled",
			},
			{
				storeId: "MOCK-S2",
				code: "CH2",
				openingHours: null,
				seatCount: null,
				openedOn: young?.openedOn,
				eInvoiceStatus: "not_configured",
				tranNoResetPeriod: "unknown",
				memberCaptureStatus: "unknown",
			},
		]);
		expect(established?.openedOn).toBe("2024-12-02");
		expect(young?.openedOn).not.toBeUndefined();
		expect(settings.storeProfiles()).toEqual(demoStoreProfiles(AS_OF));
		expect(settings.openingHoursOf("MOCK-S1")).toEqual(demoOpeningHours);
		expect(settings.openingHoursOf("MOCK-S2")).toBeNull();
		expect(settings.openingHoursOf("MOCK-S9")).toBeNull();
		expect(settings.seatCount("MOCK-S2")).toBeNull();
		expect(settings.roles()).toEqual(demoRoles());
		expect(settings.accountOf("MOCK-S1")).toBe(DEMO_POS_ACCOUNT_ID);
		expect(settings.accountOf("MOCK-S2")).toBe(DEMO_POS_ACCOUNT_ID);
		expect(settings.overrides()).toEqual([]);
		expect(settings.paymentKindOverrides()).toEqual([]);
		expect(settings.paymentKindOverrideOf(DEMO_POS_ACCOUNT_ID, "PM-BANK")).toBe(
			null,
		);
		expect(settings.costs()).toEqual([]);
		expect(settings.feeRates()).toEqual([]);
		expect(settings.customHolidays()).toEqual([]);
		expect(settings.holidays()).toBe(VIETNAM_HOLIDAYS);
		expect(settings.legalDocuments()).toEqual([
			{
				kind: "privacy_notice",
				versionLabel: "privacy-notice-2026-11",
				language: "vi",
				title: DEMO_PRIVACY_NOTICE_TITLE,
				body: legalDraftSkeleton("vi"),
				publishedAt: null,
				retiredAt: null,
			},
		]);
		expect(settings.hasReportSettingsRow()).toBe(false);
		expect(settings.reportSettings()).toEqual(DEFAULT_REPORT_SETTINGS);
		for (const storeId of ["MOCK-S1", "MOCK-S2"]) {
			expect(settings.rolesConfigured(storeId)).toBe(true);
			expect(settings.feeRatesConfigured(storeId)).toBe(false);
			expect(settings.costsConfigured(storeId)).toBe(false);
		}
	});

	it("holds the established store's monthly targets up to the as-of month, as the reports read them", () => {
		const settings = fresh();
		const [established] = demoStores(AS_OF);
		if (established === undefined) throw new Error("missing demo store");
		const targets = settings.targets();
		expect(targets.map((target) => target.periodStart)).toEqual(
			Array.from({ length: 24 }, (_, index) => addMonths("2024-12-01", index)),
		);
		expect(new Set(targets.map((target) => target.storeId))).toEqual(
			new Set(["MOCK-S1"]),
		);
		const days = new DemoDayCache({ now: () => NOW });
		for (const target of targets) {
			expect(target.periodKind).toBe("month");
			expect(target.netTargetAmount).toBe(
				demoTargets(established, target.periodStart),
			);
			expect(target.netTargetAmount).toBe(
				days.target(established, "month", target.periodStart),
			);
		}
		expect(demoSettings("2026-11-30").targets.at(-1)?.periodStart).toBe(
			"2026-12-01",
		);
	});
});

describe("which writes move which version", () => {
	const writes: readonly {
		readonly name: string;
		readonly ingest: boolean;
		readonly write: (settings: DemoSettingsStore) => void;
	}[] = [
		{
			name: "store accounts",
			ingest: true,
			write: (settings) =>
				settings.saveStoreAccounts({ "MOCK-S2": SECOND_ACCOUNT }),
		},
		{
			name: "roles",
			ingest: true,
			write: (settings) => settings.saveRoles(demoRoles().slice(1)),
		},
		{
			name: "category overrides",
			ingest: true,
			write: (settings) =>
				settings.saveOverrides([
					{
						posAccountId: DEMO_POS_ACCOUNT_ID,
						itemExternalId: "SN-001",
						itemTypeExternalId: "TYPE-009",
						itemTypeName: null,
					},
				]),
		},
		{
			name: "fee rates",
			ingest: true,
			write: (settings) => settings.saveFeeRates([FEE_RATE]),
		},
		{
			name: "item costs",
			ingest: false,
			write: (settings) => settings.saveCosts([COST]),
		},
		{
			name: "report settings",
			ingest: false,
			write: (settings) =>
				settings.saveReportSettings({
					...DEFAULT_REPORT_SETTINGS,
					peakHours: 4,
				}),
		},
		{
			name: "targets",
			ingest: false,
			write: (settings) => settings.saveTargets([TARGET]),
		},
		{
			name: "custom holidays",
			ingest: false,
			write: (settings) => settings.saveHolidays([HOLIDAY]),
		},
		{
			name: "legal documents",
			ingest: false,
			write: (settings) => settings.saveLegalDocuments([NOTICE]),
		},
		{
			name: "the tenant profile",
			ingest: false,
			write: (settings) =>
				settings.saveTenantProfile({
					...DEMO_TENANT_PROFILE,
					legalForm: "micro_enterprise",
					defaultLanguage: "en",
				}),
		},
		{
			name: "payment kind overrides",
			ingest: true,
			write: (settings) => settings.savePaymentKindOverrides([KIND_OVERRIDE]),
		},
		{
			name: "a store profile",
			ingest: false,
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S2"),
					storeId: "MOCK-S2",
					code: "CH2",
					openingHours: { mon: [["07:00", "22:00"]] },
					seatCount: 24,
				}),
		},
	];

	for (const { name, ingest, write } of writes) {
		it(`${name} move version${ingest ? " and ingestVersion, as the refresh reads them" : " only, as only the query-time functions read them"}`, () => {
			const settings = fresh();
			write(settings);
			expect(settings.version).toBe(1);
			expect(settings.ingestVersion).toBe(ingest ? 1 : 0);
		});
	}

	it("re-ingests the cached days after a fee-rate write, so the next read carries the fee estimates", async () => {
		const settings = fresh();
		const source = createDemoReportSource({
			now: () => NOW,
			volumeScale: 0.3,
			settings,
		});
		const args = {
			store_ids: ["MOCK-S1"],
			from_date: "2026-10-20",
			to_date: "2026-11-03",
		};
		const before = await source.call("payment_summary", args);
		expect(before.every((row) => row.fee_estimate_amount === 0)).toBe(true);
		settings.saveFeeRates([FEE_RATE]);
		const after = await source.call("payment_summary", args);
		let expectedMinor = 0;
		for (
			let date = args.from_date;
			date <= args.to_date;
			date = addDays(date, 1)
		) {
			const generated = source.aggregates.days.generatedNow("MOCK-S1", date);
			for (const sale of generated?.sales ?? []) {
				if (sale.status === "voided") continue;
				for (const payment of sale.payments) {
					if (payment.methodExternalId !== "PM-EWALLET") continue;
					if (date < FEE_RATE.effectiveFrom) continue;
					expectedMinor += feeEstimateMinor(
						minorUnits(payment.amount),
						FEE_RATE,
					);
				}
			}
		}
		const ewallet = after.find((row) => row.kind === "ewallet");
		expect(expectedMinor).toBeGreaterThan(0);
		expect(Math.round((ewallet?.fee_estimate_amount ?? 0) * 100)).toBe(
			expectedMinor,
		);
		expect(
			after
				.filter((row) => row.kind !== "ewallet")
				.every((row) => row.fee_estimate_amount === 0),
		).toBe(true);
	});
});

describe("refused writes", () => {
	const cases: readonly {
		readonly name: string;
		readonly write: (settings: DemoSettingsStore) => void;
		readonly field: string;
		readonly refusal: DemoSettingsRefusal;
	}[] = [
		{
			name: "a threshold out of its range",
			write: (settings) =>
				settings.saveReportSettings({
					...DEFAULT_REPORT_SETTINGS,
					peakHours: 9,
				}),
			field: "peakHours",
			refusal: "range",
		},
		{
			name: "a threshold with too many decimals",
			write: (settings) =>
				settings.saveReportSettings({
					...DEFAULT_REPORT_SETTINGS,
					cashRelThreshold: 0.00505,
				}),
			field: "cashRelThreshold",
			refusal: "range",
		},
		{
			name: "a negative cost",
			write: (settings) => settings.saveCosts([{ ...COST, costAmount: -1 }]),
			field: "costAmount",
			refusal: "range",
		},
		{
			name: "a cost with three decimals",
			write: (settings) => settings.saveCosts([{ ...COST, costAmount: 1.005 }]),
			field: "costAmount",
			refusal: "range",
		},
		{
			name: "a cost from a date that does not exist",
			write: (settings) =>
				settings.saveCosts([{ ...COST, effectiveFrom: "2026-02-30" }]),
			field: "effectiveFrom",
			refusal: "format",
		},
		{
			name: "a cost of an unknown store",
			write: (settings) =>
				settings.saveCosts([{ ...COST, storeId: "MOCK-S9" }]),
			field: "storeId",
			refusal: "reference",
		},
		{
			name: "two costs of one scope, item and date",
			write: (settings) =>
				settings.saveCosts([COST, { ...COST, costAmount: 16_000 }]),
			field: "effectiveFrom",
			refusal: "duplicate",
		},
		{
			name: "a fee percentage over numeric(6,3)",
			write: (settings) =>
				settings.saveFeeRates([{ ...FEE_RATE, feePct: 1_000 }]),
			field: "feePct",
			refusal: "range",
		},
		{
			name: "a fee percentage with four decimals",
			write: (settings) =>
				settings.saveFeeRates([{ ...FEE_RATE, feePct: 1.2345 }]),
			field: "feePct",
			refusal: "range",
		},
		{
			name: "a fee rate without a payment method",
			write: (settings) =>
				settings.saveFeeRates([{ ...FEE_RATE, paymentMethodExternalId: "" }]),
			field: "paymentMethodExternalId",
			refusal: "required",
		},
		{
			name: "two fee rates of one scope, method and date",
			write: (settings) =>
				settings.saveFeeRates([FEE_RATE, { ...FEE_RATE, feePct: 2 }]),
			field: "effectiveFrom",
			refusal: "duplicate",
		},
		{
			name: "a role for an item type the account does not have",
			write: (settings) =>
				settings.saveRoles([
					...demoRoles(),
					{
						posAccountId: DEMO_POS_ACCOUNT_ID,
						itemTypeExternalId: "TYPE-999",
						role: "drink",
					},
				]),
			field: "itemTypeExternalId",
			refusal: "reference",
		},
		{
			name: "a role of an unknown POS account",
			write: (settings) =>
				settings.saveRoles([
					{
						posAccountId: SECOND_ACCOUNT,
						itemTypeExternalId: "TYPE-001",
						role: "drink",
					},
				]),
			field: "posAccountId",
			refusal: "reference",
		},
		{
			name: "two roles for one item type",
			write: (settings) =>
				settings.saveRoles([
					...demoRoles(),
					{
						posAccountId: DEMO_POS_ACCOUNT_ID,
						itemTypeExternalId: "TYPE-001",
						role: "food",
					},
				]),
			field: "itemTypeExternalId",
			refusal: "duplicate",
		},
		{
			name: "a role that is not one of the five",
			write: (settings) =>
				settings.saveRoles([
					{
						posAccountId: DEMO_POS_ACCOUNT_ID,
						itemTypeExternalId: "TYPE-001",
						role: "dessert" as "drink",
					},
				]),
			field: "role",
			refusal: "format",
		},
		{
			name: "an override onto an item type the account does not have",
			write: (settings) =>
				settings.saveOverrides([
					{
						posAccountId: DEMO_POS_ACCOUNT_ID,
						itemExternalId: "SN-001",
						itemTypeExternalId: "TYPE-404",
						itemTypeName: null,
					},
				]),
			field: "itemTypeExternalId",
			refusal: "reference",
		},
		{
			name: "two overrides of one item",
			write: (settings) =>
				settings.saveOverrides(
					["TYPE-009", "TYPE-010"].map((itemTypeExternalId) => ({
						posAccountId: DEMO_POS_ACCOUNT_ID,
						itemExternalId: "SN-001",
						itemTypeExternalId,
						itemTypeName: null,
					})),
				),
			field: "itemExternalId",
			refusal: "duplicate",
		},
		{
			name: "an account for an unknown store",
			write: (settings) =>
				settings.saveStoreAccounts({ "MOCK-S9": SECOND_ACCOUNT }),
			field: "storeId",
			refusal: "reference",
		},
		{
			name: "a target of a period kind the table does not know",
			write: (settings) =>
				settings.saveTargets([{ ...TARGET, periodKind: "year" as "month" }]),
			field: "periodKind",
			refusal: "format",
		},
		{
			name: "a target of an unknown store",
			write: (settings) =>
				settings.saveTargets([{ ...TARGET, storeId: "MOCK-S9" }]),
			field: "storeId",
			refusal: "reference",
		},
		{
			name: "two targets of one store and period",
			write: (settings) => settings.saveTargets([TARGET, TARGET]),
			field: "periodStart",
			refusal: "duplicate",
		},
		{
			name: "a holiday that is not custom",
			write: (settings) =>
				settings.saveHolidays([{ ...HOLIDAY, kind: "public" as "custom" }]),
			field: "kind",
			refusal: "format",
		},
		{
			name: "a holiday without a name",
			write: (settings) => settings.saveHolidays([{ ...HOLIDAY, name: " " }]),
			field: "name",
			refusal: "required",
		},
		{
			name: "two holidays of one country, date and name",
			write: (settings) => settings.saveHolidays([HOLIDAY, HOLIDAY]),
			field: "name",
			refusal: "duplicate",
		},
		{
			name: "a legal document of an unknown kind",
			write: (settings) =>
				settings.saveLegalDocuments([
					{ ...NOTICE, kind: "cookie_banner" as "privacy_notice" },
				]),
			field: "kind",
			refusal: "format",
		},
		{
			name: "two legal documents with one version label",
			write: (settings) => settings.saveLegalDocuments([NOTICE, NOTICE]),
			field: "versionLabel",
			refusal: "duplicate",
		},
		{
			name: "a legal document published at no time",
			write: (settings) =>
				settings.saveLegalDocuments([{ ...NOTICE, publishedAt: "soon" }]),
			field: "publishedAt",
			refusal: "format",
		},
		{
			name: "a tenant without a name",
			write: (settings) =>
				settings.saveTenantProfile({ ...DEMO_TENANT_PROFILE, name: "" }),
			field: "name",
			refusal: "required",
		},
		{
			name: "a legal form the table does not know",
			write: (settings) =>
				settings.saveTenantProfile({
					...DEMO_TENANT_PROFILE,
					legalForm: "corporation" as "enterprise",
				}),
			field: "legalForm",
			refusal: "format",
		},
		{
			name: "a negative seat count",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					storeId: "MOCK-S1",
					code: "CH1",
					openingHours: demoOpeningHours,
					seatCount: -1,
				}),
			field: "seatCount",
			refusal: "range",
		},
		{
			name: "half a seat",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					storeId: "MOCK-S1",
					code: "CH1",
					openingHours: demoOpeningHours,
					seatCount: 2.5,
				}),
			field: "seatCount",
			refusal: "range",
		},
		{
			name: "an opening time past midnight",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					storeId: "MOCK-S1",
					code: "CH1",
					openingHours: { mon: [["07:00", "25:00"]] },
					seatCount: 40,
				}),
			field: "openingHours",
			refusal: "format",
		},
		{
			name: "opening hours keyed by something other than a weekday",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					storeId: "MOCK-S1",
					code: "CH1",
					openingHours: { holiday: [] } as never,
					seatCount: 40,
				}),
			field: "openingHours",
			refusal: "format",
		},
		{
			name: "an e-invoice status the table does not know",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S2"),
					eInvoiceStatus: "pending" as "configured",
				}),
			field: "eInvoiceStatus",
			refusal: "format",
		},
		{
			name: "a receipt numbering period the table does not know",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					tranNoResetPeriod: "weekly" as "daily",
				}),
			field: "tranNoResetPeriod",
			refusal: "format",
		},
		{
			name: "a member feature status the table does not know",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					memberCaptureStatus: "on" as "enabled",
				}),
			field: "memberCaptureStatus",
			refusal: "format",
		},
		{
			name: "an opening date that is not a calendar date",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					openedOn: "2025-02-30",
				}),
			field: "openedOn",
			refusal: "format",
		},
		{
			name: "a default language the app does not offer",
			write: (settings) =>
				settings.saveTenantProfile({
					...DEMO_TENANT_PROFILE,
					defaultLanguage: "fr" as "vi",
				}),
			field: "defaultLanguage",
			refusal: "format",
		},
		{
			name: "a kind override of a payment method the account does not have",
			write: (settings) =>
				settings.savePaymentKindOverrides([
					{ ...KIND_OVERRIDE, paymentMethodExternalId: "PM-GOLD" },
				]),
			field: "paymentMethodExternalId",
			refusal: "reference",
		},
		{
			name: "a kind override on a POS account no store uses",
			write: (settings) =>
				settings.savePaymentKindOverrides([
					{ ...KIND_OVERRIDE, posAccountId: SECOND_ACCOUNT },
				]),
			field: "posAccountId",
			refusal: "reference",
		},
		{
			name: "a payment kind the table does not know",
			write: (settings) =>
				settings.savePaymentKindOverrides([
					{ ...KIND_OVERRIDE, kind: "crypto" as "cash" },
				]),
			field: "kind",
			refusal: "format",
		},
		{
			name: "two kind overrides of one payment method",
			write: (settings) =>
				settings.savePaymentKindOverrides([
					KIND_OVERRIDE,
					{ ...KIND_OVERRIDE, kind: "ewallet" },
				]),
			field: "paymentMethodExternalId",
			refusal: "duplicate",
		},
		{
			name: "a retired draft",
			write: (settings) =>
				settings.saveLegalDocuments([
					{ ...NOTICE, retiredAt: "2026-11-01T08:00:00Z" },
				]),
			field: "retiredAt",
			refusal: "format",
		},
		{
			name: "a new legal text saved as published rather than as a draft",
			write: (settings) =>
				settings.saveLegalDocuments([
					{ ...NOTICE, publishedAt: "2026-11-01T08:00:00+07:00" },
				]),
			field: "publishedAt",
			refusal: "format",
		},
		{
			name: "a legal text in a language the table does not take",
			write: (settings) =>
				settings.saveLegalDocuments([{ ...NOTICE, language: "fr" }]),
			field: "language",
			refusal: "format",
		},
		{
			name: "a version label with an underscore",
			write: (settings) =>
				settings.saveLegalDocuments([
					{ ...NOTICE, versionLabel: "privacy_notice-2026-11" },
				]),
			field: "versionLabel",
			refusal: "format",
		},
		{
			name: "a legal title of 201 characters",
			write: (settings) =>
				settings.saveLegalDocuments([{ ...NOTICE, title: "a".repeat(201) }]),
			field: "title",
			refusal: "range",
		},
		{
			name: "a legal body over 100,000 characters",
			write: (settings) =>
				settings.saveLegalDocuments([{ ...NOTICE, body: "a".repeat(100_001) }]),
			field: "body",
			refusal: "range",
		},
		{
			name: "a legal document kind the table does not know",
			write: (settings) =>
				settings.saveLegalDocuments([
					{ ...NOTICE, kind: "consent_wording" as "privacy_notice" },
				]),
			field: "kind",
			refusal: "format",
		},
		{
			name: "a profile of an unknown store",
			write: (settings) =>
				settings.saveStoreProfile({
					...profileDefaults("MOCK-S1"),
					storeId: "MOCK-S9" as "MOCK-S1",
					code: null,
					openingHours: null,
					seatCount: null,
				}),
			field: "storeId",
			refusal: "reference",
		},
	];

	for (const entry of cases) {
		it(`refuses ${entry.name} and changes nothing`, () => {
			const settings = fresh();
			settings.saveCosts([COST]);
			const before = settings.snapshot();
			const versions = [settings.version, settings.ingestVersion];
			expect(refusal(() => entry.write(settings))).toEqual({
				field: entry.field,
				refusal: entry.refusal,
			});
			expect(settings.snapshot()).toBe(before);
			expect([settings.version, settings.ingestVersion]).toEqual(versions);
		});
	}

	it("keeps the message of a refused threshold that the settings page reads", () => {
		expect(() =>
			fresh().saveReportSettings({ ...DEFAULT_REPORT_SETTINGS, peakHours: 9 }),
		).toThrow("peakHours must lie between 1 and 6 with at most 0 decimals");
	});

	it("refuses an invalid starting snapshot", () => {
		expect(
			() =>
				new DemoSettingsStore({
					...demoSettings(AS_OF),
					costs: [{ ...COST, costAmount: -5 }],
				}),
		).toThrow(DemoSettingsError);
	});

	it("refuses a starting snapshot whose roles name a POS account no store uses", () => {
		const [role] = demoRoles();
		if (role === undefined) throw new Error("no demo role");
		expect(
			() =>
				new DemoSettingsStore({
					...demoSettings(AS_OF),
					roles: [...demoRoles(), { ...role, posAccountId: SECOND_ACCOUNT }],
				}),
		).toThrow(DemoSettingsError);
	});

	it("keeps its own copy of saved opening hours", () => {
		const settings = fresh();
		const hours = structuredClone(demoOpeningHours);
		settings.saveStoreProfile({
			...profileDefaults("MOCK-S2"),
			storeId: "MOCK-S2",
			code: "CH2",
			openingHours: hours,
			seatCount: 12,
		});
		const version = settings.version;
		(hours as Record<string, unknown>).mon = [["00:00", "99:99"]];
		expect(settings.storeProfile("MOCK-S2")?.openingHours).toEqual(
			demoOpeningHours,
		);
		expect(settings.version).toBe(version);
	});

	it("takes only ISO timestamps for a publication time", () => {
		for (const publishedAt of ["1", "2026-11-01", "Nov 1, 2026"]) {
			expect(
				() => fresh().saveLegalDocuments([{ ...NOTICE, publishedAt }]),
				publishedAt,
			).toThrow(DemoSettingsError);
		}
		const settings = fresh();
		settings.saveLegalDocuments([NOTICE]);
		expect(() =>
			settings.saveLegalDocuments([
				{ ...NOTICE, publishedAt: "2026-11-01T08:00:00+07:00" },
			]),
		).not.toThrow();
	});

	it("accepts what the tables accept at their edges", () => {
		const settings = fresh();
		settings.saveCosts([COST, { ...COST, storeId: "MOCK-S1" }]);
		settings.saveFeeRates([
			FEE_RATE,
			{ ...FEE_RATE, storeId: "MOCK-S2", feePct: 999.999, fixedFeeAmount: 0 },
		]);
		settings.saveStoreProfile({
			...profileDefaults("MOCK-S2"),
			storeId: "MOCK-S2",
			code: null,
			openingHours: { sat: [["7:05", "24:00"]], sun: [] },
			seatCount: 0,
		});
		settings.saveTargets([
			TARGET,
			{ ...TARGET, periodKind: "week", periodStart: "2026-11-02" },
		]);
		settings.saveLegalDocuments([
			{ ...NOTICE, title: "a".repeat(200), body: "a".repeat(100_000) },
			{ ...NOTICE, versionLabel: "0.a-b", language: "en" },
		]);
		expect(settings.version).toBe(5);
		expect(settings.openingHoursOf("MOCK-S2")).toEqual({
			sat: [["7:05", "24:00"]],
			sun: [],
		});
		expect(settings.storeProfiles().map((profile) => profile.storeId)).toEqual([
			"MOCK-S1",
			"MOCK-S2",
		]);
	});
});

describe("fee rates", () => {
	it("picks the store's own rate before the tenant's, then the latest one in force", () => {
		const settings = fresh();
		settings.saveFeeRates([
			FEE_RATE,
			{ ...FEE_RATE, feePct: 1.5, effectiveFrom: "2026-11-01" },
			{
				...FEE_RATE,
				storeId: "MOCK-S2",
				feePct: 0.9,
				effectiveFrom: "2026-09-01",
			},
			{ ...FEE_RATE, paymentMethodExternalId: "PM-BANK", feePct: 0.2 },
		]);
		expect(
			settings.feeRateOf("MOCK-S1", "PM-EWALLET", "2026-10-14"),
		).toBeNull();
		expect(
			settings.feeRateOf("MOCK-S1", "PM-EWALLET", "2026-10-15")?.feePct,
		).toBe(1.237);
		expect(
			settings.feeRateOf("MOCK-S1", "PM-EWALLET", "2026-11-03")?.feePct,
		).toBe(1.5);
		expect(
			settings.feeRateOf("MOCK-S2", "PM-EWALLET", "2026-11-03")?.feePct,
		).toBe(0.9);
		expect(
			settings.feeRateOf("MOCK-S2", "PM-EWALLET", "2026-08-31"),
		).toBeNull();
		expect(settings.feeRateOf("MOCK-S1", "PM-CASH", "2026-11-03")).toBeNull();
		expect(settings.feeRateOf("MOCK-S1", null, "2026-11-03")).toBeNull();
		expect(settings.feeRatesConfigured("MOCK-S1")).toBe(true);
	});

	it("counts a store as configured only for its own or the tenant's rates", () => {
		const settings = fresh();
		settings.saveFeeRates([{ ...FEE_RATE, storeId: "MOCK-S2" }]);
		expect(settings.feeRatesConfigured("MOCK-S1")).toBe(false);
		expect(settings.feeRatesConfigured("MOCK-S2")).toBe(true);
	});
});

describe("custom holidays", () => {
	it("join the tenant's calendar for its country and leave it unchanged otherwise", () => {
		const settings = fresh();
		settings.saveHolidays([
			HOLIDAY,
			{ ...HOLIDAY, countryCode: "TH", holidayDate: "2026-10-28" },
		]);
		const calendar = settings.holidays();
		expect(calendar).toHaveLength(VIETNAM_HOLIDAYS.length + 1);
		expect(calendar).toContainEqual({
			holidayDate: "2026-10-27",
			name: HOLIDAY.name,
			kind: "custom",
		});
		expect(isExcludedDemoDay(calendar, "2026-10-27")).toBe(true);
		expect(isExcludedDemoDay(calendar, "2026-10-28")).toBe(false);
		expect(settings.holidays()).toBe(calendar);
		settings.saveCosts([COST]);
		expect(settings.holidays()).toBe(calendar);
		settings.saveTenantProfile({ ...DEMO_TENANT_PROFILE, countryCode: "TH" });
		expect(settings.holidays()).toEqual([
			{ holidayDate: "2026-10-28", name: HOLIDAY.name, kind: "custom" },
		]);
		settings.saveTenantProfile(DEMO_TENANT_PROFILE);
		settings.saveHolidays([]);
		expect(settings.holidays()).toBe(VIETNAM_HOLIDAYS);
	});

	it("reach the report source wherever the functions read the calendar", async () => {
		const settings = fresh();
		const source = createDemoReportSource({
			now: () => NOW,
			volumeScale: 0.2,
			settings,
		});
		const args = {
			store_ids: ["MOCK-S1"],
			grain: "day" as const,
			from_date: "2026-10-26",
			to_date: "2026-10-28",
		};
		const before = await source.call("period_series", args);
		expect(
			before.find((row) => row.bucket_start === "2026-10-27")?.holiday_kind,
		).toBeNull();
		settings.saveHolidays([HOLIDAY]);
		const after = await source.call("period_series", args);
		const holiday = after.filter((row) => row.bucket_start === "2026-10-27");
		expect(holiday.length).toBeGreaterThan(0);
		for (const row of holiday) {
			expect(row.holiday_kind).toBe("custom");
			expect(row.excluded_days).toBe(1);
		}
	});
});

describe("the second POS account", () => {
	it("needs a store on the account before roles name it, and keeps its roles apart", () => {
		const settings = fresh();
		const secondRoles = [
			{
				posAccountId: SECOND_ACCOUNT,
				itemTypeExternalId: "TYPE-001",
				role: "drink" as const,
			},
			{
				posAccountId: SECOND_ACCOUNT,
				itemTypeExternalId: "TYPE-009",
				role: "snack" as const,
			},
		];
		expect(
			refusal(() => settings.saveRoles([...demoRoles(), ...secondRoles])),
		).toEqual({ field: "posAccountId", refusal: "reference" });
		settings.saveStoreAccounts({ "MOCK-S2": SECOND_ACCOUNT });
		settings.saveRoles([...demoRoles(), ...secondRoles]);
		expect(settings.accountOf("MOCK-S2")).toBe(SECOND_ACCOUNT);
		expect(settings.accountOf("MOCK-S1")).toBe(DEMO_POS_ACCOUNT_ID);
		expect(settings.roleOf(SECOND_ACCOUNT, "TYPE-009")).toBe("snack");
		expect(settings.roleOf(SECOND_ACCOUNT, "TYPE-007")).toBeNull();
		expect(settings.roleOf(DEMO_POS_ACCOUNT_ID, "TYPE-007")).toBe("topping");
		expect(settings.mapsRole(SECOND_ACCOUNT, "topping")).toBe(false);
		expect(settings.mapsRole(SECOND_ACCOUNT, "snack")).toBe(true);
		settings.saveOverrides([
			{
				posAccountId: SECOND_ACCOUNT,
				itemExternalId: "SN-001",
				itemTypeExternalId: "TYPE-009",
				itemTypeName: "ignored",
			},
		]);
		expect(settings.overrideOf(SECOND_ACCOUNT, "SN-001")).toMatchObject({
			itemTypeExternalId: "TYPE-009",
			itemTypeName: "Đồ ăn kèm",
		});
		expect(settings.overrideOf(DEMO_POS_ACCOUNT_ID, "SN-001")).toBeNull();
		settings.saveStoreAccounts({});
		expect(settings.accountOf("MOCK-S2")).toBe(DEMO_POS_ACCOUNT_ID);
		settings.saveRoles([...demoRoles(), ...secondRoles]);
		expect(settings.version).toBe(5);
		expect(settings.ingestVersion).toBe(5);
	});

	it("reports roles as configured for a store whose account maps any role", () => {
		const settings = fresh();
		settings.saveStoreAccounts({ "MOCK-S2": SECOND_ACCOUNT });
		expect(settings.rolesConfigured("MOCK-S2")).toBe(false);
		expect(settings.rolesConfigured("MOCK-S1")).toBe(true);
	});
});

describe("the 10b settings of the demo store", () => {
	it("drafts a legal text from the skeleton's six headings, with no wording under them", () => {
		expect(legalDraftSkeleton("vi")).toBe(
			[
				"## Mục đích xử lý dữ liệu",
				"## Dữ liệu được thu thập",
				"## Thời gian lưu trữ",
				"## Quyền của chủ thể dữ liệu và cách thực hiện",
				"## Liên hệ",
				"## Bên xử lý dữ liệu và lưu trữ ở nước ngoài",
			].join("\n\n"),
		);
		const english = legalDraftSkeleton("en").split("\n\n");
		expect(english).toHaveLength(6);
		expect(english.every((line) => /^## \S/.test(line))).toBe(true);
	});

	it("takes every kind of the table and suggests version labels the table accepts", () => {
		const settings = fresh();
		const kinds = [
			"privacy_notice",
			"data_protection_rules",
			"mini_app_terms",
			"staff_notice",
			"loyalty_consent_text",
			"marketing_consent_text",
		] as const;
		settings.saveLegalDocuments(
			kinds.map((kind) => ({
				...NOTICE,
				kind,
				versionLabel: legalVersionLabel(kind, AS_OF),
			})),
		);
		expect(settings.legalDocuments().map((row) => row.versionLabel)).toEqual([
			"privacy-notice-2026-11",
			"data-protection-rules-2026-11",
			"mini-app-terms-2026-11",
			"staff-notice-2026-11",
			"loyalty-consent-text-2026-11",
			"marketing-consent-text-2026-11",
		]);
	});

	it("publishes a draft, retires the text it replaces, and never edits or deletes a published or retired text", () => {
		const settings = fresh();
		const v1 = { ...NOTICE, versionLabel: "v1" };
		const v2 = { ...NOTICE, versionLabel: "v2", body: "Bản mới." };
		settings.saveLegalDocuments([v1, v2]);
		const published = { ...v1, publishedAt: "2026-11-01T08:00:00+07:00" };
		settings.saveLegalDocuments([published, v2]);
		const retired = { ...published, retiredAt: "2026-11-02T08:00:00+07:00" };
		const current = { ...v2, publishedAt: "2026-11-02T08:00:00+07:00" };
		settings.saveLegalDocuments([retired, current]);
		expect(
			settings
				.legalDocuments()
				.map((row) => [
					row.versionLabel,
					row.publishedAt !== null,
					row.retiredAt !== null,
				]),
		).toEqual([
			["v1", true, true],
			["v2", true, false],
		]);
		const before = settings.snapshot();
		const cases: readonly [() => void, string, DemoSettingsRefusal][] = [
			[
				() =>
					settings.saveLegalDocuments([retired, { ...current, body: "Sửa." }]),
				"body",
				"frozen",
			],
			[
				() =>
					settings.saveLegalDocuments([{ ...retired, title: "Khác" }, current]),
				"body",
				"frozen",
			],
			[() => settings.saveLegalDocuments([retired]), "body", "frozen"],
			[() => settings.saveLegalDocuments([current]), "body", "frozen"],
			[
				() =>
					settings.saveLegalDocuments([
						{ ...retired, retiredAt: null },
						current,
					]),
				"publishedAt",
				"duplicate",
			],
			[
				() =>
					settings.saveLegalDocuments([
						retired,
						current,
						{
							...NOTICE,
							language: "en",
							versionLabel: "v3",
							publishedAt: "2026-11-03T08:00:00Z",
						},
					]),
				"publishedAt",
				"format",
			],
		];
		for (const [write, field, refused] of cases) {
			expect(refusal(write)).toEqual({ field, refusal: refused });
		}
		expect(settings.snapshot()).toBe(before);
		settings.saveLegalDocuments([
			retired,
			current,
			{ ...NOTICE, versionLabel: "v3" },
		]);
		expect(
			refusal(() =>
				settings.saveLegalDocuments([
					retired,
					current,
					{
						...NOTICE,
						versionLabel: "v3",
						publishedAt: "2026-11-03T08:00:00Z",
					},
				]),
			),
		).toEqual({ field: "publishedAt", refusal: "duplicate" });
		settings.saveLegalDocuments([retired, current]);
		expect(settings.legalDocuments()).toHaveLength(2);
	});

	it("answers the effective kind override of each account and payment method", () => {
		const settings = fresh();
		settings.saveStoreAccounts({ "MOCK-S2": SECOND_ACCOUNT });
		settings.savePaymentKindOverrides([
			KIND_OVERRIDE,
			{ ...KIND_OVERRIDE, posAccountId: SECOND_ACCOUNT, kind: "ewallet" },
		]);
		expect(settings.ingestVersion).toBe(2);
		expect(settings.paymentKindOverrideOf(DEMO_POS_ACCOUNT_ID, "PM-BANK")).toBe(
			"cash",
		);
		expect(settings.paymentKindOverrideOf(SECOND_ACCOUNT, "PM-BANK")).toBe(
			"ewallet",
		);
		expect(
			settings.paymentKindOverrideOf(DEMO_POS_ACCOUNT_ID, "PM-CASH"),
		).toBeNull();
		settings.savePaymentKindOverrides([]);
		expect(
			settings.paymentKindOverrideOf(DEMO_POS_ACCOUNT_ID, "PM-BANK"),
		).toBeNull();
	});
});
