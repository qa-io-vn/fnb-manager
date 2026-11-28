import { createTranslator } from "@fnb/zalo-mini";
import type {
	Order,
	OrderingState,
	TakeawaySlot,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { orderingCatalogs } from "./i18n/catalog";
import {
	choiceStillFree,
	dateLine,
	groupSlots,
	minutesUntil,
	nearestFree,
	orderingOpen,
	pickupPassed,
	pickupWords,
	preOrderOpen,
	relativeDay,
	SLOTS_SHOWN,
	shownSlots,
	slotPeriod,
	slotRefusal,
	takeawayMethods,
	takeawayOffered,
	vietnameseWeekday,
} from "./takeaway";

// C17's display rules (missing-screens 5.6; ADR-072): the server decides every slot on its own clock; the app only
// arranges the answer. Techniques:
// - boundary values of the part of the day a slot starts in (03:59/04:00, 11:59/12:00, 17:59/18:00), of the list cut
//   before "Xem giờ muộn hơn" (12 shown, the 13th hidden), of a booking's preparation start (one millisecond before
//   and at start_at) and of "khoảng N phút nữa" (never below 1);
// - equivalence partitions of a slot (free, full, passed), of the day (today, tomorrow, later: C17-U2's words) and of
//   the weekday (C17-U4: "Thứ Bảy, 28/11/2026", every weekday's name);
// - a decision table of what the app offers: takeaway (type offered × online build × an online method), the closed
//   store's booking (each closed reason, paused, open) and whether items can be added (table or takeaway × state).

const t = createTranslator(orderingCatalogs.vi);
const at = (local: string) => new Date(`${local}+07:00`).toISOString();
const NOW = Date.parse("2026-11-27T14:05:00+07:00");

function slot(
	local: string,
	reason: "full" | "passed" | null = null,
): TakeawaySlot {
	return { start: at(local), available: reason === null, reason };
}

function ordering(overrides: Partial<OrderingState> = {}): OrderingState {
	return {
		accepting: true,
		reason: null,
		tillMode: "native",
		orderTypes: ["table", "takeaway"],
		paymentMethods: ["counter", "zalo_checkout", "vietqr"],
		opensAt: null,
		closesAt: null,
		lastOrderAt: null,
		pausedUntil: null,
		closureReason: null,
		closureEndsOn: null,
		...overrides,
	};
}

describe("the part of the day a slot starts in", () => {
	it.each([
		["2026-11-27T03:59:00", "night"],
		["2026-11-27T04:00:00", "morning"],
		["2026-11-27T11:59:00", "morning"],
		["2026-11-27T12:00:00", "afternoon"],
		["2026-11-27T17:59:00", "afternoon"],
		["2026-11-27T18:00:00", "evening"],
	] as const)("%s is %s", (local, period) => {
		expect(slotPeriod(at(local))).toBe(period);
	});
});

describe("the slots C17 lists", () => {
	const day = [
		slot("2026-11-27T14:00:00", "passed"),
		slot("2026-11-27T14:15:00", "passed"),
		...Array.from({ length: 14 }, (_, index) => {
			const minutes = 14 * 60 + 30 + index * 15;
			const local = `2026-11-27T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
			return slot(local, local.endsWith("15:15:00") ? "full" : null);
		}),
	];

	it("leave out the passed ones and show the first 12, full ones in their place", () => {
		const shown = shownSlots(day, false);
		expect(shown).toHaveLength(SLOTS_SHOWN);
		expect(shown[0]?.start).toBe(at("2026-11-27T14:30:00"));
		expect(shown.some((entry) => entry.reason === "passed")).toBe(false);
		expect(shown.find((entry) => entry.reason === "full")?.start).toBe(
			at("2026-11-27T15:15:00"),
		);
	});

	it("show every later one once asked (boundary: the 13th and 14th were hidden)", () => {
		expect(shownSlots(day, true)).toHaveLength(14);
	});

	it("group them by the part of the day, in order", () => {
		const groups = groupSlots([
			slot("2026-11-28T07:00:00"),
			slot("2026-11-28T11:45:00"),
			slot("2026-11-28T12:00:00"),
			slot("2026-11-28T18:00:00"),
		]);
		expect(
			groups.map((group) => `${group.period}:${group.slots.length}`),
		).toEqual(["morning:2", "afternoon:1", "evening:1"]);
	});

	it("name the nearest free slots after a full one (frame 3: 15:30 and 15:45)", () => {
		const frame = [
			slot("2026-11-27T14:30:00"),
			slot("2026-11-27T15:00:00", "full"),
			slot("2026-11-27T15:15:00", "full"),
			slot("2026-11-27T15:30:00"),
			slot("2026-11-27T15:45:00"),
			slot("2026-11-27T16:00:00"),
		];
		expect(nearestFree(frame, at("2026-11-27T15:00:00"))).toEqual([
			at("2026-11-27T15:30:00"),
			at("2026-11-27T15:45:00"),
		]);
		expect(nearestFree(frame, at("2026-11-27T16:00:00"))).toEqual([]);
	});

	it("keep a choice only while the server still offers it free", () => {
		const slots = [
			slot("2026-11-27T15:00:00", "full"),
			slot("2026-11-27T15:30:00"),
		];
		expect(
			choiceStillFree(
				{ kind: "slot", at: at("2026-11-27T15:30:00") },
				slots,
				null,
			),
		).toBe(true);
		expect(
			choiceStillFree(
				{ kind: "slot", at: at("2026-11-27T15:00:00") },
				slots,
				null,
			),
		).toBe(false);
		expect(
			choiceStillFree({ kind: "asap" }, slots, at("2026-11-27T14:20:00")),
		).toBe(true);
		expect(choiceStillFree({ kind: "asap" }, slots, null)).toBe(false);
		expect(choiceStillFree(null, slots, null)).toBe(false);
	});
});

describe("the words for days and times (C17-U2, C17-U4)", () => {
	it("say today, tomorrow or later on the shop's clock", () => {
		expect(relativeDay("2026-11-27", NOW)).toBe("today");
		expect(relativeDay("2026-11-28", NOW)).toBe("tomorrow");
		expect(relativeDay("2026-11-29", NOW)).toBe("later");
		// boundary: 23:59 and 00:00 on the shop's clock
		expect(
			relativeDay("2026-11-28", Date.parse("2026-11-27T23:59:00+07:00")),
		).toBe("tomorrow");
		expect(
			relativeDay("2026-11-28", Date.parse("2026-11-28T00:00:00+07:00")),
		).toBe("today");
	});

	it("write the Vietnamese date line: Hôm nay for today, the weekday otherwise (Thứ Bảy, 28/11/2026)", () => {
		expect(dateLine(t, "2026-11-27", NOW)).toBe("Hôm nay, 27/11/2026");
		expect(dateLine(t, "2026-11-28", NOW)).toBe("Thứ Bảy, 28/11/2026");
		expect(dateLine(t, "2026-11-29", NOW)).toBe("Chủ Nhật, 29/11/2026");
	});

	it.each([
		["2026-11-30", "Thứ Hai"],
		["2026-12-01", "Thứ Ba"],
		["2026-12-02", "Thứ Tư"],
		["2026-12-03", "Thứ Năm"],
		["2026-12-04", "Thứ Sáu"],
		["2026-12-05", "Thứ Bảy"],
		["2026-12-06", "Chủ Nhật"],
	] as const)("names %s %s", (date, name) => {
		expect(vietnameseWeekday(date)).toBe(name);
	});

	it("write a pick-up for the bar: 15:00 hôm nay, 07:30 sáng mai, 19:00 ngày mai, later with the day", () => {
		expect(pickupWords(t, at("2026-11-27T15:00:00"), NOW)).toBe(
			"15:00 hôm nay",
		);
		expect(pickupWords(t, at("2026-11-28T07:30:00"), NOW)).toBe(
			"07:30 sáng mai",
		);
		expect(pickupWords(t, at("2026-11-28T19:00:00"), NOW)).toBe(
			"19:00 ngày mai",
		);
		expect(pickupWords(t, at("2026-11-30T08:00:00"), NOW)).toBe(
			"08:00 Thứ Hai, 30/11",
		);
	});

	it("count the minutes to an instant, never fewer than one", () => {
		expect(minutesUntil(at("2026-11-27T14:20:00"), NOW)).toBe(15);
		expect(minutesUntil(at("2026-11-27T14:05:10"), NOW)).toBe(1);
		expect(minutesUntil(at("2026-11-27T14:00:00"), NOW)).toBe(1);
	});
});

describe("what the app offers (decision table)", () => {
	it.each([
		[true, ["table", "takeaway"], ["counter", "vietqr"], true],
		[false, ["table", "takeaway"], ["counter", "vietqr"], false],
		[true, ["table"], ["counter", "vietqr"], false],
		[true, ["table", "takeaway"], ["counter"], false],
		[true, ["takeaway"], ["zalo_checkout"], true],
	] as const)(
		"online build %s, types %j, methods %j: takeaway %s",
		(online, types, methods, offered) => {
			expect(
				takeawayOffered(
					ordering({ orderTypes: types, paymentMethods: methods }),
					online,
				),
			).toBe(offered);
		},
	);

	it.each([
		["closed_now", true],
		["last_orders_passed", true],
		["closed_today", true],
		["paused", false],
		["no_staff_online", false],
		["hours_unknown", false],
	] as const)(
		"a store held by %s books the next opening: %s",
		(reason, books) => {
			expect(preOrderOpen(ordering({ accepting: false, reason }), true)).toBe(
				books,
			);
		},
	);

	it("never books while the store is open (that is an ordinary order), nor without the online build", () => {
		expect(preOrderOpen(ordering(), true)).toBe(false);
		expect(
			preOrderOpen(ordering({ accepting: false, reason: "closed_now" }), false),
		).toBe(false);
	});

	it("lets items be added when the store takes orders, or for a takeaway booked while closed only", () => {
		const closed = ordering({ accepting: false, reason: "closed_now" });
		expect(orderingOpen(ordering(), "table", true)).toBe(true);
		expect(orderingOpen(closed, "table", true)).toBe(false);
		expect(orderingOpen(closed, "takeaway", true)).toBe(true);
		expect(orderingOpen(closed, "takeaway", false)).toBe(false);
		expect(
			orderingOpen(
				ordering({ accepting: false, reason: "paused" }),
				"takeaway",
				true,
			),
		).toBe(false);
	});

	it("takes takeaway online only (C17-I5 in the app: no Trả tại quầy)", () => {
		expect(takeawayMethods(["counter", "zalo_checkout", "vietqr"])).toEqual([
			"zalo_checkout",
			"vietqr",
		]);
		expect(takeawayMethods(["counter"])).toEqual([]);
	});

	it("sends the slot refusals back to C17 and nothing else", () => {
		for (const refusal of [
			"slot_full",
			"slot_passed",
			"closed",
			"pickup_time_invalid",
		])
			expect(slotRefusal(refusal)).toBe(true);
		for (const refusal of ["price_changed", "closed_now", null])
			expect(slotRefusal(refusal)).toBe(false);
	});
});

describe("a booked time that passed while paying", () => {
	const booking = {
		type: "takeaway",
		status: "awaiting_payment",
		pickupAt: at("2026-11-27T14:30:00"),
		startAt: at("2026-11-27T14:15:00"),
	} as Order;

	it("is passed from its preparation start (boundary: one millisecond before and at start_at)", () => {
		const start = Date.parse(at("2026-11-27T14:15:00"));
		expect(pickupPassed(booking, start - 1)).toBe(false);
		expect(pickupPassed(booking, start)).toBe(true);
	});

	it("never for an order already paid, a table order or one without a time", () => {
		const late = Date.parse(at("2026-11-27T16:00:00"));
		expect(pickupPassed({ ...booking, status: "accepted" }, late)).toBe(false);
		expect(pickupPassed({ ...booking, type: "table" }, late)).toBe(false);
		expect(
			pickupPassed({ ...booking, pickupAt: null, startAt: null }, late),
		).toBe(false);
	});
});
