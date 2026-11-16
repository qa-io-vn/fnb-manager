import { promotionRules } from "@fnb/core";
import { addDays, DISCOUNT_DAYS_FIRST_YEAR } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { complianceDay } from "./compliance-cases.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { compareThemeCall, themeEngine, themeSql } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const OLD_RULE_END = promotionRules("VN").find(
	(rule) => rule.id === "discount_days",
)?.validTo;

describe("item_discount_days in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const engines = new Map<string, DemoReportSource>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
		for (const seeded of database.datasets) {
			engines.set(seeded.dataset.id, themeEngine(seeded, clock));
		}
	});

	afterAll(async () => {
		console.info(
			`item_discount_days parity: ${report.summary().split("\n")[0]}`,
		);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function engineOf(seeded: SeededDataset): DemoReportSource {
		const engine = engines.get(seeded.dataset.id);
		if (engine === undefined) throw new Error("no theme engine");
		return engine;
	}

	function callsOf(seeded: SeededDataset) {
		const firstYear = Number(seeded.window.from.slice(0, 4));
		const lastYear = Number(clock.today.slice(0, 4));
		const calls: { calendar_year: number; as_of_date?: string }[] = [];
		for (let year = firstYear - 1; year <= lastYear; year += 1) {
			if (year < DISCOUNT_DAYS_FIRST_YEAR) continue;
			calls.push({ calendar_year: year });
			calls.push({ calendar_year: year, as_of_date: `${year}-01-15` });
		}
		if (OLD_RULE_END !== undefined && OLD_RULE_END !== null) {
			calls.push({
				calendar_year: Number(OLD_RULE_END.slice(0, 4)),
				as_of_date: OLD_RULE_END,
			});
		}
		calls.push({
			calendar_year: lastYear,
			as_of_date: addDays(clock.asOf, -1),
		});
		return calls;
	}

	it("matches every store set for each year of the data and the year before, with the default as-of day, a January as-of day and the end of the old 120-day rule", async () => {
		expect(OLD_RULE_END).toBe("2026-06-25");
		const context = active();
		for (const seeded of context.datasets) {
			for (const call of callsOf(seeded)) {
				for (const stores of STORE_SETS) {
					await compareThemeCall(
						report,
						context,
						seeded,
						engineOf(seeded),
						"item_discount_days",
						{ store_ids: [...stores], ...call },
						{ key: ["item_external_id"], checkOrder: true },
					);
				}
			}
		}
		expect(report.rows).toBeGreaterThan(300);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("keeps price-discount, gift, bill and voucher days apart on the compliance cases' day: a gift-only item gains a gift day and no price day, a fully discounted bill adds no bill day", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D3",
		);
		if (seeded === undefined) throw new Error("no D3 dataset");
		const day = complianceDay(clock.asOf);
		const args = {
			store_ids: ["MOCK-S1"],
			calendar_year: Number(day.slice(0, 4)),
			as_of_date: day,
		};
		await compareThemeCall(
			report,
			context,
			seeded,
			engineOf(seeded),
			"item_discount_days",
			args,
			{ key: ["item_external_id"], checkOrder: true },
			" cases",
		);
		const before = await engineOf(seeded).callTheme("item_discount_days", {
			...args,
			as_of_date: addDays(day, -1),
		});
		const rows = await engineOf(seeded).callTheme("item_discount_days", args);
		const keysOf = async (where: string) =>
			new Set(
				(
					await context.connection.rows(
						`with d as (
							select x.*, x.discount_amount >= x.base_amount as is_full
							from app.discount_rows($1::uuid[], $2::date, $2::date) x
						)
						select distinct coalesce(il.item_external_id, il.item_name) as item
						from d
						join public.invoice_lines il on il.invoice_id = d.invoice_id and il.line_kind = 'item'
						where ${where}`,
						[`{${seeded.uuidOf("MOCK-S1")}}`, day],
					)
				).map((row) => String(row.item)),
			);
		const giftItems = await keysOf(
			"d.promotion_kind = 'item' and d.is_full and d.item_key = coalesce(il.item_external_id, il.item_name)",
		);
		const partialLineItems = await keysOf(
			"d.promotion_kind = 'item' and not d.is_full and d.item_key = coalesce(il.item_external_id, il.item_name)",
		);
		const billItems = await keysOf(
			"d.promotion_kind = 'bill' and not d.is_full",
		);
		const fullBillItems = await keysOf(
			"d.promotion_kind = 'bill' and d.is_full",
		);
		const voucherItems = await keysOf("d.promotion_kind = 'voucher'");
		const change = (key: string) => {
			const now = rows.find((row) => row.item_external_id === key);
			const earlier = before.find((row) => row.item_external_id === key);
			return {
				gift: (now?.gift_days ?? 0) - (earlier?.gift_days ?? 0),
				price:
					(now?.price_discount_days ?? 0) - (earlier?.price_discount_days ?? 0),
				bill:
					(now?.bill_discount_days ?? 0) - (earlier?.bill_discount_days ?? 0),
			};
		};
		const giftOnly = [...giftItems].filter(
			(key) =>
				!partialLineItems.has(key) &&
				!billItems.has(key) &&
				!voucherItems.has(key),
		);
		expect(giftOnly.length).toBeGreaterThan(0);
		for (const key of giftOnly) {
			expect(change(key), key).toMatchObject({ gift: 1, price: 0 });
		}
		const fullBillOnly = [...fullBillItems].filter(
			(key) => !billItems.has(key),
		);
		expect(fullBillOnly.length).toBeGreaterThan(0);
		for (const key of fullBillOnly) {
			expect(change(key).bill, key).toBe(0);
		}
		expect(voucherItems.size).toBeGreaterThan(0);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("splits the days at each year boundary of the long history in both engines", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D2",
		);
		if (seeded === undefined) throw new Error("no D2 dataset");
		let boundaries = 0;
		for (
			let year = Number(seeded.window.from.slice(0, 4));
			`${year + 1}-01-07` <= clock.asOf;
			year += 1
		) {
			if (`${year}-12-24` < seeded.window.from) continue;
			boundaries += 1;
			for (const stores of STORE_SETS) {
				for (const call of [
					{ calendar_year: year, as_of_date: `${year}-12-31` },
					{ calendar_year: year + 1, as_of_date: `${year + 1}-01-07` },
				]) {
					await compareThemeCall(
						report,
						context,
						seeded,
						engineOf(seeded),
						"item_discount_days",
						{ store_ids: [...stores], ...call },
						{ key: ["item_external_id"], checkOrder: true },
						" year boundary",
					);
				}
			}
			const january = await engineOf(seeded).callTheme("item_discount_days", {
				store_ids: ["MOCK-S1", "MOCK-S2"],
				calendar_year: year + 1,
				as_of_date: `${year + 1}-01-07`,
			});
			expect(
				january.every(
					(row) =>
						row.first_price_discount_on === null ||
						row.first_price_discount_on >= `${year + 1}-01-01`,
				),
			).toBe(true);
		}
		expect(boundaries).toBeGreaterThan(0);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("refuses a year before 2023 and a year after the current one in both engines", async () => {
		const context = active();
		const seeded = context.datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		const nextYear = Number(clock.today.slice(0, 4)) + 1;
		const { text, params } = themeSql(seeded, "item_discount_days", {
			store_ids: ["MOCK-S1"],
			calendar_year: nextYear,
		});
		const sqlCode = await context.connection.rows(text, params).then(
			() => null,
			(error: { code?: string }) => error.code ?? "error",
		);
		const engineCode = await engineOf(seeded)
			.callTheme("item_discount_days", {
				store_ids: ["MOCK-S1"],
				calendar_year: nextYear,
			})
			.then(
				() => null,
				(error: { code?: string }) => error.code ?? "error",
			);
		expect([sqlCode, engineCode]).toEqual(["22023", "22023"]);
		const old = themeSql(seeded, "item_discount_days", {
			store_ids: ["MOCK-S1"],
			calendar_year: 2022,
		});
		await expect(
			context.connection.rows(old.text, old.params),
		).rejects.toMatchObject({ code: "22023" });
		await expect(
			engineOf(seeded).callTheme("item_discount_days", {
				store_ids: ["MOCK-S1"],
				calendar_year: 2022,
			}),
		).rejects.toMatchObject({ code: "invalid_arguments" });
	}, 900_000);
});
