export type Row = Readonly<Record<string, unknown>>;
export type IsoInstant = string;

export function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalid(what: string): never {
	throw new Error(`the answer has no valid ${what}`);
}

export function single(value: unknown, what: string): Row {
	if (Array.isArray(value) && value.length === 1) return single(value[0], what);
	return isRecord(value) ? value : invalid(what);
}

export function rows(value: unknown, what: string): readonly Row[] {
	if (!Array.isArray(value)) return invalid(what);
	return value.map((row) => (isRecord(row) ? row : invalid(what)));
}

export function text(value: unknown, what: string): string {
	return typeof value === "string" && value.trim() !== ""
		? value
		: invalid(what);
}

export function textOrNull(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value.trim() || null : invalid(what);
}

export function count(value: unknown, what: string): number {
	const parsed =
		typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0
		? parsed
		: invalid(what);
}

export function ratioOrNull(value: unknown, what: string): number | null {
	if (value === null || value === undefined) return null;
	const parsed =
		typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof parsed === "number" && parsed >= 0 && parsed <= 1
		? parsed
		: invalid(what);
}

export function flag(value: unknown, what: string): boolean {
	return typeof value === "boolean" ? value : invalid(what);
}

export function instant(value: unknown, what: string): IsoInstant {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

export function instantOrNull(value: unknown, what: string): IsoInstant | null {
	return value === null || value === undefined ? null : instant(value, what);
}

export function idsOrNull(value: unknown, what: string): string[] | null {
	if (value === null || value === undefined) return null;
	if (!Array.isArray(value)) return invalid(what);
	return value.map((id) => text(id, what));
}

export function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

export function knownOrNull<T extends string>(
	allowed: readonly T[],
	value: unknown,
): T | null {
	return allowed.find((candidate) => candidate === value) ?? null;
}
