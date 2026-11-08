import { describe, expect, it } from "vitest";
import { addDays } from "../lib/business-dates";
import { median } from "./statistics";
import {
	line,
	localInstant,
	payment,
	rowsOf,
	sale,
	testStore,
} from "./test-rows";
import { computeToday, medianBaseline, planToday } from "./today";

const TODAY = "2026-11-08";
const YESTERDAY = "2026-11-07";
const storeA = testStore("A");
const storeB = testStore("B", { posAccountId: "account-b" });
const evening = localInstant(storeA, TODAY, "20:00");

function weeksBefore(date: string, week: number): string {
	return addDays(date, -7 * week);
}

describe("median", () => {
	it("takes the middle value or the mean of the two middle values", () => {
		expect(median([])).toBeNull();
		expect(median([5, 1, 3])).toBe(3);
		expect(median([4, 1, 3, 2])).toBe(2.5);
	});

	it("skips days without data in the baseline", () => {
		const baseline = medianBaseline([
			{ net: 100, invoices: 2, avgTicket: 50 },
			{ net: 0, invoices: 0, avgTicket: null },
			{ net: 300, invoices: 4, avgTicket: 75 },
		]);
		expect(baseline).toEqual({
			net: 200,
			invoices: 3,
			avgTicket: 62.5,
			sampleDays: 2,
		});
	});
});

describe("planToday", () => {
	it("asks for today, yesterday and the eight same-weekday dates before each", () => {
		const plan = planToday([storeA], evening);
		expect(plan.todayDates).toEqual([TODAY]);
		expect(plan.yesterdayDates).toEqual([YESTERDAY]);
		expect(plan.requiredDates).toHaveLength(18);
		expect(plan.requiredDates).toContain(weeksBefore(TODAY, 8));
		expect(plan.requiredDates).toContain(weeksBefore(YESTERDAY, 8));
		expect(plan.requiredDates).not.toContain(weeksBefore(TODAY, 9));
	});
});

describe("same-weekday median baseline", () => {
	it("is the median of the previous eight same weekdays, holidays excluded", () => {
		const history = [100, 200, 300, 400, 500, 600, 700, 10_000].map(
			(net, index) =>
				sale(storeA, weeksBefore(YESTERDAY, index + 1), "10:00", net),
		);
		const holiday = weeksBefore(YESTERDAY, 8);
		const report = computeToday(
			[storeA],
			rowsOf({
				invoices: [...history, sale(storeA, YESTERDAY, "09:00", 450)],
				excludedDates: new Set([holiday]),
			}),
			evening,
		);
		expect(report.yesterday.totals.net).toBe(450);
		expect(report.yesterday.baseline.net).toBe(400);
		expect(report.yesterday.baseline.sampleDays).toBe(7);
	});

	it("sums the stores per day before taking the median", () => {
		const invoices = [
			sale(storeA, weeksBefore(YESTERDAY, 1), "10:00", 100),
			sale(storeB, weeksBefore(YESTERDAY, 1), "10:00", 900),
			sale(storeA, weeksBefore(YESTERDAY, 2), "10:00", 500),
			sale(storeB, weeksBefore(YESTERDAY, 2), "10:00", 100),
			sale(storeA, weeksBefore(YESTERDAY, 3), "10:00", 300),
		];
		const report = computeToday(
			[storeA, storeB],
			rowsOf({ invoices }),
			evening,
		);
		expect(report.yesterday.baseline.net).toBe(600);
		expect(report.yesterday.stores.map((store) => store.baseline.net)).toEqual([
			300, 500,
		]);
	});

	it("compares today with the history only up to the same time of day", () => {
		const lastWeek = weeksBefore(TODAY, 1);
		const morning = localInstant(storeA, TODAY, "10:30");
		const invoices = [
			sale(storeA, lastWeek, "09:00", 100),
			sale(storeA, lastWeek, "10:29", 50),
			sale(storeA, lastWeek, "19:00", 1_000),
			sale(storeA, TODAY, "09:15", 120),
		];
		const report = computeToday([storeA], rowsOf({ invoices }), morning);
		expect(report.today.baseline.net).toBe(150);
		expect(report.today.totals.net).toBe(120);
		const hourlyBaseline = report.today.hourly.find(
			(point) => point.hour === 19,
		);
		expect(hourlyBaseline?.baseline).toBe(1_000);
	});

	it("ends today's hourly curve at the current hour instead of drawing zeros", () => {
		const lastWeek = weeksBefore(TODAY, 1);
		const morning = localInstant(storeA, TODAY, "10:30");
		const report = computeToday(
			[storeA],
			rowsOf({
				invoices: [
					sale(storeA, lastWeek, "08:00", 100),
					sale(storeA, lastWeek, "19:00", 1_000),
					sale(storeA, TODAY, "09:15", 120),
				],
			}),
			morning,
		);
		const currentAt = (hour: number) =>
			report.today.hourly.find((point) => point.hour === hour)?.current;
		expect(currentAt(8)).toBe(0);
		expect(currentAt(9)).toBe(120);
		expect(currentAt(10)).toBe(0);
		expect(currentAt(11)).toBeNull();
		expect(currentAt(19)).toBeNull();
		expect(
			report.yesterday.hourly.every((point) => point.current !== null),
		).toBe(true);
	});
});

describe("voided invoices", () => {
	it("are left out of totals, baselines, items and payments", () => {
		const kept = sale(storeA, TODAY, "08:00", 100);
		const voided = sale(storeA, TODAY, "08:30", 999, "voided");
		const voidedHistory = sale(
			storeA,
			weeksBefore(TODAY, 1),
			"08:00",
			5_000,
			"voided",
		);
		const edited = sale(storeA, TODAY, "09:00", 40, "edited");
		const report = computeToday(
			[storeA],
			rowsOf({
				invoices: [kept, voided, voidedHistory, edited],
				lines: [
					line(kept, "Trà sữa", 100),
					line(voided, "Cà phê", 999),
					line(edited, "Trà đào", 40),
				],
				payments: [
					payment(kept, "CASH", 100),
					payment(voided, "CASH", 999),
					payment(edited, "QR", 40),
				],
			}),
			evening,
		);
		expect(report.today.totals).toEqual({
			net: 140,
			invoices: 2,
			avgTicket: 70,
		});
		expect(report.today.baseline.sampleDays).toBe(0);
		expect(report.topItems.map((item) => item.name)).toEqual([
			"Trà sữa",
			"Trà đào",
		]);
		expect(report.payments.total).toBe(140);
		expect(report.payments.cashToCount).toBe(100);
	});
});

describe("top items", () => {
	it("ranks item lines only, never modifier lines", () => {
		const invoice = sale(storeA, TODAY, "10:00", 200);
		const report = computeToday(
			[storeA],
			rowsOf({
				invoices: [invoice],
				lines: [
					line(invoice, "Trà sữa", 60, "item", 2),
					line(invoice, "Trà sữa", 40, "item"),
					line(invoice, "Ít đá", 500, "modifier"),
					line(invoice, "Combo", 300, "package"),
					line(invoice, "Hạt dưa", 100, "item"),
				],
			}),
			evening,
		);
		expect(report.topItems).toEqual([
			{ key: "Trà sữa", name: "Trà sữa", quantity: 3, net: 100, share: 0.5 },
			{ key: "Hạt dưa", name: "Hạt dưa", quantity: 1, net: 100, share: 0.5 },
		]);
	});

	it("keeps at most five items", () => {
		const invoice = sale(storeA, TODAY, "10:00", 600);
		const lines = ["a", "b", "c", "d", "e", "f"].map((name, index) =>
			line(invoice, name, 10 * (index + 1)),
		);
		const report = computeToday(
			[storeA],
			rowsOf({ invoices: [invoice], lines }),
			evening,
		);
		expect(report.topItems.map((item) => item.name)).toEqual([
			"f",
			"e",
			"d",
			"c",
			"b",
		]);
	});
});

describe("payment split", () => {
	it("classifies tenders by the payment method kind of the store's account", () => {
		const first = sale(storeA, TODAY, "10:00", 300);
		const second = sale(storeB, TODAY, "11:00", 200);
		const report = computeToday(
			[storeA, storeB],
			rowsOf({
				invoices: [first, second],
				payments: [
					payment(first, "CASH", 100),
					payment(first, "QR", 150),
					payment(first, "UNKNOWN", 50),
					payment(second, "CASH", 200),
				],
			}),
			evening,
		);
		expect(report.payments.cashToCount).toBe(100);
		expect(report.payments.total).toBe(500);
		expect(report.payments.kinds).toEqual([
			{ kind: "bank_transfer", amount: 200, share: 0.4 },
			{ kind: "ewallet", amount: 150, share: 0.3 },
			{ kind: "cash", amount: 100, share: 0.2 },
			{ kind: "other", amount: 50, share: 0.1 },
		]);
	});
});

describe("business dates with a 05:00 day start", () => {
	const lateStore = testStore("L", { businessDayStartMinutes: 300 });

	it("plans today from the day start and lays the hour axis from 05:00 to 04:00", () => {
		const beforeDayStart = localInstant(lateStore, TODAY, "02:00");
		expect(beforeDayStart.toISOString()).toBe("2026-11-08T19:00:00.000Z");
		const plan = planToday([lateStore], beforeDayStart);
		expect(plan.todayDates).toEqual([TODAY]);
		const afterMidnight = sale(lateStore, TODAY, "00:30", 70);
		const evening = sale(lateStore, TODAY, "21:00", 30);
		expect(afterMidnight.soldAt).toBe("2026-11-08T17:30:00.000Z");
		const report = computeToday(
			[lateStore],
			rowsOf({
				invoices: [
					afterMidnight,
					evening,
					sale(lateStore, "2026-11-09", "06:00", 999),
				],
			}),
			beforeDayStart,
		);
		expect(report.today.totals).toEqual({
			net: 100,
			invoices: 2,
			avgTicket: 50,
		});
		expect(report.today.hourly.map((point) => point.hour)).toEqual([
			21, 22, 23, 0,
		]);
	});

	it("cuts the same-weekday history at the time elapsed since the day start", () => {
		const lastWeek = weeksBefore(TODAY, 1);
		const now = localInstant(lateStore, TODAY, "02:00");
		const report = computeToday(
			[lateStore],
			rowsOf({
				invoices: [
					sale(lateStore, lastWeek, "06:00", 10),
					sale(lateStore, lastWeek, "00:30", 20),
					sale(lateStore, lastWeek, "03:00", 400),
				],
			}),
			now,
		);
		expect(report.today.cutAtMinutes).toBe(21 * 60);
		expect(report.today.baseline.net).toBe(30);
		const currentAt = (hour: number) =>
			report.today.hourly.find((point) => point.hour === hour)?.current;
		expect(currentAt(2)).toBe(0);
		expect(currentAt(3)).toBeNull();
	});

	it("rolls today over only at the day start", () => {
		expect(
			planToday([lateStore], localInstant(lateStore, "2026-11-09", "05:00"))
				.todayDates,
		).toEqual(["2026-11-09"]);
		expect(
			planToday([lateStore], new Date("2026-11-08T21:59:00.000Z")).todayDates,
		).toEqual([TODAY]);
	});
});
