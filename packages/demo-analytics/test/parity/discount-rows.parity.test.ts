import { addDays, type IsoDate } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	discountRows,
	type StoreDiscountRow,
} from "../../src/functions/discount-rows.js";
import {
	type DemoReportSource,
	type DemoStoreId,
	money,
	type PgDecimal,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import {
	COMPLIANCE_STORE,
	complianceDay,
	DEEP_DISCOUNT_SHARE,
	GIFT_PROMOTION,
	ITEM_PROMOTION_ID,
} from "./compliance-cases.js";
import { parityClock, parityDatasets, seededRanges } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	pgArray,
	type SeededDataset,
	type SqlRow,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_RANGES = 6;
const RANDOM_RANGE_DAYS = 120;
const LONG_RANGE_DAYS = 400;

const GROUPED_SQL = `
	select
		d.promotion_kind,
		d.promotion_key,
		max(d.promotion_name collate "C") as promotion_name,
		count(*)::integer as row_count,
		count(distinct d.invoice_id)::integer as invoices,
		count(distinct d.business_date)::integer as days,
		count(distinct d.item_key)::integer as items,
		sum(d.discount_amount) as discount_amount,
		sum(d.base_amount) as base_amount,
		min(d.discount_rate) as min_rate,
		max(d.discount_rate) as max_rate,
		(count(*) filter (where d.discount_rate is null))::integer as unrated_rows,
		(count(*) filter (where d.discount_amount >= d.base_amount))::integer as full_rows,
		min(d.business_date)::text as first_on,
		max(d.business_date)::text as last_on
	from app.discount_rows($1::uuid[], $2::date, $3::date) d
	group by d.promotion_kind, d.promotion_key
	order by d.promotion_kind collate "C", d.promotion_key collate "C"
`;

function byCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function lesser(left: PgDecimal | null, right: PgDecimal | null) {
	if (left === null) return right;
	if (right === null) return left;
	return right.compare(left) < 0 ? right : left;
}

function greater(left: PgDecimal | null, right: PgDecimal | null) {
	if (left === null) return right;
	if (right === null) return left;
	return right.compare(left) > 0 ? right : left;
}

interface Group {
	kind: string;
	key: string;
	name: string;
	rows: number;
	invoices: Set<string>;
	days: Set<IsoDate>;
	items: Set<string>;
	discountMinor: number;
	baseMinor: number;
	minRate: PgDecimal | null;
	maxRate: PgDecimal | null;
	unrated: number;
	full: number;
	first: IsoDate;
	last: IsoDate;
}

function groupedEngineRows(rows: readonly StoreDiscountRow[]): SqlRow[] {
	const groups = new Map<string, Group>();
	for (const row of rows) {
		const mapKey = `${row.kind}\u0000${row.key}`;
		let group = groups.get(mapKey);
		if (group === undefined) {
			group = {
				kind: row.kind,
				key: row.key,
				name: row.name,
				rows: 0,
				invoices: new Set(),
				days: new Set(),
				items: new Set(),
				discountMinor: 0,
				baseMinor: 0,
				minRate: null,
				maxRate: null,
				unrated: 0,
				full: 0,
				first: row.businessDate,
				last: row.businessDate,
			};
			groups.set(mapKey, group);
		}
		if (row.name > group.name) group.name = row.name;
		group.rows += 1;
		group.invoices.add(`${row.storeId}\u0000${row.invoiceExternalId}`);
		group.days.add(row.businessDate);
		if (row.itemKey !== null) group.items.add(row.itemKey);
		group.discountMinor += row.discountMinor;
		group.baseMinor += row.baseMinor;
		group.minRate = lesser(group.minRate, row.rate);
		group.maxRate = greater(group.maxRate, row.rate);
		if (row.rate === null) group.unrated += 1;
		if (row.discountMinor >= row.baseMinor) group.full += 1;
		if (row.businessDate < group.first) group.first = row.businessDate;
		if (row.businessDate > group.last) group.last = row.businessDate;
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				byCodeUnits(left.kind, right.kind) || byCodeUnits(left.key, right.key),
		)
		.map((group) => ({
			promotion_kind: group.kind,
			promotion_key: group.key,
			promotion_name: group.name,
			row_count: group.rows,
			invoices: group.invoices.size,
			days: group.days.size,
			items: group.items.size,
			discount_amount: money(group.discountMinor).toString(),
			base_amount: money(group.baseMinor).toString(),
			min_rate: group.minRate?.toString() ?? null,
			max_rate: group.maxRate?.toString() ?? null,
			unrated_rows: group.unrated,
			full_rows: group.full,
			first_on: group.first,
			last_on: group.last,
		}));
}

describe("the engine's discount rows equal app.discount_rows grouped by kind and key", () => {
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
		console.info(`discount-row parity: ${report.summary().split("\n")[0]}`);
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

	async function engineRows(
		seeded: SeededDataset,
		storeIds: readonly DemoStoreId[],
		from: IsoDate,
		to: IsoDate,
	): Promise<StoreDiscountRow[]> {
		const { aggregates } = engineOf(seeded);
		await aggregates.ensure(storeIds, from, to);
		return discountRows(aggregates, storeIds, from, to);
	}

	async function compare(
		seeded: SeededDataset,
		storeIds: readonly DemoStoreId[],
		from: IsoDate,
		to: IsoDate,
	): Promise<void> {
		const call = `${seeded.dataset.id} discount_rows(${storeIds.join(",")}, ${from}, ${to})`;
		const sql = await active().connection.rows(GROUPED_SQL, [
			pgArray(storeIds.map((id) => seeded.uuidOf(id))),
			from,
			to,
		]);
		report.compareRows(
			call,
			sql,
			groupedEngineRows(await engineRows(seeded, storeIds, from, to)),
			{ key: ["promotion_kind", "promotion_key"] },
		);
	}

	it("matches over every store set, the whole window, a 400-day range and seeded ranges", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			const { from, to } = seeded.window;
			const ranges = [
				{ from, to },
				{ from: addDays(to, -(LONG_RANGE_DAYS - 1)), to },
				...seededRanges(seeded.dataset, RANDOM_RANGES, 41, RANDOM_RANGE_DAYS),
			];
			for (const stores of STORE_SETS) {
				for (const range of ranges) {
					await compare(seeded, stores, range.from, range.to);
				}
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
		expect(report.rows).toBeGreaterThan(0);
	}, 900_000);

	it("loads the three compliance cases of D3 into both engines identically", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D3",
		);
		if (seeded === undefined) throw new Error("no D3 dataset");
		const day = complianceDay(clock.asOf);
		const caseRows = (rows: readonly StoreDiscountRow[]) =>
			rows
				.filter(
					(row) =>
						(row.kind === "item" &&
							(row.key === GIFT_PROMOTION.id ||
								row.rate?.toString() === "0.600000")) ||
						(row.kind === "bill" && row.rate?.toString() === "0.600000"),
				)
				.map((row) => [
					row.kind,
					row.key,
					row.invoiceExternalId,
					money(row.discountMinor).toString(),
					money(row.baseMinor).toString(),
					row.rate?.toString() ?? null,
				]);
		const fromEngine = caseRows(
			await engineRows(seeded, [COMPLIANCE_STORE], day, day),
		);
		const fromSql = (
			await context.connection.rows(
				`select d.promotion_kind, d.promotion_key, i.external_id, d.discount_amount::text,
					d.base_amount::text, d.discount_rate::text
				from app.discount_rows($1::uuid[], $2::date, $2::date) d
				join public.invoices i on i.id = d.invoice_id
				where (d.promotion_kind = 'item' and (d.promotion_key = $3 or d.discount_rate = $4::numeric))
					or (d.promotion_kind = 'bill' and d.discount_rate = $4::numeric)
				order by d.promotion_kind, d.promotion_key, i.external_id`,
				[
					pgArray([seeded.uuidOf(COMPLIANCE_STORE)]),
					day,
					GIFT_PROMOTION.id,
					DEEP_DISCOUNT_SHARE,
				],
			)
		).map((row) => Object.values(row).map((value) => value ?? null));
		const sortRows = (rows: unknown[][]) =>
			[...rows].sort((left, right) =>
				byCodeUnits(left.join("|"), right.join("|")),
			);
		expect(sortRows(fromEngine)).toEqual(sortRows(fromSql));
		expect(
			fromEngine.map(([kind, key, , , , rate]) => [kind, key, rate]),
		).toEqual(
			expect.arrayContaining([
				["item", GIFT_PROMOTION.id, "1.000000"],
				["item", ITEM_PROMOTION_ID, "0.600000"],
				["bill", expect.any(String), "0.600000"],
			]),
		);
		const untouched = await engineRows(
			seeded,
			[COMPLIANCE_STORE],
			addDays(day, -1),
			addDays(day, -1),
		);
		expect(untouched.some((row) => row.key === GIFT_PROMOTION.id)).toBe(false);
	}, 900_000);
});
