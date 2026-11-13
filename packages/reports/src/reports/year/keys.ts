const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type MonthNumber = (typeof MONTH_NUMBERS)[number];

export const YEAR_MONTH_NUMBERS: readonly MonthNumber[] = MONTH_NUMBERS;

export function monthLabelKey(month: number): string {
	return `report.year.month.${month}`;
}

export const yearKeys = {
	title: "report.year.title",
	noSales: "report.year.noSales",
	table: {
		year: "report.year.table.year",
		total: "report.year.table.total",
		lastYearNet: "report.year.table.lastYearNet",
		yoy: "report.year.table.yoy",
		mom: "report.year.table.mom",
		threeMonths: "report.year.table.threeMonths",
		avgDailyNet: "report.year.table.avgDailyNet",
		index: "report.year.table.index",
		lastYearTicket: "report.year.table.lastYearTicket",
		changeLastYear: "report.year.table.changeLastYear",
		itemsEffect: "report.year.table.itemsEffect",
		priceEffect: "report.year.table.priceEffect",
		stage: "report.year.table.stage",
		firstSold: "report.year.table.firstSold",
		lastSold: "report.year.table.lastSold",
		quantityYtd: "report.year.table.quantityYtd",
		quantityLastYtd: "report.year.table.quantityLastYtd",
		netYtd: "report.year.table.netYtd",
		lastYtd: "report.year.table.lastYtd",
		week: "report.year.table.week",
		daysWithData: "report.year.table.daysWithData",
		changeFirstWeek: "report.year.table.changeFirstWeek",
		likeForLike: "report.year.table.likeForLike",
		coveredNet: "report.year.table.coveredNet",
		coveredLastYearNet: "report.year.table.coveredLastYearNet",
		coveredTicket: "report.year.table.coveredTicket",
	},
	matrix: {
		title: "report.year.matrix.title",
		caption: "report.year.matrix.caption",
		captionPartial: "report.year.matrix.captionPartial",
		peak: "report.year.matrix.peak",
		peakPartial: "report.year.matrix.peakPartial",
		noData: "report.year.matrix.noData",
		lastYearUp: "report.year.matrix.lastYearUp",
		lastYearDown: "report.year.matrix.lastYearDown",
		lastYearFlat: "report.year.matrix.lastYearFlat",
		lastYearNone: "report.year.matrix.lastYearNone",
		lastYearUpLikeForLike: "report.year.matrix.lastYearUpLikeForLike",
		lastYearDownLikeForLike: "report.year.matrix.lastYearDownLikeForLike",
		lastYearFlatLikeForLike: "report.year.matrix.lastYearFlatLikeForLike",
		table: "report.year.matrix.table",
		partial: "report.year.matrix.partial",
	},
	growth: {
		title: "report.year.growth.title",
		caption: "report.year.growth.caption",
		main: "report.year.growth.main",
		onlyRise: "report.year.growth.onlyRise",
		onlyFall: "report.year.growth.onlyFall",
		flat: "report.year.growth.flat",
		noReference: "report.year.growth.noReference",
		noData: "report.year.growth.noData",
		noCompleteMonth: "report.year.growth.noCompleteMonth",
		rise: "report.year.growth.rise",
		fall: "report.year.growth.fall",
		chart: "report.year.growth.chart",
		table: "report.year.growth.table",
	},
	seasonality: {
		title: "report.year.seasonality.title",
		caption: "report.year.seasonality.caption",
		main: "report.year.seasonality.main",
		tooShort: "report.year.seasonality.tooShort",
		tooShortSentence: "report.year.seasonality.tooShortSentence",
		tetBoth: "report.year.seasonality.tetBoth",
		tetThisYear: "report.year.seasonality.tetThisYear",
		tetLastYear: "report.year.seasonality.tetLastYear",
		tet: "report.year.seasonality.tet",
		series: "report.year.seasonality.series",
		chart: "report.year.seasonality.chart",
		table: "report.year.seasonality.table",
		tableLikeForLike: "report.year.seasonality.tableLikeForLike",
		weekdayTable: "report.year.seasonality.weekdayTable",
	},
	ticket: {
		title: "report.year.ticket.title",
		up: "report.year.ticket.up",
		down: "report.year.ticket.down",
		flat: "report.year.ticket.flat",
		noReference: "report.year.ticket.noReference",
		noData: "report.year.ticket.noData",
		series: "report.year.ticket.series",
		chart: "report.year.ticket.chart",
		table: "report.year.ticket.table",
	},
	lifecycle: {
		title: "report.year.lifecycle.title",
		caption: "report.year.lifecycle.caption",
		main: "report.year.lifecycle.main",
		mainYoung: "report.year.lifecycle.mainYoung",
		noData: "report.year.lifecycle.noData",
		topNew: "report.year.lifecycle.topNew",
		topDiscontinued: "report.year.lifecycle.topDiscontinued",
		tooYoung: "report.year.lifecycle.tooYoung",
		chart: "report.year.lifecycle.chart",
		chartSeries: "report.year.lifecycle.chartSeries",
		table: "report.year.lifecycle.table",
		tableLikeForLike: "report.year.lifecycle.tableLikeForLike",
		status: {
			new: "report.year.lifecycle.status.new",
			growing: "report.year.lifecycle.status.growing",
			declining: "report.year.lifecycle.status.declining",
			discontinued: "report.year.lifecycle.status.discontinued",
			steady: "report.year.lifecycle.status.steady",
		},
	},
	yearOverYear: {
		title: "report.year.yearOverYear.title",
		up: "report.year.yearOverYear.up",
		down: "report.year.yearOverYear.down",
		flat: "report.year.yearOverYear.flat",
		noReference: "report.year.yearOverYear.noReference",
		noData: "report.year.yearOverYear.noData",
		chart: "report.year.yearOverYear.chart",
		table: "report.year.yearOverYear.table",
		periodTable: "report.year.yearOverYear.periodTable",
	},
	since: {
		title: "report.year.since.title",
		caption: "report.year.since.caption",
		main: "report.year.since.main",
		latest: "report.year.since.latest",
		firstWeek: "report.year.since.firstWeek",
		tooEarly: "report.year.since.tooEarly",
		notice: "report.year.since.notice",
		series: "report.year.since.series",
		chart: "report.year.since.chart",
		table: "report.year.since.table",
	},
} as const;

function collectKeys(value: unknown, into: string[]): void {
	if (typeof value === "string") {
		into.push(value);
		return;
	}
	if (value !== null && typeof value === "object") {
		for (const nested of Object.values(value)) collectKeys(nested, into);
	}
}

export function yearReportKeys(): readonly string[] {
	const keys: string[] = [];
	collectKeys(yearKeys, keys);
	for (const month of YEAR_MONTH_NUMBERS) keys.push(monthLabelKey(month));
	return keys;
}
