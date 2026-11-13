import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { defaultPeriod, type Period, rangeOf } from "../lib/period";
import { renderWithLanguage, vndFormatters } from "../test/render";
import { PeriodPicker, periodSummary } from "./period-picker";

function renderPicker(initial: Period) {
	const changes: Period[] = [];
	const view = renderWithLanguage(
		<PeriodPicker
			period={initial}
			onChange={(period) => changes.push(period)}
			formatDate={vndFormatters().date}
		/>,
	);
	return { changes, view };
}

describe("period ranges", () => {
	const anchor = "2026-11-05";
	const base = defaultPeriod(anchor);
	it("covers a day, an ISO week, a month and a year", () => {
		expect(rangeOf({ ...base, kind: "day" })).toEqual({
			from: anchor,
			to: anchor,
		});
		expect(rangeOf({ ...base, kind: "week" })).toEqual({
			from: "2026-11-02",
			to: "2026-11-08",
		});
		expect(rangeOf({ ...base, kind: "month" })).toEqual({
			from: "2026-11-01",
			to: "2026-11-30",
		});
		expect(rangeOf({ ...base, kind: "year" })).toEqual({
			from: "2026-01-01",
			to: "2026-12-31",
		});
		expect(rangeOf({ ...base, kind: "month", anchor: "2028-02-10" })).toEqual({
			from: "2028-02-01",
			to: "2028-02-29",
		});
	});

	it("orders a custom range", () => {
		expect(
			rangeOf({
				...base,
				kind: "custom",
				custom: { from: "2026-11-09", to: "2026-11-01" },
			}),
		).toEqual({
			from: "2026-11-01",
			to: "2026-11-09",
		});
	});
});

describe("PeriodPicker", () => {
	it("offers the five period kinds in Vietnamese", () => {
		renderPicker(defaultPeriod("2026-11-05"));
		const options = screen
			.getAllByRole("option")
			.map((option) => option.textContent);
		expect(options).toEqual(["Ngày", "Tuần", "Tháng", "Năm", "Tùy chọn"]);
	});

	it("shows the range of the chosen period as dd/MM/yyyy", () => {
		renderPicker({ ...defaultPeriod("2026-11-05"), kind: "week" });
		expect(screen.getByTestId("period-range").textContent).toBe(
			"02/11/2026 – 08/11/2026",
		);
	});

	it("does not repeat the date of a single-day period", () => {
		renderPicker(defaultPeriod("2026-11-05"));
		expect(screen.queryByTestId("period-range")).toBeNull();
	});

	it("summarises the period for the phone scope button", () => {
		const t = (
			key: Parameters<typeof translate>[1],
			params?: Record<string, string | number>,
		) => translate("vi", key, params);
		const formatDate = vndFormatters().date;
		expect(periodSummary(defaultPeriod("2026-11-05"), t, formatDate)).toBe(
			"Ngày 05/11/2026",
		);
		expect(
			periodSummary(
				{ ...defaultPeriod("2026-11-05"), kind: "week" },
				t,
				formatDate,
			),
		).toBe("Tuần 02/11/2026 – 08/11/2026");
	});

	it("reports a kind change and an anchor date change", () => {
		const { changes } = renderPicker(defaultPeriod("2026-11-05"));
		fireEvent.change(screen.getByLabelText("Kỳ"), {
			target: { value: "month" },
		});
		fireEvent.change(screen.getByLabelText("Ngày"), {
			target: { value: "2026-10-15" },
		});
		expect(changes.map((change) => [change.kind, change.anchor])).toEqual([
			["month", "2026-11-05"],
			["day", "2026-10-15"],
		]);
	});

	it("shows from and to inputs for a custom period and ignores invalid dates", () => {
		const { changes } = renderPicker({
			...defaultPeriod("2026-11-05"),
			kind: "custom",
		});
		fireEvent.change(screen.getByLabelText("Từ ngày"), {
			target: { value: "2026-10-01" },
		});
		fireEvent.change(screen.getByLabelText("Đến ngày"), {
			target: { value: "" },
		});
		expect(changes).toHaveLength(1);
		expect(changes[0]?.custom).toEqual({
			from: "2026-10-01",
			to: "2026-11-05",
		});
	});
});
