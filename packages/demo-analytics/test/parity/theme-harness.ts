import {
	ARGUMENT_SQL_TYPES,
	type ReportSettings,
	type ThemeArgs,
	ThemeCallError,
	type ThemeFunctionName,
	themeArgumentNames,
} from "@fnb/reports";
import {
	createDemoReportSource,
	type DemoReportSource,
	DemoSettingsStore,
	type DemoStoreId,
	demoSettings,
} from "../../src/index.js";
import type { CompareOptions, ParityReport } from "./compare.js";
import type { ParityClock } from "./datasets.js";
import type { ParityContext } from "./harness.js";
import { pgArray, type SeededDataset, type SqlRow } from "./harness.js";

export const PARITY_SEATS: Readonly<Record<DemoStoreId, number | null>> = {
	"MOCK-S1": 40,
	"MOCK-S2": null,
};

export const TENANT_SETTINGS_VARIANT: ReportSettings = {
	menuWindowDays: 21,
	menuPopularityFactor: 0.75,
	menuLowSampleItems: 5,
	cashAbsThreshold: 80000,
	cashRelThreshold: 0.008,
	peakHours: 4,
	deadHourRatio: 0.4,
	busyHourRatio: 1.3,
	promoPreWeeks: 3,
};

export interface SettingsVariant {
	readonly id: "defaults" | "tenant";
	readonly settings: ReportSettings | null;
}

export const SETTINGS_VARIANTS: readonly SettingsVariant[] = [
	{ id: "defaults", settings: null },
	{ id: "tenant", settings: TENANT_SETTINGS_VARIANT },
];

export function themeEngine(
	seeded: SeededDataset,
	clock: ParityClock,
): DemoReportSource {
	return createDemoReportSource({
		now: () => clock.now,
		days: seeded.days,
		volumeScale: seeded.dataset.volumeScale,
		validateRows: true,
		settings: new DemoSettingsStore(demoSettings()),
	});
}

export async function seedSeats(
	context: ParityContext,
	seeded: SeededDataset,
): Promise<void> {
	for (const [storeId, seats] of Object.entries(PARITY_SEATS)) {
		await context.connection.rows(
			"update public.stores set seat_count = $1::integer where id = $2::uuid",
			[seats, seeded.uuidOf(storeId as DemoStoreId)],
		);
	}
}

export async function applySettingsVariant(
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
	variant: SettingsVariant,
): Promise<void> {
	await context.connection.rows(
		"delete from public.report_settings where tenant_id = $1::uuid",
		[seeded.tenantId],
	);
	engine.settings.saveReportSettings(variant.settings);
	const settings = variant.settings;
	if (settings === null) return;
	await context.connection.rows(
		`insert into public.report_settings (
			tenant_id, menu_window_days, menu_popularity_factor, menu_low_sample_items,
			cash_abs_threshold, cash_rel_threshold, peak_hours, dead_hour_ratio,
			busy_hour_ratio, promo_pre_weeks
		) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			seeded.tenantId,
			settings.menuWindowDays,
			settings.menuPopularityFactor,
			settings.menuLowSampleItems,
			settings.cashAbsThreshold,
			settings.cashRelThreshold,
			settings.peakHours,
			settings.deadHourRatio,
			settings.busyHourRatio,
			settings.promoPreWeeks,
		],
	);
}

function sqlArgument(value: unknown): unknown {
	if (Array.isArray(value)) return pgArray(value.map(String));
	if (typeof value === "number") return String(value);
	return value;
}

export function themeSql<N extends ThemeFunctionName>(
	seeded: SeededDataset,
	name: N,
	args: ThemeArgs<N>,
): { text: string; params: unknown[] } {
	const known = new Set(themeArgumentNames(name));
	const params: unknown[] = [];
	const parts: string[] = [];
	for (const [argument, value] of Object.entries(args)) {
		if (value === undefined) continue;
		if (!known.has(argument)) {
			throw new Error(`${name} has no argument ${argument}`);
		}
		const type = ARGUMENT_SQL_TYPES[argument];
		if (type === undefined) throw new Error(`no SQL type for ${argument}`);
		const translated =
			argument === "store_ids"
				? (value as readonly string[]).map(
						(id) => seeded.stores[id as DemoStoreId]?.uuid ?? id,
					)
				: value;
		params.push(value === null ? null : sqlArgument(translated));
		parts.push(`${argument} => $${params.length}::${type}`);
	}
	return { text: `select * from public.${name}(${parts.join(", ")})`, params };
}

interface Outcome {
	readonly rows: SqlRow[] | null;
	readonly code: string | null;
}

function codeOf(error: unknown): string {
	if (error instanceof ThemeCallError) return error.code ?? "error";
	if (error !== null && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code);
	}
	return "error";
}

async function outcome(run: () => Promise<SqlRow[]>): Promise<Outcome> {
	try {
		return { rows: await run(), code: null };
	} catch (error) {
		return { rows: null, code: codeOf(error) };
	}
}

export async function compareThemeCall<N extends ThemeFunctionName>(
	report: ParityReport,
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
	name: N,
	args: ThemeArgs<N>,
	options: Omit<CompareOptions, "demoIdOf">,
	label = "",
): Promise<void> {
	const call = `${seeded.dataset.id}${label} ${name}(${JSON.stringify(args)})`;
	const { text, params } = themeSql(seeded, name, args);
	const sql = await outcome(() => context.connection.rows(text, params));
	const fromEngine = await outcome(
		async () => (await engine.callTheme(name, args)) as unknown as SqlRow[],
	);
	if (sql.code !== null || fromEngine.code !== null) {
		report.compareValues(call, "error code", sql.code, fromEngine.code);
		return;
	}
	report.compareRows(call, sql.rows ?? [], fromEngine.rows ?? [], {
		...options,
		demoIdOf: seeded.demoIdOf,
	});
}
