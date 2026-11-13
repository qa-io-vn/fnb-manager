import {
	createDemoAnalyticsSource,
	DemoDayCache,
	toDbLineKind,
} from "@fnb/demo-analytics";
import { describe, expect, it } from "vitest";
import { addDays } from "../lib/business-dates";
import { computeToday, planToday } from "../metrics/today";
import {
	createDemoRowSource,
	DEMO_TENANT_ID,
	demoTenant,
} from "./demo-row-source";

const now = new Date("2026-11-08T05:30:00.000Z");

function demoAt(at: Date) {
	const days = new DemoDayCache({ now: () => at });
	return { days, source: createDemoRowSource(() => at, days) };
}

async function loadDemo(at: Date) {
	const { source, days } = demoAt(at);
	const stores = await source.stores(DEMO_TENANT_ID);
	const plan = planToday(stores, at);
	const storeIds = stores.map((store) => store.id);
	const [invoices, lines, payments, paymentMethods] = await Promise.all([
		source.invoices({ storeIds, dates: plan.requiredDates }),
		source.invoiceLines({ storeIds, dates: plan.todayDates }),
		source.payments({ storeIds, dates: plan.todayDates }),
		source.paymentMethods(DEMO_TENANT_ID),
	]);
	return {
		source,
		days,
		stores,
		plan,
		invoices,
		lines,
		payments,
		paymentMethods,
	};
}

describe("demo row source", () => {
	it("serves one VND tenant with the two demo stores", async () => {
		const { source } = demoAt(now);
		expect(await source.tenants()).toEqual([demoTenant]);
		expect(demoTenant.currencyCode).toBe("VND");
		const stores = await source.stores(DEMO_TENANT_ID);
		expect(stores.map((store) => store.id)).toEqual(["MOCK-S1", "MOCK-S2"]);
		expect(stores.every((store) => store.timeZone === "Asia/Ho_Chi_Minh")).toBe(
			true,
		);
		expect(await source.stores("another-tenant")).toEqual([]);
	});

	it("cuts today's sales at the current time and anchors dates in Ho Chi Minh City", async () => {
		const { invoices, plan } = await loadDemo(now);
		expect(plan.todayDates).toEqual(["2026-11-08"]);
		const today = invoices.filter(
			(invoice) => invoice.businessDate === "2026-11-08",
		);
		expect(today.length).toBeGreaterThan(0);
		expect(today.every((invoice) => new Date(invoice.soldAt) <= now)).toBe(
			true,
		);
		expect(
			invoices.some(
				(invoice) => invoice.businessDate === addDays("2026-11-08", 1),
			),
		).toBe(false);
	});

	it("is deterministic for a fixed seed", async () => {
		const first = await loadDemo(now);
		const second = await loadDemo(now);
		expect(second.invoices).toEqual(first.invoices);
	});

	it("generates only the requested dates and maps line kinds as the sync stores them", async () => {
		const { invoices, lines, payments, plan } = await loadDemo(now);
		expect(new Set(invoices.map((invoice) => invoice.businessDate))).toEqual(
			new Set(plan.requiredDates),
		);
		const ids = new Set(invoices.map((invoice) => invoice.id));
		expect(lines.every((line) => ids.has(line.invoiceId))).toBe(true);
		expect(payments.every((payment) => ids.has(payment.invoiceId))).toBe(true);
		expect(lines.some((line) => line.lineKind === "modifier")).toBe(true);
		expect(toDbLineKind("package_component")).toBe("item");
		expect(
			lines.every((line) =>
				["item", "modifier", "service", "package", "other"].includes(
					line.lineKind,
				),
			),
		).toBe(true);
	});

	it("produces non-zero Hôm nay numbers with a baseline", async () => {
		const { stores, invoices, lines, payments, paymentMethods } =
			await loadDemo(now);
		const report = computeToday(
			stores,
			{ invoices, lines, payments, paymentMethods, excludedDates: new Set() },
			now,
		);
		expect(report.today.totals.net).toBeGreaterThan(0);
		expect(report.yesterday.totals.invoices).toBeGreaterThan(0);
		expect(report.yesterday.baseline.sampleDays).toBe(8);
		expect(report.topItems).toHaveLength(5);
		expect(report.payments.cashToCount).toBeGreaterThan(0);
	});

	it("gives Hôm nay's yesterday the same totals as the analytics engine's day", async () => {
		const { days, stores, invoices } = await loadDemo(now);
		const yesterday = "2026-11-07";
		const counted = invoices.filter(
			(invoice) =>
				invoice.businessDate === yesterday && invoice.status !== "voided",
		);
		const analytics = createDemoAnalyticsSource({
			now: () => now,
			days,
			validateRows: true,
		});
		const rows = await analytics.call("period_compare_by_store", {
			store_ids: stores.map((store) => store.id),
			grain: "day",
			anchor: yesterday,
		});
		const all = rows.find(
			(row) => row.store_id === null && row.period === "current",
		);
		expect(all?.invoices).toBe(counted.length);
		expect(all?.net_amount).toBe(
			counted.reduce((total, invoice) => total + invoice.netAmount, 0),
		);
	});

	it("excludes holidays and Tết days from the baseline dates", async () => {
		const { source } = demoAt(now);
		expect(
			await source.excludedDates(demoTenant, [
				"2026-02-17",
				"2026-09-02",
				"2026-11-03",
			]),
		).toEqual(["2026-02-17", "2026-09-02"]);
	});

	it("reports sample freshness and verification without any network call", async () => {
		const { source } = demoAt(now);
		expect(await source.freshness(DEMO_TENANT_ID)).toEqual({ kind: "sample" });
		expect(
			await source.verification({
				storeIds: ["MOCK-S1"],
				dates: ["2026-11-08"],
			}),
		).toEqual({ kind: "sample" });
	});
});
