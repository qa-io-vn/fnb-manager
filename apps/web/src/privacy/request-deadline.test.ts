import { describe, expect, it } from "vitest";
import { DEADLINE_TONES, deadlineOf } from "./request-deadline";

const NOW = new Date("2026-11-20T03:00:00Z");
const DAY = 86_400_000;
const at = (offsetMs: number) =>
	new Date(NOW.getTime() + offsetMs).toISOString();

describe("the deadline badge", () => {
	it("is done whatever the date once the step is done (decision table, done column)", () => {
		expect(deadlineOf(NOW, at(-10 * DAY), true).state).toBe("done");
		expect(deadlineOf(NOW, at(10 * DAY), true).state).toBe("done");
	});

	it("is overdue one millisecond after the deadline and not at the deadline itself (boundary)", () => {
		expect(deadlineOf(NOW, at(-1), false).state).toBe("overdue");
		expect(deadlineOf(NOW, at(0), false).state).toBe("due_soon");
	});

	it("is due soon up to and including the third day, on track after it (boundary)", () => {
		expect(deadlineOf(NOW, at(3 * DAY), false).state).toBe("due_soon");
		expect(deadlineOf(NOW, at(3 * DAY + 1), false).state).toBe("on_track");
		expect(deadlineOf(NOW, at(20 * DAY), false).state).toBe("on_track");
	});

	it("follows the window it is given", () => {
		expect(deadlineOf(NOW, at(5 * DAY), false, 5).state).toBe("due_soon");
		expect(deadlineOf(NOW, at(5 * DAY), false, 0).state).toBe("on_track");
	});

	it("counts whole days left, rounded up, and negative once overdue", () => {
		expect(deadlineOf(NOW, at(2 * DAY - 1), false).daysLeft).toBe(2);
		expect(deadlineOf(NOW, at(DAY / 2), false).daysLeft).toBe(1);
		expect(deadlineOf(NOW, at(-2 * DAY - 1000), false).daysLeft).toBe(-2);
	});

	it("has a tone for every state", () => {
		expect(Object.keys(DEADLINE_TONES).sort()).toEqual([
			"done",
			"due_soon",
			"on_track",
			"overdue",
		]);
	});
});
