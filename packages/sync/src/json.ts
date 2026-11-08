import type { JsonValue } from "./rows.js";

const NUL = "\u0000";

export function stripNul(text: string): string {
	return text.includes(NUL) ? text.replaceAll(NUL, "") : text;
}

export function containsNul(value: unknown): boolean {
	return (JSON.stringify(value) ?? "").includes("\\u0000");
}

function cleanJson(value: JsonValue): JsonValue {
	if (typeof value === "string") {
		return stripNul(value);
	}
	if (Array.isArray(value)) {
		return value.map(cleanJson);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				stripNul(key),
				cleanJson(entry),
			]),
		);
	}
	return value;
}

export function toJson(value: unknown): JsonValue | null {
	if (value === undefined || value === null) {
		return null;
	}
	const text = JSON.stringify(value);
	if (text === undefined) {
		return null;
	}
	const parsed: JsonValue = JSON.parse(text);
	return text.includes("\\u0000") ? cleanJson(parsed) : parsed;
}

export function stableJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}
	if (value !== null && typeof value === "object" && !(value instanceof Date)) {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([key, entry]) => [key, sortKeys(entry)]),
		);
	}
	return value;
}
