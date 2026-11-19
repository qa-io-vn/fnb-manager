import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import type { ChecklistTemplate } from "../../operations/source";
import type { Membership, StoreProfile } from "../source";
import {
	ALL_STORES,
	type ChecklistDraft,
	checklistDraftOf,
	checklistErrorKey,
	checklistGroups,
	checklistStoreChoices,
	copiedChange,
	copyTargets,
	emptyItem,
	isDraftEmpty,
	movedItem,
	readChecklistDraft,
	sameChecklist,
	skeletonDraft,
	templateAccess,
	textIssue,
	withoutItem,
} from "./checklist-rules";

const STORE_1 = "11111111-1111-4111-8111-111111111111";
const STORE_2 = "22222222-2222-4222-8222-222222222222";

function profile(storeId: string, name: string): StoreProfile {
	return {
		storeId,
		posAccountId: "account",
		name,
		address: null,
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
		code: null,
		openingHours: null,
		seatCount: null,
		openedOn: null,
		eInvoiceStatus: "unknown",
		tranNoResetPeriod: "unknown",
		memberCaptureStatus: "unknown",
		audit: null,
	} as StoreProfile;
}

const PROFILES = [
	profile(STORE_1, "Cửa hàng 1"),
	profile(STORE_2, "Cửa hàng 2"),
];

const OWNER: Membership = { role: "owner", storeIds: null };
const LIMITED: Membership = { role: "manager", storeIds: [STORE_1] };
const STAFF: Membership = { role: "staff", storeIds: null };

function template(
	overrides: Partial<ChecklistTemplate> = {},
): ChecklistTemplate {
	return {
		id: "template-1",
		storeId: STORE_1,
		phase: "closing",
		title: "Đóng ca",
		active: true,
		version: 3,
		items: [
			{
				id: "item-1",
				position: 1,
				label: "Đếm két",
				requiresPhoto: false,
				numberUnit: null,
			},
			{
				id: "item-2",
				position: 2,
				label: "Nhiệt độ tủ",
				requiresPhoto: true,
				numberUnit: "°C",
			},
		],
		createdAt: "2026-11-01T00:00:00Z",
		audit: null,
		...overrides,
	};
}

const t = (key: Parameters<typeof translate>[1]) => translate("vi", key);

describe("checklist drafts", () => {
	it("moves an item up and down and leaves the ends where they are", () => {
		const items = checklistDraftOf(template(), STORE_1).items;
		const down = movedItem(items, 0, 1);
		expect(down.map((item) => item.label)).toEqual(["Nhiệt độ tủ", "Đếm két"]);
		expect(movedItem(down, 1, -1).map((item) => item.label)).toEqual([
			"Đếm két",
			"Nhiệt độ tủ",
		]);
		expect(movedItem(items, 0, -1)).toEqual(items);
		expect(movedItem(items, 1, 1)).toEqual(items);
		expect(withoutItem(items, 0).map((item) => item.label)).toEqual([
			"Nhiệt độ tủ",
		]);
	});

	it("sends the composed, trimmed texts with the photo and number options in order", () => {
		const draft: ChecklistDraft = {
			store: STORE_1,
			phase: "midshift",
			title: "  Giữa ca  ",
			items: [
				{ ...emptyItem(), label: " Lau bàn ", requiresPhoto: true },
				{ ...emptyItem(), label: "Tủ mát", hasNumber: true, unit: " °C " },
				{ ...emptyItem(), label: "Thùng rác", hasNumber: false, unit: "kg" },
			],
		};
		expect(readChecklistDraft(draft, [STORE_1]).change).toEqual({
			templateId: null,
			storeId: STORE_1,
			phase: "midshift",
			title: "Giữa ca",
			items: [
				{ label: "Lau bàn", requiresPhoto: true, numberUnit: null },
				{ label: "Tủ mát", requiresPhoto: false, numberUnit: "°C" },
				{ label: "Thùng rác", requiresPhoto: false, numberUnit: null },
			],
		});
	});

	it("sends every store as null", () => {
		const draft = {
			...checklistDraftOf(template(), STORE_1),
			store: ALL_STORES,
		};
		expect(
			readChecklistDraft(draft, [ALL_STORES, STORE_1]).change?.storeId,
		).toBeNull();
	});

	it("holds back a missing or too long title, label or unit, control characters and a store outside the choices", () => {
		const long = "x".repeat(121);
		const reading = readChecklistDraft(
			{
				store: STORE_2,
				phase: "opening",
				title: long,
				items: [
					{ ...emptyItem(), label: "" },
					{ ...emptyItem(), label: "Ổn\tđịnh", hasNumber: true, unit: "" },
					{
						...emptyItem(),
						label: "y".repeat(201),
						hasNumber: true,
						unit: "z".repeat(17),
					},
				],
			},
			[STORE_1],
		);
		expect(reading.change).toBeNull();
		expect(reading.store).toBe(true);
		expect(reading.title).toEqual({ kind: "tooLong", max: 120 });
		expect(reading.items).toEqual([
			{ label: { kind: "required" }, unit: null },
			{ label: { kind: "control" }, unit: { kind: "required" } },
			{
				label: { kind: "tooLong", max: 200 },
				unit: { kind: "tooLong", max: 16 },
			},
		]);
	});

	it("counts characters as the database does, so a composed Vietnamese title of 120 letters passes", () => {
		expect(textIssue("ệ".repeat(120), 120)).toBeNull();
		expect(textIssue("ệ".repeat(120), 120)).toBeNull();
		expect(textIssue("ệ".repeat(121), 120)).toEqual({
			kind: "tooLong",
			max: 120,
		});
	});

	it("needs one to sixty items", () => {
		const draft = checklistDraftOf(template(), STORE_1);
		expect(readChecklistDraft({ ...draft, items: [] }, [STORE_1]).count).toBe(
			"required",
		);
		expect(
			readChecklistDraft(
				{
					...draft,
					items: Array.from({ length: 61 }, () => ({
						...emptyItem(),
						label: "Mục",
					})),
				},
				[STORE_1],
			).count,
		).toBe("tooMany");
	});

	it("sees an unchanged edit whatever was typed around the texts", () => {
		const saved = template();
		const reading = readChecklistDraft(
			{
				...checklistDraftOf(saved, STORE_1),
				title: " Đóng ca ",
			},
			[STORE_1],
		);
		expect(reading.change && sameChecklist(saved, reading.change)).toBe(true);
		const moved = readChecklistDraft(
			{
				...checklistDraftOf(saved, STORE_1),
				items: movedItem(checklistDraftOf(saved, STORE_1).items, 0, 1),
			},
			[STORE_1],
		);
		expect(moved.change && sameChecklist(saved, moved.change)).toBe(false);
	});

	it("fills an empty draft from the outline of its shift in the interface language", () => {
		const empty: ChecklistDraft = {
			store: STORE_1,
			phase: "closing",
			title: "",
			items: [emptyItem()],
		};
		expect(isDraftEmpty(empty)).toBe(true);
		const filled = skeletonDraft(empty, t);
		expect(filled.title).toBe("Checklist đóng ca");
		expect(filled.items.map((item) => item.label)).toEqual([
			"Kiểm đếm hàng hủy trong ca",
			"Vệ sinh khu pha chế và sàn",
			"Báo sự cố nếu có",
			"Viết ghi chú bàn giao cho ca sau",
			"Đóng ca trên POS và đếm két",
		]);
		expect(filled.items[0]).toMatchObject({ hasNumber: true, unit: "phần" });
		expect(filled.items[1]?.requiresPhoto).toBe(true);
		expect(isDraftEmpty(filled)).toBe(false);
		expect(
			skeletonDraft({ ...empty, phase: "opening", title: "Riêng" }, t).title,
		).toBe("Riêng");
		expect(
			readChecklistDraft(skeletonDraft({ ...empty, phase: "midshift" }, t), [
				STORE_1,
			]).change?.items,
		).toHaveLength(3);
	});
});

describe("checklist scope", () => {
	it("offers every store and each store to an editor with every store, only their own stores to a store-limited manager, nothing to staff", () => {
		expect(
			checklistStoreChoices(OWNER, PROFILES).map((choice) => choice.value),
		).toEqual([ALL_STORES, STORE_1, STORE_2]);
		expect(
			checklistStoreChoices(LIMITED, PROFILES).map((choice) => choice.value),
		).toEqual([STORE_1]);
		expect(checklistStoreChoices(STAFF, PROFILES)).toEqual([]);
		expect(checklistStoreChoices(undefined, PROFILES)).toEqual([]);
	});

	it("lets a store-limited manager edit their store's checklists and read the others with the scope reason", () => {
		expect(templateAccess(LIMITED, { storeId: STORE_1 })).toEqual({
			canWrite: true,
			reason: null,
		});
		expect(templateAccess(LIMITED, { storeId: null })).toEqual({
			canWrite: false,
			reason: "scope",
		});
		expect(templateAccess(LIMITED, { storeId: STORE_2 })).toEqual({
			canWrite: false,
			reason: "scope",
		});
		expect(templateAccess(STAFF, { storeId: STORE_1 })).toEqual({
			canWrite: false,
			reason: "role",
		});
	});

	it("copies a checklist to another store in scope with the same phase, title and items and no template id", () => {
		const choices = checklistStoreChoices(OWNER, PROFILES);
		expect(
			copyTargets(template(), choices).map((choice) => choice.value),
		).toEqual([STORE_2]);
		expect(
			copyTargets(template({ storeId: null }), choices).map(
				(choice) => choice.value,
			),
		).toEqual([STORE_1, STORE_2]);
		expect(
			copyTargets(template(), checklistStoreChoices(LIMITED, PROFILES)),
		).toEqual([]);
		expect(copiedChange(template(), STORE_2)).toEqual({
			templateId: null,
			storeId: STORE_2,
			phase: "closing",
			title: "Đóng ca",
			items: [
				{ label: "Đếm két", requiresPhoto: false, numberUnit: null },
				{ label: "Nhiệt độ tủ", requiresPhoto: true, numberUnit: "°C" },
			],
		});
	});

	it("groups every store's checklists first, then each store's, by shift with the retired after", () => {
		const groups = checklistGroups(
			[
				template({ id: "c", phase: "closing" }),
				template({ id: "a", phase: "opening", active: false }),
				template({ id: "b", phase: "opening", title: "Mở ca" }),
				template({ id: "w", storeId: null, phase: "midshift" }),
				template({ id: "s2", storeId: STORE_2 }),
			],
			PROFILES,
		);
		expect(
			groups.map((group) => [
				group.storeId,
				group.templates.map((entry) => entry.id),
			]),
		).toEqual([
			[null, ["w"]],
			[STORE_1, ["b", "a", "c"]],
			[STORE_2, ["s2"]],
		]);
	});

	it("names the refusals: the scope for 42501, the checklist for 22023 and a lost connection", () => {
		expect(checklistErrorKey("forbidden")).toBe(
			"settings.checklists.error.scope",
		);
		expect(checklistErrorKey("invalid")).toBe(
			"settings.checklists.error.invalid",
		);
		expect(checklistErrorKey("network")).toBe("settings.error.network");
		expect(checklistErrorKey(null)).toBeNull();
	});
});
