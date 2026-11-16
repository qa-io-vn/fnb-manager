import {
	addDays,
	type IsoDate,
	type ThemeArgs,
	ThemeCallError,
} from "@fnb/reports";
import { DEMO_POS_ACCOUNT_ID, type DemoReportSource } from "../../src/index.js";
import type { CompareOptions, ParityReport } from "./compare.js";
import {
	inWindow,
	monthEnds,
	type ParityClock,
	seededRanges,
} from "./datasets.js";
import type { ParityContext, SeededDataset, SqlRow } from "./harness.js";
import { SECOND_ACCOUNT } from "./settings-fixture.js";
import { themeSql } from "./theme-harness.js";

export type QualityFunction =
	| "data_quality_items"
	| "data_quality_summary"
	| "data_quality_payments";

export interface QualityRange {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

const PRESET_DAYS = [7, 28, 90] as const;

export function qualityRanges(
	seeded: SeededDataset,
	clock: ParityClock,
	randomCount: number,
	salt: number,
): QualityRange[] {
	const clip = (from: IsoDate, to: IsoDate): QualityRange => ({
		from: from < seeded.window.from ? seeded.window.from : from,
		to: to > seeded.window.to ? seeded.window.to : to,
	});
	const young = seeded.stores["MOCK-S2"].definition.openedOn;
	const ranges = PRESET_DAYS.map((days) =>
		clip(addDays(clock.asOf, -(days - 1)), clock.asOf),
	);
	if (inWindow(seeded.dataset, young)) {
		ranges.push(clip(young, addDays(young, 27)));
	}
	for (const monthEnd of monthEnds(clock, 1)) {
		ranges.push(clip(addDays(monthEnd, -6), addDays(monthEnd, 7)));
	}
	ranges.push(...seededRanges(seeded.dataset, randomCount, salt, 400));
	return ranges.filter((range) => range.from <= range.to);
}

export async function accountIds(
	context: ParityContext,
	seeded: SeededDataset,
): Promise<Map<string, string>> {
	const rows = await context.connection.rows(
		"select distinct pos_account_id::text as account from public.stores where tenant_id = $1::uuid",
		[seeded.tenantId],
	);
	const accounts = new Map<string, string>([
		[seeded.posAccountId, DEMO_POS_ACCOUNT_ID],
	]);
	for (const row of rows) {
		const account = String(row.account);
		if (!accounts.has(account)) accounts.set(account, SECOND_ACCOUNT);
	}
	return accounts;
}

function codeOf(error: unknown): string {
	if (error instanceof ThemeCallError) return error.code ?? "error";
	if (error !== null && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code);
	}
	return "error";
}

export async function compareQuality<N extends QualityFunction>(
	report: ParityReport,
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
	name: N,
	args: ThemeArgs<N>,
	options: Omit<CompareOptions, "demoIdOf">,
	accounts: ReadonlyMap<string, string>,
	label = "",
): Promise<{ sql: SqlRow[]; engine: SqlRow[] } | null> {
	const call = `${seeded.dataset.id}${label} ${name}(${JSON.stringify(args)})`;
	const { text, params } = themeSql(seeded, name, args);
	const sql = await context.connection.rows(text, params).then(
		(rows) => ({ rows, code: null as string | null }),
		(error: unknown) => ({ rows: null, code: codeOf(error) }),
	);
	const fromEngine = await engine.callTheme(name, args).then(
		(rows) => ({
			rows: rows as unknown as SqlRow[],
			code: null as string | null,
		}),
		(error: unknown) => ({ rows: null, code: codeOf(error) }),
	);
	if (sql.code !== null || fromEngine.code !== null) {
		report.compareValues(call, "error code", sql.code, fromEngine.code);
		return null;
	}
	const translated = (sql.rows ?? []).map((row) =>
		"pos_account_id" in row && typeof row.pos_account_id === "string"
			? {
					...row,
					pos_account_id:
						accounts.get(row.pos_account_id) ?? row.pos_account_id,
				}
			: row,
	);
	report.compareRows(call, translated, fromEngine.rows ?? [], {
		...options,
		demoIdOf: seeded.demoIdOf,
	});
	return { sql: translated, engine: fromEngine.rows ?? [] };
}
