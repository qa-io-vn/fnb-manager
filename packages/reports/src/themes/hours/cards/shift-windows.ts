import type { CardModel, TableModel } from "../../../model/card.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { hoursKeys } from "../keys.js";
import {
	hourRows,
	hoursCalls,
	hoursCsvName,
	hoursNeeds,
	type LevelWindow,
	levelWindows,
	profileRows,
	SHIFT_WINDOWS_MIN_DAYS,
	windowText,
} from "../support.js";
import { levelKey } from "./peak-dead.js";

type DayGroup = "weekdays" | "weekend";

const DAY_GROUPS: readonly DayGroup[] = ["weekdays", "weekend"];

interface GroupWindow extends LevelWindow {
	readonly group: DayGroup;
}

function windowsOf(input: ThemeCardInput): GroupWindow[] {
	const profile = profileRows(input.results, hoursCalls.hours);
	return DAY_GROUPS.flatMap((group) =>
		levelWindows(hourRows(profile, group)).map((window) => ({
			...window,
			group,
		})),
	);
}

function extreme(
	window: LevelWindow,
	pick: (row: LevelWindow["hours"][number]) => number | null,
	direction: 1 | -1,
): number | null {
	let chosen: number | null = null;
	for (const row of window.hours) {
		const value = pick(row);
		if (value === null) continue;
		if (chosen === null || direction * (value - chosen) > 0) chosen = value;
	}
	return chosen;
}

function windowTable(windows: readonly GroupWindow[]): TableModel {
	return tableModel({
		captionKey: hoursKeys.shiftWindows.table,
		columns: [
			column("dayGroup", hoursKeys.table.dayGroup, "message"),
			column("from", hoursKeys.table.from, "hour"),
			column("to", hoursKeys.table.to, "hour"),
			column("level", hoursKeys.table.level, "message"),
			column("minInvoices", hoursKeys.table.minInvoices, "decimal"),
			column("maxInvoices", hoursKeys.table.maxInvoices, "decimal"),
			column("minNet", hoursKeys.table.minNet, "money"),
			column("maxNet", hoursKeys.table.maxNet, "money"),
		],
		rows: windows.map((window) => ({
			id: `${window.group}-${window.fromHour}`,
			cells: {
				dayGroup: hoursKeys.dayGroup[window.group],
				from: window.fromHour,
				to: window.toHour,
				level: levelKey(window.level),
				minInvoices: extreme(window, (row) => row.avg_invoices, -1),
				maxInvoices: extreme(window, (row) => row.avg_invoices, 1),
				minNet: extreme(window, (row) => row.avg_net_amount, -1),
				maxNet: extreme(window, (row) => row.avg_net_amount, 1),
			},
		})),
	});
}

function longestBusy(
	windows: readonly GroupWindow[],
	group: DayGroup,
): GroupWindow | null {
	let chosen: GroupWindow | null = null;
	for (const window of windows) {
		if (window.group !== group || window.level !== "busy") continue;
		if (chosen === null || window.hours.length > chosen.hours.length)
			chosen = window;
	}
	return chosen;
}

function narrativeOf(
	input: ThemeCardInput,
	windows: readonly GroupWindow[],
): SentencePart[] {
	const range = rangeValue(input.context);
	const weekdays = longestBusy(windows, "weekdays");
	const weekend = longestBusy(windows, "weekend");
	const basis = part(hoursKeys.shiftWindows.basis);
	if (weekdays === null && weekend === null) {
		return [part(hoursKeys.shiftWindows.none, { range }), basis];
	}
	if (weekdays !== null && weekend !== null) {
		return [
			part(hoursKeys.shiftWindows.main, {
				range,
				weekdays: textValue("text", windowText(weekdays)),
				weekend: textValue("text", windowText(weekend)),
			}),
			basis,
		];
	}
	const only = (weekdays ?? weekend) as GroupWindow;
	return [
		part(hoursKeys.shiftWindows.mainOne, {
			range,
			group: messageValue(hoursKeys.dayGroup[only.group]),
			window: textValue("text", windowText(only)),
		}),
		basis,
	];
}

export function buildShiftWindowsCard(input: ThemeCardInput): CardModel {
	const windows = windowsOf(input);
	const busy = windows.filter((window) => window.level === "busy").length;
	const short = input.context.range.days < SHIFT_WINDOWS_MIN_DAYS;
	return {
		id: "shift_windows",
		titleKey: hoursKeys.shiftWindows.title,
		subtitle: null,
		metricId: "busy_window",
		relatedMetricIds: ["invoices_per_opening_hour"],
		headline: {
			value: windows.length === 0 ? null : busy,
			unit: "count",
			caption: part(hoursKeys.shiftWindows.window),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrativeOf(input, windows),
		tables: windows.length === 0 ? [] : [windowTable(windows)],
		chart: null,
		notice: short
			? {
					tone: "info",
					part: part(hoursKeys.shiftWindows.short, {
						days: numberValue("count", SHIFT_WINDOWS_MIN_DAYS),
					}),
					action: null,
				}
			: null,
		markers: themeMarkers(input, false),
		csvName: hoursCsvName(input.context, "shift_windows"),
	};
}

export const hoursShiftWindowsCard: ThemeCardDefinition = {
	id: "shift_windows",
	needs: hoursNeeds.windows,
	visible: () => true,
	build: buildShiftWindowsCard,
};
