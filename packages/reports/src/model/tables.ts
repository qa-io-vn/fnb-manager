import type {
	ColumnKind,
	TableCell,
	TableColumnModel,
	TableModel,
	TableRowModel,
} from "./card.js";
import { reportKeys } from "./keys.js";

export interface TableSort {
	readonly key: string;
	readonly direction: "ascending" | "descending";
}

export function column(
	key: string,
	labelKey: string,
	kind: ColumnKind,
): TableColumnModel {
	return { key, labelKey, kind };
}

export function tableModel(input: {
	readonly captionKey: string;
	readonly columns: readonly TableColumnModel[];
	readonly rows: readonly TableRowModel[];
	readonly initialSort?: TableSort | null;
	readonly variant?: TableModel["variant"];
	readonly heatColumns?: readonly string[];
	readonly previewRows?: number;
}): TableModel {
	return {
		captionKey: input.captionKey,
		columns: input.columns,
		rows: input.rows,
		initialSort: input.initialSort ?? null,
		variant: input.variant ?? "standard",
		heatColumns: input.heatColumns ?? [],
		...(input.previewRows === undefined
			? {}
			: { previewRows: input.previewRows }),
	};
}

export interface StoreLike {
	readonly id: string;
	readonly name: string;
}

export const STORE_COLUMN = column("store", reportKeys.table.store, "text");
export const PERIOD_COLUMN = column(
	"period",
	reportKeys.table.period,
	"message",
);

export function storeComparisonTable(input: {
	readonly captionKey: string;
	readonly stores: readonly StoreLike[];
	readonly columns: readonly TableColumnModel[];
	readonly cells: (store: StoreLike) => Readonly<Record<string, TableCell>>;
	readonly initialSort?: TableSort | null;
}): TableModel {
	return tableModel({
		captionKey: input.captionKey,
		columns: [STORE_COLUMN, ...input.columns],
		rows: input.stores.map((store) => ({
			id: store.id,
			cells: { store: store.name, ...input.cells(store) },
		})),
		initialSort: input.initialSort ?? null,
	});
}

export interface PeriodTableRow {
	readonly id: string;
	readonly labelKey: string;
	readonly cells: Readonly<Record<string, TableCell>>;
}

export function periodComparisonTable(input: {
	readonly captionKey: string;
	readonly columns: readonly TableColumnModel[];
	readonly periods: readonly PeriodTableRow[];
}): TableModel {
	return tableModel({
		captionKey: input.captionKey,
		columns: [PERIOD_COLUMN, ...input.columns],
		rows: input.periods.map((period) => ({
			id: period.id,
			cells: { period: period.labelKey, ...period.cells },
		})),
	});
}

export function tableKeys(table: TableModel): string[] {
	const keys = [
		table.captionKey,
		...table.columns.map((item) => item.labelKey),
	];
	const messageColumns = table.columns
		.filter((item) => item.kind === "message")
		.map((item) => item.key);
	const labelColumns = table.columns
		.filter((item) => item.kind === "label")
		.map((item) => item.key);
	for (const row of table.rows) {
		for (const key of messageColumns) {
			const cell = row.cells[key];
			if (typeof cell === "string") keys.push(cell);
		}
		for (const key of labelColumns) {
			const cell = row.cells[key];
			if (isLabelKey(cell)) keys.push(cell);
		}
	}
	return keys;
}

export const LABEL_KEY_PREFIX = "report.";

export function isLabelKey(cell: unknown): cell is string {
	return typeof cell === "string" && cell.startsWith(LABEL_KEY_PREFIX);
}
