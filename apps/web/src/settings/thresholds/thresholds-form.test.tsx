import { DEFAULT_REPORT_SETTINGS, type ReportSettings } from "@fnb/reports";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { PREFERENCES_KEY, PreferencesProvider } from "../../state/preferences";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import type { ReportSettingsState } from "../source";
import { DeviceCsvChoice } from "./device-csv-choice";
import { ThresholdsForm, type ThresholdsFormProps } from "./thresholds-form";

const NO_ROW: ReportSettingsState = {
	settings: DEFAULT_REPORT_SETTINGS,
	hasRow: false,
	audit: null,
};

const CUSTOM: ReportSettings = {
	...DEFAULT_REPORT_SETTINGS,
	menuWindowDays: 21,
	cashAbsThreshold: 80_000,
	busyHourRatio: 1.4,
};

const SAVED_ROW: ReportSettingsState = {
	settings: CUSTOM,
	hasRow: true,
	audit: { changedAt: "2026-11-14T17:30:00Z", author: { kind: "you" } },
};

function propsWith(
	overrides: Partial<ThresholdsFormProps> = {},
): ThresholdsFormProps {
	return {
		saved: NO_ROW,
		canWrite: true,
		formatters: vndFormatters(),
		currencyCode: "VND",
		timeZone: "Asia/Ho_Chi_Minh",
		saving: false,
		outcome: { kind: "idle" },
		onSave: vi.fn(),
		onEdit: vi.fn(),
		...overrides,
	};
}

function renderForm(overrides: Partial<ThresholdsFormProps> = {}) {
	const props = propsWith(overrides);
	const view = renderWithLanguage(<ThresholdsForm {...props} />);
	return { props, ...view };
}

function field(label: string): HTMLElement {
	return screen.getByRole("textbox", { name: label });
}

async function retype(
	user: ReturnType<typeof userEvent.setup>,
	label: string,
	text: string,
) {
	await user.clear(field(label));
	await user.type(field(label), text);
	await user.tab();
}

describe("ThresholdsForm", () => {
	it("shows every threshold in its group with the default next to it", () => {
		renderForm();
		const values: [string, string, string][] = [
			["Số ngày xét thực đơn", "28", "Mặc định: 28 ngày."],
			["Ngưỡng bán chạy", "70", "Mặc định: 70%."],
			["Số món tối thiểu mỗi vai trò", "10", "Mặc định: 10 món."],
			["Chênh lệch két theo số tiền", "50.000", "Mặc định: 50.000"],
			["Chênh lệch két theo tỷ lệ", "0,5", "Mặc định: 0,5%."],
			["Số giờ cao điểm", "3", "Mặc định: 3 giờ."],
			["Ngưỡng giờ thấp điểm", "50", "Mặc định: 50%."],
			["Ngưỡng giờ đông", "125", "Mặc định: 125%."],
			["Số tuần trước khuyến mãi", "4", "Mặc định: 4 tuần."],
		];
		for (const [label, value, defaultText] of values) {
			expect(field(label), label).toHaveValue(value);
			expect(
				field(label).getAttribute("aria-describedby"),
				label,
			).not.toBeNull();
			expect(screen.getByTestId("thresholds-form")).toHaveTextContent(
				defaultText,
			);
		}
		expect(
			within(screen.getByTestId("thresholds-group-menu")).getAllByRole(
				"textbox",
			),
		).toHaveLength(3);
		expect(
			within(screen.getByTestId("thresholds-group-cash")).getAllByRole(
				"textbox",
			),
		).toHaveLength(2);
		expect(
			within(screen.getByTestId("thresholds-group-hours")).getAllByRole(
				"textbox",
			),
		).toHaveLength(3);
		expect(
			within(screen.getByTestId("thresholds-group-promotions")).getAllByRole(
				"textbox",
			),
		).toHaveLength(1);
		expect(screen.getByTestId("thresholds-z-fixed")).toHaveTextContent(
			"cố định ở mức 2",
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Đang dùng giá trị mặc định.",
		);
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
	});

	it("refuses a value out of range before anything is saved", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await retype(user, "Số ngày xét thực đơn", "5");
		expect(field("Số ngày xét thực đơn")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập giá trị từ 7 đến 91.",
		);
		expect(screen.getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Sửa các ô đang báo lỗi rồi lưu.",
		);
		await user.click(screen.getByTestId("settings-save"));
		expect(props.onSave).not.toHaveBeenCalled();
	});

	it("waits for the field to lose focus before showing its error or asking for a correction", async () => {
		const user = userEvent.setup();
		renderForm();
		await user.clear(field("Số giờ cao điểm"));
		await user.type(field("Số giờ cao điểm"), "9");
		expect(screen.queryByTestId("settings-field-error")).toBeNull();
		expect(
			screen.getByTestId("settings-save-bar-status"),
		).toBeEmptyDOMElement();
		expect(screen.getByTestId("settings-save")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		await user.tab();
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập giá trị từ 1 đến 6.",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Sửa các ô đang báo lỗi rồi lưu.",
		);
	});

	it("saves only the changed thresholds, as the columns' values", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await retype(user, "Ngưỡng bán chạy", "65");
		await retype(user, "Chênh lệch két theo tỷ lệ", "0,75");
		await retype(user, "Chênh lệch két theo số tiền", "80000");
		expect(field("Chênh lệch két theo số tiền")).toHaveValue("80.000");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"3 thay đổi chưa lưu",
		);
		expect(props.onEdit).toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith({
			menuPopularityFactor: 0.65,
			cashRelThreshold: 0.0075,
			cashAbsThreshold: 80_000,
		});
	});

	it("reads a comma typed as a thousands mark as đồng, never as a fraction", async () => {
		const user = userEvent.setup();
		const { props } = renderForm();
		await retype(user, "Chênh lệch két theo số tiền", "80,000");
		expect(field("Chênh lệch két theo số tiền")).toHaveValue("80.000");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith({
			cashAbsThreshold: 80_000,
		});
	});

	it("restores the defaults as a pending change that is saved like any other", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({ saved: SAVED_ROW });
		expect(field("Số ngày xét thực đơn")).toHaveValue("21");
		expect(field("Ngưỡng giờ đông")).toHaveValue("140");
		await user.click(
			screen.getByRole("button", { name: "Khôi phục mặc định" }),
		);
		expect(field("Số ngày xét thực đơn")).toHaveValue("28");
		expect(field("Chênh lệch két theo số tiền")).toHaveValue("50.000");
		expect(field("Ngưỡng giờ đông")).toHaveValue("125");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"3 thay đổi chưa lưu",
		);
		expect(props.onSave).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenCalledExactlyOnceWith({
			menuWindowDays: 28,
			cashAbsThreshold: 50_000,
			busyHourRatio: 1.25,
		});
	});

	it("saves the promotion weeks of Khuyến mãi and restores them with the others", async () => {
		const user = userEvent.setup();
		const { props } = renderForm({
			saved: { ...SAVED_ROW, settings: { ...CUSTOM, promoPreWeeks: 6 } },
		});
		expect(field("Số tuần trước khuyến mãi")).toHaveValue("6");
		await retype(user, "Số tuần trước khuyến mãi", "9");
		expect(screen.getByTestId("thresholds-form")).toHaveTextContent(
			"Nhập giá trị từ 2 đến 8.",
		);
		await retype(user, "Số tuần trước khuyến mãi", "8");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenLastCalledWith({ promoPreWeeks: 8 });
		await user.click(
			screen.getByRole("button", { name: "Khôi phục mặc định" }),
		);
		expect(field("Số tuần trước khuyến mãi")).toHaveValue("4");
		await user.click(screen.getByRole("button", { name: "Lưu" }));
		expect(props.onSave).toHaveBeenLastCalledWith({
			menuWindowDays: 28,
			cashAbsThreshold: 50_000,
			busyHourRatio: 1.25,
			promoPreWeeks: 4,
		});
	});

	it("has nothing to restore while every field shows its default", () => {
		renderForm();
		expect(screen.getByTestId("settings-restore-defaults")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
	});

	it("discards the pending changes back to the saved values", async () => {
		const user = userEvent.setup();
		renderForm({ saved: SAVED_ROW });
		await retype(user, "Số ngày xét thực đơn", "35");
		await user.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
		expect(field("Số ngày xét thực đơn")).toHaveValue("21");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
	});

	it("shows when the saved row last changed and by whom", () => {
		renderForm({ saved: SAVED_ROW });
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Bạn sửa lần cuối 15/11/2026 lúc 00:30.",
		);
	});

	it("shows what the database holds after a save, even where it differs from what was typed", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await retype(user, "Số giờ cao điểm", "4");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<ThresholdsForm
					{...props}
					saved={{
						settings: {
							...DEFAULT_REPORT_SETTINGS,
							peakHours: 4,
							menuWindowDays: 21,
						},
						hasRow: true,
						audit: SAVED_ROW.audit,
					}}
					outcome={{ kind: "saved" }}
				/>
			</I18nProvider>,
		);
		expect(field("Số giờ cao điểm")).toHaveValue("4");
		expect(field("Số ngày xét thực đơn")).toHaveValue("21");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"Chưa có thay đổi.",
		);
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đã lưu.",
		);
	});

	it("keeps what is being typed when the same saved values arrive again", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderForm();
		await retype(user, "Số giờ cao điểm", "4");
		rerender(
			<I18nProvider language="vi" onLanguageChange={() => undefined}>
				<ThresholdsForm
					{...props}
					saved={{ ...NO_ROW, settings: { ...DEFAULT_REPORT_SETTINGS } }}
				/>
			</I18nProvider>,
		);
		expect(field("Số giờ cao điểm")).toHaveValue("4");
		expect(screen.getByTestId("settings-save-bar-pending")).toHaveTextContent(
			"1 thay đổi chưa lưu",
		);
	});

	it("locks the fields while a save is running, so nothing typed can be lost", () => {
		renderForm({ saving: true });
		for (const input of screen.getAllByRole("textbox")) {
			expect(input).toHaveAttribute("readonly");
		}
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Đang lưu…",
		);
	});

	it("says why a save was refused and marks the field the database named", () => {
		renderForm({
			outcome: {
				kind: "refused",
				code: "invalid",
				constraint: "report_settings_peak_hours_check",
			},
		});
		expect(screen.getByTestId("settings-save-bar-status")).toHaveTextContent(
			"Không lưu được: có giá trị nằm ngoài khoảng cho phép.",
		);
		expect(field("Số giờ cao điểm")).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập giá trị từ 1 đến 6.",
		);
	});

	it("explains at once a stored value the form cannot keep", () => {
		renderForm({
			saved: {
				...SAVED_ROW,
				settings: { ...CUSTOM, cashAbsThreshold: 50_000.5 },
			},
		});
		expect(field("Chênh lệch két theo số tiền")).toHaveValue("50.000,5");
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập số tiền chẵn đồng, không có phần lẻ.",
		);
	});

	it("is read-only, without save or restore controls, for a member who may not write", () => {
		renderForm({ saved: SAVED_ROW, canWrite: false });
		for (const input of screen.getAllByRole("textbox")) {
			expect(input).toHaveAttribute("readonly");
		}
		expect(screen.getAllByRole("textbox")).toHaveLength(9);
		expect(screen.queryByTestId("settings-save-bar")).toBeNull();
		expect(screen.queryByTestId("settings-restore-defaults")).toBeNull();
		expect(screen.getByTestId("settings-audit-line")).toBeInTheDocument();
	});

	it("asks a member who may not write to correct nothing", () => {
		renderForm({
			canWrite: false,
			saved: {
				...SAVED_ROW,
				settings: { ...CUSTOM, cashAbsThreshold: 50_000.5 },
			},
		});
		expect(field("Chênh lệch két theo số tiền")).toHaveValue("50.000,5");
		expect(screen.queryByTestId("settings-field-error")).toBeNull();
		expect(field("Chênh lệch két theo số tiền")).not.toHaveAttribute(
			"aria-invalid",
		);
	});

	it("reads in English", () => {
		renderWithLanguage(<ThresholdsForm {...propsWith()} />, "en");
		expect(field("Menu window")).toHaveValue("28");
		expect(screen.getByTestId("thresholds-form")).toHaveTextContent(
			"Default: 28 days.",
		);
		expect(screen.getByTestId("settings-audit-line")).toHaveTextContent(
			"Using the default values.",
		);
	});
});

describe("DeviceCsvChoice", () => {
	afterEach(() => window.localStorage.clear());

	function renderChoice() {
		return renderWithLanguage(
			<PreferencesProvider>
				<DeviceCsvChoice />
			</PreferencesProvider>,
		);
	}

	it("starts on commas and stores the choice on this device", async () => {
		const user = userEvent.setup();
		const { unmount } = renderChoice();
		expect(
			screen.getByRole("radio", { name: "Dấu phẩy (mặc định)" }),
		).toBeChecked();
		await user.click(
			screen.getByRole("radio", {
				name: "Dấu chấm phẩy cho Excel cài đặt vùng Việt Nam",
			}),
		);
		expect(
			JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}")
				.csvDialect,
		).toBe("semicolon");
		unmount();
		renderChoice();
		expect(
			screen.getByRole("radio", {
				name: "Dấu chấm phẩy cho Excel cài đặt vùng Việt Nam",
			}),
		).toBeChecked();
	});

	it("names the group and says who it applies to", () => {
		renderChoice();
		expect(
			screen.getByRole("region", { name: "Thiết bị này" }),
		).toHaveTextContent("chỉ áp dụng cho thiết bị này và ai cũng chọn được");
		expect(
			screen.getByRole("group", { name: "Định dạng tệp CSV khi tải bảng" }),
		).toHaveAccessibleDescription(/dấu phẩy thập phân/);
	});
});
