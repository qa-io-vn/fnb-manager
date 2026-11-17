import { formatDecimal } from "./decimal.js";
import { DataPackError } from "./errors.js";
import { type PathSegment, pathText } from "./path.js";

export type CanonicalValue =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalValue[]
	| { readonly [key: string]: CanonicalValue };

export function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function refuse(reason: string, path: readonly PathSegment[]): never {
	throw new DataPackError(
		"pack_invalid",
		`${reason} at ${pathText(path) ?? "the root"}`,
	);
}

function isPlainObject(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function writeValue(
	value: unknown,
	path: PathSegment[],
	ancestors: Set<object>,
	parts: string[],
): void {
	if (value === null) {
		parts.push("null");
		return;
	}
	switch (typeof value) {
		case "boolean":
			parts.push(value ? "true" : "false");
			return;
		case "number":
			if (!Number.isFinite(value)) refuse(`${value} is not finite`, path);
			parts.push(formatDecimal(value));
			return;
		case "string":
			parts.push(JSON.stringify(value));
			return;
		case "object":
			break;
		default:
			refuse(`${typeof value} is not a JSON value`, path);
	}
	if (ancestors.has(value)) refuse("a value contains itself", path);
	ancestors.add(value);
	if (Array.isArray(value)) {
		parts.push("[");
		for (let index = 0; index < value.length; index += 1) {
			if (index > 0) parts.push(",");
			path.push(index);
			writeValue(value[index], path, ancestors, parts);
			path.pop();
		}
		parts.push("]");
	} else {
		if (!isPlainObject(value)) refuse("only plain objects are JSON", path);
		const record = value as Readonly<Record<string, unknown>>;
		const keys = Object.keys(record).sort(compareCodeUnits);
		parts.push("{");
		keys.forEach((key, index) => {
			if (index > 0) parts.push(",");
			parts.push(JSON.stringify(key), ":");
			path.push(key);
			writeValue(record[key], path, ancestors, parts);
			path.pop();
		});
		parts.push("}");
	}
	ancestors.delete(value);
}

export function canonicalJson(value: CanonicalValue): string {
	const parts: string[] = [];
	writeValue(value, [], new Set(), parts);
	parts.push("\n");
	return parts.join("");
}
