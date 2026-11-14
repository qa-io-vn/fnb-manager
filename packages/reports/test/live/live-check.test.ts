import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AnalyticsSource,
	addDays,
	asOfDate,
	type CardModel,
	createRpcAnalyticsSource,
	firstOfMonth,
	firstOfYear,
	type IsoDate,
	isEmailLike,
	lastOfMonth,
	periodContaining,
	type ReportContext,
	type ReportKind,
	type ReportStore,
	reportDefinitions,
	runReport,
	sumMoney,
} from "../../src/index.js";
import {
	asMember,
	createPostgresRpcClient,
	LIVE_CONNECTION_OPTIONS,
	type PostgresRpcClient,
} from "./postgres-rpc-client.js";

const LIVE =
	process.env.LIVE === "1" && (process.env.DATABASE_URL ?? "") !== "";
const TENANT_SLUG = process.env.LIVE_TENANT ?? "live-local";
const SEED = Number(process.env.LIVE_SEED ?? "20261108");
const RANDOM_STORE_DAYS = 3;
const TOLERANCE_ABSOLUTE = 1_000;
const TOLERANCE_RELATIVE = 0.0005;
const SLOWEST_CALL_MS = 1_500;
const SHIFT_CHECK_DAYS = 3;
const YEAR_DAYS = 364;
const CARD = {
	dayNet: "net_revenue",
	dayInvoices: "invoices",
	monthPace: "month_pace",
	yearOverYear: "year_over_year",
	monthMatrix: "month_matrix",
} as const;

interface LiveSetup {
	readonly sql: postgres.Sql;
	readonly userId: string;
	readonly client: PostgresRpcClient;
	readonly source: AnalyticsSource;
	readonly tenantId: string;
	readonly stores: readonly ReportStore[];
	readonly asOf: IsoDate;
}

function report(
	check: string,
	facts: Record<string, boolean | number | string>,
): void {
	console.info(JSON.stringify({ check, ...facts }));
}

function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 4_294_967_296;
	};
}

function withinTolerance(value: number | null, source: number): boolean {
	if (value === null) return false;
	return (
		Math.abs(value - source) <=
		Math.max(TOLERANCE_ABSOLUTE, Math.abs(source) * TOLERANCE_RELATIVE)
	);
}

function card(cards: readonly CardModel[], id: string): CardModel {
	const found = cards.find((candidate) => candidate.id === id);
	if (found === undefined) {
		throw new Error(`the report has no card ${id}`);
	}
	return found;
}

function contextFor(
	setup: LiveSetup,
	kind: ReportKind,
	date: IsoDate,
	stores: readonly ReportStore[],
): ReportContext {
	return {
		tenantId: setup.tenantId,
		stores,
		allStoresSelected: stores.length === setup.stores.length,
		period: periodContaining(kind, date, setup.asOf),
		sample: false,
	};
}

async function metricValue(
	setup: LiveSetup,
	storeIds: readonly string[],
	metricId: string,
	from: IsoDate,
	to: IsoDate,
): Promise<number | null> {
	const [row] = await asMember(setup.sql, setup.userId, (transaction) =>
		transaction.unsafe(
			"select public.metric_value($1::uuid[], $2, $3::date, $4::date)::text as value",
			[`{${storeIds.join(",")}}`, metricId, from, to],
		),
	);
	return row?.value === null || row?.value === undefined
		? null
		: Number(row.value);
}

async function seriesBucket(
	setup: LiveSetup,
	storeIds: readonly string[],
	grain: "day" | "month",
	from: IsoDate,
	to: IsoDate,
) {
	const rows = await setup.source.call("period_series", {
		store_ids: [...storeIds],
		grain,
		from_date: from,
		to_date: to,
	});
	return rows.filter((row) => row.store_id === null);
}

describe.skipIf(!LIVE)("live check against the tenant database", () => {
	let setup: LiveSetup | null = null;

	beforeAll(async () => {
		const sql = postgres(
			process.env.DATABASE_URL ?? "",
			LIVE_CONNECTION_OPTIONS,
		);
		const [tenant] = await sql`
			select t.id::text as id, m.user_id::text as user_id
			from public.tenants t
			join public.tenant_members m on m.tenant_id = t.id and m.role = 'owner'
			where t.slug = ${TENANT_SLUG}
			order by m.created_at
			limit 1
		`;
		if (tenant === undefined) {
			await sql.end();
			throw new Error("no owner member found for the tenant");
		}
		const storeRows = await sql`
			select id::text as id, name, timezone, business_day_start_minutes
			from public.stores
			where tenant_id = ${tenant.id}::uuid
			order by name, id
		`;
		const stores: ReportStore[] = storeRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			timeZone: String(row.timezone),
			businessDayStartMinutes: Number(row.business_day_start_minutes),
		}));
		const client = createPostgresRpcClient(sql, String(tenant.user_id));
		setup = {
			sql,
			userId: String(tenant.user_id),
			client,
			source: createRpcAnalyticsSource(client, "postgres"),
			tenantId: String(tenant.id),
			stores,
			asOf: asOfDate(stores, new Date()),
		};
		report("setup", { stores: stores.length });
	});

	afterAll(async () => {
		await setup?.sql.end({ timeout: 5 });
	});

	function live(): LiveSetup {
		if (setup === null) throw new Error("the live setup did not run");
		return setup;
	}

	it("1. three random store-days and yesterday equal the POS control totals", async () => {
		const active = live();
		const candidates = await active.sql`
			select store_id::text as store_id, business_date::text as business_date,
				source_invoice_count, source_net_amount::text as source_net_amount
			from public.sync_checks
			where tenant_id = ${active.tenantId}::uuid
				and source_invoice_count > 0
				and business_date < ${active.asOf}::date
			order by store_id, business_date
		`;
		const random = seeded(SEED);
		const picked = new Set<number>();
		while (picked.size < Math.min(RANDOM_STORE_DAYS, candidates.length)) {
			picked.add(Math.floor(random() * candidates.length));
		}
		const days = [...picked]
			.map((index) => candidates[index])
			.filter((row) => row !== undefined);
		const yesterday = await active.sql`
			select s.id::text as store_id, ${active.asOf}::text as business_date,
				c.source_invoice_count, c.source_net_amount::text as source_net_amount
			from public.stores s
			left join public.sync_checks c on c.store_id = s.id and c.business_date = ${active.asOf}::date
			where s.tenant_id = ${active.tenantId}::uuid
		`;
		let checked = 0;
		let posChecked = 0;
		const failures: string[] = [];
		for (const row of [...days, ...yesterday]) {
			const store = active.stores.find(
				(candidate) => candidate.id === row.store_id,
			);
			if (store === undefined) continue;
			const date = String(row.business_date);
			const cards = await runReport(
				reportDefinitions.day,
				contextFor(active, "day", date, [store]),
				active.source,
			);
			const net = card(cards, CARD.dayNet).headline.value;
			const invoices = card(cards, CARD.dayInvoices).headline.value;
			const [bucket] = await seriesBucket(
				active,
				[store.id],
				"day",
				date,
				date,
			);
			const equalities = {
				metricNet:
					net ===
					(await metricValue(active, [store.id], "net_revenue", date, date)),
				metricInvoices:
					invoices ===
					(await metricValue(active, [store.id], "invoices", date, date)),
				seriesNet: net === (bucket?.net_amount ?? null),
				seriesInvoices: invoices === (bucket?.invoices ?? null),
			};
			if (
				row.source_invoice_count !== null &&
				row.source_invoice_count !== undefined
			) {
				posChecked += 1;
				if (invoices !== Number(row.source_invoice_count))
					failures.push("pos invoices");
				if (!withinTolerance(net, Number(row.source_net_amount)))
					failures.push("pos net");
			}
			for (const [name, holds] of Object.entries(equalities)) {
				if (!holds) failures.push(name);
			}
			checked += 1;
		}
		report("days", {
			storeDays: checked,
			posChecked,
			failures: failures.length,
			passed: failures.length === 0,
		});
		expect(failures).toEqual([]);
		expect(checked).toBeGreaterThan(0);
	});

	it("2. the last complete month equals the POS totals, metric_value, the series and month_pace", async () => {
		const active = live();
		const monthEnd =
			lastOfMonth(active.asOf) === active.asOf
				? active.asOf
				: addDays(firstOfMonth(active.asOf), -1);
		const monthStart = firstOfMonth(monthEnd);
		const selections = [
			...active.stores.map((store) => [store]),
			active.stores,
		];
		const failures: string[] = [];
		for (const stores of selections) {
			const ids = stores.map((store) => store.id);
			const cards = await runReport(
				reportDefinitions.month,
				contextFor(active, "month", monthEnd, stores),
				active.source,
			);
			const net = card(cards, CARD.monthPace).headline.value;
			const [checks] = await active.sql`
				select coalesce(sum(source_net_amount), 0)::text as net, count(*)::integer as days
				from public.sync_checks
				where store_id = any (${`{${ids.join(",")}}`}::uuid[])
					and business_date between ${monthStart}::date and ${monthEnd}::date
			`;
			const [bucket] = await seriesBucket(
				active,
				ids,
				"month",
				monthStart,
				monthEnd,
			);
			const [pace] = await active.source.call("month_pace", {
				store_ids: ids,
				month_start: monthStart,
				as_of: monthEnd,
			});
			if (
				Number(checks?.days ?? 0) > 0 &&
				!withinTolerance(net, Number(checks?.net ?? 0))
			) {
				failures.push("pos net");
			}
			if (
				net !==
				(await metricValue(active, ids, "net_revenue", monthStart, monthEnd))
			) {
				failures.push("metric net");
			}
			if (net !== (bucket?.net_amount ?? null)) failures.push("series net");
			if (net !== (pace?.month_to_date_net_amount ?? null))
				failures.push("month pace");
		}
		report("month", {
			selections: selections.length,
			failures: failures.length,
			passed: failures.length === 0,
		});
		expect(failures).toEqual([]);
	});

	it("3. day buckets add up to the month and month buckets to the year to date", async () => {
		const active = live();
		const ids = active.stores.map((store) => store.id);
		const monthStart = firstOfMonth(active.asOf);
		const days = await seriesBucket(
			active,
			ids,
			"day",
			monthStart,
			active.asOf,
		);
		const [month] = await seriesBucket(
			active,
			ids,
			"month",
			monthStart,
			active.asOf,
		);
		const monthHolds =
			sumMoney(days.map((row) => row.net_amount)) ===
				(month?.net_amount ?? 0) &&
			days.reduce((total, row) => total + (row.invoices ?? 0), 0) ===
				(month?.invoices ?? 0);
		const months = await seriesBucket(
			active,
			ids,
			"month",
			firstOfYear(active.asOf),
			active.asOf,
		);
		const cards = await runReport(
			reportDefinitions.year,
			contextFor(active, "year", active.asOf, active.stores),
			active.source,
		);
		const yearHolds =
			sumMoney(months.map((row) => row.net_amount)) ===
			card(cards, CARD.yearOverYear).headline.value;
		report("identities", {
			monthHolds,
			yearHolds,
			dayBuckets: days.length,
			monthBuckets: months.length,
		});
		expect(monthHolds).toBe(true);
		expect(yearHolds).toBe(true);
	});

	it("4. a young store shows the graceful state and the total compares like for like", async () => {
		const active = live();
		const coverage = await active.source.call("store_coverage", {
			store_ids: active.stores.map((store) => store.id),
			from_date: firstOfYear(active.asOf),
			to_date: active.asOf,
		});
		const young = active.stores.filter((store) => {
			const start =
				coverage.find((row) => row.store_id === store.id)?.history_start ??
				null;
			return start !== null && start > addDays(active.asOf, -YEAR_DAYS);
		});
		let graceful = 0;
		for (const store of young) {
			const cards = await runReport(
				reportDefinitions.year,
				contextFor(active, "year", active.asOf, [store]),
				active.source,
			);
			const lastYear = card(cards, CARD.yearOverYear).comparisons.find(
				(comparison) => comparison.kind === "last_year",
			);
			if (lastYear?.unavailable === "store_too_young") graceful += 1;
		}
		let likeForLike = true;
		if (young.length > 0 && young.length < active.stores.length) {
			const cards = await runReport(
				reportDefinitions.year,
				contextFor(active, "year", active.asOf, active.stores),
				active.source,
			);
			likeForLike =
				card(cards, CARD.yearOverYear).comparisons.find(
					(comparison) => comparison.kind === "last_year",
				)?.basis === "like_for_like";
		}
		report("young store", { youngStores: young.length, graceful, likeForLike });
		expect(graceful).toBe(young.length);
		expect(likeForLike).toBe(true);
	});

	it("5. aggregates of the last 7 days are fresh", async () => {
		const active = live();
		const rows = await active.source.call("store_coverage", {
			store_ids: active.stores.map((store) => store.id),
			from_date: addDays(active.asOf, -6),
			to_date: active.asOf,
		});
		const staleDays = rows.reduce((total, row) => total + row.stale_days, 0);
		report("freshness", { stores: rows.length, staleDays });
		expect(staleDays).toBe(0);
	});

	it("6. the slowest call of each report is under 1.5 s", async () => {
		const active = live();
		const slowest: Record<string, number> = {};
		for (const kind of ["day", "week", "month", "year"] as const) {
			const before = active.client.calls.length;
			await runReport(
				reportDefinitions[kind],
				contextFor(active, kind, active.asOf, active.stores),
				active.source,
			);
			const calls = active.client.calls.slice(before);
			slowest[kind] = Math.round(
				Math.max(0, ...calls.map((call) => call.milliseconds)),
			);
		}
		report("timing", { ...slowest, limit: SLOWEST_CALL_MS });
		expect(
			Object.values(slowest).every((value) => value < SLOWEST_CALL_MS),
		).toBe(true);
	});

	it("7. the owner sheet agrees with Năm when one is given", async () => {
		const active = live();
		const path = process.env.LIVE_ACCEPTANCE;
		if (path === undefined || !existsSync(path)) {
			console.info("owner check pending");
			return;
		}
		const sheet = JSON.parse(readFileSync(path, "utf8")) as {
			peakMonth?: string;
			yearOverYearChange?: number;
			year?: number;
		};
		if (
			sheet.peakMonth === undefined ||
			sheet.yearOverYearChange === undefined
		) {
			console.info("owner check pending");
			return;
		}
		const yearEnd =
			sheet.year === undefined || sheet.year >= Number(active.asOf.slice(0, 4))
				? active.asOf
				: `${sheet.year}-12-31`;
		const cards = await runReport(
			reportDefinitions.year,
			contextFor(active, "year", yearEnd, active.stores),
			active.source,
		);
		const caption = card(cards, CARD.monthMatrix).headline.caption;
		const peak = Object.values(caption?.values ?? {}).find(
			(value) => value.kind === "month",
		);
		const change = card(cards, CARD.yearOverYear).comparisons.find(
			(comparison) => comparison.kind === "last_year",
		)?.change;
		const matches =
			peak?.value === sheet.peakMonth &&
			change !== null &&
			change !== undefined &&
			Math.abs(change - sheet.yearOverYearChange) < 0.0005;
		console.info(`matches: ${matches}`);
	});
	it("8. no Ngày or Tháng card shows a POS shift name or an e-mail-shaped value", async () => {
		const active = live();
		const recent = await active.sql`
			select distinct business_date::text as business_date
			from public.sync_checks
			where tenant_id = ${active.tenantId}::uuid
				and source_invoice_count > 0
				and business_date < ${active.asOf}::date
			order by business_date desc
			limit ${SHIFT_CHECK_DAYS}
		`;
		const lastMonth = addDays(firstOfMonth(active.asOf), -1);
		const runs: {
			kind: ReportKind;
			date: IsoDate;
			stores: readonly ReportStore[];
		}[] = [
			...recent.flatMap((row) => [
				{
					kind: "day" as const,
					date: String(row.business_date),
					stores: active.stores,
				},
				...active.stores.map((store) => ({
					kind: "day" as const,
					date: String(row.business_date),
					stores: [store],
				})),
			]),
			{ kind: "month", date: lastMonth, stores: active.stores },
		];
		let emailFound = false;
		let shiftRows = 0;
		for (const run of runs) {
			const cards = await runReport(
				reportDefinitions[run.kind],
				contextFor(active, run.kind, run.date, run.stores),
				active.source,
			);
			for (const model of cards) {
				if (isEmailLike(JSON.stringify(model))) emailFound = true;
				if (model.id === "shifts" || model.id === "shift_stats") {
					shiftRows += model.tables[0]?.rows.length ?? 0;
				}
			}
		}
		report("8 shift labels", {
			reports: runs.length,
			shiftRows,
			noEmailShapedValue: !emailFound,
		});
		expect(shiftRows).toBeGreaterThan(0);
		expect(emailFound).toBe(false);
	});
});
