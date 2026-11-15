import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useT } from "../../i18n";
import { createFormatters, type Formatters } from "../../lib/format";
import { renderWithLanguage, vndFormatters } from "../../test/render";
import { wholeMoney } from "../validation";
import { issueText, numericBound } from "./issue-text";
import { formatMoneyText, MoneyField, readMoneyDraft } from "./money-field";

function MoneyHarness({
	initial,
	formatters,
}: {
	initial: string;
	formatters: Formatters;
}) {
	const t = useT();
	const [text, setText] = useState(initial);
	const [touched, setTouched] = useState(false);
	const draft = readMoneyDraft(text, formatters, "VND", {
		schema: wholeMoney({ max: 10_000_000 }),
	});
	return (
		<>
			<MoneyField
				id="cash"
				label="Chênh lệch két"
				hint="Từ mức này trở lên thì báo."
				value={text}
				onChange={setText}
				onBlur={() => setTouched(true)}
				error={
					touched
						? issueText(t, draft.issue, numericBound(formatters.moneyExact))
						: null
				}
				formatters={formatters}
				currencyCode="VND"
				testId="money"
			/>
			<output data-testid="value">{String(draft.value)}</output>
		</>
	);
}

describe("MoneyField", () => {
	it("shows the Vietnamese grouping on blur and keeps the đồng value", async () => {
		const user = userEvent.setup();
		renderWithLanguage(
			<MoneyHarness initial="" formatters={vndFormatters()} />,
		);
		const input = screen.getByTestId("money");
		await user.type(input, "50000");
		expect(screen.getByTestId("value")).toHaveTextContent("50000");
		await user.tab();
		expect(input).toHaveValue("50.000");
		expect(screen.getByTestId("value")).toHaveTextContent("50000");
		expect(screen.queryByTestId("settings-field-error")).toBeNull();
	});

	it("opens the numeric keyboard and names its unit for screen readers", () => {
		renderWithLanguage(
			<MoneyHarness initial="50.000" formatters={vndFormatters()} />,
		);
		const input = screen.getByRole("textbox", { name: "Chênh lệch két" });
		expect(input).toHaveAttribute("inputmode", "numeric");
		expect(input).toHaveAccessibleDescription("₫ Từ mức này trở lên thì báo.");
	});

	it("reads the ways đồng are written in Vietnam", () => {
		const formatters = vndFormatters();
		for (const text of [
			"50.000",
			"50000",
			"50.000 ₫",
			"50.000đ",
			"50.000 VNĐ",
			"50 000",
		]) {
			expect(readMoneyDraft(text, formatters, "VND").value, text).toBe(50_000);
		}
	});

	it("reads a comma typed as a thousands mark as đồng, not as a fraction of 80", async () => {
		const user = userEvent.setup();
		renderWithLanguage(
			<MoneyHarness initial="" formatters={vndFormatters()} />,
		);
		const input = screen.getByTestId("money");
		await user.type(input, "80,000");
		expect(screen.getByTestId("value")).toHaveTextContent("80000");
		await user.tab();
		expect(input).toHaveValue("80.000");
		expect(screen.queryByTestId("settings-field-error")).toBeNull();
	});

	it("refuses a fraction of a đồng without rounding it away", async () => {
		const user = userEvent.setup();
		renderWithLanguage(
			<MoneyHarness initial="" formatters={vndFormatters()} />,
		);
		const input = screen.getByTestId("money");
		await user.type(input, "50.000,5");
		await user.tab();
		expect(input).toHaveValue("50.000,5");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			"Nhập số tiền chẵn đồng, không có phần lẻ.",
		);
	});

	it("writes the bound of a range in money format", async () => {
		const user = userEvent.setup();
		renderWithLanguage(
			<MoneyHarness initial="" formatters={vndFormatters()} />,
		);
		await user.type(screen.getByTestId("money"), "20000000");
		await user.tab();
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			/Nhập giá trị không quá 10\.000\.000\s₫\./,
		);
	});

	it("asks for a value when left empty", async () => {
		const user = userEvent.setup();
		renderWithLanguage(
			<MoneyHarness initial="" formatters={vndFormatters()} />,
		);
		await user.click(screen.getByTestId("money"));
		await user.tab();
		expect(screen.getByTestId("settings-field-error")).toHaveTextContent(
			"Ô này không được để trống.",
		);
	});

	it("formats money in the Vietnamese way in the English interface too", () => {
		expect(formatMoneyText(1_250_000, vndFormatters("en-GB"))).toBe(
			"1.250.000",
		);
	});

	it("keeps cents for a currency that has them", () => {
		const dollars = createFormatters({
			currencyCode: "USD",
			uiLocale: "en-GB",
			timeZone: "America/New_York",
			unitLabels: { million: "m", billion: "bn" },
		});
		expect(readMoneyDraft("12.50", dollars, "USD")).toEqual({
			value: 12.5,
			issue: null,
		});
		expect(readMoneyDraft("$1,250.75", dollars, "USD").value).toBe(1250.75);
		expect(readMoneyDraft("12.505", dollars, "USD").issue).toEqual({
			key: "decimals",
			digits: 2,
		});
	});

	it("refuses a point that cannot be thousands grouping instead of guessing", () => {
		const formatters = vndFormatters();
		expect(readMoneyDraft("10.0000", formatters, "VND").issue).toEqual({
			key: "number",
		});
		expect(readMoneyDraft("0.500", formatters, "VND").issue).toEqual({
			key: "number",
		});
	});

	it("shows a stored amount with cents as it is instead of rounding it", () => {
		const formatters = vndFormatters();
		const text = formatMoneyText(50_000.5, formatters);
		expect(text).toBe("50.000,5");
		expect(readMoneyDraft(text, formatters, "VND").issue).toEqual({
			key: "wholeMoney",
		});
	});
});
