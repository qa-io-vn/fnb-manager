import {
	DEFAULT_LOYALTY_PARAMETERS,
	LOYALTY_PARAMETER_RANGES,
} from "@fnb/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { LoyaltyProgrammeRecord } from "../../loyalty/source";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import {
	decidedAtOf,
	orderSourcesOf,
	PARAMETER_SPECS,
	type ProgrammeFormat,
	programmeTextsOf,
	readProgrammeDraft,
} from "./programme-fields";
import {
	fieldIdOf,
	LEGAL_PAGE,
	ProgrammeForm,
	type ProgrammeFormProps,
} from "./programme-form";

const TODAY = "2026-11-19";
const TIME_ZONE = "Asia/Ho_Chi_Minh";

const SAVED: LoyaltyProgrammeRecord = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Tích dấu thử",
	startsOn: "2026-12-01",
	endsOn: null,
	rewardBudgetAmount: 20_000_000,
	status: "draft",
	notificationDecision: "pending",
	notificationDecidedAt: null,
	notificationBasis: null,
	parameters: DEFAULT_LOYALTY_PARAMETERS,
	createdAt: "2026-11-18T01:00:00Z",
	audit: { changedAt: "2026-11-18T01:00:00Z", author: { kind: "you" } },
};

const FORMAT: ProgrammeFormat = {
	formatters: vndFormatters(),
	currencyCode: "VND",
	timeZone: TIME_ZONE,
};

function propsWith(
	overrides: Partial<ProgrammeFormProps> = {},
): ProgrammeFormProps {
	return {
		saved: SAVED,
		canWrite: true,
		formatters: vndFormatters(),
		currencyCode: "VND",
		timeZone: TIME_ZONE,
		today: TODAY,
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onEdit: vi.fn(),
		...overrides,
	};
}

function renderForm(
	overrides: Partial<ProgrammeFormProps> = {},
	language: "vi" | "en" = "vi",
) {
	const props = propsWith(overrides);
	const view = renderWithLanguage(
		<MemoryRouter>
			<ProgrammeForm {...props} />
		</MemoryRouter>,
		language,
	);
	return { props, ...view };
}

function textbox(label: string): HTMLInputElement {
	return screen.getByRole("textbox", { name: label }) as HTMLInputElement;
}

function fieldOf(id: string): HTMLElement {
	const input = document.getElementById(id);
	const field = input?.closest('[data-testid="settings-field"]');
	if (!(field instanceof HTMLElement)) throw new Error(`no field ${id}`);
	return field;
}

async function retype(
	user: ReturnType<typeof userEvent.setup>,
	label: string,
	text: string,
) {
	await user.clear(textbox(label));
	if (text !== "") await user.type(textbox(label), text);
	await user.tab();
}

describe("the programme fields", () => {
	it("start a new programme from the defaults of the shared schema", () => {
		const texts = programmeTextsOf(null, FORMAT, TODAY);
		expect(texts).toMatchObject({
			name: "",
			startsOn: TODAY,
			endsOn: "",
			status: "draft",
			notificationDecision: "pending",
			notificationDecidedOn: "",
			excludedOrderSources: "",
		});
		expect(texts.parameters).toMatchObject({
			stampsPerCard: "8",
			stampMinBillAmount: "50.000",
			welcomeStamps: "2",
			pointUnitAmount: "10.000",
			pointValueAmount: "500",
			expectedBreakageRate: "20",
			checkinCodeTtlSeconds: "120",
		});
		const draft = readProgrammeDraft(
			null,
			texts,
			{ ...texts, name: "Chương trình mới" },
			FORMAT,
		);
		expect(draft.issues).toEqual({});
		expect(draft.change).toEqual({
			id: null,
			name: "Chương trình mới",
			startsOn: TODAY,
			endsOn: null,
			rewardBudgetAmount: 0,
			status: "draft",
			notificationDecision: "pending",
			notificationBasis: null,
			notificationDecidedAt: null,
			parameters: DEFAULT_LOYALTY_PARAMETERS,
		});
	});

	it("cover every numeric parameter of the shared ranges once", () => {
		const numeric = Object.keys(LOYALTY_PARAMETER_RANGES).sort();
		expect(PARAMETER_SPECS.map((spec) => spec.field).sort()).toEqual(numeric);
	});

	it("read the breakage rate as a percent and store it as a fraction", () => {
		const texts = programmeTextsOf(SAVED, FORMAT, TODAY);
		const draft = readProgrammeDraft(
			SAVED,
			texts,
			{
				...texts,
				parameters: { ...texts.parameters, expectedBreakageRate: "12,5" },
			},
			FORMAT,
		);
		expect(draft.changed).toEqual(["expectedBreakageRate"]);
		expect(draft.change?.parameters.expectedBreakageRate).toBe(0.125);
	});

	it("keep one order source per non-empty line", () => {
		expect(orderSourcesOf(" GRAB \n\n shopee-food\r\n")).toEqual([
			"GRAB",
			"shopee-food",
		]);
	});

	it("hold the launch: Active with a pending decision is an issue on the status and gives no change", () => {
		const texts = programmeTextsOf(SAVED, FORMAT, TODAY);
		const draft = readProgrammeDraft(
			SAVED,
			texts,
			{ ...texts, status: "active" },
			FORMAT,
		);
		expect(draft.issues.status).toEqual({
			kind: "rule",
			key: "settings.loyalty.hold.refused",
		});
		expect(draft.change).toBeNull();
	});

	it("store the decision date as the start of that day in the tenant's zone, and keep a saved one untouched", () => {
		expect(decidedAtOf(TODAY, TIME_ZONE)).toBe("2026-11-18T17:00:00.000Z");
		const decided: LoyaltyProgrammeRecord = {
			...SAVED,
			notificationDecision: "below_threshold",
			notificationDecidedAt: "2026-11-10T09:30:00Z",
		};
		const texts = programmeTextsOf(decided, FORMAT, TODAY);
		expect(texts.notificationDecidedOn).toBe("2026-11-10");
		const kept = readProgrammeDraft(
			decided,
			texts,
			{ ...texts, name: "Đổi tên" },
			FORMAT,
		);
		expect(kept.change?.notificationDecidedAt).toBe("2026-11-10T09:30:00Z");
		const moved = readProgrammeDraft(
			decided,
			texts,
			{ ...texts, notificationDecidedOn: "2026-11-12" },
			FORMAT,
		);
		expect(moved.change?.notificationDecidedAt).toBe(
			"2026-11-11T17:00:00.000Z",
		);
	});
});

describe("ProgrammeForm", () => {
	it("shows every mechanic parameter with its unit and its default", () => {
		renderForm();
		const rows: [string, string, string | null, string][] = [
			["Số dấu đầy một thẻ", "8", "dấu", "Mặc định: 8 dấu."],
			["Hóa đơn tối thiểu để có dấu", "50.000", "₫", "Mặc định: 50.000"],
			["Dấu tặng khi tham gia", "2", "dấu", "Mặc định: 2 dấu."],
			["Hạn của mỗi dấu", "6", "tháng", "Mặc định: 6 tháng."],
			["Số tiền cho mỗi lần cộng điểm", "10.000", "₫", "Mặc định: 10.000"],
			["Điểm cho mỗi khoản tiền", "1", "điểm", "Mặc định: 1 điểm."],
			["Hạn của điểm", "12", "tháng", "Mặc định: 12 tháng."],
			[
				"Số hóa đơn được tích mỗi ngày cho một số điện thoại",
				"3",
				"hóa đơn/ngày",
				"Mặc định: 3 hóa đơn/ngày.",
			],
			["Số lần gửi hóa đơn mỗi ngày", "3", "lần/ngày", "Mặc định: 3 lần/ngày."],
			["Khớp hóa đơn bán trước check-in", "2", "phút", "Mặc định: 2 phút."],
			["Khớp hóa đơn bán sau check-in", "15", "phút", "Mặc định: 15 phút."],
			["Thời hạn mã check-in", "120", "giây", "Mặc định: 120 giây."],
			["Thời gian chờ hóa đơn của check-in", "24", "giờ", "Mặc định: 24 giờ."],
			["Hạn gửi hóa đơn", "72", "giờ", "Mặc định: 72 giờ."],
			["Giá trị một điểm", "500", "₫", "Mặc định: 500"],
			["Tỷ lệ điểm dự kiến không dùng", "20", "%", "Mặc định: 20%."],
		];
		for (const [label, value, unit, hint] of rows) {
			const input = textbox(label);
			expect(input.value, label).toBe(value);
			const field = within(fieldOf(input.id));
			if (unit !== null) {
				expect(document.getElementById(`${input.id}-unit`)?.textContent).toBe(
					unit,
				);
			}
			expect(
				field.getByText(new RegExp(hint.replace(/[.%]/g, "\\$&"))),
			).toBeTruthy();
		}
		expect(textbox("Tên chương trình").value).toBe("Tích dấu thử");
		expect(textbox("Ngân sách quà tặng").value).toBe("20.000.000");
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Bạn sửa lần cuối",
		);
	});

	it("explains the launch hold and links the decision options to the legal texts", () => {
		renderForm();
		expect(screen.getByTestId("loyalty-hold")).toHaveAttribute(
			"data-held",
			"true",
		);
		expect(screen.getByTestId("loyalty-hold")).toHaveTextContent(
			"Đang giữ chưa ra mắt",
		);
		const options = screen.getByTestId("loyalty-decision-options");
		expect(within(options).getAllByRole("listitem")).toHaveLength(4);
		expect(within(options).getByRole("link")).toHaveAttribute(
			"href",
			LEGAL_PAGE,
		);
		expect(screen.queryByLabelText("Ngày quyết định")).toBeNull();
	});

	it("holds Active while the decision is pending: the hold message shows by the status and nothing is saved", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Trạng thái" }),
			"active",
		);
		expect(fieldOf(fieldIdOf("status"))).toHaveTextContent(
			"Chưa thể chuyển sang Đang chạy khi quyết định thông báo còn chờ",
		);
		const save = screen.getByTestId("settings-save");
		expect(save).toHaveAttribute("aria-disabled", "true");
		await user.click(save);
		expect(props.onSave).not.toHaveBeenCalled();
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			/.+/,
		);
	});

	it("shows the validation messages of the shared rules next to their fields", async () => {
		const user = userEvent.setup();
		renderForm();
		await retype(user, "Số dấu đầy một thẻ", "25");
		expect(fieldOf(fieldIdOf("stampsPerCard"))).toHaveTextContent(
			"Nhập giá trị từ 2 đến 20.",
		);
		await retype(user, "Số dấu đầy một thẻ", "3");
		await retype(user, "Dấu tặng khi tham gia", "3");
		expect(fieldOf(fieldIdOf("welcomeStamps"))).toHaveTextContent(
			"Dấu tặng phải ít hơn số dấu đầy một thẻ.",
		);
		await retype(user, "Tên chương trình", "");
		expect(fieldOf(fieldIdOf("name"))).toHaveTextContent(
			"Ô này không được để trống.",
		);
		const ends = screen.getByLabelText("Ngày kết thúc");
		await user.type(ends, "2026-11-01");
		await user.tab();
		expect(fieldOf(fieldIdOf("endsOn"))).toHaveTextContent(
			"Ngày kết thúc phải từ ngày bắt đầu trở đi.",
		);
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Quyết định" }),
			"not_required",
		);
		expect(fieldOf(fieldIdOf("notificationBasis"))).toHaveTextContent(
			"Ghi căn cứ pháp lý khi chọn Không phải thông báo.",
		);
		expect(screen.getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
	});

	it("saves the whole programme once the decision is recorded, dated today by default", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Quyết định" }),
			"below_threshold",
		);
		expect(screen.getByLabelText("Ngày quyết định")).toHaveValue(TODAY);
		expect(screen.getByTestId("loyalty-hold")).toHaveAttribute(
			"data-held",
			"false",
		);
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Trạng thái" }),
			"active",
		);
		await retype(user, "Số dấu đầy một thẻ", "10");
		await user.type(
			screen.getByRole("textbox", { name: "Nguồn đơn không tích điểm" }),
			"GRAB{enter}SHOPEE",
		);
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"5",
		);
		await user.click(screen.getByTestId("settings-save"));
		expect(props.onSave).toHaveBeenCalledWith({
			id: SAVED.id,
			name: SAVED.name,
			startsOn: SAVED.startsOn,
			endsOn: null,
			rewardBudgetAmount: 20_000_000,
			status: "active",
			notificationDecision: "below_threshold",
			notificationBasis: null,
			notificationDecidedAt: "2026-11-18T17:00:00.000Z",
			parameters: {
				...DEFAULT_LOYALTY_PARAMETERS,
				stampsPerCard: 10,
				excludedOrderSources: ["GRAB", "SHOPEE"],
			},
		});
	});

	it("shows a database refusal next to the refused field", () => {
		renderForm({
			outcome: { kind: "refused", code: "invalid", field: "pointUnitAmount" },
		});
		expect(fieldOf(fieldIdOf("pointUnitAmount"))).toHaveTextContent(
			"Cơ sở dữ liệu không nhận giá trị này",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			/.+/,
		);
	});

	it("shows the refused activation and the other active programme on the status", () => {
		const { unmount } = renderForm({
			outcome: { kind: "refused", code: "invalid", field: "status" },
		});
		expect(fieldOf(fieldIdOf("status"))).toHaveTextContent(
			"Chưa thể chuyển sang Đang chạy",
		);
		unmount();
		renderForm({
			outcome: { kind: "refused", code: "duplicate", field: "status" },
		});
		expect(fieldOf(fieldIdOf("status"))).toHaveTextContent(
			"Đã có một chương trình khác đang chạy",
		);
	});

	it("is read only without the right to write: no save bar and no issues", () => {
		renderForm({ canWrite: false });
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		expect(textbox("Số dấu đầy một thẻ")).toHaveAttribute("readonly");
		expect(textbox("Trạng thái")).toHaveAttribute("readonly");
		expect(textbox("Trạng thái").value).toBe("Bản nháp");
		expect(screen.queryAllByTestId("settings-field-error")).toHaveLength(0);
	});

	it("reads in English with English units", () => {
		renderForm({}, "en");
		expect(textbox("Stamps for a full card").value).toBe("8");
		expect(
			screen.getByText("Default: 6 months.", { exact: false }),
		).toBeTruthy();
		expect(screen.getByTestId("loyalty-hold")).toHaveTextContent(
			"Launch on hold",
		);
	});
});
