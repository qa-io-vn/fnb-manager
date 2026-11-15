import {
	DEMO_POS_ACCOUNT_ID,
	DEMO_UNCATEGORISED_ITEM,
	DemoSettingsStore,
	demoSettings,
} from "@fnb/demo-analytics";
import { DEFAULT_REPORT_SETTINGS } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { createDemoSettingsSource } from "./demo-settings-source";
import { SettingsWriteError } from "./source";
import { writeErrorKey } from "./use-settings-mutation";

const TENANT = "demo";

describe("the demo settings source", () => {
	it("lets the demo visitor act as an owner of every store", async () => {
		const source = createDemoSettingsSource(new DemoSettingsStore());
		expect(await source.membership(TENANT)).toEqual({
			role: "owner",
			storeIds: null,
		});
	});

	it("lists the demo menu's item types with their roles and saves a change into the shared store", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		const before = await source.itemTypes(TENANT);
		expect(before.length).toBeGreaterThan(5);
		expect(before[0]?.posAccountId).toBe(DEMO_POS_ACCOUNT_ID);
		const target = before.find((entry) => entry.role === "drink");
		expect(target).toBeDefined();
		const version = store.version;
		await source.saveRoles(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemTypeExternalId: target?.itemTypeExternalId ?? "",
				role: "food",
			},
		]);
		expect(store.version).toBeGreaterThan(version);
		const after = await source.itemTypes(TENANT);
		expect(
			after.find(
				(entry) => entry.itemTypeExternalId === target?.itemTypeExternalId,
			)?.role,
		).toBe("food");
		expect(after.filter((entry) => entry.role !== null)).toHaveLength(
			before.filter((entry) => entry.role !== null).length,
		);
	});

	it("clears a role when it is saved as not assigned, and gives it back", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		const topping = (await source.itemTypes(TENANT)).find(
			(entry) => entry.role === "topping",
		);
		if (topping === undefined) throw new Error("the demo has no topping type");
		await source.saveRoles(TENANT, [{ ...topping, role: null }]);
		const cleared = (await source.itemTypes(TENANT)).find(
			(entry) => entry.itemTypeExternalId === topping.itemTypeExternalId,
		);
		expect(cleared?.role).toBeNull();
		await source.saveRoles(TENANT, [{ ...topping, role: "topping" }]);
		const back = (await source.itemTypes(TENANT)).find(
			(entry) => entry.itemTypeExternalId === topping.itemTypeExternalId,
		);
		expect(back?.role).toBe("topping");
	});

	it("reads the defaults until thresholds are saved, then the saved row", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: DEFAULT_REPORT_SETTINGS,
			hasRow: false,
			audit: null,
		});
		const saved = { ...DEFAULT_REPORT_SETTINGS, cashAbsThreshold: 80_000 };
		await source.saveReportSettings(TENANT, saved);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: saved,
			hasRow: true,
			audit: { changedAt: expect.any(String), author: { kind: "you" } },
		});
		expect((await source.catchUpStatus(TENANT)).pendingDays).toBe(0);
	});

	it("merges a change into the saved thresholds", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		await source.saveReportSettings(TENANT, { cashAbsThreshold: 80_000 });
		await source.saveReportSettings(TENANT, { peakHours: 4 });
		expect(store.reportSettings()).toEqual({
			...DEFAULT_REPORT_SETTINGS,
			cashAbsThreshold: 80_000,
			peakHours: 4,
		});
	});

	it("removes the row when a save leaves every threshold at its default", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		await source.saveReportSettings(TENANT, { peakHours: 4 });
		expect(store.hasReportSettingsRow()).toBe(true);
		await source.saveReportSettings(TENANT, { peakHours: 3 });
		expect(store.hasReportSettingsRow()).toBe(false);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: DEFAULT_REPORT_SETTINGS,
			hasRow: false,
			audit: null,
		});
	});

	it("remembers when the thresholds were saved for every source of the same store", async () => {
		const store = new DemoSettingsStore();
		await createDemoSettingsSource(store).saveReportSettings(TENANT, {
			...DEFAULT_REPORT_SETTINGS,
			peakHours: 4,
		});
		const reopened =
			await createDemoSettingsSource(store).reportSettings(TENANT);
		expect(reopened.hasRow).toBe(true);
		expect(Number.isNaN(Date.parse(reopened.audit?.changedAt ?? ""))).toBe(
			false,
		);
		const other = await createDemoSettingsSource(
			new DemoSettingsStore(),
		).reportSettings(TENANT);
		expect(other.audit).toBeNull();
	});

	it("leaves a refused save without an audit stamp", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		await expect(
			source.saveReportSettings(TENANT, {
				...DEFAULT_REPORT_SETTINGS,
				peakHours: 9,
			}),
		).rejects.toBeInstanceOf(SettingsWriteError);
		expect((await source.reportSettings(TENANT)).audit).toBeNull();
	});

	it("refuses a threshold out of range as invalid, naming the field", async () => {
		const source = createDemoSettingsSource(new DemoSettingsStore());
		await expect(
			source.saveReportSettings(TENANT, {
				...DEFAULT_REPORT_SETTINGS,
				peakHours: 9,
			}),
		).rejects.toEqual(new SettingsWriteError("invalid", "peakHours"));
	});
});

describe("the demo settings source's 10b areas", () => {
	const fresh = () => new DemoSettingsStore(demoSettings("2026-11-03"));

	it("reads and updates the tenant profile, stamping the audit line only once saved", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		expect(await source.tenantProfile(TENANT)).toEqual({
			legalForm: "household_business",
			defaultLanguage: "vi",
			audit: null,
		});
		const saved = await source.updateTenantProfile(TENANT, {
			defaultLanguage: "en",
		});
		expect(saved).toMatchObject({
			legalForm: "household_business",
			defaultLanguage: "en",
			audit: { author: { kind: "you" } },
		});
		expect(await source.tenantProfile(TENANT)).toEqual(saved);
		await expect(
			source.updateTenantProfile(TENANT, { legalForm: "corp" as "enterprise" }),
		).rejects.toMatchObject({ code: "invalid", constraint: "legalForm" });
	});

	it("shows each store's POS facts beside its profile and saves a profile change", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		const [established, young] = await source.storeProfiles(TENANT);
		expect(established).toMatchObject({
			storeId: "MOCK-S1",
			posAccountId: DEMO_POS_ACCOUNT_ID,
			timeZone: "Asia/Ho_Chi_Minh",
			businessDayStartMinutes: 0,
			code: "CH1",
			seatCount: 40,
			eInvoiceStatus: "configured",
			audit: null,
		});
		expect(young).toMatchObject({
			storeId: "MOCK-S2",
			openingHours: null,
			eInvoiceStatus: "not_configured",
			tranNoResetPeriod: "unknown",
			memberCaptureStatus: "unknown",
		});
		expect(established?.name.length).toBeGreaterThan(0);
		const saved = await source.updateStoreProfile(TENANT, "MOCK-S2", {
			seatCount: 24,
			eInvoiceStatus: "configured",
		});
		expect(saved).toMatchObject({
			seatCount: 24,
			eInvoiceStatus: "configured",
			code: "CH2",
			audit: { author: { kind: "you" } },
		});
		expect(store.seatCount("MOCK-S2")).toBe(24);
		await expect(
			source.updateStoreProfile(TENANT, "MOCK-S2", { seatCount: -1 }),
		).rejects.toMatchObject({ code: "invalid", constraint: "seatCount" });
		await expect(
			source.updateStoreProfile(TENANT, "MOCK-S9", { seatCount: 1 }),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("lists the catalogue with the POS category and the override, and saves and clears an override", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		const untyped = (await source.items(TENANT)).find(
			(item) => item.itemExternalId === DEMO_UNCATEGORISED_ITEM,
		);
		expect(untyped).toMatchObject({
			posItemTypeExternalId: null,
			overrideItemTypeExternalId: null,
			audit: null,
		});
		const ingest = store.ingestVersion;
		await source.saveCategoryOverrides(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemExternalId: DEMO_UNCATEGORISED_ITEM,
				itemTypeExternalId: "TYPE-009",
			},
		]);
		expect(store.ingestVersion).toBe(ingest + 1);
		expect(
			(await source.items(TENANT)).find(
				(item) => item.itemExternalId === DEMO_UNCATEGORISED_ITEM,
			),
		).toMatchObject({
			overrideItemTypeExternalId: "TYPE-009",
			audit: { author: { kind: "you" } },
		});
		await source.saveCategoryOverrides(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemExternalId: DEMO_UNCATEGORISED_ITEM,
				itemTypeExternalId: null,
			},
		]);
		expect(store.overrides()).toEqual([]);
		expect(
			(await source.items(TENANT)).find(
				(item) => item.itemExternalId === DEMO_UNCATEGORISED_ITEM,
			)?.audit,
		).toBeNull();
	});

	it("shows the payment methods' POS and effective kinds and saves a kind override", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		await source.saveKindOverrides(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				paymentMethodExternalId: "PM-BANK",
				kind: "cash",
			},
		]);
		const bank = (await source.paymentMethods(TENANT)).find(
			(method) => method.externalId === "PM-BANK",
		);
		expect(bank).toMatchObject({
			posKind: "bank_transfer",
			overrideKind: "cash",
			kind: "cash",
			audit: { author: { kind: "you" } },
		});
		expect(store.paymentKindOverrideOf(DEMO_POS_ACCOUNT_ID, "PM-BANK")).toBe(
			"cash",
		);
		await source.saveKindOverrides(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				paymentMethodExternalId: "PM-BANK",
				kind: null,
			},
		]);
		expect(store.paymentKindOverrides()).toEqual([]);
	});

	it("saves fee rates as an upsert on scope, method and date, tenant-wide and per store as two rows", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		const rate = {
			storeId: null,
			paymentMethodExternalId: "PM-EWALLET",
			feePct: 1.2,
			fixedFeeAmount: 0,
			effectiveFrom: "2023-01-01",
		};
		await source.saveFeeRates(TENANT, [rate, { ...rate, storeId: "MOCK-S1" }]);
		await source.saveFeeRates(TENANT, [{ ...rate, feePct: 1.5 }]);
		const rows = await source.feeRates(TENANT);
		expect(rows.map((row) => [row.storeId, row.feePct])).toEqual([
			[null, 1.5],
			["MOCK-S1", 1.2],
		]);
		expect(rows.every((row) => row.audit?.author.kind === "you")).toBe(true);
		await expect(
			source.saveFeeRates(TENANT, [{ ...rate, feePct: 999_999 }]),
		).rejects.toMatchObject({ code: "invalid", constraint: "feePct" });
		expect((await source.feeRates(TENANT)).map((row) => row.feePct)).toEqual([
			1.5, 1.2,
		]);
	});

	it("reads a year of national and custom holidays, adds a custom day once and deletes it", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		const national = await source.holidays(TENANT, 2026);
		expect(national.length).toBeGreaterThan(5);
		expect(national.every((day) => !day.custom && day.audit === null)).toBe(
			true,
		);
		expect(national.every((day) => day.holidayDate.startsWith("2026-"))).toBe(
			true,
		);
		const added = await source.addHoliday(TENANT, {
			holidayDate: "2026-03-09",
			name: "Nghỉ riêng",
		});
		expect(added).toMatchObject({ custom: true, kind: "custom" });
		await expect(
			source.addHoliday(TENANT, {
				holidayDate: "2026-03-09",
				name: "Nghỉ riêng",
			}),
		).rejects.toMatchObject({ code: "duplicate" });
		expect(
			(await source.holidays(TENANT, 2026)).filter((day) => day.custom),
		).toEqual([added]);
		expect(
			(await source.holidays(TENANT, 2027)).filter((day) => day.custom),
		).toEqual([]);
		await source.deleteHoliday(TENANT, national[0]?.id ?? "");
		await source.deleteHoliday(TENANT, added.id);
		expect(store.customHolidays()).toEqual([]);
	});

	it("refuses a store code another store uses and a bad span under the database's constraint names, so the page shows the same messages", async () => {
		const source = createDemoSettingsSource(fresh());
		const duplicate = await source
			.updateStoreProfile(TENANT, "MOCK-S2", { code: "ch1" })
			.catch((error: unknown) => error);
		expect(duplicate).toMatchObject({
			code: "duplicate",
			constraint: "stores_code_unique_in_tenant",
		});
		expect(writeErrorKey("duplicate", "stores_code_unique_in_tenant")).toBe(
			"settings.store.code.duplicate",
		);
		const span = await source
			.updateStoreProfile(TENANT, "MOCK-S1", {
				openingHours: { mon: [["25:00", "22:00"]] },
			})
			.catch((error: unknown) => error);
		expect(span).toMatchObject({
			code: "invalid",
			constraint: "stores_opening_hours_valid",
		});
	});

	it("stamps the audit line only when a profile change changed something", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		const version = store.version;
		const same = await source.updateStoreProfile(TENANT, "MOCK-S1", {
			code: "CH1",
		});
		expect(same.audit).toBeNull();
		expect(store.version).toBe(version);
		expect((await source.updateTenantProfile(TENANT, {})).audit).toBeNull();
		const changed = await source.updateStoreProfile(TENANT, "MOCK-S1", {
			code: "CH9",
		});
		expect(changed.audit?.author).toEqual({ kind: "you" });
	});

	it("gives a saved role its audit line and lists an override whose item the catalogue lacks", async () => {
		const store = fresh();
		const source = createDemoSettingsSource(store);
		const [first] = await source.itemTypes(TENANT);
		if (first === undefined) throw new Error("no item type");
		await source.saveRoles(TENANT, [
			{
				posAccountId: first.posAccountId,
				itemTypeExternalId: first.itemTypeExternalId,
				role: "snack",
			},
		]);
		expect((await source.itemTypes(TENANT))[0]?.audit?.author).toEqual({
			kind: "you",
		});
		await source.saveCategoryOverrides(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemExternalId: "Bánh mì cũ",
				itemTypeExternalId: "TYPE-009",
			},
		]);
		expect((await source.items(TENANT)).at(-1)).toMatchObject({
			itemExternalId: "Bánh mì cũ",
			inCatalogue: false,
			overrideItemTypeExternalId: "TYPE-009",
		});
	});

	it("lists fee rates in the live order and refuses a batch that names one key twice", async () => {
		const source = createDemoSettingsSource(fresh());
		const rate = {
			storeId: "MOCK-S1",
			paymentMethodExternalId: "PM-EWALLET",
			feePct: 1,
			fixedFeeAmount: 0,
			effectiveFrom: "2026-01-01",
		};
		await source.saveFeeRates(TENANT, [rate]);
		await source.saveFeeRates(TENANT, [
			{ ...rate, storeId: null, effectiveFrom: "2023-01-01" },
			{ ...rate, paymentMethodExternalId: "PM-BANK" },
		]);
		expect(
			(await source.feeRates(TENANT)).map((row) => [
				row.paymentMethodExternalId,
				row.storeId,
			]),
		).toEqual([
			["PM-BANK", "MOCK-S1"],
			["PM-EWALLET", null],
			["PM-EWALLET", "MOCK-S1"],
		]);
		await expect(
			source.saveFeeRates(TENANT, [rate, { ...rate, feePct: 2 }]),
		).rejects.toMatchObject({ code: "duplicate" });
	});
});
