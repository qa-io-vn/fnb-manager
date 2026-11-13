import type { CardModel, Comparison } from "@fnb/reports";
import type { DigestComparison, DigestModel } from "./model.js";

export function sameNumber(left: number | null, right: number | null): boolean {
	return (
		Object.is(left, right) ||
		(left !== null && right !== null && left === right)
	);
}

function cardById(cards: readonly CardModel[], id: string): CardModel | null {
	return cards.find((card) => card.id === id) ?? null;
}

function sameBasis(
	digest: DigestComparison,
	card: Comparison | undefined,
): boolean {
	if (card === undefined) {
		return digest.basis === undefined || digest.basis === "all_stores";
	}
	return (
		(digest.basis ?? "all_stores") === card.basis &&
		(digest.basis !== "like_for_like" ||
			(digest.coveredStores === card.coveredStores &&
				digest.totalStores === card.totalStores))
	);
}

export interface NgayComparison {
	readonly fields: number;
	readonly equal: boolean;
	readonly differing: readonly string[];
}

export function compareDigestWithNgay(
	model: DigestModel | null,
	ngay: readonly CardModel[],
): NgayComparison {
	if (model === null) {
		return { fields: 0, equal: false, differing: ["model"] };
	}
	const net = cardById(ngay, "net_revenue");
	const comparison = (kind: string) =>
		net?.comparisons.find((entry) => entry.kind === kind);
	const hourly = cardById(ngay, "hourly");
	const hour = hourly?.headline.caption?.values.hour;
	const items = (cardById(ngay, "top_items")?.tables[0]?.rows ?? [])
		.slice(0, 3)
		.map((row) => [row.cells.item, row.cells.quantity]);
	const storeTable = net?.tables[0];
	const storeCells = model.stores.every((store) => {
		if (model.stores.length < 2) {
			return sameNumber(store.net, net?.headline.value ?? null);
		}
		const row = storeTable?.rows.find((entry) => entry.id === store.storeId);
		return (
			row !== undefined &&
			sameNumber(store.net, (row.cells.value as number | null) ?? null) &&
			sameNumber(
				store.vsBaseline.change,
				(row.cells.changeBaseline as number | null) ?? null,
			)
		);
	});
	const checks: [string, boolean][] = [
		["net", sameNumber(model.totals.net, net?.headline.value ?? null)],
		[
			"vs_baseline",
			sameNumber(
				model.totals.vsBaseline.change,
				comparison("baseline")?.change ?? null,
			),
		],
		[
			"baseline_weeks",
			sameNumber(
				model.totals.vsBaseline.sampleDays,
				comparison("baseline")?.sampleDays ?? null,
			),
		],
		[
			"vs_previous",
			sameNumber(
				model.totals.vsPrevious.change,
				comparison("previous")?.change ?? null,
			) && sameBasis(model.totals.vsPrevious, comparison("previous")),
		],
		[
			"invoices",
			sameNumber(
				model.totals.invoices,
				cardById(ngay, "invoices")?.headline.value ?? null,
			),
		],
		[
			"avg_ticket",
			sameNumber(
				model.totals.avgTicket,
				cardById(ngay, "avg_ticket")?.headline.value ?? null,
			),
		],
		[
			"cash_to_count",
			sameNumber(
				model.totals.cashToCount,
				cardById(ngay, "payments")?.headline.value ?? null,
			),
		],
		[
			"peak_hour",
			sameNumber(
				model.totals.peakHour?.hour ?? null,
				typeof hour?.value === "number" ? hour.value : null,
			),
		],
		[
			"peak_net",
			sameNumber(
				model.totals.peakHour?.net ?? null,
				hour === undefined ? null : (hourly?.headline.value ?? null),
			),
		],
		[
			"top_items",
			JSON.stringify(
				model.totals.topItems.map((item) => [item.name, item.quantity]),
			) === JSON.stringify(items),
		],
		["store_lines", storeCells],
	];
	return {
		fields: checks.length,
		equal: checks.every(([, same]) => same),
		differing: checks.filter(([, same]) => !same).map(([name]) => name),
	};
}
