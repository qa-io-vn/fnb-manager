import {
	COMPARATOR_PARAM,
	PROMOTION_PARAM,
	promotionParams,
	type ThemeParamOption,
} from "@fnb/reports";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithLanguage } from "../test/render";
import {
	PARAM_IDLE_COMMIT_MS,
	shownValue,
	type ThemeParamChoice,
	ThemeParamControls,
} from "./theme-param-controls";

function specOf(id: string) {
	const spec = promotionParams.find((entry) => entry.id === id);
	if (spec === undefined) throw new Error(`no parameter ${id}`);
	return spec;
}

const OPTIONS: readonly ThemeParamOption[] = [
	{
		value: "item:KM-01",
		labelKey: "theme.promotions.lift.option",
		labelValues: {
			name: { text: "Mua 2 tặng 1" },
			kind: { key: "report.promotionKind.item" },
		},
	},
	{
		value: "voucher:Giảm 20k",
		labelKey: "theme.promotions.lift.option",
		labelValues: {
			name: { text: "Giảm 20k" },
			kind: { key: "report.promotionKind.voucher" },
		},
	},
	{
		value: "bill:unnamed",
		labelKey: "theme.promotions.lift.optionUnnamed",
		labelValues: { kind: { key: "report.promotionKind.bill" } },
	},
];

function choices(
	promo: ThemeParamChoice["options"],
	values: { promo?: string; cmp?: string } = {},
	comparatorOptions?: readonly ThemeParamOption[],
): ThemeParamChoice[] {
	const comparator = specOf(COMPARATOR_PARAM);
	return [
		{
			spec: specOf(PROMOTION_PARAM),
			options: promo,
			value: values.promo ?? "",
		},
		{
			spec: comparator,
			options: comparatorOptions ?? comparator.options,
			value: values.cmp ?? "baseline",
		},
	];
}

afterEach(() => {
	vi.useRealTimers();
});

describe("ThemeParamControls", () => {
	it("labels a select and a radio group, names each option with its kind, and reports a change by parameter id", () => {
		const onChange = vi.fn();
		renderWithLanguage(
			<ThemeParamControls choices={choices(OPTIONS)} onChange={onChange} />,
		);
		const select = screen.getByRole("combobox", { name: "Chương trình" });
		expect(select).toHaveValue("item:KM-01");
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Mua 2 tặng 1 (Giảm giá món)",
			"Giảm 20k (Voucher)",
			"Giảm giá hóa đơn không tên",
		]);
		fireEvent.change(select, { target: { value: "voucher:Giảm 20k" } });
		fireEvent.blur(select);
		expect(onChange).toHaveBeenLastCalledWith(
			PROMOTION_PARAM,
			"voucher:Giảm 20k",
		);
		const group = screen.getByRole("group", { name: "So với" });
		expect(
			within(group)
				.getAllByRole("radio")
				.map((radio) => radio.getAttribute("value")),
		).toEqual(["baseline", "prior_weeks", "sister_store"]);
		expect(
			within(group).getByRole("radio", { name: "Cùng thứ các tuần trước" }),
		).toBeChecked();
		fireEvent.click(
			within(group).getByRole("radio", {
				name: "Cửa hàng không chạy chương trình",
			}),
		);
		expect(onChange).toHaveBeenLastCalledWith(COMPARATOR_PARAM, "sister_store");
	});

	it("commits a select's choice once, after a pause, on Enter or on leaving it, so stepping through it asks for nothing in between", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		renderWithLanguage(
			<ThemeParamControls choices={choices(OPTIONS)} onChange={onChange} />,
		);
		const select = screen.getByRole("combobox", { name: "Chương trình" });
		fireEvent.change(select, { target: { value: "voucher:Giảm 20k" } });
		fireEvent.change(select, { target: { value: "bill:unnamed" } });
		expect(select).toHaveValue("bill:unnamed");
		act(() => vi.advanceTimersByTime(PARAM_IDLE_COMMIT_MS - 1));
		expect(onChange).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(PROMOTION_PARAM, "bill:unnamed");
		fireEvent.change(select, { target: { value: "voucher:Giảm 20k" } });
		fireEvent.keyDown(select, { key: "Enter" });
		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange).toHaveBeenLastCalledWith(
			PROMOTION_PARAM,
			"voucher:Giảm 20k",
		);
		fireEvent.blur(select);
		act(() => vi.advanceTimersByTime(PARAM_IDLE_COMMIT_MS));
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("does not report the value already shown", () => {
		const onChange = vi.fn();
		renderWithLanguage(
			<ThemeParamControls choices={choices(OPTIONS)} onChange={onChange} />,
		);
		const select = screen.getByRole("combobox", { name: "Chương trình" });
		fireEvent.focus(select);
		fireEvent.blur(select);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("is reachable and operable by keyboard", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithLanguage(
			<ThemeParamControls
				choices={choices(OPTIONS, { cmp: "prior_weeks" })}
				onChange={onChange}
			/>,
		);
		await user.tab();
		expect(document.activeElement).toBe(
			screen.getByRole("combobox", { name: "Chương trình" }),
		);
		await user.tab();
		expect(document.activeElement).toBe(
			screen.getByRole("radio", { name: "Các tuần trước chương trình" }),
		);
		await user.keyboard("{ArrowRight}");
		expect(onChange).toHaveBeenLastCalledWith(COMPARATOR_PARAM, "sister_store");
	});

	it("shows the chosen value when it is offered and enabled, and the first enabled option otherwise", () => {
		expect(shownValue("voucher:Giảm 20k", OPTIONS)).toBe("voucher:Giảm 20k");
		expect(shownValue("bill:gone", OPTIONS)).toBe("item:KM-01");
		expect(shownValue("", [])).toBe("");
		const firstDisabled = OPTIONS.map((option, index) =>
			index === 0 ? { ...option, disabled: true } : option,
		);
		expect(shownValue("item:KM-01", firstDisabled)).toBe("voucher:Giảm 20k");
		renderWithLanguage(
			<ThemeParamControls
				choices={choices(OPTIONS, { promo: "voucher:Giảm 20k" })}
				onChange={() => undefined}
			/>,
		);
		expect(screen.getByRole("combobox", { name: "Chương trình" })).toHaveValue(
			"voucher:Giảm 20k",
		);
	});

	it("disables an option the theme disables", () => {
		const comparator = specOf(COMPARATOR_PARAM);
		renderWithLanguage(
			<ThemeParamControls
				choices={choices(
					OPTIONS,
					{},
					comparator.options.map((option) =>
						option.value === "sister_store"
							? { ...option, disabled: true }
							: option,
					),
				)}
				onChange={() => undefined}
			/>,
		);
		expect(
			screen.getByRole("radio", { name: "Cửa hàng không chạy chương trình" }),
		).toBeDisabled();
		expect(
			screen.getByRole("radio", { name: "Cùng thứ các tuần trước" }),
		).toBeEnabled();
	});

	it("disables the select while its options load and leaves it out when there is none", () => {
		const { unmount } = renderWithLanguage(
			<ThemeParamControls choices={choices(null)} onChange={() => undefined} />,
		);
		const loading = screen.getByRole("combobox", { name: "Chương trình" });
		expect(loading).toBeDisabled();
		expect(loading).toHaveTextContent("Đang tải");
		unmount();
		renderWithLanguage(
			<ThemeParamControls choices={choices([])} onChange={() => undefined} />,
		);
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.getByRole("group", { name: "So với" })).toBeInTheDocument();
	});

	it("takes the focus back when it reappears after a change, unless the reader has moved on", () => {
		const { unmount } = renderWithLanguage(
			<ThemeParamControls
				choices={choices(OPTIONS, { cmp: "sister_store" })}
				focusParam={COMPARATOR_PARAM}
				onChange={() => undefined}
			/>,
		);
		expect(document.activeElement).toBe(
			screen.getByRole("radio", { name: "Cửa hàng không chạy chương trình" }),
		);
		unmount();
		const elsewhere = document.createElement("button");
		document.body.append(elsewhere);
		elsewhere.focus();
		renderWithLanguage(
			<ThemeParamControls
				choices={choices(OPTIONS)}
				focusParam={PROMOTION_PARAM}
				onChange={() => undefined}
			/>,
		);
		expect(document.activeElement).toBe(elsewhere);
		elsewhere.remove();
	});

	it("renders nothing without parameters and in English for an English reader", () => {
		const { container, unmount } = renderWithLanguage(
			<ThemeParamControls choices={[]} onChange={() => undefined} />,
		);
		expect(container).toBeEmptyDOMElement();
		unmount();
		renderWithLanguage(
			<ThemeParamControls
				choices={choices(OPTIONS)}
				onChange={() => undefined}
			/>,
			"en",
		);
		const select = screen.getByRole("combobox", { name: "Promotion" });
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Mua 2 tặng 1 (Item discount)",
			"Giảm 20k (Voucher)",
			"Bill discount, unnamed",
		]);
		expect(
			screen.getByRole("radio", { name: "A store that did not run it" }),
		).toBeInTheDocument();
	});
});
