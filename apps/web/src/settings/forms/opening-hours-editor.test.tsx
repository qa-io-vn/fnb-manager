import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithLanguage } from "../../test/render";
import {
	issueOf,
	type OpeningHours,
	openingHoursSchema,
	WEEKDAYS,
} from "../validation";
import {
	addSpan,
	changedDays,
	copyDayToOthers,
	DEFAULT_SPAN,
	draftOfOpeningHours,
	MAX_SPANS_PER_DAY,
	type OpeningHoursDraft,
	openingHoursOfDraft,
	removeSpan,
	runsPastMidnight,
	setDayOpen,
	spanIssues,
	updateSpan,
} from "./opening-hours";
import { OpeningHoursEditor } from "./opening-hours-editor";

const SPLIT_AND_OVERNIGHT: OpeningHours = {
	mon: [["07:00", "22:30"]],
	tue: [["07:00", "22:30"]],
	wed: [["07:00", "22:30"]],
	thu: [["07:00", "22:30"]],
	fri: [
		["07:00", "11:00"],
		["16:00", "02:00"],
	],
	sat: [
		["06:30", "11:00"],
		["13:00", "17:00"],
		["18:00", "00:00"],
	],
	sun: [],
};

function writtenHours(draft: OpeningHoursDraft): OpeningHours | null {
	const write = openingHoursOfDraft(draft);
	if (!write.ok) throw new Error(`unwritable draft: ${JSON.stringify(write)}`);
	return write.hours;
}

function expectWritable(draft: OpeningHoursDraft) {
	const hours = writtenHours(draft);
	expect(issueOf(openingHoursSchema, hours, "openingHours")).toBeNull();
	expect(draftOfOpeningHours(hours)).toEqual(draft);
	expect(writtenHours(draftOfOpeningHours(hours))).toEqual(hours);
	return hours;
}

describe("opening hours draft", () => {
	it("reads and writes split and overnight days exactly in the database shape", () => {
		const draft = draftOfOpeningHours(SPLIT_AND_OVERNIGHT);
		expect(expectWritable(draft)).toEqual(SPLIT_AND_OVERNIGHT);
		expect(runsPastMidnight(draft.fri[1] ?? DEFAULT_SPAN)).toBe(true);
		expect(runsPastMidnight(draft.sat[2] ?? DEFAULT_SPAN)).toBe(true);
		expect(runsPastMidnight(draft.mon[0] ?? DEFAULT_SPAN)).toBe(false);
	});

	it("reads unknown hours and missing days as closed and writes unknown back as null", () => {
		for (const hours of [
			null,
			{},
			{ mon: [] },
		] satisfies (OpeningHours | null)[]) {
			const draft = draftOfOpeningHours(hours);
			expect(WEEKDAYS.every((day) => draft[day].length === 0)).toBe(true);
			expect(writtenHours(draft)).toBeNull();
		}
		const partial = draftOfOpeningHours({ sat: [["08:00", "12:00"]] });
		expect(writtenHours(partial)).toEqual({
			mon: [],
			tue: [],
			wed: [],
			thu: [],
			fri: [],
			sat: [["08:00", "12:00"]],
			sun: [],
		});
	});

	it("pads short hours and reads a 24:00 close as a close at midnight", () => {
		const draft = draftOfOpeningHours({ mon: [["7:00", "24:00"]] });
		expect(draft.mon).toEqual([{ open: "07:00", close: "00:00" }]);
		expect(runsPastMidnight(draft.mon[0] ?? DEFAULT_SPAN)).toBe(true);
		expectWritable(draft);
	});

	it("keeps a 24:00 opening as entered and asks for a time the picker can show", () => {
		const draft = draftOfOpeningHours({ mon: [["24:00", "02:00"]] });
		expect(draft.mon).toEqual([{ open: "24:00", close: "02:00" }]);
		expect(openingHoursOfDraft(draft)).toEqual({
			ok: false,
			issues: [{ day: "mon", index: 0, part: "open" }],
		});
	});

	it("opens a closed day with the default span and closes it without spans", () => {
		let draft = draftOfOpeningHours(null);
		draft = setDayOpen(draft, "mon", true);
		expect(draft.mon).toEqual([DEFAULT_SPAN]);
		draft = setDayOpen(draft, "mon", false);
		expect(draft.mon).toEqual([]);
	});

	it("keeps between one and three spans a day", () => {
		let draft = setDayOpen(draftOfOpeningHours(null), "fri", true);
		draft = removeSpan(draft, "fri", 0);
		expect(draft.fri).toHaveLength(1);
		for (let index = 0; index < MAX_SPANS_PER_DAY + 1; index += 1) {
			draft = addSpan(draft, "fri");
		}
		expect(draft.fri).toHaveLength(MAX_SPANS_PER_DAY);
		draft = removeSpan(draft, "fri", 1);
		expect(draft.fri).toHaveLength(MAX_SPANS_PER_DAY - 1);
	});

	it("flags an unfinished span and writes nothing invalid once it is filled", () => {
		let draft = addSpan(
			setDayOpen(draftOfOpeningHours(null), "sat", true),
			"sat",
		);
		const unfinished = [
			{ day: "sat", index: 1, part: "open" },
			{ day: "sat", index: 1, part: "close" },
		];
		expect(spanIssues(draft)).toEqual(unfinished);
		expect(openingHoursOfDraft(draft)).toEqual({
			ok: false,
			issues: unfinished,
		});
		draft = updateSpan(draft, "sat", 1, "open", "17:00");
		draft = updateSpan(draft, "sat", 1, "close", "01:30");
		expect(spanIssues(draft)).toEqual([]);
		expectWritable(draft);
	});

	it("copies a day to every other day", () => {
		const draft = copyDayToOthers(
			draftOfOpeningHours(SPLIT_AND_OVERNIGHT),
			"fri",
		);
		for (const day of WEEKDAYS) {
			expect(draft[day]).toEqual([
				{ open: "07:00", close: "11:00" },
				{ open: "16:00", close: "02:00" },
			]);
		}
		expectWritable(draft);
		expect(
			changedDays(draftOfOpeningHours(SPLIT_AND_OVERNIGHT), draft),
		).toEqual(["mon", "tue", "wed", "thu", "sat", "sun"]);
	});
});

function Harness({ initial }: { initial: OpeningHours | null }) {
	const [draft, setDraft] = useState(draftOfOpeningHours(initial));
	return (
		<>
			<OpeningHoursEditor
				id="hours"
				legend="Giờ mở cửa"
				value={draft}
				onChange={setDraft}
			/>
			<output data-testid="written">
				{JSON.stringify(openingHoursOfDraft(draft))}
			</output>
			<button
				type="button"
				onClick={() => setDraft(draftOfOpeningHours(initial))}
			>
				reset
			</button>
		</>
	);
}

function CopyingHarness() {
	const [draft, setDraft] = useState(
		draftOfOpeningHours({ mon: [["07:00", "22:00"]] }),
	);
	return (
		<OpeningHoursEditor
			id="hours"
			legend="Giờ mở cửa"
			value={draft}
			onChange={(next) => setDraft(structuredClone(next))}
		/>
	);
}

function written(): unknown {
	const write = JSON.parse(
		screen.getByTestId("written").textContent ?? "null",
	) as { ok: boolean; hours?: unknown };
	return write.ok ? write.hours : write;
}

describe("OpeningHoursEditor", () => {
	it("opens a closed day, adds a split span past midnight and writes the database shape", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<Harness initial={null} />);
		const saturday = screen.getByTestId("opening-hours-sat");
		await user.click(
			within(saturday).getByRole("checkbox", { name: "Thứ Bảy, nghỉ cả ngày" }),
		);
		await user.click(
			within(saturday).getByRole("button", {
				name: "Thêm khung giờ cho Thứ Bảy",
			}),
		);
		const open = within(saturday).getByLabelText("Thứ Bảy, giờ mở khung 2");
		const close = within(saturday).getByLabelText("Thứ Bảy, giờ đóng khung 2");
		fireEvent.change(open, { target: { value: "17:00" } });
		fireEvent.change(close, { target: { value: "01:00" } });
		expect(
			within(saturday).getByTestId("opening-hours-overnight"),
		).toHaveTextContent("Đóng sau nửa đêm");
		const hours = written();
		expect(hours).toEqual({
			mon: [],
			tue: [],
			wed: [],
			thu: [],
			fri: [],
			sat: [
				["07:00", "22:00"],
				["17:00", "01:00"],
			],
			sun: [],
		});
		expect(issueOf(openingHoursSchema, hours, "openingHours")).toBeNull();
	});

	it("shows a time error once an emptied field loses focus", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<Harness initial={{ mon: [["07:00", "22:00"]] }} />);
		const open = screen.getByLabelText("Thứ Hai, giờ mở khung 1");
		fireEvent.change(open, { target: { value: "" } });
		expect(screen.queryByText(/Nhập giờ dạng giờ:phút/)).toBeNull();
		await user.click(open);
		await user.tab();
		expect(open).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByText(/Nhập giờ dạng giờ:phút/)).toBeInTheDocument();
	});

	it("forgets a removed span's error and every error after an outside reset", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<Harness initial={{ fri: [["07:00", "11:00"]] }} />);
		const friday = screen.getByTestId("opening-hours-fri");
		await user.click(within(friday).getByTestId("opening-hours-add"));
		await user.click(within(friday).getByLabelText("Thứ Sáu, giờ mở khung 2"));
		await user.tab();
		expect(
			within(friday).getByText(/Nhập giờ dạng giờ:phút/),
		).toBeInTheDocument();
		await user.click(
			within(friday).getByRole("button", { name: "Xóa khung 2 của Thứ Sáu" }),
		);
		await user.click(within(friday).getByTestId("opening-hours-add"));
		expect(within(friday).queryByText(/Nhập giờ dạng giờ:phút/)).toBeNull();
		await user.click(within(friday).getByLabelText("Thứ Sáu, giờ mở khung 2"));
		await user.tab();
		expect(
			within(friday).getByText(/Nhập giờ dạng giờ:phút/),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "reset" }));
		await user.click(within(friday).getByTestId("opening-hours-add"));
		expect(within(friday).queryByText(/Nhập giờ dạng giờ:phút/)).toBeNull();
	});

	it("flags at once a stored time the picker cannot show", () => {
		renderWithLanguage(<Harness initial={{ mon: [["24:00", "02:00"]] }} />);
		const open = screen.getByLabelText("Thứ Hai, giờ mở khung 1");
		expect(open).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByText(/Nhập giờ dạng giờ:phút/)).toBeInTheDocument();
	});

	it("keeps the other spans' errors when one span is removed", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<Harness initial={{ sat: [["07:00", "11:00"]] }} />);
		const saturday = screen.getByTestId("opening-hours-sat");
		const add = within(saturday).getByTestId("opening-hours-add");
		await user.click(add);
		await user.click(add);
		await user.click(
			within(saturday).getByLabelText("Thứ Bảy, giờ mở khung 3"),
		);
		await user.tab();
		await user.click(
			within(saturday).getByRole("button", { name: "Xóa khung 2 của Thứ Bảy" }),
		);
		expect(
			within(saturday).getByLabelText("Thứ Bảy, giờ mở khung 2"),
		).toHaveAttribute("aria-invalid", "true");
	});

	it("keeps its error markers when the page hands back an equal copy", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<CopyingHarness />);
		const monday = screen.getByTestId("opening-hours-mon");
		await user.click(within(monday).getByTestId("opening-hours-add"));
		await user.click(within(monday).getByLabelText("Thứ Hai, giờ mở khung 2"));
		await user.tab();
		fireEvent.change(
			within(monday).getByLabelText("Thứ Hai, giờ đóng khung 1"),
			{
				target: { value: "21:00" },
			},
		);
		expect(
			within(monday).getByLabelText("Thứ Hai, giờ mở khung 2"),
		).toHaveAttribute("aria-invalid", "true");
	});

	it("copies a day to the others and says so", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<Harness initial={SPLIT_AND_OVERNIGHT} />);
		await user.click(
			screen.getByRole("button", { name: "Thứ Sáu: chép sang các ngày khác" }),
		);
		const hours = written() as OpeningHours;
		for (const day of WEEKDAYS) {
			expect(hours[day]).toEqual([
				["07:00", "11:00"],
				["16:00", "02:00"],
			]);
		}
		expect(screen.getByTestId("opening-hours-status")).toHaveTextContent(
			"Đã chép giờ của Thứ Sáu sang các ngày khác.",
		);
	});

	it("stops at three spans and removes one", async () => {
		const user = userEvent.setup();
		renderWithLanguage(<Harness initial={SPLIT_AND_OVERNIGHT} />);
		const saturday = screen.getByTestId("opening-hours-sat");
		expect(within(saturday).getByTestId("opening-hours-add")).toBeDisabled();
		expect(saturday).toHaveTextContent("Tối đa 3 khung mỗi ngày.");
		await user.click(
			within(saturday).getByRole("button", { name: "Xóa khung 2 của Thứ Bảy" }),
		);
		expect((written() as OpeningHours).sat).toEqual([
			["06:30", "11:00"],
			["18:00", "00:00"],
		]);
	});

	it("is read-only without edit actions", () => {
		renderWithLanguage(
			<OpeningHoursEditor
				id="hours"
				legend="Giờ mở cửa"
				value={draftOfOpeningHours(SPLIT_AND_OVERNIGHT)}
				onChange={() => undefined}
				readOnly
			/>,
		);
		expect(screen.queryByTestId("opening-hours-add")).toBeNull();
		expect(screen.queryByTestId("opening-hours-remove")).toBeNull();
		for (const checkbox of screen.getAllByTestId("opening-hours-closed")) {
			expect(checkbox).toBeDisabled();
		}
		for (const input of screen.getAllByTestId("opening-hours-open")) {
			expect(input).toHaveAttribute("readonly");
		}
	});

	it("speaks English", () => {
		renderWithLanguage(
			<OpeningHoursEditor
				id="hours"
				legend="Opening hours"
				value={draftOfOpeningHours({ mon: [["07:00", "22:00"]] })}
				onChange={() => undefined}
			/>,
			"en",
		);
		expect(screen.getByLabelText("Monday, opens, span 1")).toHaveValue("07:00");
		expect(
			screen.getByRole("checkbox", { name: "Sunday, closed all day" }),
		).toBeChecked();
	});
});
