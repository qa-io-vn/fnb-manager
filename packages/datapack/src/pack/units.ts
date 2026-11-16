export const PACK_UNITS = [
	"text",
	"date",
	"flag",
	"money",
	"money_thousands",
	"count",
	"quantity",
	"fraction",
	"rel_change",
	"pp_change",
	"metric",
	"metric_change",
	"days",
	"hours",
	"ratio",
	"class",
] as const;

export type PackUnit = (typeof PACK_UNITS)[number];

export const PACK_GRAINS = [
	"store",
	"store-period",
	"metric-window",
	"store-week",
	"store-month",
	"store-weekday",
	"weekday-hour",
	"item-period",
	"category-period",
	"size-period",
	"pair-period",
	"modifier-period",
	"method-period",
	"promotion-period",
	"store-band",
	"date",
	"gap",
	"metric",
	"plan-kpi",
] as const;

export type PackGrain = (typeof PACK_GRAINS)[number];
