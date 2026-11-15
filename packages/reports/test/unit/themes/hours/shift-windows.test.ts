import { describe, expect, it } from "vitest";
import { buildShiftWindowsCard } from "../../../../src/themes/hours/cards/shift-windows.js";
import { hoursKeys } from "../../../../src/themes/hours/keys.js";
import { hoursCalls } from "../../../../src/themes/hours/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	dayProfile,
	type HourSpec,
	profileSummary,
} from "./support.js";

const basis = { key: hoursKeys.shiftWindows.basis, values: {} };

function levels(...names: readonly HourSpec["level"][]): HourSpec[] {
	return names.map((level) => ({ level }));
}

describe("the Giờ & ngày shift windows card", () => {
	it("merges each day group's hours into windows, names the longest busy window and gives the smallest and largest means", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildShiftWindowsCard(
			cardInput(
				context,
				{
					[hoursCalls.hours]: [
						...dayProfile(
							"weekdays",
							7,
							[
								{ level: "quiet", net: 200_000, invoices: 4 },
								{ level: "busy", net: 900_000, invoices: 18 },
								{ level: "busy", net: 1_000_000, invoices: 20 },
								{ level: "normal", net: 500_000, invoices: 10 },
								{ level: "normal", net: 550_000, invoices: 11 },
								{ level: "busy", net: 800_000, invoices: 16 },
								{ level: "busy", net: 850_000, invoices: 17 },
								{ level: "busy", net: 750_000, invoices: 15 },
								{ level: "normal", net: 450_000, invoices: 9 },
								{ level: "quiet", net: 150_000, invoices: 3 },
							],
							1,
						),
						...dayProfile(
							"weekend",
							8,
							[
								{ level: "normal", net: 600_000, invoices: 12 },
								{ level: "normal", net: 500_000, invoices: 10 },
								{ level: "normal", net: 550_000, invoices: 11 },
								{ level: "normal", net: 520_000, invoices: 10.5 },
								{ level: "normal", net: 580_000, invoices: 11.5 },
								{ level: "normal", net: 510_000, invoices: 10.2 },
							],
							2,
						),
						...dayProfile("all", 9, levels("peak", "peak", "peak")),
						profileSummary("weekdays"),
						profileSummary("weekend"),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline).toEqual({
			value: 2,
			unit: "count",
			caption: { key: hoursKeys.shiftWindows.window, values: {} },
		});
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.shiftWindows.mainOne,
				values: {
					range: rangeValue(context),
					group: { kind: "message", value: hoursKeys.dayGroup.weekdays },
					window: { kind: "text", value: "12:00–15:00" },
				},
			},
			basis,
		]);
		const table = card.tables[0];
		expect(table?.captionKey).toBe(hoursKeys.shiftWindows.table);
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["dayGroup", "message"],
			["from", "hour"],
			["to", "hour"],
			["level", "message"],
			["minInvoices", "decimal"],
			["maxInvoices", "decimal"],
			["minNet", "money"],
			["maxNet", "money"],
		]);
		expect(
			table?.rows.map((row) => [
				row.id,
				row.cells.from,
				row.cells.to,
				row.cells.level,
			]),
		).toEqual([
			["weekdays-7", 7, 8, hoursKeys.level.quiet],
			["weekdays-8", 8, 10, hoursKeys.level.busy],
			["weekdays-10", 10, 12, hoursKeys.level.normal],
			["weekdays-12", 12, 15, hoursKeys.level.busy],
			["weekdays-15", 15, 16, hoursKeys.level.normal],
			["weekdays-16", 16, 17, hoursKeys.level.quiet],
			["weekend-8", 8, 14, hoursKeys.level.normal],
		]);
		expect(table?.rows[3]?.cells).toEqual({
			dayGroup: hoursKeys.dayGroup.weekdays,
			from: 12,
			to: 15,
			level: hoursKeys.level.busy,
			minInvoices: 15,
			maxInvoices: 17,
			minNet: 750_000,
			maxNet: 850_000,
		});
		expect(table?.rows[6]?.cells).toEqual({
			dayGroup: hoursKeys.dayGroup.weekend,
			from: 8,
			to: 14,
			level: hoursKeys.level.normal,
			minInvoices: 10,
			maxInvoices: 12,
			minNet: 500_000,
			maxNet: 600_000,
		});
		expect(card.notice).toBeNull();
		expect(card.csvName).toBe("gio-ngay-shift_windows-2026-10-10_2026-11-06");
	});

	it("names both groups' busy windows and keeps the earlier of two equally long ones", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildShiftWindowsCard(
			cardInput(context, {
				[hoursCalls.hours]: [
					...dayProfile(
						"weekdays",
						7,
						levels(
							"normal",
							"busy",
							"busy",
							"normal",
							"normal",
							"busy",
							"busy",
							"normal",
						),
					),
					...dayProfile(
						"weekend",
						8,
						levels("normal", "busy", "busy", "busy", "normal"),
					),
				],
			}),
		);
		expect(card.headline.value).toBe(3);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.shiftWindows.main,
				values: {
					range: rangeValue(context),
					weekdays: { kind: "text", value: "08:00–10:00" },
					weekend: { kind: "text", value: "09:00–12:00" },
				},
			},
			basis,
		]);
		const weekendOnly = buildShiftWindowsCard(
			cardInput(context, {
				[hoursCalls.hours]: [
					...dayProfile("weekdays", 7, levels("normal", "normal")),
					...dayProfile("weekend", 8, levels("normal", "busy", "busy")),
				],
			}),
		);
		expect(weekendOnly.narrative[0]).toEqual({
			key: hoursKeys.shiftWindows.mainOne,
			values: {
				range: rangeValue(context),
				group: { kind: "message", value: hoursKeys.dayGroup.weekend },
				window: { kind: "text", value: "09:00–11:00" },
			},
		});
	});

	it("counts zero busy windows on flat days and says no window stands out", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildShiftWindowsCard(
			cardInput(context, {
				[hoursCalls.hours]: [
					...dayProfile("weekdays", 7, levels("normal", "normal", "normal")),
					...dayProfile("weekend", 8, levels("normal", "normal")),
				],
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.shiftWindows.none,
				values: { range: rangeValue(context) },
			},
			basis,
		]);
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"weekdays-7",
			"weekend-8",
		]);
	});

	it("asks for at least 14 days under two weeks and draws nothing without a profile", () => {
		const context = themeContext("7d", [STORE_A]);
		const card = buildShiftWindowsCard(cardInput(context, {}));
		expect(card.notice).toEqual({
			tone: "info",
			part: {
				key: hoursKeys.shiftWindows.short,
				values: { days: { kind: "count", value: 14 } },
			},
			action: null,
		});
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.shiftWindows.none,
				values: { range: rangeValue(context) },
			},
			basis,
		]);
		expect(card.tables).toEqual([]);
	});
});
