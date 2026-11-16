export const promotionsKeys = {
	title: "theme.promotions.title",
	discountCost: {
		title: "theme.promotions.discountCost.title",
		caption: "theme.promotions.discountCost.caption",
		up: "theme.promotions.discountCost.up",
		down: "theme.promotions.discountCost.down",
		flat: "theme.promotions.discountCost.flat",
		noReference: "theme.promotions.discountCost.noReference",
		noData: "theme.promotions.discountCost.noData",
		none: "theme.promotions.discountCost.none",
		largest: "theme.promotions.discountCost.largest",
		largestUnnamed: "theme.promotions.discountCost.largestUnnamed",
		rateCompare: "theme.promotions.discountCost.rateCompare",
		table: "theme.promotions.discountCost.table",
		componentsTable: "theme.promotions.discountCost.componentsTable",
		chartDay: "theme.promotions.discountCost.chartDay",
		chartWeek: "theme.promotions.discountCost.chartWeek",
	},
	vouchers: {
		title: "theme.promotions.vouchers.title",
		up: "theme.promotions.vouchers.up",
		down: "theme.promotions.vouchers.down",
		flat: "theme.promotions.vouchers.flat",
		noReference: "theme.promotions.vouchers.noReference",
		noData: "theme.promotions.vouchers.noData",
		none: "theme.promotions.vouchers.none",
		top: "theme.promotions.vouchers.top",
		topUnnamed: "theme.promotions.vouchers.topUnnamed",
		table: "theme.promotions.vouchers.table",
	},
	lift: {
		title: "theme.promotions.lift.title",
		promotion: "theme.promotions.lift.promotion",
		comparatorLabel: "theme.promotions.lift.comparatorLabel",
		option: "theme.promotions.lift.option",
		optionUnnamed: "theme.promotions.lift.optionUnnamed",
		comparator: {
			baseline: "theme.promotions.lift.comparator.baseline",
			prior_weeks: "theme.promotions.lift.comparator.prior_weeks",
			sister_store: "theme.promotions.lift.comparator.sister_store",
		},
		definition: {
			baseline: "theme.promotions.lift.definition.baseline",
			prior_weeks: "theme.promotions.lift.definition.prior_weeks",
			sister_store: "theme.promotions.lift.definition.sister_store",
		},
		subtitle: "theme.promotions.lift.subtitle",
		caption: "theme.promotions.lift.caption",
		gain: "theme.promotions.lift.gain",
		loss: "theme.promotions.lift.loss",
		trend: "theme.promotions.lift.trend",
		notMeasured: "theme.promotions.lift.notMeasured",
		none: "theme.promotions.lift.none",
		noneNotice: "theme.promotions.lift.noneNotice",
		noControl: "theme.promotions.lift.noControl",
		flag: {
			no_test_store: "theme.promotions.lift.flag.no_test_store",
			few_promo_days: "theme.promotions.lift.flag.few_promo_days",
			few_control_days: "theme.promotions.lift.flag.few_control_days",
			few_reference_days: "theme.promotions.lift.flag.few_reference_days",
			unmeasured_days: "theme.promotions.lift.flag.unmeasured_days",
			no_control_store: "theme.promotions.lift.flag.no_control_store",
			control_differs_in_size:
				"theme.promotions.lift.flag.control_differs_in_size",
			excluded_days_in_window:
				"theme.promotions.lift.flag.excluded_days_in_window",
			other_promotions: "theme.promotions.lift.flag.other_promotions",
		},
		flagNoStore: {
			few_control_days: "theme.promotions.lift.flagNoStore.few_control_days",
		},
		flagDaily: {
			no_control_store: "theme.promotions.lift.flagDaily.no_control_store",
		},
		yes: "theme.promotions.lift.yes",
		no: "theme.promotions.lift.no",
		table: "theme.promotions.lift.table",
		chart: "theme.promotions.lift.chart",
	},
	table: {
		firstUsed: "theme.promotions.table.firstUsed",
		lastUsed: "theme.promotions.table.lastUsed",
		voucher: "theme.promotions.table.voucher",
		invoiceShare: "theme.promotions.table.invoiceShare",
		promotionDay: "theme.promotions.table.promotionDay",
		controlDay: "theme.promotions.table.controlDay",
		gross: "theme.promotions.table.gross",
		reference: "theme.promotions.table.reference",
		counterfactual: "theme.promotions.table.counterfactual",
		lift: "theme.promotions.table.lift",
	},
} as const;

export type LiftFlag = keyof typeof promotionsKeys.lift.flag;

export const LIFT_FLAGS = Object.keys(
	promotionsKeys.lift.flag,
) as readonly LiftFlag[];

export function isLiftFlag(value: string): value is LiftFlag {
	return Object.hasOwn(promotionsKeys.lift.flag, value);
}
