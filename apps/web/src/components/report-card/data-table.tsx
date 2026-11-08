import { useMemo, useState } from "react";
import { uiLocaleOf, useLanguage, useT } from "../../i18n";
import { buildCsv, type CsvCell, downloadTextFile } from "../../lib/csv";
import type { Formatters } from "../../lib/format";
import { formatValue } from "./headline";
import { TableScroller } from "./table-scroller";
import { nextSort, sortRows } from "./table-sorting";
import type {
	TableColumn,
	TableRow,
	TableSort,
	TableSpec,
	TableValue,
} from "./types";

function displayCell(
	column: TableColumn,
	value: TableValue,
	formatters: Formatters,
): string {
	if (value === null) return "—";
	if (typeof value === "string") return value;
	return formatValue(column.kind, value, formatters, false);
}

function isPercentKind(column: TableColumn): boolean {
	return column.kind === "percent" || column.kind === "signedPercent";
}

export function csvCell(column: TableColumn, value: TableValue): CsvCell {
	if (value === null || typeof value === "string") return value;
	if (isPercentKind(column)) return Math.round(value * 1000) / 10;
	if (column.kind === "money") return Math.round(value * 100) / 100;
	return value;
}

export function csvOfRows(
	columns: readonly TableColumn[],
	rows: readonly TableRow[],
	percentHeader: (label: string) => string,
): string {
	return buildCsv(
		columns.map((column) => ({
			key: column.key,
			label: isPercentKind(column) ? percentHeader(column.label) : column.label,
		})),
		rows.map((row) =>
			Object.fromEntries(
				columns.map((column) => [
					column.key,
					csvCell(column, row.cells[column.key] ?? null),
				]),
			),
		),
	);
}

const stickyColumnClass =
	"sticky left-0 z-[1] bg-surface-raised group-data-[scrolled=true]/scroller:shadow-[inset_-1px_0_0_var(--color-line)] print:static print:shadow-none";
const LONG_HEADER_CHARACTERS = 12;

function cellClass(column: TableColumn, isFirst: boolean): string {
	const alignment =
		column.kind === "text"
			? "text-left"
			: "text-right whitespace-nowrap tabular-nums";
	const width = isFirst
		? "min-w-[6.5rem]"
		: column.kind === "text"
			? "min-w-24"
			: "";
	return `border-b border-line ${alignment} ${width} ${isFirst ? stickyColumnClass : ""}`;
}

function headerClass(column: TableColumn, isFirst: boolean): string {
	const longNumericLabel =
		!isFirst &&
		column.kind !== "text" &&
		column.label.length > LONG_HEADER_CHARACTERS;
	return `px-2 py-0 align-bottom font-medium ${cellClass(column, isFirst)} ${longNumericLabel ? "min-w-24" : ""}`;
}

function SortableHeader({
	column,
	isFirst,
	sort,
	onSort,
}: {
	column: TableColumn;
	isFirst: boolean;
	sort: TableSort | null;
	onSort: (key: string) => void;
}) {
	const t = useT();
	const active = sort?.key === column.key;
	return (
		<th
			scope="col"
			aria-sort={active ? sort.direction : "none"}
			className={headerClass(column, isFirst)}
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

export function DataTable({
	table,
	formatters,
	fileName,
}: {
	table: TableSpec;
	formatters: Formatters;
	fileName: string;
}) {
	const t = useT();
	const { language } = useLanguage();
	const [sort, setSort] = useState<TableSort | null>(table.initialSort ?? null);
	const collator = useMemo(
		() => new Intl.Collator(uiLocaleOf[language]),
		[language],
	);
	const rows = useMemo(
		() => sortRows(table.rows, sort, collator),
		[table.rows, sort, collator],
	);
	const download = () =>
		downloadTextFile(
			fileName,
			csvOfRows(table.columns, rows, (label) =>
				t("reportCard.csvPercentHeader", { label }),
			),
			"text/csv;charset=utf-8",
		);

	return (
		<div className="space-y-2">
			<TableScroller>
				<table className="w-full border-separate border-spacing-0 text-sm">
					<caption className="sr-only">{table.caption}</caption>
					<thead>
						<tr>
							{table.columns.map((column, index) => (
								<SortableHeader
									key={column.key}
									column={column}
									isFirst={index === 0}
									sort={sort}
									onSort={(key) => setSort((current) => nextSort(current, key))}
								/>
							))}
						</tr>
					</thead>
					<tbody>
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
							rows.map((row) => (
								<tr key={row.id} className="[&:last-child>td]:border-b-0">
									{table.columns.map((column, index) => (
										<td
											key={column.key}
											className={`px-2 py-1.5 ${cellClass(column, index === 0)}`}
										>
											{displayCell(
												column,
												row.cells[column.key] ?? null,
												formatters,
											)}
										</td>
									))}
								</tr>
							))
						)}
					</tbody>
				</table>
			</TableScroller>
			<button
				type="button"
				onClick={download}
				disabled={rows.length === 0}
				className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface-sunken disabled:opacity-60"
			>
				{t("reportCard.downloadCsv")}
			</button>
		</div>
	);
}
