import { type RestClient, RestError } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import { createHomeFormatters } from "./format";
import type { RevenueVisibility } from "./model";
import {
	createRestHomeSource,
	type Freshness,
	freshnessMessage,
	type HomeQuery,
	readFreshness,
} from "./source";

const TENANT = "00000000-0000-4000-8000-000000000a01";
const STORE_1 = "00000000-0000-4000-8000-000000000b01";
const STORE_2 = "00000000-0000-4000-8000-000000000b02";
const OTHER_BRAND = "00000000-0000-4000-8000-000000000b03";
const NOW = new Date("2026-11-18T04:42:00Z");

interface Call {
	readonly kind: "select" | "rpc";
	readonly name: string;
	readonly query?: Readonly<Record<string, string>>;
}

interface Answers {
	readonly visibility?: RevenueVisibility;
	readonly runs?: unknown[] | Error;
	readonly totals?: unknown;
	readonly checks?: unknown[];
}

function fakeRest(answers: Answers = {}) {
	const calls: Call[] = [];
	const rest: RestClient = {
		async select(table, query) {
			calls.push({ kind: "select", name: table, query });
			switch (table) {
				case "tenants":
					return [
						{
							id: TENANT,
							currency_code: "VND",
							timezone: "Asia/Ho_Chi_Minh",
							staff_revenue_visibility: answers.visibility ?? "all",
						},
					];
				case "stores":
					return [
						{
							id: STORE_1,
							name: "Cửa hàng Một",
							timezone: "Asia/Ho_Chi_Minh",
							business_day_start_minutes: 0,
							opening_hours: { wed: [["07:00", "22:00"]] },
						},
						{
							id: OTHER_BRAND,
							name: "Cửa hàng Khác",
							timezone: "Asia/Ho_Chi_Minh",
							business_day_start_minutes: 0,
							opening_hours: null,
						},
						{
							id: STORE_2,
							name: "Cửa hàng Hai",
							timezone: "Asia/Ho_Chi_Minh",
							business_day_start_minutes: 0,
							opening_hours: null,
						},
					];
				case "sync_runs":
					if (answers.runs instanceof Error) throw answers.runs;
					return answers.runs ?? [{ finished_at: "2026-11-18T04:30:00+00:00" }];
				case "sync_checks":
					return (
						answers.checks ?? [
							{
								store_id: STORE_1,
								business_date: "2026-11-17",
								is_matched: true,
							},
						]
					);
				default:
					throw new RestError(404);
			}
		},
		async rpc(fn) {
			calls.push({ kind: "rpc", name: fn });
			return (
				answers.totals ?? [
					{
						store_id: STORE_1,
						business_date: "2026-11-18",
						net_amount: "12450000.00",
						invoices: 186,
					},
					{
						store_id: OTHER_BRAND,
						business_date: "2026-11-18",
						net_amount: 99,
						invoices: 1,
					},
					{
						store_id: STORE_2,
						business_date: "2026-11-18",
						net_amount: 0,
						invoices: 0,
					},
				]
			);
		},
	};
	return { rest, calls };
}

function query(role: HomeQuery["role"]): HomeQuery {
	return {
		role,
		tenantId: TENANT,
		storeNames: ["Cửa hàng Hai", "Cửa hàng Một"],
	};
}

describe("the home's data from the Data API", () => {
	it("reads a manager's tenant, brand stores, freshness, today's totals and yesterday's checks", async () => {
		const { rest, calls } = fakeRest({ visibility: "none" });
		const data = await createRestHomeSource(rest).load(query("manager"), NOW);
		expect(calls.map((call) => `${call.kind}:${call.name}`)).toEqual([
			"select:tenants",
			"select:stores",
			"select:sync_runs",
			"rpc:today_store_totals",
			"select:sync_checks",
		]);
		expect(calls[0]?.query).toMatchObject({ id: `eq.${TENANT}`, limit: "1" });
		expect(calls[1]?.query).toMatchObject({
			tenant_id: `eq.${TENANT}`,
			active: "eq.true",
			order: "name.asc,id.asc",
		});
		expect(calls[2]?.query).toMatchObject({
			tenant_id: `eq.${TENANT}`,
			status: "eq.succeeded",
			finished_at: "not.is.null",
			order: "finished_at.desc",
			limit: "1",
		});
		expect(calls[4]?.query).toMatchObject({
			store_id: `in.(${STORE_1},${STORE_2})`,
			business_date: "in.(2026-11-17)",
			is_matched: "is.true",
		});
		expect(data).toMatchObject({
			access: "all",
			currencyCode: "VND",
			timeZone: "Asia/Ho_Chi_Minh",
			freshness: {
				kind: "synced",
				finishedAt: new Date("2026-11-18T04:30:00Z"),
			},
			loadedAt: NOW,
		});
		expect(data.stores).toEqual([
			{
				id: STORE_1,
				name: "Cửa hàng Một",
				today: "2026-11-18",
				yesterday: "2026-11-17",
				hours: { kind: "open", spans: [["07:00", "22:00"]] },
				totals: { net: 12_450_000, invoices: 186 },
				yesterdayVerified: true,
			},
			{
				id: STORE_2,
				name: "Cửa hàng Hai",
				today: "2026-11-18",
				yesterday: "2026-11-17",
				hours: { kind: "unknown" },
				totals: { net: 0, invoices: 0 },
				yesterdayVerified: false,
			},
		]);
	});

	it.each([
		["all", ["rpc:today_store_totals", "select:sync_checks"], true],
		["store_totals", ["rpc:today_store_totals"], null],
		["none", [], null],
	] as const)(
		"asks staff with %s only for what the level allows",
		async (visibility, figureCalls, verified) => {
			const { rest, calls } = fakeRest({ visibility });
			const data = await createRestHomeSource(rest).load(query("staff"), NOW);
			expect(data.access).toBe(visibility);
			expect(calls.slice(3).map((call) => `${call.kind}:${call.name}`)).toEqual(
				figureCalls,
			);
			expect(data.stores[0]?.totals).toEqual(
				visibility === "none" ? null : { net: 12_450_000, invoices: 186 },
			);
			expect(data.stores[0]?.yesterdayVerified).toBe(verified);
		},
	);

	it("reads every tenant of the member when the session names none", async () => {
		const { rest, calls } = fakeRest();
		await createRestHomeSource(rest).load(
			{ ...query("owner"), tenantId: null },
			NOW,
		);
		expect(calls[0]?.query).not.toHaveProperty("id");
		expect(calls[1]?.query).not.toHaveProperty("tenant_id");
		expect(calls[2]?.query).not.toHaveProperty("tenant_id");
	});

	it("asks for no figures when no store of the brand is in scope", async () => {
		const { rest, calls } = fakeRest();
		const data = await createRestHomeSource(rest).load(
			{ ...query("manager"), storeNames: ["Cửa hàng Lạ"] },
			NOW,
		);
		expect(data.stores).toEqual([]);
		expect(calls).toHaveLength(3);
	});

	it("takes the store's day from the database and leaves yesterday unchecked when the phone's clock disagrees", async () => {
		const { rest } = fakeRest({
			totals: [
				{
					store_id: STORE_1,
					business_date: "2026-11-19",
					net_amount: 1,
					invoices: 1,
				},
			],
		});
		const data = await createRestHomeSource(rest).load(query("manager"), NOW);
		expect(data.stores[0]).toMatchObject({
			today: "2026-11-19",
			yesterday: "2026-11-18",
			yesterdayVerified: null,
		});
		expect(data.stores[1]).toMatchObject({
			today: "2026-11-18",
			totals: null,
			yesterdayVerified: false,
		});
	});

	it("shows the freshness as unknown when the sync runs cannot be read, and never synced when there is none", async () => {
		const failed = await createRestHomeSource(
			fakeRest({ runs: new RestError(500) }).rest,
		).load(query("staff"), NOW);
		expect(failed.freshness).toEqual({ kind: "unknown" });
		const never = await createRestHomeSource(fakeRest({ runs: [] }).rest).load(
			query("staff"),
			NOW,
		);
		expect(never.freshness).toEqual({ kind: "never" });
		expect(readFreshness([{ finished_at: "not a time" }])).toEqual({
			kind: "unknown",
		});
	});

	it("refuses rows it cannot read instead of showing wrong figures", async () => {
		await expect(
			createRestHomeSource(
				fakeRest({
					totals: [
						{
							store_id: STORE_1,
							business_date: "2026-11-18",
							net_amount: "lots",
							invoices: 1,
						},
					],
				}).rest,
			).load(query("manager"), NOW),
		).rejects.toThrow("today's totals");
	});
});

describe("the freshness stamp", () => {
	const vi = createHomeFormatters({
		currencyCode: "VND",
		language: "vi",
		timeZone: "Asia/Ho_Chi_Minh",
		million: "tr",
		billion: "tỷ",
	});
	const stamp = (freshness: Freshness) =>
		freshnessMessage(freshness, NOW, "Asia/Ho_Chi_Minh", vi);

	it("gives the time of today's latest successful sync", () => {
		expect(
			stamp({
				kind: "synced",
				finishedAt: new Date("2026-11-17T17:05:00Z"),
			}),
		).toEqual({ key: "home.freshness.updatedAt", params: { time: "00:05" } });
	});

	it("adds the date when the latest successful sync is from an earlier day", () => {
		expect(
			stamp({
				kind: "synced",
				finishedAt: new Date("2026-11-17T16:55:00Z"),
			}),
		).toEqual({
			key: "home.freshness.updatedAtOn",
			params: { time: "23:55", date: "17/11/2026" },
		});
	});

	it("says never synced or unknown instead of a time", () => {
		expect(stamp({ kind: "never" })).toEqual({
			key: "home.freshness.never",
		});
		expect(stamp({ kind: "unknown" })).toEqual({
			key: "home.freshness.unknown",
		});
	});
});
