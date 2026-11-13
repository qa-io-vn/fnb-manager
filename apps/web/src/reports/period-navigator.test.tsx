import {
	FIRST_CALENDAR_DATE,
	periodContaining,
	type ReportPeriod,
} from "@fnb/reports";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithLanguage, vndFormatters } from "../test/render";
import { DATE_IDLE_COMMIT_MS, PeriodNavigator } from "./period-navigator";

const AS_OF = "2026-11-03";

function show(period: ReportPeriod, onChange = vi.fn()) {
	const view = renderWithLanguage(
		<PeriodNavigator
			period={period}
			asOf={AS_OF}
			formatters={vndFormatters()}
			onChange={onChange}
		/>,
	);
	return { onChange, unmount: view.unmount };
}

function label(): string {
	return screen.getByTestId("period-label").textContent ?? "";
}

describe("PeriodNavigator", () => {
	it("labels each kind of period", () => {
		const day = show(periodContaining("day", "2026-11-01", AS_OF));
		expect(label()).toBe("Chủ Nhật, 01/11/2026");
		day.unmount();
		const week = show(periodContaining("week", AS_OF, AS_OF));
		expect(label()).toBe("Tuần 45 · 02/11/2026–08/11/2026");
		expect(screen.getByTestId("period-through").textContent).toBe(
			"đến hết ngày 03/11/2026",
		);
		week.unmount();
		const month = show(periodContaining("month", "2026-10-15", AS_OF));
		expect(label()).toBe("Tháng 10/2026");
		expect(screen.queryByTestId("period-through")).toBeNull();
		month.unmount();
		show(periodContaining("year", AS_OF, AS_OF));
		expect(label()).toBe("Năm 2026");
	});

	it("steps one period at a time and stops at the as-of period", () => {
		const { onChange } = show(periodContaining("day", AS_OF, AS_OF));
		const next = screen.getByRole("button", { name: "Kỳ sau" });
		expect(next).toHaveAttribute("aria-disabled", "true");
		expect(next).not.toBeDisabled();
		fireEvent.click(next);
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Kỳ trước" }));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ key: "2026-11-02" }),
		);
	});

	it("keeps focus on a step button that reaches the last period", () => {
		show(periodContaining("day", AS_OF, AS_OF));
		const next = screen.getByRole("button", { name: "Kỳ sau" });
		next.focus();
		fireEvent.click(next);
		expect(document.activeElement).toBe(next);
		expect(screen.getByRole("status")).toContainElement(
			screen.getByTestId("period-label"),
		);
	});

	it("stops at the first calendar date", () => {
		show(periodContaining("day", FIRST_CALENDAR_DATE, AS_OF));
		expect(screen.getByRole("button", { name: "Kỳ trước" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
	});

	it("moves to the period of a picked date once the date stops changing", () => {
		vi.useFakeTimers();
		try {
			const { onChange } = show(periodContaining("month", AS_OF, AS_OF));
			const input = screen.getByLabelText("Chọn ngày");
			expect(input).toHaveAttribute("min", FIRST_CALENDAR_DATE);
			expect(input).toHaveAttribute("max", AS_OF);
			fireEvent.focus(input);
			fireEvent.change(input, { target: { value: "2026-09-14" } });
			vi.advanceTimersByTime(DATE_IDLE_COMMIT_MS - 1);
			expect(onChange).not.toHaveBeenCalled();
			fireEvent.change(input, { target: { value: "2026-08-14" } });
			vi.advanceTimersByTime(DATE_IDLE_COMMIT_MS);
			expect(onChange).toHaveBeenCalledTimes(1);
			expect(onChange).toHaveBeenLastCalledWith(
				expect.objectContaining({ kind: "month", key: "2026-08" }),
				{ replace: false },
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("waits for a typed date to be complete and commits on Enter or blur", () => {
		const { onChange } = show(periodContaining("day", AS_OF, AS_OF));
		const input = screen.getByLabelText("Chọn ngày");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "2026-11-25" } });
		fireEvent.blur(input);
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "2026-10-25" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ key: "2026-10-25" }),
			{ replace: false },
		);
		fireEvent.change(input, { target: { value: "2026-10-20" } });
		fireEvent.blur(input);
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ key: "2026-10-20" }),
			{ replace: true },
		);
	});
});
