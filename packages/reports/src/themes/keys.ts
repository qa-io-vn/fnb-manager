export const themeKeys = {
	tabs: {
		label: "theme.tabs.label",
	},
	page: {
		rangeClamped: "theme.page.rangeClamped",
		todayClamped: "theme.page.todayClamped",
		invalidRange: "theme.page.invalidRange",
		noStores: "theme.page.noStores",
	},
	range: {
		label: "theme.range.label",
		summary: "theme.range.summary",
		custom: "theme.range.custom",
		from: "theme.range.from",
		to: "theme.range.to",
		previousStep: "theme.range.previousStep",
		nextStep: "theme.range.nextStep",
		preset: {
			"7d": "theme.range.preset.7d",
			"28d": "theme.range.preset.28d",
			"91d": "theme.range.preset.91d",
			"364d": "theme.range.preset.364d",
			this_month: "theme.range.preset.this_month",
			last_month: "theme.range.preset.last_month",
			this_year: "theme.range.preset.this_year",
			custom: "theme.range.preset.custom",
		},
	},
	compare: {
		previousDays: "theme.compare.previousDays",
		previousWeeks: "theme.compare.previousWeeks",
		lastYear: "theme.compare.lastYear",
	},
	subtitle: {
		lastDays: "theme.subtitle.lastDays",
	},
	print: {
		summary: "theme.print.summary",
	},
	weekday: {
		short: {
			1: "theme.weekday.short.1",
			2: "theme.weekday.short.2",
			3: "theme.weekday.short.3",
			4: "theme.weekday.short.4",
			5: "theme.weekday.short.5",
			6: "theme.weekday.short.6",
			7: "theme.weekday.short.7",
		},
		long: {
			1: "theme.weekday.long.1",
			2: "theme.weekday.long.2",
			3: "theme.weekday.long.3",
			4: "theme.weekday.long.4",
			5: "theme.weekday.long.5",
			6: "theme.weekday.long.6",
			7: "theme.weekday.long.7",
		},
	},
	heat: {
		legend: "theme.heat.legend",
		average: "theme.heat.average",
		hour: "theme.heat.hour",
	},
	stale: "theme.stale",
} as const;

export type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function weekdayShortKey(weekday: number): string {
	return themeKeys.weekday.short[weekday as WeekdayNumber];
}

export function weekdayLongKey(weekday: number): string {
	return themeKeys.weekday.long[weekday as WeekdayNumber];
}
