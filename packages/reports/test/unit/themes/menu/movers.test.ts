import { describe, expect, it } from "vitest";
import { buildMoversCard } from "../../../../src/themes/menu/cards/movers.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCalls } from "../../../../src/themes/menu/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, itemRow } from "./support.js";

const covered = [coverageRow(STORE_A), coverageRow(STORE_B)];

describe("the Thực đơn movers card", () => {
	it("ranks risers, fallers and new items with Tuần's ten-quantity threshold", () => {
		const card = buildMoversCard(
			cardInput(
				themeContext("28d", [STORE_A]),
				{
					[menuCalls.items]: [
						itemRow({
							item_external_id: "D1",
							item_name: "Trà đào",
							quantity: 150,
							compare_quantity: 100,
						}),
						itemRow({
							item_external_id: "D2",
							item_name: "Trà vải",
							quantity: 60,
							compare_quantity: 100,
						}),
						itemRow({
							item_external_id: "D3",
							item_name: "Trà ổi",
							quantity: 12,
							compare_quantity: 0,
							net_amount: 480_000,
						}),
						itemRow({
							item_external_id: "D4",
							item_name: "Trà mận",
							quantity: 5,
							compare_quantity: 8,
						}),
						itemRow({
							item_external_id: "D5",
							item_name: "Trà sen",
							quantity: 20,
							compare_quantity: 10,
						}),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline.value).toBe(100);
		expect(card.headline.unit).toBe("percentChange");
		expect(card.headline.caption?.key).toBe(menuKeys.movers.caption);
		expect(card.narrative.map((part) => part.key)).toEqual([
			menuKeys.movers.main,
			menuKeys.movers.newItem,
		]);
		expect(card.narrative[0]?.values.fallerChange).toEqual({
			kind: "percentChange",
			value: -40,
		});
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"up|D5",
			"up|D1",
			"down|D2",
			"new|D3",
		]);
		expect(card.notice).toBeNull();
	});

	it("compares the covered stores only while a store lacks the previous range", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildMoversCard(
			cardInput(
				context,
				{
					[menuCalls.items]: [
						itemRow({
							item_external_id: "D9",
							quantity: 400,
							compare_quantity: 10,
						}),
					],
					[menuCalls.itemsCovered]: [
						itemRow({
							item_external_id: "D1",
							quantity: 30,
							compare_quantity: 20,
						}),
					],
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: context.range.from }),
				],
			),
		);
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual(["up|D1"]);
		expect(card.headline.caption?.key).toBe(menuKeys.movers.captionLikeForLike);
		expect(card.headline.caption?.values.covered).toEqual({
			kind: "count",
			value: 1,
		});
	});

	it("says the previous range is missing instead of ranking anything", () => {
		const card = buildMoversCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.items]: [itemRow({ quantity: 50, compare_quantity: 0 })],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(menuKeys.movers.noPrevious);
		expect(card.narrative.map((part) => part.key)).toEqual([
			menuKeys.movers.noPreviousSentence,
		]);
		expect(card.tables[0]?.rows).toEqual([]);
	});

	it("says no item qualified when nothing sold ten in both ranges", () => {
		const card = buildMoversCard(
			cardInput(
				themeContext("28d", [STORE_A, STORE_B]),
				{ [menuCalls.items]: [itemRow({ quantity: 4, compare_quantity: 3 })] },
				covered,
			),
		);
		expect(card.narrative[0]?.key).toBe(menuKeys.movers.none);
		expect(card.notice?.part.key).toBe(menuKeys.movers.noRiser);
	});
});
