import { describe, expect, it } from "vitest";
import { coverageModel } from "../../../../src/model/coverage.js";
import { addDays } from "../../../../src/period/dates.js";
import {
	menuCalls,
	menuFollowUpCalls,
	menuPrimaryCalls,
	menuWindow,
} from "../../../../src/themes/menu/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";

describe("the Thực đơn calls", () => {
	it("asks for attach rates and pairs over the last 92 days and modifiers against the previous range", () => {
		const context = themeContext("364d", [STORE_A]);
		const end = context.range.to;
		const calls = new Map(
			menuPrimaryCalls(context).map((call) => [call.key, call]),
		);
		expect(calls.get(menuCalls.attach)?.args).toEqual({
			store_ids: [STORE_A],
			from_date: addDays(end, -91),
			to_date: end,
		});
		expect(calls.get(menuCalls.attachPrevious)?.args).toEqual({
			store_ids: [STORE_A],
			from_date: addDays(end, -183),
			to_date: addDays(end, -92),
		});
		expect(calls.get(menuCalls.pairs)?.args).toEqual({
			store_ids: [STORE_A],
			from_date: addDays(end, -91),
			to_date: end,
			min_pair_invoices: 3,
			max_pairs: 50,
		});
		expect(calls.get(menuCalls.modifiers)?.args).toEqual({
			store_ids: [STORE_A],
			from_date: context.range.from,
			to_date: context.range.to,
			compare_from: context.range.previous.from,
			compare_to: context.range.previous.to,
		});
	});

	it("keeps a short range whole and puts the previous window right before it", () => {
		const context = themeContext("7d", [STORE_A]);
		expect(menuWindow(context)).toEqual({
			from: context.range.from,
			to: context.range.to,
			days: 7,
		});
		const calls = new Map(
			menuPrimaryCalls(context).map((call) => [call.key, call]),
		);
		expect(calls.get(menuCalls.attachPrevious)?.args).toEqual({
			store_ids: [STORE_A],
			from_date: addDays(context.range.from, -7),
			to_date: addDays(context.range.from, -1),
		});
	});

	it("adds covered-store calls only while some selected stores lack the earlier ranges", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const full = coverageModel(
			[coverageRow(STORE_A), coverageRow(STORE_B)],
			context,
		);
		expect(menuFollowUpCalls(context, full)).toEqual([]);
		const partial = coverageModel(
			[
				coverageRow(STORE_A),
				coverageRow(STORE_B, { history_start: context.range.to }),
			],
			context,
		);
		const followUps = menuFollowUpCalls(context, partial);
		expect(followUps.map((call) => call.key)).toEqual([
			menuCalls.itemsCovered,
			menuCalls.attachCovered,
			menuCalls.attachPreviousCovered,
		]);
		expect(
			followUps.every((call) => call.args.store_ids?.[0] === STORE_A),
		).toBe(true);
	});
});
