import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type MessageKey, type MessageParams, translate } from "../../i18n";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import { integerInRange } from "../validation";
import { DateField, readDateDraft } from "./date-field";
import { Field } from "./field";
import { IntegerField, readIntegerDraft } from "./integer-field";
import { dateBound, issueText, numericBound } from "./issue-text";
import {
	formatPercentBound,
	PercentField,
	readPercentDraft,
} from "./percent-field";
import { SelectField } from "./select-field";

function PercentHarness() {
	const [text, setText] = useState("");
	return (
		<PercentField
			id="fee"
			label="Phí thẻ"
			value={text}
			onChange={setText}
			locale="vi-VN"
			testId="percent"
		/>
	);
}

describe("Field", () => {
	it("ties the label, hint and error to the control", () => {
		renderWithLanguage(
			<Field
				id="x"
				label="Số ghế"
				hint="Ghế phục vụ khách."
				error="Nhập một con số."
			>
				{(control) => <input {...control} />}
			</Field>,
		);
		const input = screen.getByRole("textbox", { name: "Số ghế" });
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAccessibleDescription(
			"Ghế phục vụ khách. Nhập một con số.",
		);
	});

	it("leaves a valid control unmarked", () => {
		renderWithLanguage(
			<Field id="x" label="Số ghế">
				{(control) => <input {...control} />}
			</Field>,
		);
		const input = screen.getByRole("textbox", { name: "Số ghế" });
		expect(input).not.toHaveAttribute("aria-invalid");
		expect(input).not.toHaveAttribute("aria-describedby");
	});
});

describe("PercentField", () => {
	it("opens the decimal keyboard and writes a Vietnamese decimal comma on blur", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<PercentHarness />);
		const input = screen.getByTestId("percent");
		expect(input).toHaveAttribute("inputmode", "decimal");
		await user.type(input, "1.1");
		await user.tab();
		expect(input).toHaveValue("1,1");
	});

	it("checks 0 to 20 % with three decimals and writes its bounds as percentages", () => {
		expect(readPercentDraft("1,125", "vi-VN")).toEqual({
			value: 1.125,
			issue: null,
		});
		expect(readPercentDraft("20,001%", "vi-VN").issue).toEqual({
			key: "range",
			min: 0,
			max: 20,
		});
		expect(readPercentDraft("1,1255", "vi-VN").issue).toEqual({
			key: "decimals",
			digits: 3,
		});
		expect(formatPercentBound(20, "vi-VN")).toBe("20%");
		expect(formatPercentBound(0.5, "vi-VN")).toBe("0,5%");
	});
});

describe("IntegerField", () => {
	it("shows its unit and refuses a fraction", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithLanguage(
			<IntegerField
				id="window"
				label="Cửa sổ thực đơn"
				value="28"
				onChange={onChange}
				locale="vi-VN"
				unit="ngày"
			/>,
		);
		const input = screen.getByRole("textbox", { name: "Cửa sổ thực đơn" });
		expect(input).toHaveAttribute("inputmode", "numeric");
		expect(input).toHaveAccessibleDescription("ngày");
		await user.type(input, "5");
		expect(onChange).toHaveBeenLastCalledWith("285");
		const schema = integerInRange(7, 91);
		expect(readIntegerDraft("28", "vi-VN", schema)).toEqual({
			value: 28,
			issue: null,
		});
		expect(readIntegerDraft("7,5", "vi-VN", schema).issue).toEqual({
			key: "integer",
		});
		const seats = integerInRange(0, 5000);
		expect(readIntegerDraft("1,000", "vi-VN", seats)).toEqual({
			value: 1000,
			issue: null,
		});
		expect(readIntegerDraft("1.000", "vi-VN", seats).value).toBe(1000);
	});
});

describe("DateField", () => {
	it("limits the picker to 2023-01-01 through the end of next year", () => {
		renderWithLanguage(
			<DateField
				id="from"
				label="Áp dụng từ"
				value="2026-11-15"
				onChange={() => undefined}
				today="2026-11-15"
			/>,
		);
		const input = screen.getByLabelText("Áp dụng từ");
		expect(input).toHaveAttribute("type", "date");
		expect(input).toHaveAttribute("min", "2023-01-01");
		expect(input).toHaveAttribute("max", "2027-12-31");
		expect(readDateDraft("", "2026-11-15")).toEqual({ key: "required" });
		expect(readDateDraft("", "2026-11-15", { required: false })).toBeNull();
		expect(readDateDraft("2028-01-01", "2026-11-15")?.key).toBe("dateRange");
	});
});

describe("SelectField", () => {
	it("hands back the chosen option's value", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithLanguage(
			<SelectField
				id="role"
				label="Vai trò"
				value=""
				placeholder="Chọn vai trò"
				onChange={onChange}
				options={[
					{ value: "drink", label: "Đồ uống" },
					{ value: "food", label: "Đồ ăn" },
				]}
			/>,
		);
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Vai trò" }),
			"Đồ ăn",
		);
		expect(onChange).toHaveBeenCalledWith("food");
	});

	it("stays focusable but cannot be changed when read-only", () => {
		renderWithLanguage(
			<SelectField
				id="role"
				label="Vai trò"
				value="drink"
				readOnly
				onChange={() => undefined}
				options={[{ value: "drink", label: "Đồ uống" }]}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Vai trò" });
		expect(field).toHaveValue("Đồ uống");
		expect(field).toHaveAttribute("readonly");
		expect(screen.queryByRole("combobox")).toBeNull();
	});
});

describe("issueText", () => {
	it("writes numeric and date bounds in the shop's formats", () => {
		const formatters = vndFormatters();
		const t = (key: MessageKey, params?: MessageParams) =>
			translate("vi", key, params);
		expect(
			issueText(
				t,
				{ key: "range", min: 7, max: 91 },
				numericBound(formatters.count),
			),
		).toBe("Nhập giá trị từ 7 đến 91.");
		expect(
			issueText(
				t,
				{ key: "dateRange", min: "2023-01-01", max: "2027-12-31" },
				dateBound(formatters.date),
			),
		).toBe("Chọn ngày từ 01/01/2023 đến 31/12/2027.");
		expect(issueText(t, { key: "decimals", digits: 3 })).toBe(
			"Chỉ nhập tối đa 3 chữ số sau dấu phẩy.",
		);
		expect(issueText(t, null)).toBeNull();
	});
});
