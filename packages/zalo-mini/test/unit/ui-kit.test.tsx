import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ChipGroup,
	kitButton,
	OptionPills,
	StatusPill,
	Stepper,
	StickyActionBar,
	TOAST_MS,
	Toast,
} from "../../src/react/ui-kit/index";

// Test design (ISTQB) for the component kit (design spec 3.3):
// - Stepper: boundary values at the smallest value, the one above it, the one below the largest and the largest, and a
//   decision table of the minus (at the smallest value x a way to remove given or not);
// - OptionPills: partitions of one choice and several, and the state transition of choosing and un-choosing;
// - ChipGroup: pressed and idle, each tone, a selection that moves;
// - Toast: a state transition over time (shown, shown after 3.999 s, gone after 4 s), the callback once, a timer that is
//   cancelled when the toast goes away early;
// - security: a label with markup is drawn as text, never as markup;
// - the button classes never use an opacity, and every disabled state is the sunken fill with the muted ink.

const SIZES = [
	{ value: "m", label: "Vừa" },
	{ value: "l", label: "Lớn", note: "+5.000đ" },
] as const;

const CHIPS = [
	{ key: "coffee", label: "Cà phê", tone: 1 },
	{ key: "tea", label: "Trà", tone: 2 },
	{ key: "cake", label: "Bánh", tone: 3 },
	{ key: "other", label: "Khác", tone: 4 },
	{ key: "plain", label: "Chung" },
] as const;

function StepperHarness({
	start,
	min = 1,
	max = 20,
	onRemove,
}: {
	start: number;
	min?: number;
	max?: number;
	onRemove?: () => void;
}) {
	const [value, setValue] = useState(start);
	return (
		<Stepper
			value={value}
			min={min}
			max={max}
			onChange={setValue}
			{...(onRemove === undefined ? {} : { onRemove })}
			decreaseLabel="Bớt một"
			increaseLabel="Thêm một"
			removeLabel="Bỏ món"
			testId="qty"
		/>
	);
}

function Single() {
	const [size, setSize] = useState<"m" | "l" | null>("m");
	return (
		<OptionPills
			legend="Cỡ ly"
			name="size"
			options={SIZES}
			value={size}
			onChange={setSize}
		/>
	);
}

function Multiple() {
	const [picked, setPicked] = useState<readonly string[]>([]);
	return (
		<OptionPills
			legend="Thêm"
			name="extra"
			multiple
			options={[
				{ value: "pearl", label: "Trân châu" },
				{ value: "foam", label: "Kem cheese" },
			]}
			value={picked}
			onChange={setPicked}
		/>
	);
}

function ChipHarness({ start }: { start: string }) {
	const [selected, setSelected] = useState(start);
	return (
		<ChipGroup
			label="Nhóm món"
			chips={CHIPS}
			selected={selected}
			onSelect={setSelected}
		/>
	);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Stepper", () => {
	const count = () => screen.getByTestId("qty-count").textContent;

	it("counts up and down inside its bounds and says the count in a live region", () => {
		render(<StepperHarness start={2} />);
		expect(count()).toBe("2");
		expect(screen.getByTestId("qty-count").getAttribute("aria-live")).toBe(
			"polite",
		);
		fireEvent.click(screen.getByRole("button", { name: "Thêm một" }));
		expect(count()).toBe("3");
		fireEvent.click(screen.getByRole("button", { name: "Bớt một" }));
		fireEvent.click(screen.getByRole("button", { name: "Bớt một" }));
		expect(count()).toBe("1");
	});

	it("stops the minus at the smallest value when nothing can remove the line, and says so by disabling it", () => {
		render(<StepperHarness start={1} />);
		const minus = screen.getByRole("button", { name: "Bớt một" });
		expect((minus as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(minus);
		expect(count()).toBe("1");
	});

	it("turns the minus into a bin at the smallest value when a way to remove is given, and calls it", () => {
		const onRemove = vi.fn();
		render(<StepperHarness start={1} onRemove={onRemove} />);
		const bin = screen.getByRole("button", { name: "Bỏ món" });
		expect((bin as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(bin);
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(count()).toBe("1");
	});

	it("is a minus again one above the smallest value, bin or not", () => {
		render(<StepperHarness start={2} onRemove={() => undefined} />);
		expect(screen.queryByRole("button", { name: "Bỏ món" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Bớt một" }));
		expect(count()).toBe("1");
		expect(screen.getByRole("button", { name: "Bỏ món" })).toBeTruthy();
	});

	it("stops the plus at the largest value (boundary: 19, 20)", () => {
		render(<StepperHarness start={19} max={20} />);
		const plus = screen.getByRole("button", { name: "Thêm một" });
		expect((plus as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(plus);
		expect(count()).toBe("20");
		expect((plus as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(plus);
		expect(count()).toBe("20");
	});

	it("has a 44 px target around each button and never draws a disabled button with an opacity", () => {
		const { container } = render(<StepperHarness start={1} max={1} />);
		for (const button of container.querySelectorAll("button")) {
			expect(button.className).toContain("size-11");
			expect(button.className).not.toMatch(/opacity/);
			expect(button.innerHTML).not.toMatch(/opacity/);
		}
		// both buttons are disabled here: the sunken fill and the muted ink say so
		expect(container.innerHTML).toContain("bg-surface-sunken");
		expect(container.innerHTML).toContain("text-ink-muted");
	});

	it("hides the glyphs from assistive technology and names the buttons by their labels", () => {
		render(<StepperHarness start={3} />);
		expect(
			screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")),
		).toEqual(["Bớt một", "Thêm một"]);
	});
});

describe("OptionPills", () => {
	it("is a group named by its legend, with a radio for each option and the chosen one checked", () => {
		render(<Single />);
		expect(screen.getByRole("group", { name: "Cỡ ly" })).toBeTruthy();
		const radios = screen.getAllByRole("radio") as HTMLInputElement[];
		expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
		expect(radios.map((radio) => radio.value)).toEqual(["m", "l"]);
	});

	it("moves the choice, and shows a check mark on the chosen pill only (not colour alone)", () => {
		const { container } = render(<Single />);
		const selected = () =>
			[...container.querySelectorAll("label")].map((label) =>
				label.querySelector("svg") !== null ? label.textContent : null,
			);
		expect(selected()).toEqual(["Vừa", null]);
		fireEvent.click(screen.getByRole("radio", { name: /Lớn/ }));
		expect(selected()).toEqual([null, "Lớn+5.000đ"]);
		expect(
			[...container.querySelectorAll("label")].map((label) =>
				label.getAttribute("data-selected"),
			),
		).toEqual(["false", "true"]);
	});

	it("takes several choices with checkboxes and lets each be un-chosen", () => {
		render(<Multiple />);
		const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
		fireEvent.click(boxes[0] as HTMLInputElement);
		fireEvent.click(boxes[1] as HTMLInputElement);
		expect(boxes.map((box) => box.checked)).toEqual([true, true]);
		fireEvent.click(boxes[0] as HTMLInputElement);
		expect(boxes.map((box) => box.checked)).toEqual([false, true]);
	});

	it("draws no choice as chosen when the value is null, and shows a note inside its pill", () => {
		render(
			<OptionPills
				legend="Đá"
				name="ice"
				options={SIZES}
				value={null}
				onChange={() => undefined}
			/>,
		);
		expect(
			(screen.getAllByRole("radio") as HTMLInputElement[]).some(
				(r) => r.checked,
			),
		).toBe(false);
		expect(screen.getByText("+5.000đ")).toBeTruthy();
	});

	it("draws an option label with markup as text", () => {
		const { container } = render(
			<OptionPills
				legend="x"
				name="x"
				options={[{ value: "a", label: "<img src=x onerror=alert(1)>" }]}
				value={null}
				onChange={() => undefined}
			/>,
		);
		expect(container.querySelector("img")).toBeNull();
		expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
	});
});

describe("ChipGroup", () => {
	it("is a group of buttons, each saying whether it is pressed", () => {
		render(<ChipHarness start="tea" />);
		expect(screen.getByRole("group", { name: "Nhóm món" })).toBeTruthy();
		expect(
			screen
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-pressed")),
		).toEqual(["false", "true", "false", "false", "false"]);
	});

	it.each([
		["coffee", "bg-tone-1 text-tone-1-ink"],
		["tea", "bg-tone-2 text-tone-2-ink"],
		["cake", "bg-tone-3 text-tone-3-ink"],
		["other", "bg-tone-4 text-tone-4-ink"],
		["plain", "bg-accent text-accent-ink"],
	])("fills the pressed %s chip with %s", (key, classes) => {
		render(<ChipHarness start={key} />);
		const pressed = screen
			.getAllByRole("button")
			.find((button) => button.getAttribute("aria-pressed") === "true");
		for (const name of classes.split(" ")) {
			expect(pressed?.className).toContain(name);
		}
	});

	it("moves the pressed chip when another is chosen, and draws an idle chip with an outline on a card", () => {
		render(<ChipHarness start="coffee" />);
		fireEvent.click(screen.getByRole("button", { name: "Bánh" }));
		const pressed = screen
			.getAllByRole("button")
			.filter((button) => button.getAttribute("aria-pressed") === "true");
		expect(pressed.map((button) => button.textContent)).toEqual(["Bánh"]);
		const idle = screen.getByRole("button", { name: "Trà" });
		expect(idle.className).toContain("border-outline");
		expect(idle.className).toContain("bg-surface-raised");
		expect(idle.className).not.toMatch(/opacity/);
	});

	it("hides a leading picture from assistive technology and keeps the chip's name its label", () => {
		render(
			<ChipGroup
				label="Nhóm"
				chips={[{ key: "a", label: "Món", leading: <svg data-testid="pic" /> }]}
				selected="a"
				onSelect={() => undefined}
			/>,
		);
		expect(
			screen.getByTestId("pic").parentElement?.getAttribute("aria-hidden"),
		).toBe("true");
		expect(screen.getByRole("button", { name: "Món" })).toBeTruthy();
	});
});

describe("StatusPill, StickyActionBar and the button classes", () => {
	it.each([
		["badge", "bg-badge text-badge-ink"],
		["positive", "bg-positive-soft text-ink"],
		["negative", "bg-negative-soft text-ink"],
		["warning", "bg-warning-soft text-ink"],
		["neutral", "bg-neutral-soft text-ink"],
	] as const)("draws a %s pill with %s and says its word", (tone, classes) => {
		render(
			<StatusPill tone={tone} testId="pill">
				Đã xong
			</StatusPill>,
		);
		const pill = screen.getByTestId("pill");
		expect(pill.textContent).toBe("Đã xong");
		expect(pill.getAttribute("data-tone")).toBe(tone);
		for (const name of classes.split(" "))
			expect(pill.className).toContain(name);
	});

	it("marks the action bar so the shell can count the bars on screen", () => {
		render(<StickyActionBar testId="bar">Gửi</StickyActionBar>);
		const bar = screen.getByTestId("bar");
		expect(bar.getAttribute("data-bottom-bar")).toBe("action");
		expect(bar.className).toContain("sticky");
		expect(bar.className).toContain("bottom-0");
	});

	it("draws every button variant without an opacity, and every disabled one in the sunken fill and the muted ink", () => {
		for (const [name, classes] of Object.entries(kitButton)) {
			expect(classes, name).not.toMatch(/\bopacity|disabled:opacity/);
			expect(classes, name).toContain("disabled:text-ink-muted");
			if (name !== "quiet") {
				expect(classes, name).toContain("disabled:bg-surface-sunken");
				expect(classes, name).toContain("min-h-12");
			}
		}
	});

	it("reads only roles and tokens (no colour value and no fixed radius)", () => {
		for (const [name, classes] of Object.entries(kitButton)) {
			expect(classes, name).not.toMatch(
				/#[0-9a-fA-F]{3,6}\b|rgb\(|rounded-(?:xl|2xl|3xl|full)\b/,
			);
			expect(classes, name).toContain("rounded-control");
		}
	});
});

describe("Toast", () => {
	it("is a polite status that is gone after four seconds, once", () => {
		vi.useFakeTimers();
		const onDone = vi.fn();
		render(<Toast message="Đã thêm Bạc xỉu." onDone={onDone} testId="toast" />);
		const toast = screen.getByTestId("toast");
		expect(toast.getAttribute("role")).toBe("status");
		expect(toast.getAttribute("aria-live")).toBe("polite");
		expect(toast.textContent).toBe("Đã thêm Bạc xỉu.");
		act(() => {
			vi.advanceTimersByTime(TOAST_MS - 1);
		});
		expect(onDone).not.toHaveBeenCalled();
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(onDone).toHaveBeenCalledTimes(1);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it("keeps its timer out of the way when it goes early, and honours another duration", () => {
		vi.useFakeTimers();
		const onDone = vi.fn();
		const { unmount } = render(
			<Toast message="x" onDone={onDone} durationMs={500} />,
		);
		act(() => {
			vi.advanceTimersByTime(499);
		});
		unmount();
		act(() => {
			vi.advanceTimersByTime(5_000);
		});
		expect(onDone).not.toHaveBeenCalled();
	});

	it("draws a message with markup as text and floats above the bars", () => {
		const { container } = render(
			<Toast message="<b>hi</b>" onDone={() => undefined} testId="toast" />,
		);
		expect(container.querySelector("b")).toBeNull();
		expect(screen.getByText("<b>hi</b>")).toBeTruthy();
		expect(screen.getByTestId("toast").className).toContain("--bottom-bars");
	});
});
