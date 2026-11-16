import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	type IsoDate,
	PROMOTION_COMPARATORS,
	type PromotionKind,
} from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource, DemoStoreId } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import {
	inWindow,
	monthEnds,
	parityClock,
	parityDatasets,
	seededRanges,
} from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import {
	SOLO_PROMOTION,
	soloDays,
	YOUNG_SOLO_PROMOTION,
	youngSoloDays,
} from "./solo-cases.js";
import {
	applySettingsVariant,
	compareThemeCall,
	SETTINGS_VARIANTS,
	themeEngine,
} from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const LIFT_DAYS = 92;
const PRESET_DAYS = [7, 28, LIFT_DAYS] as const;
const RANDOM_RANGES = 10;
const TET_DAY = "Tet, day 4";

interface Promotion {
	readonly kind: PromotionKind;
	readonly key: string;
}

interface Range {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

function clipped(seeded: SeededDataset, from: IsoDate, to: IsoDate): Range {
	return {
		from: from < seeded.window.from ? seeded.window.from : from,
		to: to > seeded.window.to ? seeded.window.to : to,
	};
}

describe("promotion_lift in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const engines = new Map<string, DemoReportSource>();
	const flagsSeen = new Set<string>();

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
		console.info(`promotion_lift parity: ${report.summary().split("\n")[0]}`);
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

	async function promotionsOf(seeded: SeededDataset): Promise<Promotion[]> {
		const rows = await active().connection.rows(
			`select d.promotion_kind as kind, d.promotion_key as key, count(*)::integer as uses
			from app.discount_rows($1::uuid[], $2::date, $3::date) d
			group by 1, 2
			order by uses desc, d.promotion_kind collate "C", d.promotion_key collate "C"`,
			[
				pgArray(
					(["MOCK-S1", "MOCK-S2"] as const).map((id) => seeded.uuidOf(id)),
				),
				seeded.window.from,
				seeded.window.to,
			],
		);
		const chosen = new Map<string, Promotion>();
		for (const row of rows) {
			const promotion = {
				kind: row.kind as PromotionKind,
				key: String(row.key),
			};
			const slot = promotion.key.startsWith("PARITY-")
				? promotion.key
				: promotion.kind;
			if (!chosen.has(slot)) chosen.set(slot, promotion);
		}
		return [...chosen.values()];
	}

	function specialRanges(seeded: SeededDataset): Range[] {
		const end = clock.asOf;
		const young = seeded.stores["MOCK-S2"].definition.openedOn;
		const ranges: Range[] = PRESET_DAYS.map((days) =>
			clipped(seeded, addDays(end, -(days - 1)), end),
		);
		if (inWindow(seeded.dataset, young)) {
			ranges.push(clipped(seeded, young, addDays(young, 27)));
		}
		for (const monthEnd of monthEnds(clock, 1)) {
			ranges.push(
				clipped(seeded, addDays(monthEnd, -13), addDays(monthEnd, 14)),
			);
		}
		for (const tet of VIETNAM_HOLIDAYS.filter(
			(holiday) => holiday.name === TET_DAY,
		).map((holiday) => holiday.holidayDate)) {
			if (inWindow(seeded.dataset, tet)) {
				ranges.push(clipped(seeded, addDays(tet, -20), addDays(tet, 20)));
			}
		}
		return ranges.filter((range) => range.from <= range.to);
	}

	async function compare(
		seeded: SeededDataset,
		stores: readonly DemoStoreId[],
		promotion: Promotion,
		range: Range,
		comparator: (typeof PROMOTION_COMPARATORS)[number],
		label: string,
		preWeeks?: number,
	): Promise<void> {
		const args = {
			store_ids: [...stores],
			promotion_kind: promotion.kind,
			promotion_key: promotion.key,
			from_date: range.from,
			to_date: range.to,
			comparator,
			...(preWeeks === undefined ? {} : { pre_weeks: preWeeks }),
		};
		await compareThemeCall(
			report,
			active(),
			seeded,
			engineOf(seeded),
			"promotion_lift",
			args,
			{ key: ["business_date"], checkOrder: true },
			label,
		);
		const summary = (
			await engineOf(seeded)
				.callTheme("promotion_lift", args)
				.catch(() => [])
		).at(-1);
		for (const flag of summary?.flags ?? []) flagsSeen.add(flag);
	}

	it("matches every comparator over the presets, the young store's first weeks, a month end and Tết under both settings variants (the baseline under the tenant's pre-period for both stores only, where it decides the control stores), and over seeded ranges", async () => {
		const context = active();
		for (const variant of SETTINGS_VARIANTS) {
			for (const seeded of context.datasets) {
				await applySettingsVariant(context, seeded, engineOf(seeded), variant);
				const promotions = await promotionsOf(seeded);
				expect(promotions.length).toBeGreaterThan(1);
				for (const [index, range] of specialRanges(seeded).entries()) {
					const promotion = promotions[index % promotions.length] as Promotion;
					for (const stores of STORE_SETS) {
						for (const comparator of PROMOTION_COMPARATORS) {
							if (
								variant.settings !== null &&
								comparator === "baseline" &&
								stores.length < 2
							) {
								continue;
							}
							await compare(
								seeded,
								stores,
								promotion,
								range,
								comparator,
								` ${variant.id}`,
							);
						}
					}
				}
				if (variant.settings !== null) continue;
				const random = seededRanges(
					seeded.dataset,
					RANDOM_RANGES,
					63,
					LIFT_DAYS,
				);
				for (const [index, range] of random.entries()) {
					for (const comparator of PROMOTION_COMPARATORS) {
						await compare(
							seeded,
							STORE_SETS[index % STORE_SETS.length] as readonly DemoStoreId[],
							promotions[index % promotions.length] as Promotion,
							range,
							comparator,
							" seeded",
						);
					}
				}
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("matches every promotion and an explicit pre-period, and refuses the same calls", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			const promotions = await promotionsOf(seeded);
			const range = clipped(
				seeded,
				addDays(clock.asOf, -(LIFT_DAYS - 1)),
				clock.asOf,
			);
			for (const promotion of promotions) {
				for (const comparator of PROMOTION_COMPARATORS) {
					await compare(
						seeded,
						["MOCK-S1", "MOCK-S2"],
						promotion,
						range,
						comparator,
						" every promotion",
						2,
					);
				}
			}
			await compare(
				seeded,
				["MOCK-S1"],
				{ kind: "voucher", key: "no-such-voucher" },
				range,
				"baseline",
				" unused",
			);
			for (const refused of [
				{ from: addDays(range.to, -LIFT_DAYS), to: range.to },
				{ from: range.to, to: addDays(range.to, -1) },
			]) {
				await compare(
					seeded,
					["MOCK-S1"],
					promotions[0] as Promotion,
					refused,
					"baseline",
					" refused",
				);
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("measures a promotion only one store ran against the other store as its sister, as the SQL does", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D1",
		);
		if (seeded === undefined) throw new Error("no D1 dataset");
		const solo = { kind: "item", key: SOLO_PROMOTION.id } as const;
		const days = soloDays(clock.asOf);
		const range = {
			from: addDays(days[0] as IsoDate, -7),
			to: addDays(days.at(-1) as IsoDate, 7),
		};
		for (const comparator of PROMOTION_COMPARATORS) {
			for (const preWeeks of [undefined, 2, 8]) {
				await compare(
					seeded,
					["MOCK-S1", "MOCK-S2"],
					solo,
					range,
					comparator,
					" solo",
					preWeeks,
				);
			}
		}
		const summary = (
			await engineOf(seeded).callTheme("promotion_lift", {
				store_ids: ["MOCK-S1", "MOCK-S2"],
				promotion_kind: solo.kind,
				promotion_key: solo.key,
				from_date: range.from,
				to_date: range.to,
				comparator: "sister_store",
			})
		).at(-1);
		expect(summary).toMatchObject({
			test_store_count: 1,
			control_store_count: 1,
			promo_days: days.length,
		});
		expect(summary?.measured_days).toBeGreaterThan(0);
		expect(summary?.lift_rate).not.toBeNull();
		const young = { kind: "item", key: YOUNG_SOLO_PROMOTION.id } as const;
		const youngDays = youngSoloDays(clock.asOf);
		const youngRange = {
			from: youngDays[0] as IsoDate,
			to: addDays(youngDays.at(-1) as IsoDate, 3),
		};
		for (const comparator of PROMOTION_COMPARATORS) {
			await compare(
				seeded,
				["MOCK-S1", "MOCK-S2"],
				young,
				youngRange,
				comparator,
				" young solo",
			);
		}
		const youngSummary = (
			await engineOf(seeded).callTheme("promotion_lift", {
				store_ids: ["MOCK-S1", "MOCK-S2"],
				promotion_kind: young.kind,
				promotion_key: young.key,
				from_date: youngRange.from,
				to_date: youngRange.to,
				comparator: "sister_store",
			})
		).at(-1);
		expect(youngSummary?.flags).toContain("control_differs_in_size");
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("sees every flag of the lift in the calls compared", () => {
		expect([...flagsSeen].sort()).toEqual([
			"control_differs_in_size",
			"excluded_days_in_window",
			"few_control_days",
			"few_promo_days",
			"few_reference_days",
			"no_control_store",
			"no_test_store",
			"other_promotions",
			"unmeasured_days",
		]);
	});

	it("gives a promotion run on every day of the window few_control_days and no measured day in both engines", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D3",
		);
		if (seeded === undefined) throw new Error("no D3 dataset");
		const daily = (await promotionsOf(seeded)).find(
			(promotion) =>
				promotion.kind === "item" && promotion.key !== "PARITY-GIFT",
		);
		if (daily === undefined) throw new Error("no item promotion");
		const used = new Set(
			(
				await context.connection.rows(
					`select distinct d.business_date::text as day
					from app.discount_rows($1::uuid[], $2::date, $3::date) d
					where d.promotion_kind = $4 and d.promotion_key = $5`,
					[
						pgArray([seeded.uuidOf("MOCK-S1")]),
						seeded.window.from,
						clock.asOf,
						daily.kind,
						daily.key,
					],
				)
			).map((row) => String(row.day)),
		);
		let from = clock.asOf;
		while (used.has(addDays(from, -1))) from = addDays(from, -1);
		expect(used.has(clock.asOf)).toBe(true);
		expect(from <= addDays(clock.asOf, -6)).toBe(true);
		const args = {
			store_ids: ["MOCK-S1"],
			promotion_kind: daily.kind,
			promotion_key: daily.key,
			from_date: from,
			to_date: clock.asOf,
			comparator: "baseline" as const,
		};
		const fromEngine = await engineOf(seeded).callTheme("promotion_lift", args);
		const [sqlSummary] = await context.connection.rows(
			`select * from public.promotion_lift(
				store_ids => $1::uuid[], promotion_kind => $2, promotion_key => $3,
				from_date => $4::date, to_date => $5::date, comparator => $6
			) where business_date is null`,
			[
				pgArray([seeded.uuidOf("MOCK-S1")]),
				args.promotion_kind,
				args.promotion_key,
				args.from_date,
				args.to_date,
				args.comparator,
			],
		);
		const summary = fromEngine.at(-1);
		expect(fromEngine.slice(0, -1).every((row) => row.promo_day)).toBe(true);
		expect(summary?.flags).toContain("few_control_days");
		expect(summary?.measured_days).toBe(0);
		expect(sqlSummary?.measured_days).toBe(0);
		expect(String(sqlSummary?.flags)).toContain("few_control_days");
	}, 900_000);
});
