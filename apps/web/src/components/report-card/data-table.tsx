import { useId, useMemo, useState } from "react";
import { uiLocaleOf, useLanguage, useT } from "../../i18n";
import { addDays } from "../../lib/business-dates";
import { buildCsv, type CsvCell, downloadTextFile } from "../../lib/csv";
import type { Formatters } from "../../lib/format";
import { Button } from "../ui/button";
import { formatValue, hourText } from "./headline";
import { TableScroller } from "./table-scroller";
import { nextSort, sortRows } from "./table-sorting";
import type {
	TableColumn,
	TableRow,
	TableSort,
	TableSpec,
	TableValue,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^(\d{4})-(\d{2})(?:-\d{2})?$/;
const MONDAY_OF_REFERENCE_WEEK = "2024-01-01";

export function weekdayText(value: TableValue, formatters: Formatters): string {
	if (typeof value === "string" && ISO_DATE.test(value)) {
		return formatters.weekday(value);
	}
	const isoWeekday = Number(value);
	if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7) {
		return String(value);
	}
	return formatters.weekday(addDays(MONDAY_OF_REFERENCE_WEEK, isoWeekday - 1));
}

export function monthText(value: TableValue): string {
	const match = ISO_MONTH.exec(String(value));
	return match ? `${match[2]}/${match[1]}` : String(value);
}

export function displayCell(
	column: TableColumn,
	value: TableValue,
	formatters: Formatters,
	points: (text: string) => string = (text) => text,
): string {
	if (value === null) return "—";
	switch (column.kind) {
		case "date":
			return typeof value === "string" && ISO_DATE.test(value)
				? formatters.date(value)
				: String(value);
		case "weekday":
			return weekdayText(value, formatters);
		case "month":
			return monthText(value);
		case "hour":
			return typeof value === "number" ? hourText(value) : String(value);
		default:
			break;
	}
	if (typeof value === "string") return value;
	const text = formatValue(column.kind, value, formatters, false);
	return column.kind === "percentPoints" ? points(text) : text;
}

function isPercentKind(column: TableColumn): boolean {
	return (
		column.kind === "percent" ||
		column.kind === "signedPercent" ||
		column.kind === "percentPoints" ||
		column.kind === "percentChange"
	);
}

function takesPercentHeader(column: TableColumn): boolean {
	return isPercentKind(column) && column.kind !== "percentPoints";
}

export function csvCell(
	column: TableColumn,
	value: TableValue,
	formatters?: Formatters,
): CsvCell {
	if (value === null) return null;
	if (formatters !== undefined) {
		if (column.kind === "weekday") return weekdayText(value, formatters);
		if (column.kind === "month") return monthText(value);
		if (column.kind === "hour" && typeof value === "number") {
			return hourText(value);
		}
	}
	if (typeof value === "string") return value;
	if (column.kind === "percentChange") return Math.round(value * 10) / 10;
	if (isPercentKind(column)) return Math.round(value * 1000) / 10;
	if (column.kind === "money") return Math.round(value * 100) / 100;
	return value;
}

export function csvOfRows(
	columns: readonly TableColumn[],
	rows: readonly TableRow[],
	percentHeader: (label: string) => string,
	formatters?: Formatters,
): string {
	return buildCsv(
		columns.map((column) => ({
			key: column.key,
			label: takesPercentHeader(column)
				? percentHeader(column.label)
				: column.label,
		})),
		rows.map((row) =>
			Object.fromEntries(
				columns.map((column) => [
					column.key,
					csvCell(column, row.cells[column.key] ?? null, formatters),
				]),
			),
		),
	);
}

export const HEAT_LEVELS = 5;

export function compactsInHeat(
	column: TableColumn,
	value: TableValue,
): boolean {
	return column.kind === "money" && typeof value === "number";
}

export function heatLevels(
	rows: readonly TableRow[],
	heatColumns: readonly string[],
): Map<string, number> {
	const values: number[] = [];
	for (const row of rows) {
		for (const key of heatColumns) {
			const value = row.cells[key];
			if (typeof value === "number" && Number.isFinite(value))
				values.push(value);
		}
	}
	const sorted = [...values].sort((left, right) => left - right);
	const levels = new Map<string, number>();
	if (sorted.length === 0) return levels;
	const below = (value: number) => {
		let low = 0;
		let high = sorted.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if ((sorted[middle] as number) < value) low = middle + 1;
			else high = middle;
		}
		return low;
	};
	for (const row of rows) {
		for (const key of heatColumns) {
			const value = row.cells[key];
			if (typeof value !== "number" || !Number.isFinite(value)) continue;
			const level = Math.min(
				HEAT_LEVELS - 1,
				Math.floor((HEAT_LEVELS * below(value)) / sorted.length),
			);
			levels.set(`${row.id}|${key}`, level);
		}
	}
	return levels;
}

const stickyColumnClass =
	"sticky left-0 z-[1] bg-surface-raised group-data-[scrolled=true]/scroller:shadow-[inset_-1px_0_0_var(--color-line)] print:static print:shadow-none";
const LONG_HEADER_CHARACTERS = 12;

function isTextual(column: TableColumn): boolean {
	return column.kind === "text";
}

function textWrapping(isFirst: boolean, wide: boolean): string {
	if (!wide) return "";
	return isFirst ? "md:whitespace-nowrap" : "whitespace-nowrap";
}

function cellClass(
	column: TableColumn,
	isFirst: boolean,
	compact = false,
	wide = false,
): string {
	const alignment = isTextual(column)
		? `text-left ${textWrapping(isFirst, wide)}`
		: "text-right whitespace-nowrap tabular-nums";
	const width = isFirst
		? compact
			? "min-w-12 print:min-w-0"
			: "min-w-[6.5rem] print:min-w-0"
		: column.kind === "text"
			? "min-w-24 print:min-w-0"
			: "";
	return `snap-start border-b border-line ${alignment} ${width} ${isFirst ? stickyColumnClass : ""}`;
}

function headerClass(
	column: TableColumn,
	isFirst: boolean,
	compact: boolean,
): string {
	const longNumericLabel =
		!isFirst &&
		column.kind !== "text" &&
		column.label.length > LONG_HEADER_CHARACTERS;
	return `${compact ? "px-1.5 print:px-0.5" : "px-2 print:px-1"} py-0 align-bottom font-medium ${cellClass(column, isFirst, compact)} ${longNumericLabel && !compact ? "min-w-24 print:min-w-0" : ""}`;
}

function SortableHeader({
	column,
	isFirst,
	compact,
	sort,
	onSort,
}: {
	column: TableColumn;
	isFirst: boolean;
	compact: boolean;
	sort: TableSort | null;
	onSort: (key: string) => void;
}) {
	const t = useT();
	const active = sort?.key === column.key;
	return (
		<th
			scope="col"
			aria-sort={active ? sort.direction : "none"}
			className={headerClass(column, isFirst, compact)}
			{...(isFirst ? { "data-sticky-column": "" } : {})}
		>
			<button
				type="button"
				onClick={() => onSort(column.key)}
				className={`inline-flex min-h-11 items-center gap-1 rounded py-1 text-ink-muted hover:text-ink print:min-h-0 print:text-ink ${column.kind === "text" ? "text-left" : "text-right"}`}
				aria-label={t("reportCard.sortBy", { column: column.label })}
			>
				<span className="whitespace-normal">{column.label}</span>
				<span aria-hidden="true" className="print:hidden">
					{active ? (sort.direction === "ascending" ? "↑" : "↓") : "↕"}
				</span>
			</button>
		</th>
	);
}

function hiddenInPreview(
	index: number,
	previewRows: number | undefined,
	expanded: boolean,
): boolean {
	return !expanded && previewRows !== undefined && index >= previewRows;
}

export function DataTable({
	table,
	formatters,
	fileName,
	wide = false,
}: {
	table: TableSpec;
	formatters: Formatters;
	fileName: string;
	wide?: boolean;
}) {
	const t = useT();
	const { language } = useLanguage();
	const bodyId = useId();
	const [sort, setSort] = useState<TableSort | null>(table.initialSort ?? null);
	const [expanded, setExpanded] = useState(false);
	const collator = useMemo(
		() => new Intl.Collator(uiLocaleOf[language]),
		[language],
	);
	const rows = useMemo(
		() => sortRows(table.rows, sort, collator),
		[table.rows, sort, collator],
	);
	const heat = useMemo(
		() => heatLevels(table.rows, table.heatColumns ?? []),
		[table.rows, table.heatColumns],
	);
	const heatKeys = useMemo(
		() => new Set(table.heatColumns ?? []),
		[table.heatColumns],
	);
	const isHeatTable = heatKeys.size > 0;
	const previewRows =
		table.previewRows !== undefined && table.rows.length > table.previewRows
			? table.previewRows
			: undefined;
	const points = (text: string) => t("report.value.points", { value: text });
	const download = () =>
		downloadTextFile(
			fileName,
			csvOfRows(
				table.columns,
				rows,
				(label) => t("reportCard.csvPercentHeader", { label }),
				formatters,
			),
			"text/csv;charset=utf-8",
		);

	return (
		<div className="space-y-2">
			<TableScroller>
				<table
					className={`w-full border-separate border-spacing-0 ${isHeatTable ? "text-xs print:text-[7pt]" : "text-sm print:text-[8pt]"}`}
				>
					<caption className="sr-only">{table.caption}</caption>
					<thead>
						<tr>
							{table.columns.map((column, index) => (
								<SortableHeader
									key={column.key}
									column={column}
									isFirst={index === 0}
									compact={isHeatTable}
									sort={sort}
									onSort={(key) => setSort((current) => nextSort(current, key))}
								/>
							))}
						</tr>
					</thead>
					<tbody id={bodyId}>
						{rows.length === 0 ? (
							<tr>
								<td
									colSpan={table.columns.length}
									className="px-2 py-3 text-ink-muted"
								>
									{t("reportCard.emptyTable")}
								</td>
							</tr>
						) : (
							rows.map((row, rowIndex) => (
								<tr
									key={row.id}
									className={`[&:last-child>td]:border-b-0 ${hiddenInPreview(rowIndex, previewRows, expanded) ? "hidden print:table-row" : ""}`}
								>
									{table.columns.map((column, index) => {
										const level = heat.get(`${row.id}|${column.key}`);
										const value = row.cells[column.key] ?? null;
										const compact =
											isHeatTable && compactsInHeat(column, value);
										return (
											<td
												key={column.key}
												className={`py-1.5 ${isHeatTable ? "px-1.5 print:px-0.5" : "px-2 print:px-1"} ${cellClass(column, index === 0, isHeatTable, wide)} ${level === undefined ? "" : "heat-cell"}`}
												{...(level === undefined
													? {}
													: { "data-heat": String(level) })}
												{...(compact
													? {
															title: displayCell(
																column,
																value,
																formatters,
																points,
															),
														}
													: {})}
											>
												{compact && typeof value === "number"
													? formatters.moneyCompact(value)
													: displayCell(column, value, formatters, points)}
											</td>
										);
									})}
								</tr>
							))
						)}
					</tbody>
				</table>
			</TableScroller>
			<div className="flex flex-wrap items-center gap-2">
				{previewRows === undefined ? null : (
					<Button
						type="button"
						onClick={() => setExpanded((current) => !current)}
						aria-expanded={expanded}
						aria-controls={bodyId}
						tone="secondary"
						size="compact"
						className="inline-flex items-center print:hidden"
						data-testid="table-preview-toggle"
					>
						{expanded
							? t("reportCard.showFirstRows", {
									count: formatters.count(previewRows),
								})
							: t("reportCard.showAllRows", {
									count: formatters.count(rows.length),
								})}
					</Button>
				)}
				<Button
					type="button"
					onClick={download}
					disabled={rows.length === 0}
					aria-label={t("reportCard.downloadCsvOf", { table: table.caption })}
					tone="secondary"
					size="compact"
					className="inline-flex items-center disabled:opacity-60"
				>
					{t("reportCard.downloadCsv")}
				</Button>
			</div>
		</div>
	);
}
