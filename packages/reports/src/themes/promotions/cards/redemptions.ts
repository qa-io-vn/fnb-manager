import type {
	CardModel,
	ChartModel,
	Comparison,
	TableModel,
} from "../../../model/card.js";
import { comparison } from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import type { ThemeContext } from "../../context.js";
import type { ThemeRow } from "../../contract.js";
import {
	referenceLabel,
	type ThemeCallResults,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { themeKeys } from "../../keys.js";
import { spanValue, themeMarkers } from "../../support.js";
import { promotionsKeys } from "../keys.js";
import {
	promotionsCalls,
	promotionsCsvName,
	promotionsNeeds,
	redemptionWindows,
} from "../support.js";

export const REDEMPTIONS_ID = "redemptions";
export const REWARD_COST_METRIC = "reward_cost";
export const REDEMPTION_CHART_REWARDS = 8;
export const REDEMPTION_PREVIEW_ROWS = 10;

export type RedemptionRow = ThemeRow<"redemption_summary">;

export interface RewardTotal {
	readonly couponId: string;
	readonly rewardKey: string;
	readonly name: string;
	readonly kind: RedemptionRow["reward_kind"];
	readonly redemptions: number;
	readonly held: number;
	readonly confirmed: number;
	readonly released: number;
	readonly cost: number;
}

export interface RedemptionTotals {
	readonly redemptions: number;
	readonly held: number;
	readonly confirmed: number;
	readonly released: number;
	readonly stamps: number;
	readonly points: number;
	readonly cost: number;
	readonly memberInvoices: number;
	readonly confirmedShare: number | null;
}

export function redemptionRows(
	results: ThemeCallResults,
	key: string = promotionsCalls.redemptions,
): readonly RedemptionRow[] {
	return results.rows(key, "redemption_summary") ?? [];
}

export function redemptionTotals(
	rows: readonly RedemptionRow[],
): RedemptionTotals {
	const memberInvoices = new Map<string, number>();
	let redemptions = 0;
	let held = 0;
	let confirmed = 0;
	let released = 0;
	let stamps = 0;
	let points = 0;
	let cost = 0;
	for (const row of rows) {
		redemptions += row.redemptions;
		held += row.held;
		confirmed += row.confirmed;
		released += row.released;
		stamps += row.stamps_redeemed;
		points += row.points_redeemed;
		cost += row.reward_cost_amount;
		memberInvoices.set(row.store_id ?? "", row.member_invoices);
	}
	const invoices = [...memberInvoices.values()].reduce(
		(sum, value) => sum + value,
		0,
	);
	return {
		redemptions,
		held,
		confirmed,
		released,
		stamps,
		points,
		cost,
		memberInvoices: invoices,
		confirmedShare: invoices > 0 ? ratio(confirmed, invoices, 4) : null,
	};
}

function codePointOrder(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

export function rewardTotals(rows: readonly RedemptionRow[]): RewardTotal[] {
	const byCoupon = new Map<string, RewardTotal>();
	for (const row of rows) {
		const known = byCoupon.get(row.coupon_id);
		byCoupon.set(row.coupon_id, {
			couponId: row.coupon_id,
			rewardKey: row.reward_key,
			name: row.coupon_name,
			kind: row.reward_kind,
			redemptions: (known?.redemptions ?? 0) + row.redemptions,
			held: (known?.held ?? 0) + row.held,
			confirmed: (known?.confirmed ?? 0) + row.confirmed,
			released: (known?.released ?? 0) + row.released,
			cost: (known?.cost ?? 0) + row.reward_cost_amount,
		});
	}
	return [...byCoupon.values()].sort(
		(left, right) =>
			right.redemptions - left.redemptions ||
			right.confirmed - left.confirmed ||
			codePointOrder(left.rewardKey, right.rewardKey) ||
			codePointOrder(left.couponId, right.couponId),
	);
}

export function mostRedeemed(
	rows: readonly RedemptionRow[],
): RewardTotal | null {
	return rewardTotals(rows).find((reward) => reward.redemptions > 0) ?? null;
}

function storeName(context: ThemeContext, storeId: string | null): string {
	return (
		context.stores.find((store) => store.id === storeId)?.name ?? storeId ?? ""
	);
}

function costComparison(
	context: ThemeContext,
	current: number,
	previousRows: readonly RedemptionRow[],
): Comparison {
	const windows = redemptionWindows(context);
	return comparison({
		kind: "previous",
		label: windows.clipped
			? part(themeKeys.compare.previousDays, {
					days: numberValue("count", windows.current.days),
				})
			: referenceLabel(context.range, "previous"),
		range: windows.previous,
		current,
		reference: redemptionTotals(previousRows).cost,
		coveredStores: context.stores.length,
		totalStores: context.stores.length,
		unit: "money",
	});
}

function redemptionsTable(
	context: ThemeContext,
	rows: readonly RedemptionRow[],
): TableModel {
	const multiStore = context.stores.length > 1;
	return tableModel({
		captionKey: promotionsKeys.redemptions.table,
		columns: [
			column("reward", promotionsKeys.redemptions.reward, "text"),
			...(multiStore ? [column("store", reportKeys.table.store, "text")] : []),
			column("kind", promotionsKeys.redemptions.kind, "message"),
			column("redemptions", promotionsKeys.redemptions.redemptions, "count"),
			column("confirmed", promotionsKeys.redemptions.confirmed, "count"),
			column("held", promotionsKeys.redemptions.held, "count"),
			column("released", promotionsKeys.redemptions.released, "count"),
			column("stamps", promotionsKeys.redemptions.stamps, "count"),
			column("points", promotionsKeys.redemptions.points, "count"),
			column("cost", promotionsKeys.redemptions.cost, "money"),
			column(
				"memberInvoices",
				promotionsKeys.redemptions.memberInvoices,
				"count",
			),
			column(
				"confirmedShare",
				promotionsKeys.redemptions.confirmedShare,
				"percent",
			),
		],
		rows: rows.map((row) => ({
			id: `${row.store_id ?? ""}|${row.coupon_id}`,
			cells: {
				reward: row.coupon_name,
				store: storeName(context, row.store_id),
				kind: promotionsKeys.redemptions.rewardKind[row.reward_kind],
				redemptions: row.redemptions,
				confirmed: row.confirmed,
				held: row.held,
				released: row.released,
				stamps: row.stamps_redeemed,
				points: row.points_redeemed,
				cost: row.reward_cost_amount,
				memberInvoices: row.member_invoices,
				confirmedShare: row.confirmed_share,
			},
		})),
		initialSort: { key: "redemptions", direction: "descending" },
		previewRows: REDEMPTION_PREVIEW_ROWS,
	});
}

function redemptionsChart(rewards: readonly RewardTotal[]): ChartModel | null {
	const shown = rewards
		.filter((reward) => reward.redemptions > 0)
		.slice(0, REDEMPTION_CHART_REWARDS);
	if (shown.length === 0) return null;
	const series = (
		key: string,
		tone: "positive" | "secondary" | "muted",
		pick: (reward: RewardTotal) => number,
	) => ({
		label: part(key),
		kind: "bar" as const,
		tone,
		axis: "left" as const,
		stack: "state",
		values: shown.map(pick),
	});
	return {
		labelKey: promotionsKeys.redemptions.chart,
		categories: shown.map((reward) => textValue("text", reward.name)),
		series: [
			series(
				promotionsKeys.redemptions.confirmed,
				"positive",
				(reward) => reward.confirmed,
			),
			series(
				promotionsKeys.redemptions.held,
				"secondary",
				(reward) => reward.held,
			),
			series(
				promotionsKeys.redemptions.released,
				"muted",
				(reward) => reward.released,
			),
		],
		leftUnit: "count",
		rightUnit: null,
		markLines: [],
		markAreas: [],
		zeroBased: true,
	};
}

function narrative(
	context: ThemeContext,
	rows: readonly RedemptionRow[],
	totals: RedemptionTotals,
): SentencePart[] {
	const windows = redemptionWindows(context);
	const range = spanValue(windows.current);
	if (totals.redemptions === 0) {
		return [part(promotionsKeys.redemptions.none, { range })];
	}
	const parts: SentencePart[] = [
		part(promotionsKeys.redemptions.main, {
			range,
			redemptions: numberValue("count", totals.redemptions),
			confirmed: numberValue("count", totals.confirmed),
			cost: numberValue("money", totals.cost),
		}),
	];
	const top = mostRedeemed(rows);
	if (top !== null) {
		parts.push(
			part(promotionsKeys.redemptions.top, {
				reward: textValue("text", top.name),
				redemptions: numberValue("count", top.redemptions),
				kind: messageValue(promotionsKeys.redemptions.rewardKind[top.kind]),
			}),
		);
	}
	parts.push(
		totals.confirmedShare === null
			? part(promotionsKeys.redemptions.noMembers)
			: part(promotionsKeys.redemptions.share, {
					share: numberValue("percent", totals.confirmedShare),
					confirmed: numberValue("count", totals.confirmed),
					invoices: numberValue("count", totals.memberInvoices),
				}),
	);
	return parts;
}

export function buildRedemptionsCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const windows = redemptionWindows(context);
	const base = {
		id: REDEMPTIONS_ID,
		titleKey: promotionsKeys.redemptions.title,
		subtitle: windows.clipped
			? part(themeKeys.subtitle.lastDays, {
					days: numberValue("count", windows.current.days),
				})
			: null,
		metricId: REWARD_COST_METRIC,
		relatedMetricIds: [],
		decomposition: null,
		notice: null,
		csvName: promotionsCsvName(context, REDEMPTIONS_ID),
	} as const;
	if (context.sample) {
		return {
			...base,
			subtitle: null,
			headline: { value: null, unit: "money", caption: null },
			comparisons: [],
			narrative: [part(promotionsKeys.redemptions.demo)],
			tables: [],
			chart: null,
			markers: themeMarkers(input, false),
		};
	}
	const rows = redemptionRows(input.results);
	const totals = redemptionTotals(rows);
	const previous = redemptionRows(
		input.results,
		promotionsCalls.redemptionsPrevious,
	);
	return {
		...base,
		headline: { value: totals.cost, unit: "money", caption: null },
		comparisons: [costComparison(context, totals.cost, previous)],
		narrative: narrative(context, rows, totals),
		tables: rows.length === 0 ? [] : [redemptionsTable(context, rows)],
		chart: redemptionsChart(rewardTotals(rows)),
		markers: themeMarkers(input, false),
	};
}

export const redemptionsCard: ThemeCardDefinition = {
	id: REDEMPTIONS_ID,
	needs: promotionsNeeds.redemptions,
	visible: () => true,
	build: buildRedemptionsCard,
	wide: true,
};
