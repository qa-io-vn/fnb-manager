import {
	FIRST_CALENDAR_DATE,
	type ReportRange,
	rangeOf,
	rangeOfPreset,
	stepRange,
} from "@fnb/reports";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DATE_IDLE_COMMIT_MS } from "../reports/period-navigator";
import { renderWithLanguage, vndFormatters } from "../test/render";
import { RangePicker } from "./range-picker";

const AS_OF = "2026-11-03";
const MAX_DAYS = 400;

function show(range: ReportRange, onChange = vi.fn()) {
	const view = renderWithLanguage(
		<RangePicker
			range={range}
			maxDays={MAX_DAYS}
			formatters={vndFormatters()}
			onChange={onChange}
		/>,
	);
	return { onChange, unmount: view.unmount };
}

describe("RangePicker", () => {
	it("offers the seven presets as one radio group with the current one checked", () => {
		const { onChange } = show(rangeOfPreset("28d", AS_OF));
		const radios = screen.getAllByRole("radio");
		expect(radios).toHaveLength(7);
		expect(screen.getByRole("radio", { name: "4 tuần" })).toBeChecked();
		fireEvent.click(screen.getByRole("radio", { name: "13 tuần" }));
		expect(onChange).toHaveBeenCalledWith(rangeOfPreset("91d", AS_OF));
	});

	it("announces the dates, the day count and the reference politely", () => {
		show(rangeOfPreset("28d", AS_OF));
		const status = screen.getByRole("status");
		expect(status).toHaveAttribute("aria-live", "polite");
		expect(status.textContent).toBe(
			"07/10/2026 – 03/11/2026 · 28 ngày · so với 4 tuần trước",
		);
	});

	it("steps by the range's own length and marks the end it cannot pass", () => {
		const range = rangeOfPreset("28d", AS_OF);
		const { onChange } = show(range);
		const next = screen.getByRole("button", { name: "Khoảng sau" });
		expect(next).toHaveAttribute("aria-disabled", "true");
		expect(next).not.toBeDisabled();
		fireEvent.click(next);
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Khoảng trước" }));
		expect(onChange).toHaveBeenCalledWith(stepRange(range, -1));
	});

	it("stops stepping back at the first calendar date", () => {
		show(rangeOf(FIRST_CALENDAR_DATE, "2023-01-28", AS_OF));
		expect(
			screen.getByRole("button", { name: "Khoảng trước" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("bounds the dates and applies a typed date on Enter or blur", () => {
		const range = rangeOfPreset("28d", AS_OF);
		const { onChange } = show(range);
		const from = screen.getByLabelText("Từ ngày");
		const to = screen.getByLabelText("Đến ngày");
		expect(from).toHaveAttribute("min", FIRST_CALENDAR_DATE);
		expect(from).toHaveAttribute("max", range.to);
		expect(to).toHaveAttribute("min", range.from);
		expect(to).toHaveAttribute("max", AS_OF);
		fireEvent.change(from, { target: { value: "2026-10-01" } });
		fireEvent.keyDown(from, { key: "Enter" });
		expect(onChange).toHaveBeenLastCalledWith(
			rangeOf("2026-10-01", range.to, AS_OF),
		);
		fireEvent.change(to, { target: { value: "2026-10-31" } });
		fireEvent.blur(to);
		expect(onChange).toHaveBeenLastCalledWith(
			rangeOf(range.from, "2026-10-31", AS_OF),
		);
	});

	it("applies a typed date after a pause and ignores a range longer than the theme allows", () => {
		vi.useFakeTimers();
		try {
			const range = rangeOfPreset("28d", AS_OF);
			const { onChange } = show(range);
			const from = screen.getByLabelText("Từ ngày");
			fireEvent.change(from, { target: { value: "2026-09-14" } });
			vi.advanceTimersByTime(DATE_IDLE_COMMIT_MS - 1);
			expect(onChange).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(onChange).toHaveBeenCalledWith(
				rangeOf("2026-09-14", range.to, AS_OF),
			);
			onChange.mockClear();
			fireEvent.change(from, { target: { value: "2025-01-01" } });
			fireEvent.keyDown(from, { key: "Enter" });
			expect(onChange).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
