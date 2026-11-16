import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type AnalyticsRow,
	addDays,
	asOfDate,
	COVERAGE_CALL_KEY,
	capPeriods,
	coverageModel,
	createRpcReportSource,
	customRange,
	DEFAULT_REPORT_SETTINGS,
	type IsoDate,
	isDefaultReportSettings,
	MAX_THEME_RANGE_DAYS,
	parseThemeParams,
	type ReportCallSpec,
	type ReportRange,
	type ReportSource,
	type ReportStore,
	rangeOfPreset,
	reportCallIdentity,
	runTheme,
	settingsOfRow,
	THEME_ORDER,
	type ThemeContext,
	type ThemeDefinition,
	type ThemeKind,
	themeDefinitions,
	themePromotionRules,
	themeResultsOf,
	yearOf,
} from "../../src/index.js";
import {
	catalogueModifierFacts,
	flaggedShifts,
	itemsWithoutDiscount,
	missingFunctions,
	overBudgetCalls,
	promotionIdentities,
	promotionYear,
	TIMED_SPANS,
	type TimedSpan,
} from "./identity-checks.js";
import {
	asMember,
	createPostgresRpcClient,
	LIVE_CONNECTION_OPTIONS,
	type SerialRpcClient,
	serialRpcClient,
} from "./postgres-rpc-client.js";
import {
	chunksOf,
	type ItemRow,
	paymentInvoiceShareOf,
	rowValue,
	sellerRows,
	type WindowFacts,
	windowDays,
	windowFactsOf,
} from "./reference-facts.js";
import {
	type DateWindow,
	parseHourlyReference,
	parseMenuChecks,
	parseReferenceSheet,
	SheetError,
	type StoreSeries,
	siblingPath,
	storeFor,
	within,
} from "./reference-sheet.js";

const LIVE =
	process.env.LIVE === "1" && (process.env.DATABASE_URL ?? "") !== "";
const TENANT_SLUG = process.env.LIVE_TENANT ?? "live-local";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const YEAR_DAYS = 365;
const SHIFT_DAYS = 92;
const BASKET_CHUNK_DAYS = 91;
const MENU_MIN_WINDOW_DAYS = 7;
const QUANTITY_EPSILON = 1e-6;
const DEFAULT_WINDOW_PRESET = "28d";
const PROMOTION_DAYS_FUNCTION = "promotion_days";

type RangeShape = Pick<ThemeDefinition, "defaultPreset" | "maxRangeDays">;

interface TimedPage {
	readonly kind: ThemeKind;
	readonly span: TimedSpan;
}

interface RecordingSource {
	readonly source: ReportSource;
	readonly rows: Map<string, readonly unknown[]>;
}

interface LiveStore extends ReportStore {
	readonly posAccountId: string;
}

interface ThemeLiveSetup {
	readonly sql: postgres.Sql;
	readonly userId: string;
	readonly client: SerialRpcClient;
	readonly source: ReportSource;
	readonly tenantId: string;
	readonly stores: readonly LiveStore[];
	readonly asOf: IsoDate;
	readonly rowCounts: ReadonlyMap<string, number>;
}

interface StoreSelection {
	readonly label: string;
	readonly stores: readonly LiveStore[];
}

interface PrivateSheet {
	readonly path: string;
	readonly text: string;
}

function report(
	check: string,
	facts: Record<string, boolean | number | string>,
): void {
	console.info(JSON.stringify({ check, ...facts }));
}

function printMatch(label: string, holds: boolean): boolean {
	console.info(`${label}: matches: ${holds}`);
	return holds;
}

function privateSheet(): PrivateSheet | null {
	const value = process.env.LIVE_REFERENCE_SHEET;
	if (value === undefined || value.trim() === "") return null;
	const path = isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
	return { path, text: readFileSync(path, "utf8") };
}

function modifierPeriods(
	setup: Pick<ThemeLiveSetup, "asOf">,
	sheet: PrivateSheet | null,
): Record<string, DateWindow> {
	return {
		window:
			sheet === null
				? rangeOfPreset(DEFAULT_WINDOW_PRESET, setup.asOf)
				: parseReferenceSheet(sheet.text).window,
		year: { from: addDays(setup.asOf, 1 - YEAR_DAYS), to: setup.asOf },
	};
}

function siblingFile(sheet: PrivateSheet, name: string): string {
	const path = siblingPath(sheet.path, name);
	try {
		return readFileSync(path, "utf8");
	} catch {
		throw new SheetError("the hourly file cannot be read");
	}
}

function quoted(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

async function rowCountsOf(
	sql: postgres.Sql,
	tenantId: string,
): Promise<Map<string, number>> {
	return sql.begin("read only", async (transaction) => {
		const tables = await transaction`
			select n.nspname as schema_name, c.relname as table_name
			from pg_class c
			join pg_namespace n on n.oid = c.relnamespace
			join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
			where c.relkind in ('r', 'p') and n.nspname in ('public', 'app')
			order by 1, 2
		`;
		const counts = new Map<string, number>();
		for (const table of tables) {
			const name = `${String(table.schema_name)}.${String(table.table_name)}`;
			const [row] = await transaction.unsafe(
				`select count(*)::text as count from ${quoted(String(table.schema_name))}.${quoted(String(table.table_name))} where tenant_id = $1::uuid`,
				[tenantId],
			);
			counts.set(name, Number(row?.count ?? 0));
		}
		return counts;
	}) as Promise<Map<string, number>>;
}

function themeContext(
	setup: ThemeLiveSetup,
	definition: ThemeDefinition,
	range: ReportRange,
	stores: readonly ReportStore[] = setup.stores,
): ThemeContext {
	return {
		tenantId: setup.tenantId,
		stores,
		allStoresSelected: stores.length === setup.stores.length,
		range,
		sample: false,
		params: parseThemeParams(definition.params, {}),
		catchUpPending: null,
	};
}

function storeSelections(stores: readonly LiveStore[]): StoreSelection[] {
	return [
		...stores.map((store, index) => ({
			label: `store ${index + 1}`,
			stores: [store],
		})),
		{ label: "all", stores },
	];
}

function uuidArray(stores: readonly ReportStore[]): string {
	return `{${stores.map((store) => store.id).join(",")}}`;
}

function timedPages(): TimedPage[] {
	return THEME_ORDER.flatMap((kind) =>
		TIMED_SPANS.map((span) => ({ kind, span })),
	);
}

function timedRange(
	shape: RangeShape,
	span: TimedSpan,
	asOf: IsoDate,
): ReportRange {
	return span === "default"
		? rangeOfPreset(shape.defaultPreset, asOf)
		: customRange(addDays(asOf, 1 - shape.maxRangeDays), asOf, asOf);
}

function identityOf(spec: Pick<ReportCallSpec, "name" | "args">): string {
	return reportCallIdentity(spec);
}

function recordingSource(source: ReportSource): RecordingSource {
	const rows = new Map<string, readonly unknown[]>();
	return {
		rows,
		source: {
			kind: source.kind,
			async call(name, args) {
				const result = await source.call(name, args);
				rows.set(identityOf({ name, args } as ReportCallSpec), result);
				return result;
			},
			async callTheme(name, args) {
				const result = await source.callTheme(name, args);
				rows.set(identityOf({ name, args } as ReportCallSpec), result);
				return result;
			},
		},
	};
}

function plannedFunctions(
	definition: ThemeDefinition,
	context: ThemeContext,
	recorded: ReadonlyMap<string, readonly unknown[]>,
): string[] {
	const primary = definition.primaryCalls(context);
	const entries = new Map(
		primary.map((spec) => [spec.key, recorded.get(identityOf(spec)) ?? []]),
	);
	const coverage = coverageModel(
		(entries.get(COVERAGE_CALL_KEY) ??
			[]) as readonly AnalyticsRow<"store_coverage">[],
		context,
	);
	const followUps = definition.followUpCalls(
		context,
		coverage,
		themeResultsOf(entries),
	);
	return [...primary, ...followUps].map((spec) => spec.name);
}

async function catchUpStatus(setup: ThemeLiveSetup) {
	const started = performance.now();
	const rows = await asMember(setup.sql, setup.userId, (transaction) =>
		transaction.unsafe(
			"select pending_from::text as pending_from, pending_days from public.analytics_catch_up_status($1::uuid)",
			[setup.tenantId],
		),
	);
	setup.client.calls.push({
		fn: "analytics_catch_up_status",
		milliseconds: performance.now() - started,
	});
	return rows;
}

async function windowFacts(
	setup: ThemeLiveSetup,
	storeId: string,
	window: DateWindow,
) {
	const range = {
		store_ids: [storeId],
		from_date: window.from,
		to_date: window.to,
	};
	const totals = await setup.source.callTheme("range_totals", {
		store_ids: [storeId],
		from_dates: [window.from],
		to_dates: [window.to],
	});
	return windowFactsOf({
		profile: await setup.source.callTheme("hour_profile", range),
		heatmap: await setup.source.callTheme("hour_weekday_heatmap", range),
		totals:
			totals.find((row) => row.range_index === 1 && row.store_id === null) ??
			totals.find((row) => row.range_index === 1 && row.store_id === storeId),
		payments: await setup.source.call("payment_summary", range),
	});
}

function sortedJson(rows: readonly unknown[]): string {
	return JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
}

describe.skipIf(!LIVE)("live check of the thematic reports", () => {
	let setup: ThemeLiveSetup | null = null;

	beforeAll(async () => {
		const sql = postgres(process.env.DATABASE_URL ?? "", {
			...LIVE_CONNECTION_OPTIONS,
			connection: { default_transaction_read_only: true },
		});
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
			select id::text as id, name, timezone, business_day_start_minutes,
				pos_account_id::text as pos_account_id
			from public.stores
			where tenant_id = ${tenant.id}::uuid
			order by name, id
		`;
		const stores: LiveStore[] = storeRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			timeZone: String(row.timezone),
			businessDayStartMinutes: Number(row.business_day_start_minutes),
			posAccountId: String(row.pos_account_id),
		}));
		const client = serialRpcClient(
			createPostgresRpcClient(sql, String(tenant.user_id)),
		);
		setup = {
			sql,
			userId: String(tenant.user_id),
			client,
			source: createRpcReportSource(client, "postgres"),
			tenantId: String(tenant.id),
			stores,
			asOf: asOfDate(stores, new Date()),
			rowCounts: await rowCountsOf(sql, String(tenant.id)),
		};
		report("theme setup", { stores: stores.length });
	});

	afterAll(async () => {
		await setup?.sql.end({ timeout: 5 });
	});

	function live(): ThemeLiveSetup {
		if (setup === null) throw new Error("the live setup did not run");
		return setup;
	}

	for (const { kind, span } of timedPages()) {
		it(`1. ${kind} at its ${span} range stays within its call budgets`, async () => {
			const active = live();
			const definition = themeDefinitions[kind];
			const range = timedRange(definition, span, active.asOf);
			const context = themeContext(active, definition, range);
			const recording = recordingSource(active.source);
			await active.client.idle();
			const before = active.client.calls.length;
			await runTheme(definition, context, recording.source);
			await catchUpStatus(active);
			const calls = active.client.calls.slice(before);
			const planned = plannedFunctions(definition, context, recording.rows);
			const missing = missingFunctions(planned, calls);
			const overBudget = overBudgetCalls(calls, span);
			report("theme timing", {
				theme: kind,
				range: span,
				days: range.days,
				calls: calls.length,
				plannedFunctions: new Set(planned).size,
				missingFunctions: missing.length,
				slowestMs: Math.round(
					Math.max(0, ...calls.map((call) => call.milliseconds)),
				),
				overBudget: overBudget.length,
			});
			expect(missing).toEqual([]);
			expect(overBudget).toEqual([]);
		});
	}

	for (const span of TIMED_SPANS) {
		it(`1. promotion_days at its ${span} range stays within its call budgets`, async () => {
			const active = live();
			const range = timedRange(
				{
					defaultPreset: DEFAULT_WINDOW_PRESET,
					maxRangeDays: MAX_THEME_RANGE_DAYS,
				},
				span,
				active.asOf,
			);
			await active.client.idle();
			const before = active.client.calls.length;
			const rows = await active.source.callTheme(PROMOTION_DAYS_FUNCTION, {
				store_ids: active.stores.map((store) => store.id),
				from_date: range.from,
				to_date: range.to,
			});
			const calls = active.client.calls.slice(before);
			const missing = missingFunctions([PROMOTION_DAYS_FUNCTION], calls);
			const overBudget = overBudgetCalls(calls, span);
			report("function timing", {
				function: PROMOTION_DAYS_FUNCTION,
				range: span,
				days: range.days,
				rows: rows.length,
				missingFunctions: missing.length,
				slowestMs: Math.round(
					Math.max(0, ...calls.map((call) => call.milliseconds)),
				),
				overBudget: overBudget.length,
			});
			expect(missing).toEqual([]);
			expect(overBudget).toEqual([]);
		});
	}

	it("2. the reference window agrees with the private sheet (A1)", async () => {
		const active = live();
		const sheet = privateSheet();
		if (sheet === null) {
			console.info("owner check pending");
			return;
		}
		const reference = parseReferenceSheet(sheet.text);
		const columnStores = reference.columns.map((column) =>
			storeFor(column, active.stores),
		);
		const factsByStore = new Map<string, WindowFacts>();
		const identities: boolean[] = [];
		for (const [position, storeId] of columnStores.entries()) {
			const window = await windowFacts(active, storeId, reference.window);
			factsByStore.set(storeId, window.facts);
			report("window identities", {
				column: position + 1,
				...window.identities,
			});
			identities.push(...Object.values(window.identities));
		}
		const outcomes: boolean[] = [];
		const factsOf = (storeId: string): WindowFacts => {
			const facts = factsByStore.get(storeId);
			if (facts === undefined) throw new Error("a store has no facts");
			return facts;
		};
		for (const row of reference.rows) {
			if (row.form === "skipped") {
				console.info(`row ${row.index}: skipped`);
				continue;
			}
			for (const [position, storeId] of columnStores.entries()) {
				const facts = factsOf(storeId);
				const label = `row ${row.index} column ${position + 1}`;
				if (row.form === "payment") {
					const items = row.cells[position] ?? [];
					for (const [item, share] of items.entries()) {
						outcomes.push(
							printMatch(
								`${label} item ${item + 1}`,
								within(
									paymentInvoiceShareOf(facts.payments, share.label),
									share.share,
								),
							),
						);
					}
				} else {
					const expected = row.cells[position];
					outcomes.push(
						printMatch(
							label,
							expected !== undefined &&
								within(rowValue(row.kind, facts), expected),
						),
					);
				}
			}
		}
		if (reference.hourlyFile !== null) {
			const hourly = parseHourlyReference(
				siblingFile(sheet, reference.hourlyFile),
			);
			const seriesByColumn = (
				series: readonly StoreSeries[],
			): Map<number, StoreSeries> => {
				const byColumn = new Map<number, StoreSeries>();
				for (const entry of series) {
					const column = columnStores.indexOf(
						storeFor(entry.name, active.stores),
					);
					if (column === -1 || byColumn.has(column)) {
						throw new SheetError("an hourly row is not one store column");
					}
					byColumn.set(column, entry);
				}
				if (byColumn.size !== columnStores.length) {
					throw new SheetError("a store column has no hourly row");
				}
				return byColumn;
			};
			const lines = [
				["hour", seriesByColumn(hourly.hours), "hourNet"],
				["weekday", seriesByColumn(hourly.weekdays), "weekdayNet"],
			] as const;
			for (const [label, byColumn, key] of lines) {
				for (const [column, series] of [...byColumn].sort(
					([left], [right]) => left - right,
				)) {
					const facts = factsOf(columnStores[column] ?? "");
					for (const [slot, expected] of series.values) {
						outcomes.push(
							printMatch(
								`${label} ${slot} column ${column + 1}`,
								within(facts[key].get(slot) ?? 0, expected),
							),
						);
					}
				}
			}
		}
		const mismatches = outcomes.filter((holds) => !holds).length;
		report("reference window", {
			compared: outcomes.length,
			mismatches,
			identitiesHold: identities.every(Boolean),
		});
		expect(outcomes.length).toBeGreaterThan(0);
		expect(mismatches).toBe(0);
		expect(identities.every(Boolean)).toBe(true);
	});

	it("3. modifiers never count or appear as items over the window and the last 365 days (A2)", async () => {
		const active = live();
		const sheet = privateSheet();
		const periods = modifierPeriods(active, sheet);
		const modifierRows = await asMember(
			active.sql,
			active.userId,
			(transaction) =>
				transaction.unsafe(
					`select i.pos_account_id::text as pos_account_id, i.external_id, true as in_catalogue
					from public.items i
					where i.tenant_id = $1::uuid and i.is_modifier
					union
					select distinct s.pos_account_id::text, l.item_external_id, false
					from public.invoice_lines l
					join public.stores s on s.id = l.store_id
					where l.tenant_id = $1::uuid and l.line_kind = 'modifier' and l.item_external_id is not null`,
					[active.tenantId],
				),
		);
		const catalogueModifiers = modifierRows.filter(
			(row) => row.in_catalogue === true,
		).length;
		const modifiersOf = (posAccountId: string): Set<string> =>
			new Set(
				modifierRows
					.filter((row) => row.pos_account_id === posAccountId)
					.map((row) => String(row.external_id)),
			);
		const failures: string[] = [];
		for (const [name, period] of Object.entries(periods)) {
			const selections = [
				...active.stores.map((store) => [store]),
				active.stores,
			];
			let quantitiesAgree = true;
			for (const stores of selections) {
				const storeIds = stores.map((store) => store.id);
				const range = {
					store_ids: storeIds,
					from_date: period.from,
					to_date: period.to,
				};
				const totals = await active.source.callTheme("range_totals", {
					store_ids: storeIds,
					from_dates: [period.from],
					to_dates: [period.to],
				});
				const itemsSold =
					totals.find((row) => row.range_index === 1 && row.store_id === null)
						?.items_sold ?? 0;
				const summary = await active.source.call("item_summary", range);
				const margins = await active.source.callTheme("item_margins", range);
				const sum = (rows: readonly { quantity: number }[]) =>
					rows.reduce((total, row) => total + row.quantity, 0);
				if (
					Math.abs(sum(summary) - itemsSold) > QUANTITY_EPSILON ||
					Math.abs(sum(margins) - itemsSold) > QUANTITY_EPSILON
				) {
					quantitiesAgree = false;
				}
			}
			let keysChecked = 0;
			let modifierKeys = 0;
			for (const store of active.stores) {
				const modifiers = modifiersOf(store.posAccountId);
				const range = {
					store_ids: [store.id],
					from_date: period.from,
					to_date: period.to,
				};
				const keys: (string | null)[] = [
					...(await active.source.call("item_summary", range)).map(
						(row) => row.item_external_id,
					),
					...(await active.source.callTheme("item_margins", range)).map(
						(row) => row.item_external_id,
					),
				];
				for (const chunk of chunksOf(period, BASKET_CHUNK_DAYS)) {
					const chunkRange = {
						store_ids: [store.id],
						from_date: chunk.from,
						to_date: chunk.to,
					};
					keys.push(
						...(
							await active.source.callTheme("menu_engineering", {
								store_ids: [store.id],
								as_of_date: chunk.to,
								window_days: Math.max(MENU_MIN_WINDOW_DAYS, windowDays(chunk)),
							})
						).map((row) => row.item_external_id),
						...(await active.source.callTheme("item_attach", chunkRange)).map(
							(row) => row.item_external_id,
						),
						...(
							await active.source.callTheme("basket_pairs", chunkRange)
						).flatMap((row) => [
							row.item_a_external_id,
							row.item_b_external_id,
						]),
					);
				}
				for (const key of keys) {
					if (key === null) continue;
					keysChecked += 1;
					if (modifiers.has(key)) modifierKeys += 1;
				}
			}
			report("modifiers never items", {
				period: name,
				days: windowDays(period),
				quantitiesAgree,
				keysChecked,
				modifierKeys,
				catalogueModifiers,
				modifierLineKeys: modifierRows.length - catalogueModifiers,
			});
			if (!quantitiesAgree) failures.push(`${name} quantities`);
			if (modifierKeys > 0) failures.push(`${name} modifier keys`);
			if (keysChecked === 0) failures.push(`${name} no keys`);
			if (modifierRows.length === 0) failures.push(`${name} no modifiers`);
		}
		const menu = sheet === null ? null : parseMenuChecks(sheet.text);
		if (menu !== null) {
			const storeId = storeFor(menu.store, active.stores);
			const items: ItemRow[] = await active.source.call("item_summary", {
				store_ids: [storeId],
				from_date: menu.window.from,
				to_date: menu.window.to,
			});
			for (const [index, seller] of menu.topSellers.entries()) {
				const rows = sellerRows(items, seller.name);
				const quantity = rows.reduce((total, row) => total + row.quantity, 0);
				const net = rows.reduce((total, row) => total + row.net_amount, 0);
				if (
					!printMatch(
						`menu seller ${index + 1} quantity`,
						rows.length > 0 && within(quantity, seller.quantity),
					)
				) {
					failures.push("menu seller quantity");
				}
				if (
					!printMatch(
						`menu seller ${index + 1} net`,
						rows.length > 0 && within(net, seller.net),
					)
				) {
					failures.push("menu seller net");
				}
			}
			for (const [index, share] of menu.modifierShares.entries()) {
				const shareStore = storeFor(share.name, active.stores);
				const [counted] = await asMember(
					active.sql,
					active.userId,
					(transaction) =>
						transaction.unsafe(
							`select count(*) filter (where l.line_kind = 'modifier')::integer as modifier_lines,
								count(*)::integer as lines
							from public.invoice_lines l
							join public.invoices i on i.id = l.invoice_id
							where l.store_id = $1::uuid and i.business_date = $2::date`,
							[shareStore, menu.modifierDate],
						),
				);
				const holds =
					within(Number(counted?.modifier_lines), share.modifierLines) &&
					within(Number(counted?.lines), share.lines);
				if (!printMatch(`menu modifier share ${index + 1}`, holds)) {
					failures.push("menu modifier share");
				}
			}
		}
		report("modifier checks", { failures: failures.length });
		expect(failures).toEqual([]);
	});

	it("4. the data-quality functions find no catalogue modifier sold as an item over the window and the last 365 days (A2)", async () => {
		const active = live();
		const failures: string[] = [];
		for (const [name, period] of Object.entries(
			modifierPeriods(active, privateSheet()),
		)) {
			const range = {
				store_ids: active.stores.map((store) => store.id),
				from_date: period.from,
				to_date: period.to,
			};
			const quality = catalogueModifierFacts(
				await active.source.callTheme("data_quality_summary", range),
				await active.source.callTheme("data_quality_items", range),
			);
			report("quality modifiers", {
				period: name,
				days: windowDays(period),
				...quality,
			});
			if (!quality.linesAllZero) {
				failures.push(`${name} catalogue modifier lines`);
			}
			if (quality.catalogueModifierItems > 0) {
				failures.push(`${name} catalogue modifier items`);
			}
			if (quality.summaryRows === 0) failures.push(`${name} no summary`);
			if (quality.qualityItems === 0) failures.push(`${name} no items`);
		}
		expect(failures).toEqual([]);
	});

	it("5. the default thresholds change nothing in shift_review and cash_variance_flags", async () => {
		const active = live();
		const to = active.asOf;
		const from = addDays(to, 1 - SHIFT_DAYS);
		const settings = await active.source.callTheme("report_settings_of", {
			store_ids: active.stores.map((store) => store.id),
		});
		let shiftsEqual = true;
		let flagsEqual = true;
		let shifts = 0;
		let flags = 0;
		let tenantRows = 0;
		for (const store of active.stores) {
			const stored = settings.find((row) => row.store_id === store.id);
			const hasRow = stored?.has_tenant_row === true;
			if (hasRow) tenantRows += 1;
			const absThreshold = hasRow
				? (stored?.cash_abs_threshold ?? Number.NaN)
				: DEFAULT_REPORT_SETTINGS.cashAbsThreshold;
			const relThreshold = hasRow
				? (stored?.cash_rel_threshold ?? Number.NaN)
				: DEFAULT_REPORT_SETTINGS.cashRelThreshold;
			const range = { store_ids: [store.id], from_date: from, to_date: to };
			const plain = await active.source.call("shift_review", range);
			const explicit = await active.source.call("shift_review", {
				...range,
				abs_threshold: absThreshold,
				rel_threshold: relThreshold,
			});
			shifts += plain.length;
			if (sortedJson(plain) !== sortedJson(explicit)) shiftsEqual = false;
			const [plainFlags, explicitFlags] = await asMember(
				active.sql,
				active.userId,
				async (transaction) => [
					await transaction.unsafe(
						"select * from public.cash_variance_flags($1::uuid[], $2::date, $3::date)",
						[`{${store.id}}`, from, to],
					),
					await transaction.unsafe(
						"select * from public.cash_variance_flags($1::uuid[], $2::date, $3::date, $4::numeric, $5::numeric)",
						[
							`{${store.id}}`,
							from,
							to,
							String(absThreshold),
							String(relThreshold),
						],
					),
				],
			);
			flags += plainFlags.length;
			if (sortedJson([...plainFlags]) !== sortedJson([...explicitFlags])) {
				flagsEqual = false;
			}
		}
		report("thresholds", {
			days: SHIFT_DAYS,
			tenantRows,
			shifts,
			flags,
			shiftsEqual,
			flagsEqual,
		});
		expect(shiftsEqual).toBe(true);
		expect(flagsEqual).toBe(true);
	});

	it("6. report_settings_of answers with the defaults and no analytics day is pending", async () => {
		const active = live();
		const rows = await active.source.callTheme("report_settings_of", {
			store_ids: active.stores.map((store) => store.id),
		});
		const states = rows.map(settingsOfRow);
		const defaults = states.every(
			(state) => !state.hasTenantRow && isDefaultReportSettings(state.settings),
		);
		const flagsFalse = states.every(
			(state) =>
				!state.openingHoursKnown &&
				!state.feeRatesConfigured &&
				!state.costsConfigured &&
				!state.rolesConfigured,
		);
		const statusRows = await catchUpStatus(active);
		const [status] = statusRows;
		const pendingDays = Number(status?.pending_days ?? 0);
		report("settings and catch-up", {
			stores: rows.length,
			defaults,
			flagsFalse,
			pendingDays,
			pendingFrom:
				status?.pending_from !== null && status?.pending_from !== undefined,
		});
		expect(rows.length).toBe(active.stores.length);
		expect(defaults).toBe(true);
		expect(flagsFalse).toBe(true);
		expect(statusRows).toHaveLength(1);
		expect(pendingDays).toBe(0);
	});

	it("7. shift_review and cash_variance_flags flag the same shifts with the tenant's thresholds over the last 92 days (FR-THM-07)", async () => {
		const active = live();
		const to = active.asOf;
		const from = addDays(to, 1 - SHIFT_DAYS);
		const outcomes: boolean[] = [];
		let allStoresShifts = 0;
		for (const selection of storeSelections(active.stores)) {
			const review = await active.source.call("shift_review", {
				store_ids: selection.stores.map((store) => store.id),
				from_date: from,
				to_date: to,
			});
			const cashFlags = await asMember(
				active.sql,
				active.userId,
				(transaction) =>
					transaction.unsafe(
						"select shift_id::text as shift_id from public.cash_variance_flags($1::uuid[], $2::date, $3::date)",
						[uuidArray(selection.stores), from, to],
					),
			);
			const shifts = flaggedShifts(
				review,
				cashFlags.map((row) => ({ shift_id: String(row.shift_id) })),
			);
			report("flagged shifts", {
				selection: selection.label,
				days: SHIFT_DAYS,
				shifts: review.length,
				...shifts,
			});
			outcomes.push(shifts.agree);
			if (selection.stores.length === active.stores.length) {
				allStoresShifts = review.length;
			}
		}
		expect(outcomes).toHaveLength(active.stores.length + 1);
		expect(allStoresShifts).toBeGreaterThan(0);
		expect(outcomes.every(Boolean)).toBe(true);
	});

	it("8. promotion_compliance and item_discount_days agree with promotion_summary over the year to date, or the last year on 1 January", async () => {
		const active = live();
		const year = promotionYear(active.asOf);
		const periods = capPeriods(themePromotionRules(), year);
		const failures: string[] = [];
		let compared = 0;
		let allStoresDiscountItems = 0;
		for (const selection of storeSelections(active.stores)) {
			const storeIds = selection.stores.map((store) => store.id);
			for (const [position, period] of periods.entries()) {
				const range = {
					store_ids: storeIds,
					from_date: period.from,
					to_date: period.to,
				};
				const identities = promotionIdentities(
					await active.source.call("promotion_summary", range),
					await active.source.callTheme("promotion_compliance", {
						...range,
						cap_rate: period.cap,
					}),
				);
				report("promotion identities", {
					selection: selection.label,
					capPeriod: position + 1,
					days: windowDays(period),
					...identities,
				});
				compared += identities.promotions;
				const label = `${selection.label} period ${position + 1}`;
				if (!identities.keysAgree) failures.push(`${label} keys`);
				if (!identities.checkedRowsAgree) {
					failures.push(`${label} checked rows`);
				}
				if (!identities.flaggedWithinDiscount) {
					failures.push(`${label} flagged discount`);
				}
			}
			const discountDays = await active.source.callTheme("item_discount_days", {
				store_ids: storeIds,
				calendar_year: yearOf(year.to),
				as_of_date: year.to,
			});
			const withoutDiscount = itemsWithoutDiscount(discountDays);
			report("discount days", {
				selection: selection.label,
				days: windowDays(year),
				discountItems: discountDays.length,
				itemsWithoutDiscount: withoutDiscount,
			});
			if (withoutDiscount > 0) {
				failures.push(`${selection.label} items without a discount`);
			}
			if (selection.stores.length === active.stores.length) {
				allStoresDiscountItems = discountDays.length;
			}
		}
		report("promotion checks", {
			capPeriods: periods.length,
			compared,
			allStoresDiscountItems,
			failures: failures.length,
		});
		expect(periods.length).toBeGreaterThan(0);
		expect(compared).toBeGreaterThan(0);
		expect(allStoresDiscountItems).toBeGreaterThan(0);
		expect(failures).toEqual([]);
	});

	it("9. the real tenant's row counts are the same after the run", async () => {
		const active = live();
		const after = await rowCountsOf(active.sql, active.tenantId);
		const changed = [...after].filter(
			([table, count]) => active.rowCounts.get(table) !== count,
		);
		report("row counts", {
			tables: after.size,
			changed: changed.length,
		});
		expect(after.size).toBe(active.rowCounts.size);
		expect(changed).toEqual([]);
	});
});
