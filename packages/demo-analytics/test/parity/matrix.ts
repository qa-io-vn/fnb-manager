import { formatIsoDate, VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	type AnalyticsArgs,
	AnalyticsCallError,
	type AnalyticsFunctionName,
	addDays,
	type IsoDate,
} from "@fnb/reports";
import type { DemoStoreId } from "../../src/index.js";
import type { CompareOptions, ParityReport } from "./compare.js";
import {
	inWindow,
	monthEnds,
	type ParityClock,
	seededDates,
} from "./datasets.js";
import type { ParityContext, SeededDataset } from "./harness.js";

export const STORE_SETS: readonly (readonly DemoStoreId[])[] = [
	["MOCK-S1"],
	["MOCK-S2"],
	["MOCK-S1", "MOCK-S2"],
];

export const GRAINS = ["day", "week", "month", "year"] as const;

function tetDates(): IsoDate[] {
	return VIETNAM_HOLIDAYS.filter(
		(holiday) => holiday.name === "Tet, day 4",
	).map((holiday) => holiday.holidayDate);
}

export function matrixAnchors(
	seeded: SeededDataset,
	clock: ParityClock,
	randomCount: number,
): IsoDate[] {
	const young = seeded.stores["MOCK-S2"].definition.openedOn;
	const window = seeded.window;
	const years: IsoDate[] = [];
	for (
		let year = Number(window.from.slice(0, 4));
		year <= Number(window.to.slice(0, 4));
		year += 1
	) {
		years.push(formatIsoDate(year, 1, 1), formatIsoDate(year, 12, 31));
	}
	const candidates = [
		clock.today,
		clock.asOf,
		addDays(clock.asOf, -1),
		...monthEnds(clock, 3),
		young,
		addDays(young, 7),
		...years,
		...tetDates(),
		...seededDates(
			seeded.dataset,
			randomCount,
			seeded.dataset.id.charCodeAt(1),
		),
	];
	return [...new Set(candidates)]
		.filter((date) => inWindow(seeded.dataset, date))
		.sort();
}

export interface CallOutcome {
	readonly rows: Record<string, unknown>[] | null;
	readonly code: string | null;
}

function codeOf(error: unknown): string {
	if (error instanceof AnalyticsCallError) return error.code ?? "error";
	if (error !== null && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code);
	}
	return "error";
}

async function outcome(
	run: () => Promise<Record<string, unknown>[]>,
): Promise<CallOutcome> {
	try {
		return { rows: await run(), code: null };
	} catch (error) {
		return { rows: null, code: codeOf(error) };
	}
}

export async function compareCall<N extends AnalyticsFunctionName>(
	report: ParityReport,
	context: ParityContext,
	seeded: SeededDataset,
	name: N,
	args: AnalyticsArgs<N>,
	options: Omit<CompareOptions, "demoIdOf">,
): Promise<void> {
	const label = `${seeded.dataset.id} ${name}(${JSON.stringify(args)})`;
	const sql = await outcome(() => context.call(seeded, name, args));
	const engine = await outcome(
		async () =>
			(await seeded.engine.call(name, args)) as unknown as Record<
				string,
				unknown
			>[],
	);
	if (sql.code !== null || engine.code !== null) {
		report.compareValues(label, "error code", sql.code, engine.code);
		return;
	}
	report.compareRows(label, sql.rows ?? [], engine.rows ?? [], {
		...options,
		demoIdOf: seeded.demoIdOf,
	});
}
