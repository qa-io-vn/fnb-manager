import { type DueChecklist, RestError } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import { readOpeningHours } from "../home/model";
import {
	byPhase,
	canManage,
	checklistState,
	failureOf,
	isoDateShift,
	phaseAt,
	primaryTarget,
	seesDifference,
} from "./model";

const ME = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";
const clock = { timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 0 };

function everyDay(spans: [string, string][]) {
	return readOpeningHours(
		Object.fromEntries(
			["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
				day,
				spans,
			]),
		),
	);
}

function at(localTime: string, date = "2026-11-18"): Date {
	return new Date(`${date}T${localTime}:00+07:00`);
}

function checklist(
	templateId: string,
	shiftPhase: DueChecklist["shiftPhase"],
	run: DueChecklist["run"] = null,
): DueChecklist {
	return {
		templateId,
		title: templateId,
		shiftPhase,
		templateVersion: 1,
		everyStore: false,
		items: 3,
		photoItems: 1,
		businessDate: "2026-11-18",
		run,
	};
}

describe("the shift phase from the store's opening hours", () => {
	const hours = everyDay([["07:00", "22:00"]]);

	it("is opening until two hours after opening, closing from two hours before closing, midshift between", () => {
		expect(phaseAt(hours, at("06:15"), clock)).toBe("opening");
		expect(phaseAt(hours, at("08:59"), clock)).toBe("opening");
		expect(phaseAt(hours, at("09:00"), clock)).toBe("midshift");
		expect(phaseAt(hours, at("19:59"), clock)).toBe("midshift");
		expect(phaseAt(hours, at("20:00"), clock)).toBe("closing");
		expect(phaseAt(hours, at("23:30"), clock)).toBe("closing");
	});

	it("uses the first opening and the last closing of a split day", () => {
		const split = everyDay([
			["06:30", "11:00"],
			["16:00", "22:30"],
		]);
		expect(phaseAt(split, at("08:00"), clock)).toBe("opening");
		expect(phaseAt(split, at("13:00"), clock)).toBe("midshift");
		expect(phaseAt(split, at("21:00"), clock)).toBe("closing");
	});

	it("splits a short day at its middle and counts the night after midnight as the business day before it", () => {
		const short = everyDay([["10:00", "13:00"]]);
		expect(phaseAt(short, at("11:00"), clock)).toBe("opening");
		expect(phaseAt(short, at("11:30"), clock)).toBe("closing");
		const late = everyDay([["16:00", "24:00"]]);
		const night = { ...clock, businessDayStartMinutes: 240 };
		expect(phaseAt(late, at("01:30", "2026-11-19"), night)).toBe("closing");
	});

	it("is unknown without opening hours or on a closed day", () => {
		expect(phaseAt(readOpeningHours(null), at("08:00"), clock)).toBeNull();
		const weekdays = readOpeningHours({ mon: [["07:00", "22:00"]] });
		expect(phaseAt(weekdays, at("08:00", "2026-11-18"), clock)).toBeNull();
	});
});

describe("the checklists on the Ca làm tab", () => {
	const opening = checklist("open", "opening");
	const closing = checklist("close", "closing");
	const midshift = checklist("mid", "midshift");

	it("puts the current phase first and the others in shift order", () => {
		const groups = byPhase([closing, midshift, opening], "midshift");
		expect(groups.now.map((item) => item.templateId)).toEqual(["mid"]);
		expect(groups.later.map((item) => item.templateId)).toEqual([
			"open",
			"close",
		]);
		expect(byPhase([closing, opening], null).now).toEqual([]);
	});

	it("tells whose run is open and when it is finished", () => {
		const started = {
			id: "r",
			status: "open" as const,
			startedBy: ME,
			startedAt: "2026-11-18T01:00:00Z",
			finishedAt: null,
		};
		expect(checklistState(opening, ME)).toBe("not-started");
		expect(checklistState(checklist("a", "opening", started), ME)).toBe(
			"mine-open",
		);
		expect(
			checklistState(
				checklist("a", "opening", { ...started, startedBy: OTHER }),
				ME,
			),
		).toBe("other-open");
		expect(
			checklistState(
				checklist("a", "opening", {
					...started,
					status: "finished",
					finishedAt: "2026-11-18T02:00:00Z",
				}),
				ME,
			),
		).toBe("finished");
	});

	it("makes the due checklist the one primary action, and the shift close once it is done or taken", () => {
		expect(primaryTarget([opening, closing], "opening", ME)).toEqual({
			kind: "checklist",
			templateId: "open",
		});
		const taken = checklist("open", "opening", {
			id: "r",
			status: "open",
			startedBy: OTHER,
			startedAt: "2026-11-18T01:00:00Z",
			finishedAt: null,
		});
		expect(primaryTarget([taken, closing], "opening", ME)).toEqual({
			kind: "close",
		});
		expect(primaryTarget([opening], null, ME)).toEqual({ kind: "close" });
	});
});

describe("roles and refusals", () => {
	it("shows the cash difference to owners and managers, and to staff only at the all level", () => {
		expect(canManage("owner")).toBe(true);
		expect(canManage("staff")).toBe(false);
		expect(seesDifference("manager", "none")).toBe(true);
		expect(seesDifference("staff", "all")).toBe(true);
		expect(seesDifference("staff", "store_totals")).toBe(false);
		expect(seesDifference("staff", "none")).toBe(false);
		expect(seesDifference("viewer", "all")).toBe(false);
	});

	it("names each refusal from the database's code, a lost request and an expired session", () => {
		expect(failureOf(new RestError(403, "42501"))).toBe("not-allowed");
		expect(failureOf(new RestError(409, "23505"))).toBe("duplicate");
		expect(failureOf(new RestError(500, "55000"))).toBe("state");
		expect(failureOf(new RestError(400, "23514"))).toBe("check");
		expect(failureOf(new RestError(400, "22023"))).toBe("invalid");
		expect(failureOf(new RestError(0))).toBe("network");
		expect(failureOf(new RestError(401, "PGRST301"))).toBe("session");
		expect(failureOf(new RestError(403))).toBe("session");
		expect(failureOf(new RestError(502))).toBe("unknown");
		expect(failureOf(new Error("x"))).toBe("unknown");
	});

	it("moves a date by whole days", () => {
		expect(isoDateShift("2026-03-01", -1)).toBe("2026-02-28");
		expect(isoDateShift("2026-12-31", 1)).toBe("2027-01-01");
	});
});
