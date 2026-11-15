import {
	addDays,
	DEFAULT_REPORT_SETTINGS,
	firstOfMonth,
	type IsoDate,
	maxDate,
	minDate,
} from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	dailyNetSeries,
	weekdayProfile,
} from "../../src/functions/forecast-series-helpers.js";
import {
	type DemoReportSource,
	type DemoStoreId,
	isExcludedDemoDay,
	sameWeekdayBaseline,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { inWindow, parityClock, parityDatasets } from "./datasets.js";
import {
	attachRows,
	dailyRows,
	itemRows,
	paymentRows,
	shiftCashRows,
} from "./engine-rows.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
	type SeededDataset,
} from "./harness.js";
import { compareCall, GRAINS, STORE_SETS } from "./matrix.js";
import {
	applyMenuVariant,
	CUSTOM_HOLIDAY_NAME,
	KIND_OVERRIDE_METHOD,
	type MenuVariant,
} from "./settings-fixture.js";
import { compareThemeCall, seedSeats, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const BASELINE_WEEKS = 8;
const RATE_EDGE_DAYS = 7;

interface Variant {
	readonly engine: DemoReportSource;
	readonly variant: MenuVariant;
	readonly snackLinesBefore: number;
}

async function snackLines(
	database: OpenParityDatabase,
	seeded: SeededDataset,
): Promise<number> {
	const rows = await database.connection.rows(
		"select coalesce(sum(snack_lines), 0)::integer as lines from public.agg_attach_daily where tenant_id = $1::uuid",
		[seeded.tenantId],
	);
	return Number(rows[0]?.lines ?? 0);
}

function storeUuids(seeded: SeededDataset, stores: readonly string[]): string {
	return pgArray(stores.map((id) => seeded.uuidOf(id as DemoStoreId)));
}

function clipped(
	seeded: SeededDataset,
	from: IsoDate,
	to: IsoDate,
): { from_date: IsoDate; to_date: IsoDate } {
	return {
		from_date: maxDate(seeded.window.from, from),
		to_date: minDate(seeded.window.to, to),
	};
}

describe("aggregates and settings follow category overrides, costs, fee rates and a custom holiday in both engines", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const variants = new Map<string, Variant>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
		for (const seeded of database.datasets) {
			await seedSeats(database, seeded);
			const snackLinesBefore = await snackLines(database, seeded);
			const engine = themeEngine(seeded, clock);
			const variant = await applyMenuVariant(database, seeded, engine);
			variants.set(seeded.dataset.id, { engine, variant, snackLinesBefore });
		}
	});

	afterAll(async () => {
		console.info(`overrides parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function variantOf(seeded: SeededDataset): Variant {
		const found = variants.get(seeded.dataset.id);
		if (found === undefined) throw new Error("the variant was not applied");
		return found;
	}

	it("matches agg_attach_daily, agg_item_daily and report_settings_of after the overrides", async () => {
		for (const seeded of active().datasets) {
			const { engine, snackLinesBefore } = variantOf(seeded);
			expect(await snackLines(active(), seeded)).toBeGreaterThan(
				snackLinesBefore,
			);
			for (const [table, rows, key] of [
				["agg_attach_daily", attachRows, ["store_id", "business_date"]],
				[
					"agg_item_daily",
					itemRows,
					["store_id", "business_date", "item_external_id"],
				],
			] as const) {
				const sqlRows = await active().connection.rows(
					`select * from public.${table} where tenant_id = $1::uuid order by store_id, business_date`,
					[seeded.tenantId],
				);
				report.compareRows(
					`${seeded.dataset.id} ${table} with overrides`,
					sqlRows,
					rows(seeded),
					{
						key,
						ignore: ["tenant_id", "refreshed_at"],
						demoIdOf: seeded.demoIdOf,
						checkOrder: false,
					},
				);
			}
			for (const stores of STORE_SETS) {
				await compareThemeCall(
					report,
					active(),
					seeded,
					engine,
					"report_settings_of",
					{ store_ids: [...stores] },
					{ key: ["store_id"], checkOrder: true, ignore: ["tenant_id"] },
					" with costs and fee rates",
				);
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);

	it("estimates payment fees as the refresh does and reads the payment_summary fee estimates alike", async () => {
		for (const seeded of active().datasets) {
			const { engine, variant } = variantOf(seeded);
			const sqlRows = await active().connection.rows(
				"select * from public.agg_payment_daily where tenant_id = $1::uuid order by store_id, business_date, payment_method_external_id",
				[seeded.tenantId],
			);
			expect(sqlRows.some((row) => Number(row.fee_estimate_amount) > 0)).toBe(
				true,
			);
			report.compareRows(
				`${seeded.dataset.id} agg_payment_daily with fee rates`,
				sqlRows,
				paymentRows(seeded),
				{
					key: ["store_id", "business_date", "payment_method_external_id"],
					ignore: ["tenant_id", "refreshed_at"],
					demoIdOf: seeded.demoIdOf,
					checkOrder: false,
				},
			);
			const ranges = [
				...variant.feeRates.map((rate) =>
					clipped(
						seeded,
						addDays(rate.effectiveFrom, -RATE_EDGE_DAYS),
						addDays(rate.effectiveFrom, RATE_EDGE_DAYS),
					),
				),
				{
					...clipped(seeded, addDays(clock.asOf, -27), clock.asOf),
					compare_from: maxDate(seeded.window.from, addDays(clock.asOf, -55)),
					compare_to: maxDate(seeded.window.from, addDays(clock.asOf, -28)),
				},
			];
			for (const stores of STORE_SETS) {
				for (const range of ranges) {
					await compareCall(
						report,
						active(),
						seeded,
						"payment_summary",
						{ store_ids: [...stores], ...range },
						{ key: ["method_key"] },
						engine,
						" with fee rates",
					);
				}
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);

	it("follows a payment-kind override in the payment rows and the daily and shift cash, and keeps the drawer's expected cash of the sync", async () => {
		for (const seeded of active().datasets) {
			const kinds = await active().connection.rows(
				"select distinct kind from public.agg_payment_daily where tenant_id = $1::uuid and payment_method_external_id = $2 and store_id = $3::uuid",
				[seeded.tenantId, KIND_OVERRIDE_METHOD, seeded.uuidOf("MOCK-S1")],
			);
			expect(kinds).toEqual([{ kind: "cash" }]);
			for (const [table, rows, key, timestamps, ignore] of [
				[
					"agg_daily_sales",
					dailyRows,
					["store_id", "business_date"],
					[],
					["tenant_id", "refreshed_at"],
				],
				[
					"agg_shift_cash",
					shiftCashRows,
					["store_id", "shift_external_id"],
					["opened_at", "closed_at"],
					["tenant_id", "refreshed_at", "shift_id"],
				],
			] as const) {
				report.compareRows(
					`${seeded.dataset.id} ${table} with a payment-kind override`,
					await active().connection.rows(
						`select * from public.${table} where tenant_id = $1::uuid order by store_id, business_date`,
						[seeded.tenantId],
					),
					rows(seeded),
					{
						key,
						ignore,
						timestampColumns: timestamps,
						demoIdOf: seeded.demoIdOf,
						checkOrder: false,
					},
				);
			}
			const shifts = await active().connection.rows(
				"select count(*)::integer as shifts from public.agg_shift_cash where tenant_id = $1::uuid and store_id = $2::uuid and cash_sales_amount + opening_float_amount <> expected_cash_amount",
				[seeded.tenantId, seeded.uuidOf("MOCK-S1")],
			);
			expect(shifts[0]?.shifts).toBeGreaterThan(0);
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);

	it("excludes the custom holiday wherever the SQL reads the tenant's holidays", async () => {
		for (const seeded of active().datasets) {
			const { engine, variant } = variantOf(seeded);
			const holiday = variant.holidays[0];
			if (holiday === undefined) throw new Error("the variant has no holiday");
			const date = holiday.holidayDate;
			expect(engine.settings.customHolidays()).toEqual(variant.holidays);
			const calendar = engine.settings.holidays();
			expect(isExcludedDemoDay(calendar, date)).toBe(true);
			const anchors = [...new Set([date, addDays(date, 7), clock.asOf])]
				.filter((anchor) => inWindow(seeded.dataset, anchor))
				.sort();
			const context = {
				now: clock.now,
				holidays: calendar,
				reportSettings: DEFAULT_REPORT_SETTINGS,
				settings: engine.settings,
			};
			for (const stores of STORE_SETS) {
				const uuids = storeUuids(seeded, stores);
				const excluded = await active().connection.rows(
					"select d::date::text as day, app.is_excluded_day($1::uuid[], d::date) as excluded from generate_series($2::date, $3::date, interval '1 day') as d order by d",
					[uuids, addDays(date, -1), addDays(date, 1)],
				);
				report.compareRows(
					`${seeded.dataset.id} is_excluded_day(${stores.join(",")}) around ${date}`,
					excluded,
					[-1, 0, 1].map((offset) => {
						const day = addDays(date, offset);
						return { day, excluded: isExcludedDemoDay(calendar, day) };
					}),
					{ key: ["day"] },
				);
				const series = await compareCall(
					report,
					active(),
					seeded,
					"period_series",
					{
						store_ids: [...stores],
						grain: "day",
						...clipped(seeded, addDays(date, -27), addDays(date, 7)),
					},
					{ key: ["store_id", "bucket_start", "weekday"] },
					engine,
					" with a custom holiday",
				);
				expect(
					series.rows?.find(
						(row) => row.bucket_start === date && row.store_id === null,
					)?.holiday_kind,
				).toBe("custom");
				for (const grain of ["week", "weekday"] as const) {
					await compareCall(
						report,
						active(),
						seeded,
						"period_series",
						{
							store_ids: [...stores],
							grain,
							...clipped(seeded, addDays(date, -55), addDays(date, 7)),
						},
						{ key: ["store_id", "bucket_start", "weekday"] },
						engine,
						" with a custom holiday",
					);
				}
				for (const anchor of anchors) {
					for (const grain of GRAINS) {
						await compareCall(
							report,
							active(),
							seeded,
							"period_compare",
							{ store_ids: [...stores], grain, anchor },
							{ key: ["period"] },
							engine,
							" with a custom holiday",
						);
						await compareCall(
							report,
							active(),
							seeded,
							"period_compare_by_store",
							{ store_ids: [...stores], grain, anchor },
							{ key: ["store_id", "period"] },
							engine,
							" with a custom holiday",
						);
					}
					await compareCall(
						report,
						active(),
						seeded,
						"daily_baselines",
						{
							store_ids: [...stores],
							from_date: addDays(anchor, -13),
							to_date: anchor,
							weeks: BASELINE_WEEKS,
						},
						{ key: ["business_date"] },
						engine,
						" with a custom holiday",
					);
					await compareCall(
						report,
						active(),
						seeded,
						"hourly_profile",
						{
							store_ids: [...stores],
							target_date: anchor,
							weeks: BASELINE_WEEKS,
						},
						{ key: ["hour_local"] },
						engine,
						" with a custom holiday",
					);
					await compareCall(
						report,
						active(),
						seeded,
						"month_pace",
						{
							store_ids: [...stores],
							month_start: firstOfMonth(anchor),
							as_of: anchor,
						},
						{ key: ["period_start"] },
						engine,
						" with a custom holiday",
					);
					await compareCall(
						report,
						active(),
						seeded,
						"forecast_accuracy",
						{ store_ids: [...stores], as_of_date: anchor, days: 28 },
						{ key: ["forecast_id"] },
						engine,
						" with a custom holiday",
					);
					const label = `${seeded.dataset.id} with a custom holiday (${stores.join(",")}, ${anchor})`;
					report.compareRows(
						`same_weekday_baseline${label}`,
						await active().connection.rows(
							"select * from public.same_weekday_baseline($1::uuid[], $2::date, $3)",
							[uuids, anchor, BASELINE_WEEKS],
						),
						sameWeekdayBaseline(
							engine.aggregates,
							{
								store_ids: stores,
								target_date: anchor,
								weeks: BASELINE_WEEKS,
							},
							context,
						) as unknown as Record<string, unknown>[],
						{ key: ["weekday"], demoIdOf: seeded.demoIdOf },
					);
					const seriesFrom = addDays(anchor, -83);
					report.compareRows(
						`daily_net_series${label}`,
						await active().connection.rows(
							"select business_date, net_amount::text as net_amount, excluded from app.daily_net_series($1::uuid[], $2::date, $3::date) order by business_date",
							[uuids, seriesFrom, anchor],
						),
						dailyNetSeries(
							engine.aggregates,
							stores,
							seriesFrom,
							anchor,
							calendar,
						).map((point) => ({
							business_date: point.date,
							net_amount: point.net.toString(),
							excluded: point.excluded,
						})),
						{ key: ["business_date"] },
					);
					report.compareRows(
						`weekday_profile${label}`,
						await active().connection.rows(
							"select weekday, level_net_amount::text as level_net_amount, weekday_index::text as weekday_index from app.weekday_profile($1::uuid[], $2::date) order by weekday",
							[uuids, anchor],
						),
						weekdayProfile(engine.aggregates, stores, anchor, calendar).map(
							(entry) => ({
								weekday: entry.weekday,
								level_net_amount: entry.level?.toString() ?? null,
								weekday_index: entry.index?.toString() ?? null,
							}),
						),
						{ key: ["weekday"] },
					);
				}
			}
			expect(holiday.name).toBe(CUSTOM_HOLIDAY_NAME);
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);
});
