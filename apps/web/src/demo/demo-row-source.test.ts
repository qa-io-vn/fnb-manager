import { describe, expect, it } from "vitest";
import { addDays } from "../lib/business-dates";
import { computeToday, planToday } from "../metrics/today";
import {
	createDemoRowSource,
	DEMO_TENANT_ID,
	demoTenant,
} from "./demo-row-source";

const now = new Date("2026-11-08T05:30:00.000Z");

async function loadDemo(at: Date) {
	const source = createDemoRowSource(() => at);
	const stores = await source.stores(DEMO_TENANT_ID);
	const plan = planToday(stores, at);
	const storeIds = stores.map((store) => store.id);
	const [invoices, lines, payments, paymentMethods] = await Promise.all([
		source.invoices({ storeIds, dates: plan.requiredDates }),
		source.invoiceLines({ storeIds, dates: plan.todayDates }),
		source.payments({ storeIds, dates: plan.todayDates }),
		source.paymentMethods(DEMO_TENANT_ID),
	]);
	return { source, stores, plan, invoices, lines, payments, paymentMethods };
}

describe("demo row source", () => {
	it("serves one VND tenant with the stores of the mock connector", async () => {
		const source = createDemoRowSource(() => now);
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

	it("generates only the requested dates and links lines and payments to invoices", async () => {
		const { invoices, lines, payments, plan } = await loadDemo(now);
		expect(new Set(invoices.map((invoice) => invoice.businessDate))).toEqual(
			new Set(plan.requiredDates),
		);
		const ids = new Set(invoices.map((invoice) => invoice.id));
		expect(lines.every((line) => ids.has(line.invoiceId))).toBe(true);
		expect(payments.every((payment) => ids.has(payment.invoiceId))).toBe(true);
		expect(lines.some((line) => line.lineKind === "modifier")).toBe(true);
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

	it("reports sample freshness and verification without any network call", async () => {
		const source = createDemoRowSource(() => now);
		expect(await source.freshness(DEMO_TENANT_ID)).toEqual({ kind: "sample" });
		expect(
			await source.verification({
				storeIds: ["MOCK-S1"],
				dates: ["2026-11-08"],
			}),
		).toEqual({ kind: "sample" });
	});
});
