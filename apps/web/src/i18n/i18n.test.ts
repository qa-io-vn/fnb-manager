import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync } from "vite";
import { describe, expect, it } from "vitest";
import { messageFiles } from "./catalog";
import { interpolate, isMessageKey, messages, translate } from "./index";

const sourceRoot = join(import.meta.dirname, "..");

function tsxFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) return tsxFiles(path);
		return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
	});
}

const technicalAttributes = new Set([
	"className",
	"style",
	"key",
	"id",
	"htmlFor",
	"type",
	"role",
	"lang",
	"to",
	"href",
	"d",
	"viewBox",
	"fill",
	"stroke",
	"strokeLinecap",
	"strokeLinejoin",
	"aria-hidden",
	"aria-controls",
	"aria-current",
	"aria-describedby",
	"aria-labelledby",
	"aria-sort",
	"autoComplete",
	"scope",
	"testId",
	"csvFileName",
	"fileName",
]);
const letters = /\p{L}/u;
const proseShape = /\s|[^\p{ASCII}]|^\p{Lu}\p{Ll}/u;

interface AstNode {
	type?: string;
	value?: unknown;
	name?: { name?: unknown };
	expression?: unknown;
	children?: unknown;
	quasis?: { value?: { cooked?: unknown } }[];
	consequent?: unknown;
	alternate?: unknown;
	right?: unknown;
	[key: string]: unknown;
}

function asNode(value: unknown): AstNode | null {
	return typeof value === "object" && value !== null
		? (value as AstNode)
		: null;
}

function isTechnicalAttribute(name: string): boolean {
	return technicalAttributes.has(name) || name.startsWith("data-");
}

function literalTexts(expression: unknown): string[] {
	const node = asNode(expression);
	if (!node) return [];
	if (node.type === "Literal" && typeof node.value === "string") {
		return [node.value];
	}
	if (node.type === "TemplateLiteral") {
		return [
			(node.quasis ?? [])
				.map((quasi) =>
					typeof quasi.value?.cooked === "string" ? quasi.value.cooked : "",
				)
				.join(" "),
		];
	}
	if (node.type === "ConditionalExpression") {
		return [...literalTexts(node.consequent), ...literalTexts(node.alternate)];
	}
	if (node.type === "LogicalExpression") return literalTexts(node.right);
	return [];
}

function visibleTexts(value: unknown): string[] {
	const node = asNode(value);
	if (!node) return [];
	if (node.type === "JSXExpressionContainer") {
		return literalTexts(node.expression);
	}
	return literalTexts(node);
}

function isProse(text: string): boolean {
	return letters.test(text) && proseShape.test(text.trim());
}

function literalsBypassingTranslation(
	file: string,
	source = readFileSync(file, "utf8"),
): string[] {
	const { program, errors } = parseSync(file, source, { lang: "tsx" });
	expect(errors).toHaveLength(0);
	const findings: string[] = [];
	const visit = (node: unknown) => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		const astNode = asNode(node);
		if (!astNode) return;
		if (
			astNode.type === "JSXText" &&
			typeof astNode.value === "string" &&
			letters.test(astNode.value)
		) {
			findings.push(astNode.value.trim());
		}
		if (astNode.type === "JSXElement" || astNode.type === "JSXFragment") {
			const children = Array.isArray(astNode.children) ? astNode.children : [];
			for (const child of children) {
				if (asNode(child)?.type !== "JSXExpressionContainer") continue;
				for (const text of visibleTexts(child)) {
					if (letters.test(text)) findings.push(`{${text.trim()}}`);
				}
			}
		}
		if (
			astNode.type === "JSXAttribute" &&
			typeof astNode.name?.name === "string" &&
			!isTechnicalAttribute(astNode.name.name)
		) {
			for (const text of visibleTexts(astNode.value)) {
				if (isProse(text)) findings.push(`${astNode.name.name}="${text}"`);
			}
		}
		for (const child of Object.values(astNode)) visit(child);
	};
	visit(program);
	return findings;
}

describe("translations", () => {
	const placeholders = (message: string) =>
		[...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

	it.each(messageFiles.map((file) => [file.name, file] as const))(
		"keeps %s in step between Vietnamese and English",
		(_name, file) => {
			expect(Object.keys(file.en).sort()).toEqual(Object.keys(file.vi).sort());
			for (const [key, message] of Object.entries(file.vi)) {
				expect(message.trim(), key).not.toBe("");
				expect(file.en[key]?.trim(), key).not.toBe("");
				expect(placeholders(file.en[key] ?? ""), key).toEqual(
					placeholders(message),
				);
			}
		},
	);

	it.each(messageFiles.map((file) => [file.name, file] as const))(
		"keeps every key of %s under the file's own prefix",
		(_name, file) => {
			for (const key of Object.keys(file.vi)) {
				if (file.prefix !== null)
					expect(key.startsWith(file.prefix), key).toBe(true);
				for (const excluded of file.excludedPrefixes) {
					expect(key.startsWith(excluded), key).toBe(false);
				}
			}
		},
	);

	it("never repeats a key in two files", () => {
		const owners = new Map<string, string[]>();
		for (const file of messageFiles) {
			for (const key of Object.keys(file.vi)) {
				owners.set(key, [...(owners.get(key) ?? []), file.name]);
			}
		}
		expect(
			[...owners.entries()].filter(([, files]) => files.length > 1),
		).toEqual([]);
	});

	it("merges every file into one dictionary per language", () => {
		const total = messageFiles.reduce(
			(count, file) => count + Object.keys(file.vi).length,
			0,
		);
		expect(Object.keys(messages.vi)).toHaveLength(total);
		expect(Object.keys(messages.en)).toHaveLength(total);
		expect(isMessageKey("report.day.title")).toBe(true);
		expect(isMessageKey("report.day.missing")).toBe(false);
	});

	it("spells invoices and cancellations the registry's way", () => {
		const oldSpellings = /(?<!\p{L})(hoá|Hoá|huỷ|Huỷ|tuỳ|Tuỳ)(?!\p{L})/u;
		expect(oldSpellings.test("Số hoá đơn")).toBe(true);
		expect(oldSpellings.test("Thoát bản demo")).toBe(false);
		for (const [key, message] of Object.entries(messages.vi)) {
			expect(oldSpellings.test(message), key).toBe(false);
		}
	});

	it("writes Vietnamese with diacritics", () => {
		expect(messages.vi["nav.today"]).toBe("Hôm nay");
		expect(messages.vi["badge.unverified"]).toBe("chưa đối soát");
		expect(messages.vi["shell.newVersion"]).toBe("Có phiên bản mới — tải lại");
	});

	it("interpolates named parameters", () => {
		expect(interpolate("cập nhật lúc {time}", { time: "09:44" })).toBe(
			"cập nhật lúc 09:44",
		);
		expect(interpolate("{missing} stays", {})).toBe("{missing} stays");
		expect(translate("en", "shell.stores.selected", { count: 2 })).toBe(
			"2 stores",
		);
	});

	it("detects JSX text and visible attributes written outside t()", () => {
		const sample = 'const view = <p title="Xin chào">Hôm nay {count} — 12</p>;';
		expect(literalsBypassingTranslation("sample.tsx", sample)).toEqual([
			'title="Xin chào"',
			"Hôm nay",
		]);
		expect(
			literalsBypassingTranslation(
				"sample.tsx",
				'const view = <p>{t("nav.today")} — 12 %</p>;',
			),
		).toEqual([]);
	});

	it("detects string literals in expressions and text props of own components", () => {
		const sample = readFileSync(
			join(import.meta.dirname, "fixtures", "literal-bypass-sample.tsx.txt"),
			"utf8",
		);
		expect(literalsBypassingTranslation("sample.tsx", sample)).toEqual([
			"{Tất cả}",
			"{stores}",
			"{Ready}",
			'label="Doanh thu"',
			'caption="Tổng  "',
			'title="Đóng"',
		]);
	});

	it("routes every visible JSX string through t()", () => {
		const offenders = tsxFiles(sourceRoot).flatMap((file) =>
			literalsBypassingTranslation(file).map(
				(text) => `${relative(sourceRoot, file)}: ${text}`,
			),
		);
		expect(offenders).toEqual([]);
	});
});
