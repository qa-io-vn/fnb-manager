export const shiftsKeys = {
	title: "theme.shifts.title",
	noData: "theme.shifts.noData",
	noShifts: "theme.shifts.noShifts",
	sales: {
		title: "theme.shifts.sales.title",
		caption: "theme.shifts.sales.caption",
		main: "theme.shifts.sales.main",
		average: "theme.shifts.sales.average",
		table: "theme.shifts.sales.table",
		chart: "theme.shifts.sales.chart",
		series: "theme.shifts.sales.series",
	},
	drawer: {
		title: "theme.shifts.drawer.title",
		cashierTable: "theme.shifts.drawer.cashierTable",
	},
	adjustments: {
		title: "theme.shifts.adjustments.title",
		main: "theme.shifts.adjustments.main",
		none: "theme.shifts.adjustments.none",
		unmeasured: "theme.shifts.adjustments.unmeasured",
		basis: "theme.shifts.adjustments.basis",
		unscored: "theme.shifts.adjustments.unscored",
		table: "theme.shifts.adjustments.table",
		chart: "theme.shifts.adjustments.chart",
		series: "theme.shifts.adjustments.series",
		threshold: "theme.shifts.adjustments.threshold",
	},
	reasons: {
		voids: "theme.shifts.reasons.voids",
		removed_lines: "theme.shifts.reasons.removed_lines",
		after_close: "theme.shifts.reasons.after_close",
		voids_removed_lines: "theme.shifts.reasons.voids_removed_lines",
		voids_after_close: "theme.shifts.reasons.voids_after_close",
		removed_lines_after_close: "theme.shifts.reasons.removed_lines_after_close",
		voids_removed_lines_after_close:
			"theme.shifts.reasons.voids_removed_lines_after_close",
	},
	table: {
		voids: "theme.shifts.table.voids",
		voidRate: "theme.shifts.table.voidRate",
		voidZ: "theme.shifts.table.voidZ",
		removedLines: "theme.shifts.table.removedLines",
		removedRate: "theme.shifts.table.removedRate",
		removedZ: "theme.shifts.table.removedZ",
		edits: "theme.shifts.table.edits",
		editsAfterClose: "theme.shifts.table.editsAfterClose",
		shifts: "theme.shifts.table.shifts",
		flagged: "theme.shifts.table.flagged",
		totalVariance: "theme.shifts.table.totalVariance",
		meanVariance: "theme.shifts.table.meanVariance",
		largestShortage: "theme.shifts.table.largestShortage",
		largestOverage: "theme.shifts.table.largestOverage",
	},
} as const;

const ADJUSTMENT_REASON_ORDER = [
	"voids",
	"removed_lines",
	"after_close",
] as const;

export function adjustmentReasonsKey(
	reasons: readonly string[] | null,
): string | null {
	const present = ADJUSTMENT_REASON_ORDER.filter((reason) =>
		(reasons ?? []).includes(reason),
	);
	if (present.length === 0) return null;
	return shiftsKeys.reasons[
		present.join("_") as keyof typeof shiftsKeys.reasons
	];
}
