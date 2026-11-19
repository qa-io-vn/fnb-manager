import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import {
	actionsOf,
	approvalStateOf,
	type RewardFormat,
	readRewardDraft,
	rewardCapOf,
	rewardTextsOf,
	sendsBackToDraft,
	slugOfName,
} from "./reward-fields";
import { RewardForm, type RewardFormProps, resolveItem } from "./reward-form";
import { notReady, readinessOf } from "./reward-rails";
import type { RewardRails, RewardRecord } from "./source";

const TODAY = "2026-11-19";
const PROGRAMME = "11111111-1111-4111-8111-111111111111";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const FORMAT: RewardFormat = {
	formatters: vndFormatters(),
	currencyCode: "VND",
	countryCode: "VN",
	today: TODAY,
};

const SAVED: RewardRecord = {
	id: "22222222-2222-4222-8222-222222222222",
	programmeId: PROGRAMME,
	rewardKey: "giam-20",
	name: "Giảm 20% hóa đơn",
	description: null,
	rewardKind: "percent_off",
	rewardPercent: 20,
	rewardAmount: null,
	rewardItemExternalIds: null,
	excludedItemExternalIds: [],
	costStamps: 0,
	costPoints: 300,
	minBillAmount: 0,
	validFrom: null,
	validUntil: null,
	validDays: 30,
	holdHours: 24,
	perMemberLimit: null,
	storeIds: null,
	status: "approved",
	approval: { at: "2026-11-18T03:00:00Z", by: { kind: "owner" } },
	createdAt: "2026-11-18T01:00:00Z",
	audit: null,
};

const RAILS: RewardRails = {
	rails: [
		{
			storeId: STORE_A,
			rail: "pos_payment_discount",
			activeFrom: "2026-11-01T00:00:00Z",
		},
	],
	mappings: [
		{
			storeId: STORE_A,
			rewardKey: "giam-20",
			posDiscountName: "Ưu đãi 20%",
			posFreeItemExternalId: null,
			crmProgrammeExternalId: null,
			einvoiceDisplay: "discount",
		},
	],
};

const STORES = [
	{ id: STORE_A, name: "Cửa hàng A" },
	{ id: STORE_B, name: "Cửa hàng B" },
];

const OWNER = { canWrite: true, canApprove: true };
const MANAGER = { canWrite: true, canApprove: false };
const VIEWER = { canWrite: false, canApprove: false };

function propsWith(overrides: Partial<RewardFormProps> = {}): RewardFormProps {
	return {
		saved: SAVED,
		defaultProgrammeId: PROGRAMME,
		programmes: [{ id: PROGRAMME, label: "Tích dấu thử" }],
		stores: STORES,
		items: [
			{ externalId: "DR-008-M", name: "Trà sữa truyền thống", sizeLabel: "M" },
			{ externalId: "SN-001", name: "Bánh flan", sizeLabel: null },
		],
		rails: RAILS,
		canWrite: true,
		role: OWNER,
		format: FORMAT,
		timeZone: "Asia/Ho_Chi_Minh",
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onEdit: vi.fn(),
		...overrides,
	};
}

function renderForm(
	overrides: Partial<RewardFormProps> = {},
	language: "vi" | "en" = "vi",
) {
	const props = propsWith(overrides);
	const view = renderWithLanguage(
		<MemoryRouter>
			<RewardForm {...props} />
		</MemoryRouter>,
		language,
	);
	return { props, ...view };
}

function textbox(label: string): HTMLInputElement {
	return screen.getByRole("textbox", { name: label }) as HTMLInputElement;
}

function fieldOf(id: string): HTMLElement {
	const field = document
		.getElementById(id)
		?.closest('[data-testid="settings-field"]');
	if (!(field instanceof HTMLElement)) throw new Error(`no field ${id}`);
	return field;
}

describe("the reward cap", () => {
	it("is the dated 50 % of the rules in force over the reward's dates, with its legal basis", () => {
		expect(rewardCapOf("VN", "2026-12-01", null)).toEqual({
			rate: 0.5,
			basis: {
				instrument: "circular",
				number: "39/2025/TT-BCT",
				articles: [4],
			},
		});
		expect(rewardCapOf("VN", "2025-01-01", "2025-03-31")?.basis.number).toBe(
			"81/2018/NĐ-CP",
		);
		expect(rewardCapOf("XX", "2026-12-01", null)).toBeNull();
	});

	it("refuses a percentage above the cap and an amount above the cap of its minimum bill, and needs that minimum bill", () => {
		const saved = rewardTextsOf(null, FORMAT, PROGRAMME);
		const base = {
			...saved,
			name: "Ưu đãi",
			rewardKey: "uu-dai",
			costStamps: "8",
		};
		const over = readRewardDraft(
			null,
			saved,
			{ ...base, rewardKind: "percent_off", rewardPercent: "60" },
			FORMAT,
		);
		expect(over.issues.rewardPercent).toMatchObject({
			kind: "cap",
			key: "settings.rewards.error.cap",
		});
		expect(over.change).toBeNull();
		const atCap = readRewardDraft(
			null,
			saved,
			{ ...base, rewardKind: "percent_off", rewardPercent: "50" },
			FORMAT,
		);
		expect(atCap.issues).toEqual({});
		expect(atCap.change).toMatchObject({
			rewardKind: "percent_off",
			rewardPercent: 50,
			rewardAmount: null,
			rewardItemExternalIds: null,
			storeIds: null,
			costStamps: 8,
			costPoints: 0,
		});
		const noMinimum = readRewardDraft(
			null,
			saved,
			{ ...base, rewardKind: "amount_off", rewardAmount: "20.000" },
			FORMAT,
		);
		expect(noMinimum.issues.minBillAmount).toEqual({
			kind: "rule",
			key: "settings.rewards.error.minBillRequired",
		});
		const overAmount = readRewardDraft(
			null,
			saved,
			{
				...base,
				rewardKind: "amount_off",
				rewardAmount: "30.000",
				minBillAmount: "50.000",
			},
			FORMAT,
		);
		expect(overAmount.issues.rewardAmount).toMatchObject({
			kind: "cap",
			maxAmount: 25_000,
		});
		const gift = readRewardDraft(
			null,
			saved,
			{ ...base, rewardKind: "free_item", rewardItems: ["DR-008-M"] },
			FORMAT,
		);
		expect(gift.cap).toBeNull();
		expect(gift.change?.rewardItemExternalIds).toEqual(["DR-008-M"]);
	});

	it("checks the other rules of the catalogue before a save", () => {
		const saved = rewardTextsOf(null, FORMAT, PROGRAMME);
		const draft = readRewardDraft(
			null,
			saved,
			{
				...saved,
				name: "Quà",
				rewardKey: "Quà Tặng",
				rewardKind: "free_item",
				costStamps: "0",
				costPoints: "0",
				validFrom: "2026-12-10",
				validUntil: "2026-12-01",
				allStores: false,
				storeIds: [],
				excludedItems: [],
			},
			FORMAT,
		);
		expect(Object.keys(draft.issues).sort()).toEqual([
			"costStamps",
			"rewardItemExternalIds",
			"rewardKey",
			"storeIds",
			"validUntil",
		]);
		const overlap = readRewardDraft(
			null,
			saved,
			{
				...saved,
				name: "Quà",
				rewardKey: "qua",
				costStamps: "5",
				rewardItems: ["SN-001"],
				excludedItems: ["SN-001"],
			},
			FORMAT,
		);
		expect(overlap.issues.excludedItemExternalIds).toEqual({
			kind: "rule",
			key: "settings.rewards.error.itemOverlap",
		});
		expect(slugOfName("Ly trà sữa Đường đen!")).toBe("ly-tra-sua-duong-den");
		expect(resolveItem("Bánh flan", propsWith().items)).toBe("SN-001");
		expect(
			resolveItem("Trà sữa truyền thống M (DR-008-M)", propsWith().items),
		).toBe("DR-008-M");
		expect(resolveItem("POS-999", propsWith().items)).toBe("POS-999");
	});
});

describe("the reward form", () => {
	it("shows the cap refusal next to the percentage and keeps the reward from being saved", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		expect(fieldOf("reward-rewardPercent")).toHaveTextContent(
			"Tối đa 50% giá được giảm (Thông tư 39/2025/TT-BCT, Điều 4).",
		);
		await user.clear(textbox("Mức giảm"));
		await user.type(textbox("Mức giảm"), "60");
		await user.tab();
		expect(
			within(fieldOf("reward-rewardPercent")).getByTestId(
				"settings-field-error",
			),
		).toHaveTextContent(
			"Vượt mức giảm tối đa 50% giá được giảm (Thông tư 39/2025/TT-BCT, Điều 4). Ưu đãi này không lưu được.",
		);
		expect(textbox("Mức giảm")).toHaveAttribute("aria-invalid", "true");
		const saveButton = screen.getByRole("button", { name: "Lưu" });
		expect(saveButton).toHaveAttribute("aria-disabled", "true");
		await user.click(saveButton);
		expect(props.onSave).not.toHaveBeenCalled();
		await user.clear(textbox("Mức giảm"));
		await user.type(textbox("Mức giảm"), "50");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledWith(
			expect.objectContaining({ id: SAVED.id, rewardPercent: 50 }),
		);
	});

	it("offers the four reward kinds only, with no cash-like option, in both languages", () => {
		const { unmount } = renderForm();
		const select = screen.getByRole("combobox", { name: "Loại phần thưởng" });
		const options = within(select)
			.getAllByRole("option")
			.map((option) => option.textContent);
		expect(options).toEqual([
			"Tặng món",
			"Giảm theo phần trăm",
			"Giảm một số tiền",
			"Lên size hoặc thêm topping",
		]);
		for (const text of options) {
			expect(text).not.toMatch(/tiền mặt|nạp|ví|hoàn tiền|cash|top-up|wallet/i);
		}
		expect(fieldOf("reward-rewardKind")).toHaveTextContent(
			"Không có loại trả tiền mặt, nạp tiền hay ví trả trước.",
		);
		unmount();
		renderForm({}, "en");
		const english = within(
			screen.getByRole("combobox", { name: "Reward type" }),
		)
			.getAllByRole("option")
			.map((option) => (option as HTMLOptionElement).value);
		expect(english).toEqual([
			"free_item",
			"percent_off",
			"amount_off",
			"free_upgrade",
		]);
	});

	it("tells a manager that changing the terms of an approved reward sends it back to the owner", async () => {
		const user = userEvent.setup();
		renderForm({ role: MANAGER });
		expect(screen.queryByTestId("reward-back-to-draft")).toBeNull();
		await user.clear(textbox("Tên ưu đãi"));
		await user.type(textbox("Tên ưu đãi"), "Giảm 20% cả hóa đơn");
		expect(screen.queryByTestId("reward-back-to-draft")).toBeNull();
		await user.clear(textbox("Mức giảm"));
		await user.type(textbox("Mức giảm"), "15");
		expect(screen.getByTestId("reward-back-to-draft")).toHaveTextContent(
			"Khi lưu, ưu đãi trở về bản nháp và chờ chủ quán duyệt lại.",
		);
	});

	it("shows each store's rail and mapping, and why activation would be refused", async () => {
		const user = userEvent.setup();
		renderForm();
		const rails = screen.getByTestId("reward-rails");
		expect(within(rails).getAllByTestId("reward-rail-store")).toHaveLength(2);
		expect(rails).toHaveTextContent("Cửa hàng A");
		expect(rails).toHaveTextContent("Chiết khấu: Ưu đãi 20%");
		expect(
			within(rails)
				.getAllByTestId("reward-rail-store")
				.map((row) => row.dataset.gap),
		).toEqual(["none", "noRail"]);
		expect(screen.getByTestId("reward-rails-summary")).toHaveTextContent(
			"1 cửa hàng chưa sẵn sàng nên chưa kích hoạt được.",
		);
		await user.click(screen.getByRole("radio", { name: "Chọn cửa hàng" }));
		await user.click(screen.getByRole("checkbox", { name: "Cửa hàng A" }));
		expect(screen.getByTestId("reward-rails-summary")).toHaveAttribute(
			"data-ready",
			"true",
		);
	});

	it("shows a database refusal next to its field and keeps everything read only for a viewer", () => {
		const { unmount } = renderForm({
			outcome: {
				kind: "refused",
				code: "duplicate",
				field: "rewardKey",
				refusal: "duplicateKey",
			},
		});
		expect(
			within(fieldOf("reward-rewardKey")).getByTestId("settings-field-error"),
		).toHaveTextContent("Chương trình đã có một ưu đãi dùng mã này.");
		unmount();
		renderForm({ canWrite: false, role: VIEWER });
		for (const control of document.querySelectorAll("input, textarea")) {
			expect(control).toHaveAttribute("readonly");
		}
		expect(document.querySelectorAll("select")).toHaveLength(0);
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
	});
});

describe("the approval states", () => {
	it("name who approved a reward, and wait for the owner while it is a draft", () => {
		expect(approvalStateOf({ ...SAVED, status: "draft", approval: null })).toBe(
			"awaitingOwner",
		);
		expect(approvalStateOf(SAVED)).toBe("approvedByOwner");
		expect(
			approvalStateOf({
				...SAVED,
				approval: { at: SAVED.createdAt, by: { kind: "you" } },
			}),
		).toBe("approvedByYou");
		expect(
			approvalStateOf({
				...SAVED,
				approval: { at: SAVED.createdAt, by: { kind: "system" } },
			}),
		).toBe("approvedBySystem");
		expect(approvalStateOf({ ...SAVED, status: "retired" })).toBe("retired");
	});

	it("let only the owner approve, anyone who writes activate, pause or retire, and nobody reopen a retired reward", () => {
		expect(actionsOf("draft", OWNER)).toEqual(["approve", "retire"]);
		expect(actionsOf("draft", MANAGER)).toEqual(["retire"]);
		expect(actionsOf("approved", MANAGER)).toEqual(["activate", "retire"]);
		expect(actionsOf("active", MANAGER)).toEqual(["deactivate", "retire"]);
		expect(actionsOf("retired", OWNER)).toEqual([]);
		expect(actionsOf("approved", VIEWER)).toEqual([]);
		expect(sendsBackToDraft(SAVED, true, MANAGER)).toBe(true);
		expect(sendsBackToDraft(SAVED, true, OWNER)).toBe(false);
		expect(sendsBackToDraft(SAVED, false, MANAGER)).toBe(false);
		expect(sendsBackToDraft({ ...SAVED, status: "draft" }, true, MANAGER)).toBe(
			false,
		);
	});

	it("count a store as ready only with an active rail and this reward's mapping", () => {
		const rows = readinessOf(null, "giam-20", STORES, RAILS);
		expect(notReady(rows).map((row) => [row.storeId, row.gap])).toEqual([
			[STORE_B, "noRail"],
		]);
		expect(
			notReady(readinessOf([STORE_A], "khac", STORES, RAILS)).map(
				(row) => row.gap,
			),
		).toEqual(["noMapping"]);
	});
});
