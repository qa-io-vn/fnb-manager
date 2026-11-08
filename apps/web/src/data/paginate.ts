import { z } from "zod";

export const PAGE_SIZE = 1000;

export interface QueryResult {
	data: unknown;
	error: { message: string } | null;
}

export type PageQuery = (from: number, to: number) => PromiseLike<QueryResult>;

export async function fetchAllPages<T>(
	schema: z.ZodType<T>,
	page: PageQuery,
	pageSize: number = PAGE_SIZE,
): Promise<T[]> {
	const rows: T[] = [];
	for (let offset = 0; ; offset += pageSize) {
		const { data, error } = await page(offset, offset + pageSize - 1);
		if (error) throw new Error(error.message);
		const parsed = z.array(schema).parse(data ?? []);
		rows.push(...parsed);
		if (parsed.length < pageSize) return rows;
	}
}

export async function fetchOnce<T>(
	schema: z.ZodType<T>,
	query: PromiseLike<QueryResult>,
): Promise<T[]> {
	const { data, error } = await query;
	if (error) throw new Error(error.message);
	return z.array(schema).parse(data ?? []);
}

export type KeysetQuery<T> = (
	after: T | null,
	pageSize: number,
) => PromiseLike<QueryResult>;

export async function fetchAllByKey<T>(
	schema: z.ZodType<T>,
	keyOf: (row: T) => string,
	page: KeysetQuery<T>,
	pageSize: number = PAGE_SIZE,
): Promise<T[]> {
	const rowsByKey = new Map<string, T>();
	let after: T | null = null;
	for (;;) {
		const { data, error } = await page(after, pageSize);
		if (error) throw new Error(error.message);
		const parsed = z.array(schema).parse(data ?? []);
		for (const row of parsed) rowsByKey.set(keyOf(row), row);
		const last = parsed.at(-1);
		if (parsed.length < pageSize || last === undefined) {
			return [...rowsByKey.values()];
		}
		after = last;
	}
}

export function quotedFilterValue(value: string | number): string {
	if (typeof value === "number") return String(value);
	return `"${value.replace(/["\\]/g, (character) => `\\${character}`)}"`;
}

export function afterCompositeKey(
	first: { column: string; value: string },
	second: { column: string; value: string | number },
): string {
	const firstValue = quotedFilterValue(first.value);
	return `${first.column}.gt.${firstValue},and(${first.column}.eq.${firstValue},${second.column}.gt.${quotedFilterValue(second.value)})`;
}
