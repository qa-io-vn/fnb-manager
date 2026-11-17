import { roundHalfAwayFromZero } from "@fnb/reports";

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

export const NUMERIC_UNITS = [
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
] as const satisfies readonly PackUnit[];

export type NumericPackUnit = (typeof NUMERIC_UNITS)[number];

export type CellKind = "text" | "date" | "flag" | "number";

export const UNIT_KINDS: Readonly<Record<PackUnit, CellKind>> = {
	text: "text",
	date: "date",
	flag: "flag",
	money: "number",
	money_thousands: "number",
	count: "number",
	quantity: "number",
	fraction: "number",
	rel_change: "number",
	pp_change: "number",
	metric: "number",
	metric_change: "number",
	days: "number",
	hours: "number",
	ratio: "number",
	class: "text",
};

export const UNIT_DIGITS: Readonly<
	Record<NumericPackUnit, number | "currency" | null>
> = {
	money: "currency",
	money_thousands: 1,
	count: 0,
	quantity: 3,
	fraction: 4,
	rel_change: 4,
	pp_change: 4,
	metric: null,
	metric_change: null,
	days: 0,
	hours: 1,
	ratio: 2,
};

export const DEFAULT_MINOR_UNITS = 2;

export const CURRENCY_MINOR_UNITS: Readonly<Record<string, number>> = {
	BHD: 3,
	BIF: 0,
	CLP: 0,
	DJF: 0,
	GNF: 0,
	IQD: 3,
	ISK: 0,
	JOD: 3,
	JPY: 0,
	KMF: 0,
	KRW: 0,
	KWD: 3,
	LYD: 3,
	OMR: 3,
	PYG: 0,
	RWF: 0,
	TND: 3,
	UGX: 0,
	VND: 0,
	VUV: 0,
	XAF: 0,
	XOF: 0,
	XPF: 0,
};

const NUMERIC = new Set<string>(NUMERIC_UNITS);

export function isNumericUnit(unit: PackUnit): unit is NumericPackUnit {
	return NUMERIC.has(unit);
}

export function currencyMinorUnits(currency: string): number {
	return Object.hasOwn(CURRENCY_MINOR_UNITS, currency)
		? (CURRENCY_MINOR_UNITS[currency] ?? DEFAULT_MINOR_UNITS)
		: DEFAULT_MINOR_UNITS;
}

export function unitDigits(
	unit: NumericPackUnit,
	currency: string,
): number | null {
	const digits = UNIT_DIGITS[unit];
	return digits === "currency" ? currencyMinorUnits(currency) : digits;
}

export function roundToUnit(
	value: number,
	unit: NumericPackUnit,
	currency: string,
): number {
	const digits = unitDigits(unit, currency);
	return digits === null ? value : roundHalfAwayFromZero(value, digits);
}
