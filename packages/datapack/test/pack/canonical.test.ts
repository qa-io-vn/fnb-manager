import { describe, expect, it } from "vitest";
import {
	type CanonicalValue,
	canonicalJson,
	compareCodeUnits,
} from "../../src/pack/canonical.js";
import { DataPackError } from "../../src/pack/errors.js";
import { draftPack, reorderKeys } from "./format-fixtures.js";

function jsonbText(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
	if (typeof value === "number") {
		return Number.isInteger(value) ? `${value}.00` : `${value}0`;
	}
	if (typeof value !== "object" || value === null) {
		return JSON.stringify(value);
	}
	const entries = Object.entries(value).sort(([left], [right]) =>
		left.length !== right.length
			? left.length - right.length
			: compareCodeUnits(left, right),
	);
	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`)
		.join(", ")}}`;
}

describe("canonicalJson", () => {
	it("writes the golden text: sorted keys, no whitespace, JSON string escapes, one final newline", () => {
		const value = {
			é: "Trà sữa trân châu",
			b: [1, -0, 0.5, "x", false],
			a: { d: null, c: true },
			Z: "\u0007\u2028\ud800",
			A: 'line\nbreak\r\n\t"quoted"\\',
			"": 1e21,
		};
		expect(canonicalJson(value)).toBe(
			`{"":1000000000000000000000,"A":"line\\nbreak\\r\\n\\t\\"quoted\\"\\\\","Z":"\\u0007\u2028\\ud800","a":{"c":true,"d":null},"b":[1,0,0.5,"x",false],"é":"Trà sữa trân châu"}\n`,
		);
	});

	it("writes scalars and empty containers", () => {
		expect(canonicalJson(null)).toBe("null\n");
		expect(canonicalJson(true)).toBe("true\n");
		expect(canonicalJson("")).toBe('""\n');
		expect(canonicalJson(0)).toBe("0\n");
		expect(canonicalJson([])).toBe("[]\n");
		expect(canonicalJson({})).toBe("{}\n");
		expect(canonicalJson({ a: [], b: {} })).toBe('{"a":[],"b":{}}\n');
	});

	it("orders keys by UTF-16 code units, not by code points, locale or length", () => {
		const keys = ["b", "S2", "S10", "a", "B", "aa", "\uff61", "\u{1f600}", "é"];
		const text = canonicalJson(
			Object.fromEntries(keys.map((key, index) => [key, index])),
		);
		expect(text).toBe(
			'{"B":4,"S10":2,"S2":1,"a":3,"aa":5,"b":0,"é":8,"\u{1f600}":7,"\uff61":6}\n',
		);
	});

	it("writes numbers as plain decimals without exponent or float drift", () => {
		expect(
			canonicalJson([
				0.1 + 0.2,
				1e-7,
				-0,
				12500000,
				-52314.27,
				1e15,
				0.0001,
				2 ** 53,
			]),
		).toBe(
			"[0.3,0.0000001,0,12500000,-52314.27,1000000000000000,0.0001,9007199254740990]\n",
		);
	});

	it("gives the same text for the same value whatever the key order", () => {
		const pack = draftPack();
		const text = canonicalJson(pack);
		expect(canonicalJson(reorderKeys(pack) as CanonicalValue)).toBe(text);
		expect(text.indexOf("\n")).toBe(text.length - 1);
		expect(text.startsWith('{"budget":')).toBe(true);
	});

	it("re-serialises a parsed text byte for byte, also after a simulated jsonb round trip", () => {
		const text = canonicalJson(draftPack());
		expect(canonicalJson(JSON.parse(text))).toBe(text);
		const jsonb = jsonbText(JSON.parse(text));
		expect(jsonb).not.toBe(text);
		expect(jsonb).toContain("12500000.00");
		expect(canonicalJson(JSON.parse(jsonb))).toBe(text);
	});

	it("never writes a raw line break, so the text has no line-ending variants", () => {
		const text = canonicalJson({ note: "a\r\nb\rc\nd\u0085" });
		expect(text).toBe('{"note":"a\\r\\nb\\rc\\nd\u0085"}\n');
		expect(text.slice(0, -1)).not.toMatch(/[\r\n]/);
	});

	it("refuses values that are not JSON, naming where", () => {
		const refused: [unknown, RegExp][] = [
			[Number.NaN, /NaN is not finite at the root/],
			[
				{ a: [1, Number.POSITIVE_INFINITY] },
				/Infinity is not finite at a\[1\]/,
			],
			[{ a: undefined }, /undefined is not a JSON value at a/],
			[[1, undefined, 3], /undefined is not a JSON value at \[1\]/],
			[{ f: () => 1 }, /function is not a JSON value at f/],
			[{ n: 10n }, /bigint is not a JSON value at n/],
			[{ when: new Date(0) }, /only plain objects are JSON at when/],
			[{ map: new Map() }, /only plain objects are JSON at map/],
			[{ "S1/r01": { x: Symbol("s") } }, /at \["S1\/r01"\]\.x/],
		];
		for (const [value, message] of refused) {
			expect(() => canonicalJson(value as CanonicalValue)).toThrow(message);
			expect(() => canonicalJson(value as CanonicalValue)).toThrow(
				DataPackError,
			);
		}
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => canonicalJson(cyclic as CanonicalValue)).toThrow(
			/contains itself at self/,
		);
	});

	it("accepts objects without a prototype and the same object twice", () => {
		const bare = Object.create(null) as Record<string, CanonicalValue>;
		bare.b = 2;
		bare.a = 1;
		const shared = { x: 1 };
		expect(canonicalJson(bare)).toBe('{"a":1,"b":2}\n');
		expect(canonicalJson({ one: shared, two: shared })).toBe(
			'{"one":{"x":1},"two":{"x":1}}\n',
		);
	});
});
