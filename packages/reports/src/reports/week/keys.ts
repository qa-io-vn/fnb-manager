export const weekKeys = {
	title: "report.week.title",
	partial: "report.week.partial",
	noDataNotice: "report.week.noDataNotice",
	compare: {
		average4WeeksLikeForLike: "report.week.compare.average4WeeksLikeForLike",
	},
	periodRow: {
		current: "report.week.periodRow.current",
		previous: "report.week.periodRow.previous",
		average4Weeks: "report.week.periodRow.average4Weeks",
		average4WeeksLikeForLike: "report.week.periodRow.average4WeeksLikeForLike",
		lastYear: "report.week.periodRow.lastYear",
	},
	net: {
		title: "report.week.net.title",
		up: "report.week.net.up",
		down: "report.week.net.down",
		flat: "report.week.net.flat",
		noReference: "report.week.net.noReference",
		noData: "report.week.net.noData",
		chart: "report.week.net.chart",
		storeTable: "report.week.net.storeTable",
		periodTable: "report.week.net.periodTable",
	},
	invoices: {
		title: "report.week.invoices.title",
		up: "report.week.invoices.up",
		down: "report.week.invoices.down",
		flat: "report.week.invoices.flat",
		noReference: "report.week.invoices.noReference",
		noData: "report.week.invoices.noData",
		chart: "report.week.invoices.chart",
		storeTable: "report.week.invoices.storeTable",
		periodTable: "report.week.invoices.periodTable",
	},
	avgTicket: {
		title: "report.week.avgTicket.title",
		up: "report.week.avgTicket.up",
		down: "report.week.avgTicket.down",
		flat: "report.week.avgTicket.flat",
		noReference: "report.week.avgTicket.noReference",
		noData: "report.week.avgTicket.noData",
		table: "report.week.avgTicket.table",
	},
	curve: {
		title: "report.week.curve.title",
		caption: "report.week.curve.caption",
		main: "report.week.curve.main",
		noData: "report.week.curve.noData",
		driver: "report.week.curve.driver",
		chart: "report.week.curve.chart",
		table: "report.week.curve.table",
		averageSeries: "report.week.curve.averageSeries",
		averageSeriesLikeForLike: "report.week.curve.averageSeriesLikeForLike",
	},
	movers: {
		title: "report.week.movers.title",
		window: "report.week.movers.window",
		caption: "report.week.movers.caption",
		captionLikeForLike: "report.week.movers.captionLikeForLike",
		main: "report.week.movers.main",
		risersOnly: "report.week.movers.risersOnly",
		fallersOnly: "report.week.movers.fallersOnly",
		none: "report.week.movers.none",
		newItem: "report.week.movers.newItem",
		buildingBaseline: "report.week.movers.buildingBaseline",
		buildingBaselineSentence: "report.week.movers.buildingBaselineSentence",
		noRiser: "report.week.movers.noRiser",
		table: "report.week.movers.table",
		group: {
			up: "report.week.movers.group.up",
			down: "report.week.movers.group.down",
			new: "report.week.movers.group.new",
		},
	},
	categories: {
		title: "report.week.categories.title",
		caption: "report.week.categories.caption",
		main: "report.week.categories.main",
		noData: "report.week.categories.noData",
		chart: "report.week.categories.chart",
		table: "report.week.categories.table",
	},
	promotions: {
		title: "report.week.promotions.title",
		caption: "report.week.promotions.caption",
		up: "report.week.promotions.up",
		down: "report.week.promotions.down",
		flat: "report.week.promotions.flat",
		noReference: "report.week.promotions.noReference",
		noData: "report.week.promotions.noData",
		none: "report.week.promotions.none",
		largest: "report.week.promotions.largest",
		largestUnnamed: "report.week.promotions.largestUnnamed",
		voucherShare: "report.week.promotions.voucherShare",
		series: {
			item: "report.week.promotions.series.item",
			bill: "report.week.promotions.series.bill",
			voucher: "report.week.promotions.series.voucher",
		},
		rateComparePrevious: "report.week.promotions.rateComparePrevious",
		chart: "report.week.promotions.chart",
		table: "report.week.promotions.table",
	},
	days: {
		title: "report.week.days.title",
		caption: "report.week.days.caption",
		main: "report.week.days.main",
		holiday: "report.week.days.holiday",
		tooFew: "report.week.days.tooFew",
		tooFewSentence: "report.week.days.tooFewSentence",
		chart: "report.week.days.chart",
		above: "report.week.days.above",
		below: "report.week.days.below",
		table: "report.week.days.table",
	},
	table: {
		lastWeek: "report.week.table.lastWeek",
		changeLastWeek: "report.week.table.changeLastWeek",
		average4Weeks: "report.week.table.average4Weeks",
		changeAverage4Weeks: "report.week.table.changeAverage4Weeks",
		lastYear: "report.week.table.lastYear",
		changeLastYear: "report.week.table.changeLastYear",
		weekdayAverage: "report.week.table.weekdayAverage",
		weekdayAverageLikeForLike: "report.week.table.weekdayAverageLikeForLike",
		changeWeekdayAverage: "report.week.table.changeWeekdayAverage",
		shareOfWeek: "report.week.table.shareOfWeek",
		recentQuantity: "report.week.table.recentQuantity",
		priorQuantity: "report.week.table.priorQuantity",
		quantityChange: "report.week.table.quantityChange",
		recentNet: "report.week.table.recentNet",
		group: "report.week.table.group",
		lastWeekShare: "report.week.table.lastWeekShare",
		lastWeekDiscount: "report.week.table.lastWeekDiscount",
		daysUsed: "report.week.table.daysUsed",
		deviation: "report.week.table.deviation",
		holiday: "report.week.table.holiday",
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

export function weekReportKeys(): readonly string[] {
	const keys: string[] = [];
	collectKeys(weekKeys, keys);
	return keys;
}
