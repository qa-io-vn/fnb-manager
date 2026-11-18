import type { ChecklistItem, ChecklistRun } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	canSeePhotos,
	doneBlock,
	numberText,
	numberValueOf,
	readNumberInput,
	runAccess,
	runProgress,
	withAnswer,
} from "./model";

const ME = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";

function item(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
	return {
		answerId: "a-1",
		itemId: "i-1",
		position: 1,
		label: "Lau quầy",
		requiresPhoto: false,
		numberUnit: null,
		done: false,
		numberValue: null,
		photoPath: null,
		photoRemoved: false,
		answeredBy: null,
		answeredAt: null,
		...overrides,
	};
}

function run(items: ChecklistItem[]): ChecklistRun {
	return {
		runId: "r-1",
		storeId: "s-1",
		templateId: "t-1",
		templateVersion: 1,
		title: "Mở ca",
		shiftPhase: "opening",
		businessDate: "2026-11-18",
		status: "open",
		startedBy: ME,
		startedAt: "2026-11-18T00:00:00Z",
		finishedAt: null,
		photo: { bucket: "ops-brand-1", prefix: "t/s/run/r-1/" },
		itemsTotal: items.length,
		itemsDone: items.filter((entry) => entry.done).length,
		items,
	};
}

describe("a checklist item's number", () => {
	it("reads whole and decimal numbers with a comma or a point, and refuses anything else", () => {
		expect(readNumberInput("")).toEqual({ kind: "empty" });
		expect(readNumberInput(" 4 ")).toEqual({ kind: "value", value: 4 });
		expect(readNumberInput("4,5")).toEqual({ kind: "value", value: 4.5 });
		expect(readNumberInput("-18")).toEqual({ kind: "value", value: -18 });
		expect(readNumberInput("4.5.1")).toEqual({ kind: "invalid" });
		expect(readNumberInput("bốn")).toEqual({ kind: "invalid" });
		expect(numberText(4.5)).toBe("4,5");
		expect(numberText(null)).toBe("");
	});

	it("is sent only for an item with a unit", () => {
		expect(numberValueOf({ numberUnit: "°C" }, readNumberInput("4"))).toBe(4);
		expect(
			numberValueOf({ numberUnit: null }, readNumberInput("4")),
		).toBeNull();
		expect(numberValueOf({ numberUnit: "°C" }, readNumberInput(""))).toBeNull();
	});
});

describe("marking an item done", () => {
	it("needs the photo the item asks for, then the number", () => {
		const photo = { requiresPhoto: true, numberUnit: null };
		expect(doneBlock(photo, null, readNumberInput(""))).toBe("photo");
		expect(
			doneBlock(photo, "t/s/run/r-1/p.jpg", readNumberInput("")),
		).toBeNull();
		const number = { requiresPhoto: false, numberUnit: "°C" };
		expect(doneBlock(number, null, readNumberInput(""))).toBe("number");
		expect(doneBlock(number, null, readNumberInput("x"))).toBe(
			"number-invalid",
		);
		expect(doneBlock(number, null, readNumberInput("3"))).toBeNull();
		expect(
			doneBlock(
				{ requiresPhoto: false, numberUnit: null },
				null,
				readNumberInput(""),
			),
		).toBeNull();
	});
});

describe("a run's progress and access", () => {
	it("counts the items done and takes a saved answer in", () => {
		const current = run([
			item(),
			item({ answerId: "a-2", itemId: "i-2", position: 2 }),
		]);
		expect(runProgress(current)).toEqual({ done: 0, total: 2, percent: 0 });
		const saved = withAnswer(current, {
			answerId: "a-2",
			runId: "r-1",
			itemId: "i-2",
			done: true,
			numberValue: null,
			photoPath: null,
			photoRemoved: false,
			answeredBy: ME,
			answeredAt: "2026-11-18T00:10:00Z",
		});
		expect(runProgress(saved)).toEqual({ done: 1, total: 2, percent: 50 });
		expect(saved.itemsDone).toBe(1);
		expect(saved.items[1]?.answeredBy).toBe(ME);
		expect(runProgress(run([]))).toEqual({ done: 0, total: 0, percent: 0 });
	});

	it("lets only the actor edit an open run, and nobody a finished one", () => {
		expect(runAccess({ status: "open", startedBy: ME }, ME)).toBe("edit");
		expect(runAccess({ status: "open", startedBy: OTHER }, ME)).toBe("other");
		expect(runAccess({ status: "finished", startedBy: ME }, ME)).toBe(
			"finished",
		);
	});

	it("shows photos to the actor and to managers, never to other staff", () => {
		expect(canSeePhotos({ startedBy: ME }, ME, false)).toBe(true);
		expect(canSeePhotos({ startedBy: OTHER }, ME, false)).toBe(false);
		expect(canSeePhotos({ startedBy: OTHER }, ME, true)).toBe(true);
		expect(canSeePhotos({ startedBy: OTHER }, null, false)).toBe(false);
	});
});
