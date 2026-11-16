export type MarkdownInline =
	| { readonly kind: "text"; readonly at: number; readonly text: string }
	| { readonly kind: "strong"; readonly at: number; readonly text: string }
	| { readonly kind: "emphasis"; readonly at: number; readonly text: string }
	| { readonly kind: "code"; readonly at: number; readonly text: string }
	| {
			readonly kind: "link";
			readonly at: number;
			readonly text: string;
			readonly href: string | null;
	  };

export interface MarkdownListItem {
	readonly line: number;
	readonly inlines: readonly MarkdownInline[];
}

export type MarkdownBlock =
	| {
			readonly kind: "heading";
			readonly line: number;
			readonly level: number;
			readonly inlines: readonly MarkdownInline[];
	  }
	| {
			readonly kind: "paragraph";
			readonly line: number;
			readonly inlines: readonly MarkdownInline[];
	  }
	| {
			readonly kind: "list";
			readonly line: number;
			readonly ordered: boolean;
			readonly start: number;
			readonly items: readonly MarkdownListItem[];
	  };

const MAX_HEADING_LEVEL = 6;
const MAX_ORDINAL_DIGITS = 9;
const LINE_BREAK = /\r\n|\r|\n/;
const INLINE =
	/\*\*([^*]+?)\*\*|`([^`]+)`|\[([^\][]+)\]\(([^()\s]+)\)|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}])/gu;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function safeHrefOf(href: string): string | null {
	return SAFE_HREF.test(href) ? href : null;
}

export function inlinesOf(text: string): MarkdownInline[] {
	const inlines: MarkdownInline[] = [];
	let last = 0;
	for (const match of text.matchAll(INLINE)) {
		const start = match.index;
		if (start > last) {
			inlines.push({ kind: "text", at: last, text: text.slice(last, start) });
		}
		const [whole, strong, code, linkText, linkHref, starred, underscored] =
			match;
		if (strong !== undefined) {
			inlines.push({ kind: "strong", at: start, text: strong });
		} else if (code !== undefined) {
			inlines.push({ kind: "code", at: start, text: code });
		} else if (linkText !== undefined && linkHref !== undefined) {
			inlines.push({
				kind: "link",
				at: start,
				text: linkText,
				href: safeHrefOf(linkHref),
			});
		} else {
			inlines.push({
				kind: "emphasis",
				at: start,
				text: starred ?? underscored ?? "",
			});
		}
		last = start + whole.length;
	}
	if (last < text.length) {
		inlines.push({ kind: "text", at: last, text: text.slice(last) });
	}
	return inlines;
}

function isSpaceOrTab(char: string | undefined): boolean {
	return char === " " || char === "\t";
}

function isDigit(char: string | undefined): boolean {
	return char !== undefined && char >= "0" && char <= "9";
}

function withoutClosingHashes(text: string): string {
	let end = text.length;
	while (end > 0 && text[end - 1] === "#") end -= 1;
	if (end === text.length) return text;
	if (end === 0) return "";
	return isSpaceOrTab(text[end - 1]) ? text.slice(0, end).trimEnd() : text;
}

export function headingOf(
	line: string,
): { level: number; text: string } | null {
	let level = 0;
	while (level < line.length && line[level] === "#") level += 1;
	if (level === 0 || level > MAX_HEADING_LEVEL) return null;
	if (!isSpaceOrTab(line[level])) return null;
	return { level, text: withoutClosingHashes(line.slice(level).trim()) };
}

type ListKind = "bullet" | "numbered";

interface ListItemStart {
	readonly kind: ListKind;
	readonly number: number;
	readonly text: string;
}

export function listItemOf(line: string): ListItemStart | null {
	const text = line.trimStart();
	const marker = text[0];
	if (
		(marker === "-" || marker === "*" || marker === "+") &&
		isSpaceOrTab(text[1])
	) {
		return { kind: "bullet", number: 1, text: text.slice(2).trim() };
	}
	let digits = 0;
	while (digits <= MAX_ORDINAL_DIGITS && isDigit(text[digits])) digits += 1;
	if (digits === 0 || digits > MAX_ORDINAL_DIGITS) return null;
	const delimiter = text[digits];
	if (delimiter !== "." && delimiter !== ")") return null;
	if (!isSpaceOrTab(text[digits + 1])) return null;
	return {
		kind: "numbered",
		number: Number(text.slice(0, digits)),
		text: text.slice(digits + 2).trim(),
	};
}

interface PendingLines {
	readonly line: number;
	readonly texts: string[];
}

interface PendingList {
	readonly line: number;
	readonly kind: ListKind;
	readonly start: number;
	readonly items: { line: number; text: string }[];
}

export function markdownBlocksOf(markdown: string): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	const pending: {
		paragraph: PendingLines | null;
		list: PendingList | null;
	} = { paragraph: null, list: null };
	const flushParagraph = () => {
		const { paragraph } = pending;
		if (paragraph === null) return;
		blocks.push({
			kind: "paragraph",
			line: paragraph.line,
			inlines: inlinesOf(paragraph.texts.join(" ")),
		});
		pending.paragraph = null;
	};
	const flushList = () => {
		const { list } = pending;
		if (list === null) return;
		blocks.push({
			kind: "list",
			line: list.line,
			ordered: list.kind === "numbered",
			start: list.start,
			items: list.items.map((item) => ({
				line: item.line,
				inlines: inlinesOf(item.text),
			})),
		});
		pending.list = null;
	};
	markdown.split(LINE_BREAK).forEach((rawLine, line) => {
		const text = rawLine.trim();
		if (text === "") {
			flushParagraph();
			return;
		}
		const heading = headingOf(text);
		if (heading !== null) {
			flushParagraph();
			flushList();
			if (heading.text !== "") {
				blocks.push({
					kind: "heading",
					line,
					level: heading.level,
					inlines: inlinesOf(heading.text),
				});
			}
			return;
		}
		const item = listItemOf(text);
		if (item !== null) {
			flushParagraph();
			if (pending.list !== null && pending.list.kind !== item.kind) {
				flushList();
			}
			pending.list ??= {
				line,
				kind: item.kind,
				start: item.number,
				items: [],
			};
			pending.list.items.push({ line, text: item.text });
			return;
		}
		flushList();
		pending.paragraph ??= { line, texts: [] };
		pending.paragraph.texts.push(text);
	});
	flushParagraph();
	flushList();
	return blocks;
}

export function headingLevelsOf(
	blocks: readonly MarkdownBlock[],
	base: number,
): Map<number, number> {
	const levels = blocks.flatMap((block) =>
		block.kind === "heading" ? [block.level] : [],
	);
	const top = levels.reduce(
		(lowest, level) => Math.min(lowest, level),
		MAX_HEADING_LEVEL,
	);
	return new Map(
		levels.map((level) => [
			level,
			Math.min(MAX_HEADING_LEVEL, base + level - top),
		]),
	);
}
