import type { AnalyticsRow } from "../../contract/functions.js";
import { type PromotionKind, promotionKinds } from "../../contract/values.js";
import { promotionKindKey } from "../../model/keys.js";
import { UNNAMED_PROMOTION_KEY } from "../../reports/week/cards/promotions.js";
import type { ThemeParamOption, ThemeParamSpec } from "../context.js";
import type { ThemeRow } from "../contract.js";
import {
	PROMOTION_COMPARATORS,
	type PromotionComparator,
} from "../contract.js";
import type { ThemeCallResults } from "../definition.js";
import { promotionsKeys } from "./keys.js";

export const PROMOTION_PARAM = "promo";
export const COMPARATOR_PARAM = "cmp";
export const LIFT_CARD_ID = "lift";
export const LIFT_CALL_KEY = "lift";
export const PROMOTIONS_W92_CALL_KEY = "promotionsW92";
export const DEFAULT_COMPARATOR: PromotionComparator = "baseline";
export const PROMOTION_PARAM_SEPARATOR = ":";

export interface PromotionChoice {
	readonly kind: PromotionKind;
	readonly key: string;
}

function isPromotionKind(value: string): value is PromotionKind {
	return (promotionKinds as readonly string[]).includes(value);
}

export function promotionParamValue(choice: PromotionChoice): string {
	return `${choice.kind}${PROMOTION_PARAM_SEPARATOR}${choice.key}`;
}

export function parsePromotionParam(value: string): PromotionChoice | null {
	const separator = value.indexOf(PROMOTION_PARAM_SEPARATOR);
	if (separator <= 0) return null;
	const kind = value.slice(0, separator);
	const key = value.slice(separator + PROMOTION_PARAM_SEPARATOR.length);
	return isPromotionKind(kind) && key !== "" ? { kind, key } : null;
}

function codePointOrder(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function promotionOption(
	row: AnalyticsRow<"promotion_summary">,
): ThemeParamOption {
	const value = promotionParamValue({
		kind: row.promotion_kind,
		key: row.promotion_key,
	});
	const kind = { key: promotionKindKey(row.promotion_kind) };
	const name =
		row.promotion_name ??
		(row.promotion_key === UNNAMED_PROMOTION_KEY ? null : row.promotion_key);
	return name === null
		? {
				value,
				labelKey: promotionsKeys.lift.optionUnnamed,
				labelValues: { kind },
			}
		: {
				value,
				labelKey: promotionsKeys.lift.option,
				labelValues: { name: { text: name }, kind },
			};
}

export function promotionOptions(
	results: ThemeCallResults,
): readonly ThemeParamOption[] | null {
	const rows = results.rows(PROMOTIONS_W92_CALL_KEY, "promotion_summary");
	if (rows === undefined) return null;
	return [...rows]
		.sort(
			(left, right) =>
				right.discount_amount - left.discount_amount ||
				codePointOrder(left.promotion_kind, right.promotion_kind) ||
				codePointOrder(left.promotion_key, right.promotion_key),
		)
		.map(promotionOption);
}

export function chosenPromotion(
	value: string,
	options: readonly ThemeParamOption[],
): PromotionChoice | null {
	const offered = options.some(
		(option) => option.value === value && option.disabled !== true,
	)
		? value
		: options.find((option) => option.disabled !== true)?.value;
	return offered === undefined ? null : parsePromotionParam(offered);
}

export type LiftRow = ThemeRow<"promotion_lift">;

export function liftSummary(
	rows: readonly LiftRow[] | undefined,
): LiftRow | null {
	return rows?.find((row) => row.business_date === null) ?? null;
}

export function lacksControlStore(results: ThemeCallResults): boolean {
	const summary = liftSummary(results.rows(LIFT_CALL_KEY, "promotion_lift"));
	return summary !== null && summary.control_store_count === 0;
}

const comparatorChoices: readonly ThemeParamOption[] =
	PROMOTION_COMPARATORS.map((comparator) => ({
		value: comparator,
		labelKey: promotionsKeys.lift.comparator[comparator],
	}));

export function comparatorOptions(
	results: ThemeCallResults,
): readonly ThemeParamOption[] | null {
	if (results.rows(LIFT_CALL_KEY, "promotion_lift") === undefined) return null;
	if (!lacksControlStore(results)) return comparatorChoices;
	return comparatorChoices.map((option) =>
		option.value === "sister_store"
			? { ...option, disabled: true, reasonKey: promotionsKeys.lift.noControl }
			: option,
	);
}

export const promotionParams: readonly ThemeParamSpec[] = [
	{
		id: PROMOTION_PARAM,
		labelKey: promotionsKeys.lift.promotion,
		cardId: LIFT_CARD_ID,
		control: "select",
		defaultValue: "",
		options: [],
		accepts: (value) => parsePromotionParam(value) !== null,
		optionsFrom: promotionOptions,
	},
	{
		id: COMPARATOR_PARAM,
		labelKey: promotionsKeys.lift.comparatorLabel,
		cardId: LIFT_CARD_ID,
		control: "radio",
		defaultValue: DEFAULT_COMPARATOR,
		options: comparatorChoices,
		optionsFrom: comparatorOptions,
	},
];
