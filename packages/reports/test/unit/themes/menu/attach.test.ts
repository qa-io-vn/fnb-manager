import { describe, expect, it } from "vitest";
import { themeKeys } from "../../../../src/themes/keys.js";
import { buildAttachCard } from "../../../../src/themes/menu/cards/attach.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import {
	menuCalls,
	menuPreviousWindow,
	menuWindow,
} from "../../../../src/themes/menu/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { attachRow, cardInput, itemRow } from "./support.js";

const covered = [coverageRow(STORE_A)];

describe("the Thực đơn attach card", () => {
	it("reads the topping and snack rates of the last 92 days against the window before", () => {
		const card = buildAttachCard(
			cardInput(
				themeContext("28d", [STORE_A]),
				{
					[menuCalls.attach]: [
						attachRow({}),
						attachRow({
							item_external_id: "D2",
							item_name: "Trà vải",
							drink_invoices: 10,
							topping_rate: 0.9,
						}),
						attachRow({
							item_external_id: "D1",
							item_name: "Trà đào",
							drink_invoices: 30,
							topping_rate: 0.4,
							snack_rate: 0.05,
						}),
					],
					[menuCalls.attachPrevious]: [
						attachRow({ topping_rate: 0.2, snack_rate: 0.12 }),
					],
				},
				covered,
			),
		);
		expect(card.headline.value).toBe(0.25);
		expect(card.headline.caption?.key).toBe(menuKeys.attach.caption);
		expect(card.comparisons.map((entry) => entry.difference)).toEqual([
			0.05, -0.02,
		]);
		expect(card.comparisons[0]?.label.key).toBe(
			menuKeys.attach.toppingPrevious,
		);
		expect(card.narrative.map((part) => part.key)).toEqual([
			menuKeys.attach.up,
			menuKeys.attach.topDrink,
		]);
		expect(card.narrative[1]?.values.item).toEqual({
			kind: "text",
			value: "Trà đào",
		});
		expect(card.subtitle).toEqual({
			key: themeKeys.subtitle.lastDays,
			values: { days: { kind: "count", value: 28 } },
		});
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual(["D1", "D2"]);
		expect(card.notice).toBeNull();
	});

	it("keeps a measured zero rate instead of a dash", () => {
		const card = buildAttachCard(
			cardInput(
				themeContext("28d", [STORE_A]),
				{
					[menuCalls.attach]: [
						attachRow({ topping_invoices: 0, topping_rate: 0 }),
					],
					[menuCalls.attachPrevious]: [attachRow({})],
				},
				covered,
			),
		);
		expect(card.headline.value).toBe(0);
		expect(card.notice).toBeNull();
	});

	it("shows a dash and the roles action while the topping role is unmapped", () => {
		const noRoles = buildAttachCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.attach]: [
					attachRow({ topping_rate: null, snack_rate: null }),
				],
			}),
		);
		expect(noRoles.headline.value).toBeNull();
		expect(noRoles.comparisons).toEqual([]);
		expect(noRoles.notice?.part.key).toBe(menuKeys.attach.noRoles);
		expect(noRoles.notice?.action).toBe("settings_roles");
		const snackOnly = buildAttachCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.attach]: [attachRow({ topping_rate: null })],
			}),
		);
		expect(snackOnly.notice?.part.key).toBe(menuKeys.attach.noToppingRole);
		expect(snackOnly.comparisons).toHaveLength(1);
	});

	it("asks for the drink role when items sell but none is a drink", () => {
		const card = buildAttachCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.items]: [
					itemRow({ role: "topping" }),
					itemRow({ role: null }),
				],
				[menuCalls.attach]: [
					attachRow({
						drink_invoices: 0,
						topping_rate: null,
						snack_rate: null,
					}),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(menuKeys.attach.noDrinkRole);
		expect(card.notice?.action).toBe("settings_roles");
	});

	it("names the snack role when only snacks are unmapped", () => {
		const card = buildAttachCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.attach]: [attachRow({ snack_rate: null })],
			}),
		);
		expect(card.headline.value).toBe(0.25);
		expect(card.notice?.part.key).toBe(menuKeys.attach.noSnackRole);
		expect(card.comparisons).toHaveLength(1);
	});

	it("names no top drink when every drink on 20 invoices has no topping", () => {
		const card = buildAttachCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.attach]: [
					attachRow({}),
					attachRow({
						item_external_id: "D1",
						drink_invoices: 40,
						topping_rate: 0,
					}),
				],
			}),
		);
		expect(card.narrative.map((part) => part.key)).not.toContain(
			menuKeys.attach.topDrink,
		);
	});

	it("stops the window at 92 days and compares it with the 92 days before", () => {
		const context = themeContext("364d", [STORE_A]);
		const window = menuWindow(context);
		const previous = menuPreviousWindow(context);
		expect(window.days).toBe(92);
		expect(window.to).toBe(context.range.to);
		expect(previous.days).toBe(92);
		expect(previous.to < window.from).toBe(true);
		const card = buildAttachCard(
			cardInput(context, { [menuCalls.attach]: [attachRow({})] }),
		);
		expect(card.subtitle?.values.days).toEqual({ kind: "count", value: 92 });
	});
});
