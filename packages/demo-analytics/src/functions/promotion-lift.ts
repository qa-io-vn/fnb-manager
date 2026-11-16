import { addDays, type IsoDate, type ThemeRow } from "@fnb/reports";
import { isExcludedDemoDay } from "../excluded.js";
import {
	float8ToNumeric,
	money,
	numericToFloat8,
	PgDecimal,
	percentileContMedian,
} from "../pg-numeric.js";
import { discountRows } from "./discount-rows.js";
import { dailySales } from "./support.js";
import {
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const PROMOTION_LIFT_MAX_DAYS = 92;
export const PROMOTION_LIFT_LOOKBACK_DAYS = 56;

const BASELINE_WEEKS = 8;
const MIN_BASELINE_DATES = 3;
const MIN_WEEKDAY_DATES = 2;
const MIN_CONTROL_DAYS = 7;
const MIN_PROMO_DAYS = 3;
const DEFAULT_PRE_WEEKS = 4;
const SMALLEST_SIZE_RATIO = PgDecimal.parse("0.5");
const LARGEST_SIZE_RATIO = PgDecimal.parse("2");

type Row = ThemeRow<"promotion_lift">;

interface TestDay {
	grossMinor: number;
	netMinor: number;
	invoices: number;
}

interface WindowDay {
	readonly date: IsoDate;
	readonly excluded: boolean;
	readonly promo: boolean;
	readonly discountMinor: number | null;
	readonly test: TestDay | undefined;
	readonly controlGrossMinor: number | undefined;
	readonly reference: PgDecimal | null;
	readonly referenceDates: number;
	readonly weekday: Weekday | undefined;
	control: boolean;
	counterfactual: PgDecimal | null;
	lift: PgDecimal | null;
}

interface Weekday {
	readonly dates: number;
	readonly test: PgDecimal;
	readonly control: PgDecimal | null;
}

function isoWeekday(date: IsoDate): number {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
	const dates: IsoDate[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
	return dates;
}

function decimalValue(value: PgDecimal | null): number | null {
	return value === null ? null : value.toNumber();
}

function medianReference(grossMinor: readonly number[]): PgDecimal | null {
	const median = percentileContMedian(
		grossMinor.map((minor) => numericToFloat8(money(minor))),
	);
	return median === null ? null : float8ToNumeric(median).round(2);
}

function emptySummary(): Omit<Row, "flags"> {
	return {
		business_date: null,
		promo_day: null,
		control_day: null,
		test_gross_amount: null,
		test_net_amount: null,
		test_invoices: null,
		discount_amount: null,
		reference_gross_amount: null,
		reference_days: null,
		counterfactual_gross_amount: null,
		gross_lift_amount: null,
		test_store_count: null,
		control_store_count: null,
		promo_days: null,
		measured_days: null,
		control_days: null,
		trend_adjustment_amount: null,
		net_lift_amount: null,
		lift_rate: null,
	};
}

export const promotionLift: ThemeHandler<"promotion_lift"> = (
	store,
	args,
	context,
) => {
	requireThemeStoreIds("promotion_lift", args.store_ids);
	requireThemeDateRange(
		"promotion_lift",
		args.from_date,
		args.to_date,
		PROMOTION_LIFT_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const comparator = args.comparator;
	const sister = comparator === "sister_store";
	const visible = store.visibleStores(args.store_ids);
	const visibleIds = visible.map((definition) => definition.id);
	const weeks =
		args.pre_weeks ??
		(visible.length > 0
			? context.reportSettings.promoPreWeeks
			: DEFAULT_PRE_WEEKS);
	const lookbackFrom = addDays(args.from_date, -PROMOTION_LIFT_LOOKBACK_DAYS);
	const usedFrom = addDays(args.from_date, -7 * weeks);
	const isPromotion = (kind: string, key: string) =>
		kind === args.promotion_kind && key === args.promotion_key;

	const testIds = new Set<string>();
	const usedIds = new Set<string>();
	let firstPromo: IsoDate | null = null;
	for (const row of discountRows(
		store,
		visibleIds,
		lookbackFrom,
		args.to_date,
	)) {
		if (!isPromotion(row.kind, row.key)) continue;
		if (
			row.businessDate >= args.from_date &&
			row.businessDate <= args.to_date
		) {
			testIds.add(row.storeId);
			if (firstPromo === null || row.businessDate < firstPromo) {
				firstPromo = row.businessDate;
			}
		}
		if (row.businessDate >= usedFrom) usedIds.add(row.storeId);
	}
	const controlIds = visibleIds.filter((id) => !usedIds.has(id));
	const testList = visibleIds.filter((id) => testIds.has(id));

	const testDiscounts = discountRows(
		store,
		testList,
		lookbackFrom,
		args.to_date,
	);
	const usage = new Map<IsoDate, number>();
	for (const row of testDiscounts) {
		if (!isPromotion(row.kind, row.key)) continue;
		usage.set(
			row.businessDate,
			(usage.get(row.businessDate) ?? 0) + row.discountMinor,
		);
	}

	const testSeries = new Map<IsoDate, TestDay>();
	const controlSeries = new Map<IsoDate, number>();
	const controlSet = new Set(controlIds);
	for (const sale of dailySales(
		store,
		visibleIds,
		lookbackFrom,
		args.to_date,
	)) {
		if (testIds.has(sale.store.id)) {
			const known = testSeries.get(sale.date) ?? {
				grossMinor: 0,
				netMinor: 0,
				invoices: 0,
			};
			known.grossMinor += sale.daily.grossMinor;
			known.netMinor += sale.daily.netMinor;
			known.invoices += sale.daily.invoices;
			testSeries.set(sale.date, known);
		}
		if (controlSet.has(sale.store.id)) {
			controlSeries.set(
				sale.date,
				(controlSeries.get(sale.date) ?? 0) + sale.daily.grossMinor,
			);
		}
	}

	const excluded = new Map<IsoDate, boolean>();
	for (const date of datesBetween(lookbackFrom, args.to_date)) {
		excluded.set(
			date,
			testList.length > 0 && isExcludedDemoDay(context.holidays, date),
		);
	}
	const usable = (date: IsoDate) =>
		excluded.get(date) === false && !usage.has(date);

	const prePeriod: {
		date: IsoDate;
		test: number;
		control: number | undefined;
	}[] = [];
	if (firstPromo !== null) {
		for (const date of datesBetween(
			addDays(firstPromo, -7 * weeks),
			addDays(firstPromo, -1),
		)) {
			const test = testSeries.get(date);
			if (test === undefined || !usable(date)) continue;
			const control = controlSeries.get(date);
			if (sister && control === undefined) continue;
			prePeriod.push({ date, test: test.grossMinor, control });
		}
	}
	const weekdays = new Map<number, Weekday>();
	const byWeekday = new Map<number, typeof prePeriod>();
	for (const day of prePeriod) {
		const weekday = isoWeekday(day.date);
		byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), day]);
	}
	for (const [weekday, days] of byWeekday) {
		const controls = days
			.map((day) => day.control)
			.filter((value): value is number => value !== undefined);
		weekdays.set(weekday, {
			dates: days.length,
			test: PgDecimal.avg(days.map((day) => money(day.test))) as PgDecimal,
			control: PgDecimal.avg(controls.map((value) => money(value))),
		});
	}

	const windowDays: WindowDay[] = datesBetween(
		args.from_date,
		args.to_date,
	).map((date) => {
		const weekday = weekdays.get(isoWeekday(date));
		let reference: PgDecimal | null;
		let referenceDates: number;
		if (comparator === "baseline") {
			const baseline: number[] = [];
			for (let week = 1; week <= BASELINE_WEEKS; week += 1) {
				const earlier = addDays(date, -7 * week);
				const test = testSeries.get(earlier);
				if (test !== undefined && usable(earlier)) {
					baseline.push(test.grossMinor);
				}
			}
			referenceDates = baseline.length;
			reference =
				baseline.length >= MIN_BASELINE_DATES
					? medianReference(baseline)
					: null;
		} else {
			referenceDates = weekday?.dates ?? 0;
			reference =
				weekday !== undefined && weekday.dates >= MIN_WEEKDAY_DATES
					? weekday.test.round(2)
					: null;
		}
		return {
			date,
			excluded: excluded.get(date) ?? false,
			promo: usage.has(date),
			discountMinor: usage.get(date) ?? null,
			test: testSeries.get(date),
			controlGrossMinor: controlSeries.get(date),
			reference,
			referenceDates,
			weekday,
			control: false,
			counterfactual: null,
			lift: null,
		};
	});

	for (const day of windowDays) {
		day.control =
			!sister &&
			!day.promo &&
			!day.excluded &&
			day.test !== undefined &&
			day.reference !== null &&
			(comparator !== "prior_weeks" ||
				(firstPromo !== null && day.date >= firstPromo));
	}
	const controls = windowDays.filter((day) => day.control);
	const adjustment = PgDecimal.avg(
		controls.map((day) =>
			money((day.test as TestDay).grossMinor).sub(day.reference as PgDecimal),
		),
	);

	for (const day of windowDays) {
		if (!day.promo) continue;
		if (sister) {
			if (
				day.weekday !== undefined &&
				day.weekday.dates >= MIN_WEEKDAY_DATES &&
				day.controlGrossMinor !== undefined &&
				day.weekday.control !== null
			) {
				day.counterfactual = day.weekday.test
					.add(money(day.controlGrossMinor).sub(day.weekday.control))
					.round(2);
			}
		} else if (
			controls.length >= MIN_CONTROL_DAYS &&
			day.reference !== null &&
			adjustment !== null
		) {
			day.counterfactual = day.reference.add(adjustment).round(2);
		}
		if (day.counterfactual !== null && day.test !== undefined) {
			day.lift = money(day.test.grossMinor).sub(day.counterfactual);
		}
	}

	const promoDays = windowDays.filter((day) => day.promo);
	const measured = promoDays.filter((day) => day.counterfactual !== null);
	const liftSum = PgDecimal.sum(
		measured.flatMap((day) => (day.lift === null ? [] : [day.lift])),
	);
	const discountSum = PgDecimal.sum(
		measured.map((day) => money(day.discountMinor ?? 0)),
	);
	const counterfactualSum = PgDecimal.sum(
		measured.map((day) => day.counterfactual as PgDecimal),
	);
	const testAverage = PgDecimal.avg(prePeriod.map((day) => money(day.test)));
	const controlAverage = PgDecimal.avg(
		prePeriod.flatMap((day) =>
			day.control === undefined ? [] : [money(day.control)],
		),
	);
	const sizeRatio =
		testAverage !== null && testAverage.sign() > 0 && controlAverage !== null
			? controlAverage.div(testAverage)
			: null;
	const promoDates = new Set(promoDays.map((day) => day.date));
	const otherPromotions = testDiscounts.some(
		(row) =>
			row.businessDate >= args.from_date &&
			row.businessDate <= args.to_date &&
			promoDates.has(row.businessDate) &&
			!isPromotion(row.kind, row.key),
	);

	const flags = [
		testList.length === 0 ? "no_test_store" : null,
		promoDays.length < MIN_PROMO_DAYS ? "few_promo_days" : null,
		!sister && controls.length < MIN_CONTROL_DAYS ? "few_control_days" : null,
		promoDays.some((day) => day.reference === null)
			? "few_reference_days"
			: null,
		measured.length < promoDays.length ? "unmeasured_days" : null,
		sister && controlIds.length === 0 ? "no_control_store" : null,
		sister &&
		sizeRatio !== null &&
		(sizeRatio.compare(SMALLEST_SIZE_RATIO) < 0 ||
			sizeRatio.compare(LARGEST_SIZE_RATIO) > 0)
			? "control_differs_in_size"
			: null,
		promoDays.some((day) => day.excluded) ? "excluded_days_in_window" : null,
		otherPromotions ? "other_promotions" : null,
	].filter((flag): flag is string => flag !== null);

	const rows: Row[] = windowDays.map((day) => ({
		...emptySummary(),
		business_date: day.date,
		promo_day: day.promo,
		control_day: day.control,
		test_gross_amount:
			day.test === undefined ? null : money(day.test.grossMinor).toNumber(),
		test_net_amount:
			day.test === undefined ? null : money(day.test.netMinor).toNumber(),
		test_invoices: day.test === undefined ? null : day.test.invoices,
		discount_amount:
			day.discountMinor === null ? null : money(day.discountMinor).toNumber(),
		reference_gross_amount: decimalValue(day.reference),
		reference_days: day.referenceDates,
		counterfactual_gross_amount: decimalValue(day.counterfactual),
		gross_lift_amount: decimalValue(day.lift),
		flags: null,
	}));
	rows.push({
		...emptySummary(),
		discount_amount: decimalValue(discountSum),
		gross_lift_amount: decimalValue(liftSum),
		test_store_count: testList.length,
		control_store_count: controlIds.length,
		promo_days: promoDays.length,
		measured_days: measured.length,
		control_days: sister ? null : controls.length,
		trend_adjustment_amount:
			!sister && measured.length > 0 && adjustment !== null
				? adjustment.round(2).toNumber()
				: null,
		net_lift_amount:
			liftSum === null || discountSum === null
				? null
				: liftSum.sub(discountSum).toNumber(),
		lift_rate:
			liftSum !== null &&
			counterfactualSum !== null &&
			!counterfactualSum.isZero()
				? liftSum.div(counterfactualSum).round(6).toNumber()
				: null,
		flags,
	});
	return rows;
};
