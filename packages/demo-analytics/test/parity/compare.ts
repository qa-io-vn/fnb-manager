export const MAX_REPORTED_DIFFERENCES = 20;

export interface Difference {
	readonly call: string;
	readonly key: string;
	readonly column: string;
	readonly sql: string;
	readonly engine: string;
}

export interface CompareOptions {
	readonly key: readonly string[];
	readonly ignore?: readonly string[];
	readonly storeColumns?: readonly string[];
	readonly timestampColumns?: readonly string[];
	readonly demoIdOf?: (uuid: string) => string | undefined;
	readonly checkOrder?: boolean;
}

type Row = Readonly<Record<string, unknown>>;

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

function scaleOf(text: string): number {
	const point = text.indexOf(".");
	return point < 0 ? 0 : text.length - point - 1;
}

function arrayOf(value: unknown): string[] | null {
	if (Array.isArray(value)) return value.map(String);
	if (
		typeof value === "string" &&
		value.startsWith("{") &&
		value.endsWith("}")
	) {
		const body = value.slice(1, -1);
		return body === ""
			? []
			: body.split(",").map((item) => item.replace(/^"(.*)"$/, "$1"));
	}
	return null;
}

export function instantOf(text: string): number {
	const iso = text
		.replace(" ", "T")
		.replace(/([+-]\d\d)$/, "$1:00")
		.replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
	return Date.parse(iso);
}

function text(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (Array.isArray(value)) return `[${value.map(String).join(",")}]`;
	return String(value);
}

export function sameValue(
	sql: unknown,
	engine: unknown,
	kind: "plain" | "timestamp" = "plain",
): boolean {
	if (sql === null || sql === undefined)
		return engine === null || engine === undefined;
	if (engine === null || engine === undefined) return false;
	if (kind === "timestamp") {
		return (
			typeof sql === "string" &&
			typeof engine === "string" &&
			instantOf(sql) === instantOf(engine)
		);
	}
	const sqlArray = arrayOf(sql);
	if (sqlArray !== null && Array.isArray(engine)) {
		return sqlArray.join("\u0000") === engine.map(String).join("\u0000");
	}
	if (
		typeof sql === "string" &&
		NUMERIC_TEXT.test(sql) &&
		typeof engine === "number"
	) {
		return (
			withoutNegativeZero(engine.toFixed(scaleOf(sql))) ===
			withoutNegativeZero(sql)
		);
	}
	if (typeof sql === "number" || typeof sql === "bigint") {
		return typeof engine === "number" && Number(sql) === engine;
	}
	if (typeof sql === "string" && typeof engine === "number") {
		return Number(sql) === engine;
	}
	return sql === engine;
}

function withoutNegativeZero(value: string): string {
	return /^-0(\.0+)?$/.test(value) ? value.slice(1) : value;
}

export class ParityReport {
	compared = 0;
	calls = 0;
	rows = 0;
	readonly differences: Difference[] = [];
	private total = 0;

	get mismatches(): number {
		return this.total;
	}

	private record(difference: Difference): void {
		this.total += 1;
		if (this.differences.length < MAX_REPORTED_DIFFERENCES) {
			this.differences.push(difference);
		}
	}

	compareRows(
		call: string,
		sqlRows: readonly Row[],
		engineRows: readonly Row[],
		options: CompareOptions,
	): void {
		this.calls += 1;
		const ignore = new Set(options.ignore ?? []);
		const storeColumns = new Set(options.storeColumns ?? ["store_id"]);
		const timestamps = new Set(options.timestampColumns ?? []);
		const translate = (column: string, value: unknown): unknown =>
			storeColumns.has(column) && typeof value === "string" && options.demoIdOf
				? (options.demoIdOf(value) ?? value)
				: value;
		const keyOf = (row: Row, translateStores: boolean) =>
			options.key
				.map((column) =>
					text(translateStores ? translate(column, row[column]) : row[column]),
				)
				.join("|");
		const engineByKey = new Map(
			engineRows.map((row) => [keyOf(row, false), row]),
		);
		const sqlKeys = sqlRows.map((row) => keyOf(row, true));
		const engineKeys = engineRows.map((row) => keyOf(row, false));
		if (sqlRows.length !== engineRows.length) {
			this.record({
				call,
				key: "*",
				column: "row count",
				sql: String(sqlRows.length),
				engine: String(engineRows.length),
			});
		}
		if (
			options.checkOrder !== false &&
			sqlKeys.join("\n") !== engineKeys.join("\n") &&
			sqlRows.length === engineRows.length
		) {
			this.record({
				call,
				key: "*",
				column: "row order",
				sql: sqlKeys.slice(0, 5).join(" ; "),
				engine: engineKeys.slice(0, 5).join(" ; "),
			});
		}
		for (const sqlRow of sqlRows) {
			const key = keyOf(sqlRow, true);
			const engineRow = engineByKey.get(key);
			this.rows += 1;
			if (engineRow === undefined) {
				this.record({
					call,
					key,
					column: "row",
					sql: "present",
					engine: "missing",
				});
				continue;
			}
			for (const [column, sqlValue] of Object.entries(sqlRow)) {
				if (ignore.has(column)) continue;
				this.compared += 1;
				const engineValue = engineRow[column];
				const expected = translate(column, sqlValue);
				if (!(column in engineRow)) {
					this.record({
						call,
						key,
						column,
						sql: text(expected),
						engine: "absent column",
					});
					continue;
				}
				if (
					!sameValue(
						expected,
						engineValue,
						timestamps.has(column) ? "timestamp" : "plain",
					)
				) {
					this.record({
						call,
						key,
						column,
						sql: text(expected),
						engine: text(engineValue),
					});
				}
			}
		}
		const sqlKeySet = new Set(sqlKeys);
		for (const engineKey of engineKeys) {
			if (!sqlKeySet.has(engineKey)) {
				this.record({
					call,
					key: engineKey,
					column: "row",
					sql: "missing",
					engine: "present",
				});
			}
		}
	}

	compareValues(
		call: string,
		column: string,
		sql: unknown,
		engine: unknown,
	): void {
		this.calls += 1;
		this.compared += 1;
		if (!sameValue(sql, engine)) {
			this.record({
				call,
				key: "-",
				column,
				sql: text(sql),
				engine: text(engine),
			});
		}
	}

	summary(): string {
		const lines = [
			`${this.calls} calls, ${this.rows} rows, ${this.compared} values compared, ${this.mismatches} mismatches`,
			...this.differences.map(
				(difference) =>
					`${difference.call} [${difference.key}] ${difference.column}: sql=${difference.sql} engine=${difference.engine}`,
			),
		];
		return lines.join("\n");
	}
}
