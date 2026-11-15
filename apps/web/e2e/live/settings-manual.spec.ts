import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseManualSource } from "../../src/settings/manual/supabase-manual-source";
import { writeCodeOf } from "../../src/settings/source";
import { createSupabaseSettingsSource } from "../../src/settings/supabase-settings-source";
import { isLocalStackConfigured } from "../support/local-stack";
import {
	createSettingsFixture,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const FIRST_DAY = "2023-01-01";

let fixture: SettingsFixture | undefined;
const clients: SupabaseClient[] = [];

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

async function clientAs(role: SettingsRole): Promise<SupabaseClient> {
	const client = await created().clientAs(role);
	clients.push(client);
	return client;
}

async function refusal(write: Promise<unknown>): Promise<string> {
	return write.then(
		() => "saved",
		(error: unknown) => writeCodeOf(error),
	);
}

test.beforeAll(async () => {
	fixture = await createSettingsFixture();
});

test.afterAll(async () => {
	for (const client of clients) await client.auth.signOut();
	await fixture?.teardown();
});

test("a tenant-wide cost and a store cost of one item and date are two rows, and saving a scope again updates its row", async () => {
	const { tenantId, storeIds } = created();
	const manual = createSupabaseManualSource(await clientAs("owner"));
	const tenantWide = {
		storeId: null,
		itemExternalId: "ITEM-1",
		costAmount: 10_000,
		effectiveFrom: FIRST_DAY,
	};
	await manual.saveItemCosts(tenantId, [
		tenantWide,
		{ ...tenantWide, storeId: storeIds[0], costAmount: 12_000 },
	]);
	const [saved] = await manual.saveItemCosts(tenantId, [
		{ ...tenantWide, costAmount: 11_000 },
	]);
	expect(saved?.audit?.author).toEqual({ kind: "you" });
	const rows = (await manual.itemCosts(tenantId)).filter(
		(row) => row.itemExternalId === "ITEM-1",
	);
	expect(rows.map((row) => [row.storeId, row.costAmount])).toEqual([
		[null, 11_000],
		[storeIds[0], 12_000],
	]);
	expect(rows.every((row) => row.audit !== null)).toBe(true);
});

test("a save holding one refused row writes none of its rows", async () => {
	const { tenantId } = created();
	const manual = createSupabaseManualSource(await clientAs("owner"));
	const before = await manual.itemCosts(tenantId);
	expect(
		await refusal(
			manual.saveItemCosts(tenantId, [
				{
					storeId: null,
					itemExternalId: "ITEM-2",
					costAmount: 9_000,
					effectiveFrom: FIRST_DAY,
				},
				{
					storeId: null,
					itemExternalId: "ITEM-3",
					costAmount: 10_000_000_000_000,
					effectiveFrom: FIRST_DAY,
				},
			]),
		),
	).toBe("invalid");
	expect(await manual.itemCosts(tenantId)).toEqual(before);
});

test("fee rates resolve the tenant-wide key the same way, and a store-limited manager writes only their own store's rows", async () => {
	const { tenantId, storeIds } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	const rate = {
		storeId: null,
		paymentMethodExternalId: "WALLET",
		feePct: 1.1,
		fixedFeeAmount: 0,
		effectiveFrom: FIRST_DAY,
	};
	await owner.saveFeeRates(tenantId, [rate]);
	await owner.saveFeeRates(tenantId, [{ ...rate, feePct: 1.3 }]);
	expect(
		(await owner.feeRates(tenantId)).map((row) => [row.storeId, row.feePct]),
	).toEqual([[null, 1.3]]);

	const limited = createSupabaseManualSource(await clientAs("store-manager"));
	const cost = {
		storeId: null,
		itemExternalId: "ITEM-4",
		costAmount: 5_000,
		effectiveFrom: FIRST_DAY,
	};
	expect(await refusal(limited.saveItemCosts(tenantId, [cost]))).toBe(
		"forbidden",
	);
	expect(
		await refusal(
			limited.saveItemCosts(tenantId, [{ ...cost, storeId: storeIds[1] }]),
		),
	).toBe("forbidden");
	expect(
		await refusal(
			limited.saveItemCosts(tenantId, [{ ...cost, storeId: storeIds[0] }]),
		),
	).toBe("saved");
});

test("store and tenant profiles: a duplicate code, the owner-only opening hours and an invalid span come back as their codes", async () => {
	const { tenantId, storeIds } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	const manager = createSupabaseSettingsSource(await clientAs("manager"));
	const stores = await owner.storeProfiles(tenantId);
	expect(stores.map((store) => store.code).sort()).toEqual(["E1", "E2"]);
	const saved = await owner.updateStoreProfile(tenantId, storeIds[0], {
		seatCount: 30,
		eInvoiceStatus: "configured",
	});
	expect(saved).toMatchObject({
		seatCount: 30,
		eInvoiceStatus: "configured",
		audit: { author: { kind: "you" } },
	});
	const duplicate = await owner
		.updateStoreProfile(tenantId, storeIds[1], { code: "E1" })
		.catch((error: unknown) => error);
	expect(duplicate).toMatchObject({
		code: "duplicate",
		constraint: "stores_code_unique_in_tenant",
	});
	expect(
		await refusal(
			manager.updateStoreProfile(tenantId, storeIds[0], {
				openingHours: { mon: [["07:00", "22:00"]] },
			}),
		),
	).toBe("forbidden");
	expect(
		await refusal(
			manager.updateStoreProfile(tenantId, storeIds[0], { seatCount: 32 }),
		),
	).toBe("saved");
	const invalid = await owner
		.updateStoreProfile(tenantId, storeIds[0], {
			openingHours: { mon: [["25:00", "22:00"]] },
		})
		.catch((error: unknown) => error);
	expect(invalid).toMatchObject({
		code: "invalid",
		constraint: "stores_opening_hours_valid",
	});
	expect(
		await owner.updateTenantProfile(tenantId, { defaultLanguage: "en" }),
	).toMatchObject({
		defaultLanguage: "en",
		audit: { author: { kind: "you" } },
	});
	expect(
		await refusal(
			manager.updateTenantProfile(tenantId, { legalForm: "enterprise" }),
		),
	).toBe("forbidden");
});

test("category and payment-kind overrides are saved, read back over the POS values and cleared", async () => {
	const { tenantId, accountId } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	await owner.saveCategoryOverrides(tenantId, [
		{
			posAccountId: accountId,
			itemExternalId: "ITEM-6",
			itemTypeExternalId: "TYPE-SNACK",
		},
	]);
	await owner.saveKindOverrides(tenantId, [
		{
			posAccountId: accountId,
			paymentMethodExternalId: "WALLET",
			kind: "ewallet",
		},
	]);
	const item = (await owner.items(tenantId)).find(
		(entry) => entry.itemExternalId === "ITEM-6",
	);
	expect(item).toMatchObject({
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "TYPE-SNACK",
		audit: { author: { kind: "you" } },
	});
	const wallet = (await owner.paymentMethods(tenantId)).find(
		(entry) => entry.externalId === "WALLET",
	);
	expect(wallet).toMatchObject({
		posKind: "other",
		overrideKind: "ewallet",
		kind: "ewallet",
	});
	await owner.saveCategoryOverrides(tenantId, [
		{
			posAccountId: accountId,
			itemExternalId: "ITEM-6",
			itemTypeExternalId: null,
		},
	]);
	await owner.saveKindOverrides(tenantId, [
		{ posAccountId: accountId, paymentMethodExternalId: "WALLET", kind: null },
	]);
	expect(
		(await owner.items(tenantId)).find(
			(entry) => entry.itemExternalId === "ITEM-6",
		)?.overrideItemTypeExternalId,
	).toBeNull();
	expect(
		(await owner.paymentMethods(tenantId)).find(
			(entry) => entry.externalId === "WALLET",
		),
	).toMatchObject({ overrideKind: null, kind: "other" });
});

test("a custom holiday is added once, read in its year beside the national days, and deleted", async () => {
	const { tenantId } = created();
	const owner = createSupabaseSettingsSource(await clientAs("owner"));
	const viewer = createSupabaseSettingsSource(await clientAs("viewer"));
	const added = await owner.addHoliday(tenantId, {
		holidayDate: "2026-03-09",
		name: "Nghỉ riêng của chuỗi",
	});
	expect(added).toMatchObject({ custom: true, kind: "custom" });
	expect(
		await refusal(
			owner.addHoliday(tenantId, {
				holidayDate: "2026-03-09",
				name: "Nghỉ riêng của chuỗi",
			}),
		),
	).toBe("duplicate");
	const year = await viewer.holidays(tenantId, 2026);
	expect(year.some((day) => !day.custom)).toBe(true);
	expect(year.filter((day) => day.custom).map((day) => day.id)).toEqual([
		added.id,
	]);
	expect(await refusal(viewer.deleteHoliday(tenantId, added.id))).toBe(
		"forbidden",
	);
	await owner.deleteHoliday(tenantId, added.id);
	expect(
		(await owner.holidays(tenantId, 2026)).filter((day) => day.custom),
	).toEqual([]);
});

test("a legal draft is published and retired through the functions, and a published text is frozen", async () => {
	const { tenantId } = created();
	const owner = createSupabaseManualSource(await clientAs("owner"));
	const manager = createSupabaseManualSource(await clientAs("manager"));
	const draft = await owner.saveLegalDraft(tenantId, {
		kind: "privacy_notice",
		language: "vi",
		version: "privacy-notice-2026-11",
		title: "Thông báo bảo mật",
		bodyMarkdown: "## Mục đích xử lý dữ liệu",
	});
	expect(draft).toMatchObject({ status: "draft", publishedAt: null });
	expect(await refusal(manager.publishLegalDocument(tenantId, draft.id))).toBe(
		"forbidden",
	);
	await owner.publishLegalDocument(tenantId, draft.id);
	expect(
		await refusal(
			owner.saveLegalDraft(tenantId, {
				id: draft.id,
				kind: "privacy_notice",
				language: "vi",
				version: draft.version,
				title: "Sửa sau khi công bố",
				bodyMarkdown: draft.bodyMarkdown,
			}),
		),
	).toBe("frozen");
	expect(await refusal(owner.deleteLegalDraft(tenantId, draft.id))).toBe(
		"frozen",
	);
	await owner.retireLegalDocument(tenantId, draft.id);
	const [retired] = await owner.legalDocuments(tenantId);
	expect(retired).toMatchObject({ status: "retired" });
	expect(retired?.publishedAt).not.toBeNull();
	expect(retired?.retiredAt).not.toBeNull();
});
